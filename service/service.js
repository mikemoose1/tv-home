// tv-home helper service. Runs inside TizenBrew's service sandbox, which exposes
// the `tizen` global and Node built-ins. The home page itself has no Tizen APIs,
// so it asks this service (on 127.0.0.1 only) to list and launch apps.
// Written in ES5 for old Tizen Node runtimes.
'use strict';
var http = require('http');
var url = require('url');
var PORT = 8097;

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function listApps(res) {
  try {
    tizen.application.getAppsInfo(function (apps) {
      var out = [];
      for (var i = 0; i < apps.length; i++) {
        if (apps[i].show === false) continue;
        out.push({ id: apps[i].id, name: apps[i].name });
      }
      send(res, 200, { ok: true, apps: out });
    }, function (e) {
      send(res, 500, { ok: false, error: String(e && e.message) });
    });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e && e.message) });
  }
}

function launchApp(res, id) {
  if (!id) return send(res, 400, { ok: false, error: 'missing id' });
  try {
    tizen.application.launch(id, function () {
      send(res, 200, { ok: true });
    }, function (e) {
      send(res, 500, { ok: false, error: String(e && e.message) });
    });
  } catch (e) {
    send(res, 500, { ok: false, error: String(e && e.message) });
  }
}

// Launch another TizenBrew module the same way TizenTube's DIAL service does:
// an app control to TizenBrew carrying {moduleName, moduleType}.
function launchModule(res, name, type) {
  if (!name || !type) return send(res, 400, { ok: false, error: 'missing module' });
  try {
    var pkg = tizen.application.getAppInfo().packageId;
    var data = [new tizen.ApplicationControlData('module', [JSON.stringify({ moduleName: name, moduleType: type })])];
    tizen.application.launchAppControl(
      new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, data),
      pkg + '.TizenBrewStandalone',
      function () { send(res, 200, { ok: true }); },
      function (e) { send(res, 500, { ok: false, error: String(e && e.message) }); }
    );
  } catch (e) {
    send(res, 500, { ok: false, error: String(e && e.message) });
  }
}

var server = http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (u.pathname === '/ping') return send(res, 200, { ok: true, service: 'tv-home' });
  if (u.pathname === '/apps') return listApps(res);
  if (u.pathname === '/launch') return launchApp(res, u.query.id);
  if (u.pathname === '/module') return launchModule(res, u.query.name, u.query.type);
  send(res, 404, { ok: false });
});
server.on('error', function (e) {
  // Already running from an earlier launch: keep the existing listener.
  if (e && e.code !== 'EADDRINUSE') console.log('tv-home service error: ' + e.message);
});
server.listen(PORT, '127.0.0.1');
module.exports = server;
