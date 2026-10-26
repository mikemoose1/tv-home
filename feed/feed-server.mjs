// tv-home calendar feed: serves Skylight events as small JSON for the TV home screen.
// LAN-only helper meant to run on a home Mac under launchd. No data is stored on disk
// except skylight-mcp's own token cache (~/.skylight-mcp/tokens.json).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Load KEY=VALUE env file (chmod 600) without printing it.
function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile(process.env.TVHOME_ENV_FILE || path.join(here, 'skylight.env'));

const PORT = Number(process.env.TVHOME_PORT || 8787);
const HOST = process.env.TVHOME_HOST || '0.0.0.0';
const DAYS = Number(process.env.TVHOME_DAYS || 8);
const CACHE_MS = Number(process.env.TVHOME_CACHE_MS || 120000);
const TZ = process.env.TVHOME_TZ || 'America/New_York';

const pkgDir = path.join(here, 'node_modules', 'skylight-mcp', 'dist');
const { resolveAuth } = await import(pathToFileURL(path.join(pkgDir, 'auth.js')).href);

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    clientPromise = resolveAuth().then(r => r.client).catch(e => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

function ymd(d) {
  // YYYY-MM-DD in the household time zone
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function index(included) {
  const map = {};
  for (const r of included || []) map[r.type + ':' + r.id] = r;
  return map;
}

function rel(ev, name) {
  const r = ev.relationships && ev.relationships[name];
  if (!r || !r.data) return [];
  return Array.isArray(r.data) ? r.data : [r.data];
}

async function fetchEvents() {
  const c = await getClient();
  const frameId = await c.resolveFrameId();
  const now = new Date();
  const end = new Date(now.getTime() + (DAYS - 1) * 86400000);
  const doc = await c.request('GET', `/frames/${encodeURIComponent(frameId)}/calendar_events`, {
    query: { date_min: ymd(now), date_max: ymd(end), timezone: TZ, include: 'categories' },
  });
  const inc = index(doc.included);
  const events = (doc.data || []).map(ev => {
    const a = ev.attributes || {};
    const people = rel(ev, 'categories').map(ref => {
      const cat = inc[ref.type + ':' + ref.id];
      const ca = (cat && cat.attributes) || {};
      return { name: ca.label || ca.name || '', color: ca.color || null };
    }).filter(p => p.name);
    return {
      title: a.summary || '(No title)',
      start: a.starts_at || null,
      end: a.ends_at || null,
      allDay: !!a.all_day,
      location: a.location || null,
      people,
    };
  }).filter(e => e.start);
  events.sort((x, y) => String(x.start).localeCompare(String(y.start)));
  return { ok: true, generatedAt: new Date().toISOString(), timezone: TZ, days: DAYS, events };
}

let cache = null, cacheAt = 0, inflight = null;
async function getFeed() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = fetchEvents().then(f => { cache = f; cacheAt = Date.now(); return f; })
      .finally(() => { inflight = null; });
  }
  try { return await inflight; } catch (e) {
    if (cache) return Object.assign({}, cache, { stale: true });
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url !== '/calendar.json') { res.writeHead(404); return res.end(); }
  try {
    const feed = await getFeed();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(feed));
  } catch (e) {
    console.error(new Date().toISOString(), 'feed error:', e && e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'calendar unavailable' }));
  }
});
server.listen(PORT, HOST, () => console.log(`tv-home feed on http://${HOST}:${PORT}/calendar.json`));
