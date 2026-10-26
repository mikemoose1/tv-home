/* TV Home: Apple TV-style launcher for TizenBrew. ES5 only (Tizen 5.5 Chromium). */
(function () {
  'use strict';

  var CFG = window.TVHOME_CONFIG || {};
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BKSP: 8, DONE: 65376, CANCEL: 65385 };
  var STORE_FEED = 'tvhome.feedUrl';
  var STORE_CACHE = 'tvhome.lastFeed';

  // Known Tizen app ids. More than one id per app because Samsung changed them by model year.
  // Tiles are matched against the TV's installed-app list when the helper service answers.
  var APPS = [
    { key: 'youtube', label: 'YouTube', ids: ['111299001912'], match: /^youtube$/i, cls: 'youtube', logo: '<span class="glyph">&#9654;</span>&nbsp;YouTube', bg: '#ff0033', fg: '#fff' },
    { key: 'netflix', label: 'Netflix', ids: ['3201907018807', '11101200001'], match: /netflix/i, logo: 'NETFLIX', bg: '#141414', fg: '#e50914' },
    { key: 'prime', label: 'Prime Video', ids: ['3201910019365', '3201512006785'], match: /prime video/i, logo: 'prime video', bg: '#00a8e1', fg: '#fff' },
    { key: 'disney', label: 'Disney+', ids: ['3201901017640'], match: /disney/i, logo: 'Disney+', bg: 'linear-gradient(135deg,#0a1a4a,#1b4fa8)', fg: '#fff' },
    { key: 'jellyfin', label: 'Jellyfin', ids: ['AprZAARz4r.Jellyfin'], match: /jellyfin/i, logo: 'Jellyfin', bg: 'linear-gradient(135deg,#aa5cc3,#00a4dc)', fg: '#fff', optional: true },
    { key: 'appletv', label: 'Apple TV', ids: ['3201807016597'], match: /^apple tv$/i, logo: 'Apple TV', bg: '#000', fg: '#fff', optional: true },
    { key: 'plex', label: 'Plex', ids: ['3201512006963'], match: /^plex$/i, logo: 'plex', bg: '#1f1f1f', fg: '#e5a00d', optional: true },
    { key: 'spotify', label: 'Spotify', ids: ['3201606009684'], match: /spotify/i, logo: 'Spotify', bg: '#121212', fg: '#1ed760', optional: true }
  ];

  var state = {
    rows: [],          // [{ el, items: [{el, ...}] }]
    row: 1,
    col: [0, 0],
    overlay: null,     // null | 'settings' | 'detail'
    sheetIdx: 0,
    installed: null,   // map id -> name, or null if unknown
    service: false,
    modules: null,
    feed: null,
    feedOk: false
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function xhr(method, url, timeout, cb) {
    var r = new XMLHttpRequest();
    var done = false;
    function fin(err, body) { if (done) return; done = true; cb(err, body); }
    try {
      r.open(method, url, true);
      r.timeout = timeout || 5000;
      r.onload = function () {
        if (r.status >= 200 && r.status < 300) {
          var data = null;
          try { data = JSON.parse(r.responseText); } catch (e) { data = r.responseText; }
          fin(null, data);
        } else fin(new Error('HTTP ' + r.status));
      };
      r.onerror = function () { fin(new Error('network')); };
      r.ontimeout = function () { fin(new Error('timeout')); };
      r.send();
    } catch (e) { fin(e); }
  }

  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast hidden'; }, ms || 2500);
  }

  // ---------- Clock ----------
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + pad(m) + ' ' + ap;
  }
  function tickClock() {
    var d = new Date();
    var h = d.getHours();
    $('clock').textContent = fmtTime(d).replace(/ (AM|PM)$/, '');
    $('date').textContent = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    $('hello').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    if (state.lastDay !== d.getDate()) { state.lastDay = d.getDate(); if (state.feed) renderDays(); }
  }

  // ---------- Calendar ----------
  function feedUrl() {
    var v = null;
    try { v = localStorage.getItem(STORE_FEED); } catch (e) {}
    return v || CFG.feedUrl;
  }

  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function personColor(ev) {
    var p = ev.people || [];
    for (var i = 0; i < p.length; i++) {
      if (p[i].color && p[i].color.toLowerCase() !== '#dadada') return p[i].color;
    }
    return '#8e8e93';
  }

  function peopleText(ev) {
    var out = [];
    var p = ev.people || [];
    for (var i = 0; i < p.length; i++) out.push(p[i].name);
    return out.join(' \u00b7 ');
  }

  // Bucket events into the next 7 local days. All-day events cover every day they span.
  function bucket(events) {
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var days = [];
    var map = {};
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var b = { date: d, events: [] };
      days.push(b); map[dayKey(d)] = b;
    }
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      var s = new Date(ev.start);
      if (isNaN(s.getTime())) continue;
      if (ev.allDay) {
        var e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 86400000);
        var cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
        var guard = 0;
        do {
          if (map[dayKey(cur)]) map[dayKey(cur)].events.push(ev);
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
          guard++;
        } while (cur < e && guard < 31);
      } else if (map[dayKey(s)]) {
        map[dayKey(s)].events.push(ev);
      }
    }
    for (var k = 0; k < days.length; k++) {
      days[k].events.sort(function (a, b) {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return new Date(a.start) - new Date(b.start);
      });
    }
    return days;
  }

  function evTime(ev) {
    if (ev.allDay) return 'All day';
    var s = new Date(ev.start);
    return fmtTime(s);
  }

  function evHtml(ev, withPeople) {
    var h = '<div class="ev" style="color:' + esc(personColor(ev)) + '">' +
      '<div class="t">' + esc(evTime(ev)) + '</div>' +
      '<div class="n">' + esc(ev.title) + '</div>';
    if (withPeople) {
      var pt = peopleText(ev);
      if (pt) h += '<div class="p">' + esc(pt) + '</div>';
    }
    return h + '</div>';
  }

  function renderDays() {
    var wrap = $('days');
    wrap.innerHTML = '';
    var items = [];
    var feed = state.feed;
    var days = bucket(feed && feed.events ? feed.events : []);
    for (var i = 0; i < days.length; i++) {
      var day = days[i];
      var isToday = i === 0;
      var card = el('div', 'day' + (isToday ? ' today' : ''));
      var name = isToday ? 'Today' : (i === 1 ? 'Tomorrow' : DAYS[day.date.getDay()].slice(0, 3));
      var h = '<div class="day-name">' + name + (isToday ? ' \u00b7 ' + DAYS[day.date.getDay()] : '') + '</div>' +
        '<div class="day-num">' + (isToday ? MONTHS[day.date.getMonth()].slice(0, 3) + ' ' : '') + day.date.getDate() + '</div>';
      var limit = isToday ? 4 : 4;
      if (!feed) {
        h += '<div class="empty">' + (isToday ? 'Calendar offline' : '') + '</div>';
      } else if (!day.events.length) {
        h += '<div class="empty">' + (isToday ? 'Nothing scheduled' : 'Free') + '</div>';
      } else {
        for (var j = 0; j < day.events.length && j < limit; j++) h += evHtml(day.events[j], isToday);
        if (day.events.length > limit) h += '<div class="more">+' + (day.events.length - limit) + ' more</div>';
      }
      card.innerHTML = h;
      wrap.appendChild(card);
      items.push({ el: card, day: day });
    }
    state.rows[0] = { el: wrap, items: items };
    applyFocus();
  }

  function setStatus(text, offline) {
    var s = $('cal-status');
    s.textContent = text;
    s.className = 'cal-status' + (offline ? ' offline' : '');
  }

  function loadFeed() {
    xhr('GET', feedUrl() + (feedUrl().indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), 8000, function (err, data) {
      if (!err && data && data.ok && data.events) {
        state.feed = data; state.feedOk = true;
        try { localStorage.setItem(STORE_CACHE, JSON.stringify(data)); } catch (e) {}
        setStatus('Updated ' + fmtTime(new Date()) + (data.stale ? ' (cached on server)' : ''), false);
      } else {
        state.feedOk = false;
        if (!state.feed) {
          try { var c = localStorage.getItem(STORE_CACHE); if (c) state.feed = JSON.parse(c); } catch (e) {}
        }
        setStatus(state.feed ? 'Calendar offline \u00b7 showing last saved schedule' : 'Calendar offline', true);
      }
      renderDays();
    });
  }

  // ---------- Apps ----------
  function installedId(app) {
    if (!state.installed) return null;
    for (var i = 0; i < app.ids.length; i++) if (state.installed[app.ids[i]]) return app.ids[i];
    for (var id in state.installed) {
      if (Object.prototype.hasOwnProperty.call(state.installed, id) && app.match.test(state.installed[id])) return id;
    }
    return null;
  }

  function makeTile(spec) {
    var t = el('div', 'tile' + (spec.missing ? ' missing' : ''));
    t.style.background = spec.bg;
    t.style.color = spec.fg;
    t.innerHTML = '<div class="logo">' + spec.logo + '</div>';
    return t;
  }

  function renderApps() {
    var wrap = $('apps');
    wrap.innerHTML = '';
    var items = [];
    function add(spec) {
      var t = makeTile(spec);
      wrap.appendChild(t);
      spec.el = t;
      items.push(spec);
    }
    for (var i = 0; i < APPS.length; i++) {
      var a = APPS[i];
      var id = installedId(a);
      if (state.installed && !id && a.optional) continue;
      if (!state.installed && a.optional && a.key !== 'jellyfin') continue;
      add({ kind: 'app', label: a.label, logo: a.logo, bg: a.bg, fg: a.fg, id: id || a.ids[0], missing: !!state.installed && !id });
    }
    // TizenBrew modules (TizenTube etc.) from TizenBrew's own module list
    var mods = state.modules;
    if (!mods) mods = [{ name: '@foxreis/tizentube', moduleType: 'npm', appName: 'TizenTube' }];
    for (var m = 0; m < mods.length; m++) {
      var md = mods[m];
      if (String(md.name).indexOf(CFG.selfModule) >= 0 || md.appName === 'TV Home') continue;
      if (md.appName === 'Unknown Module') continue;
      var isTT = /tizentube/i.test(md.name);
      add({ kind: 'module', label: md.appName + ' (TizenBrew)', logo: isTT ? '<span class="glyph">&#9654;</span>&nbsp;TizenTube' : esc(md.appName),
        bg: isTT ? 'linear-gradient(135deg,#3a0d0d,#b3161b)' : 'linear-gradient(135deg,#1d2a44,#3d5a8a)', fg: '#fff', name: md.name, type: md.moduleType });
    }
    add({ kind: 'settings', label: 'Home Screen Settings', logo: 'Settings', bg: 'linear-gradient(135deg,#3a3a3c,#636366)', fg: '#fff' });
    state.rows[1] = { el: wrap, items: items };
    if (state.col[1] >= items.length) state.col[1] = items.length - 1;
    applyFocus();
  }

  function launch(item) {
    if (item.kind === 'settings') return openSettings();
    if (item.kind === 'module') {
      toast('Opening ' + item.label.replace(' (TizenBrew)', '') + '\u2026');
      return xhr('GET', CFG.serviceUrl + '/module?name=' + encodeURIComponent(item.name) + '&type=' + encodeURIComponent(item.type), 5000, function (err) {
        if (err) toast('Could not open it: TV Home helper service is not running. Relaunch TizenBrew and try again.', 5000);
      });
    }
    if (item.missing) return toast(item.label + ' is not installed on this TV', 3000);
    toast('Opening ' + item.label + '\u2026');
    xhr('GET', CFG.serviceUrl + '/launch?id=' + encodeURIComponent(item.id), 5000, function (err, res) {
      if (!err && res && res.ok) return;
      // Fallback: the TV's own REST API (POST /api/v2/applications/<id>). The page cannot read the
      // cross-origin response, but a simple POST is still delivered.
      var r = new XMLHttpRequest();
      try { r.open('POST', CFG.tvApiUrl + '/applications/' + encodeURIComponent(item.id), true); r.send(); } catch (e) {}
    });
  }

  function probeService() {
    xhr('GET', CFG.serviceUrl + '/apps', 4000, function (err, res) {
      if (!err && res && res.ok && res.apps) {
        state.service = true;
        state.installed = {};
        for (var i = 0; i < res.apps.length; i++) state.installed[res.apps[i].id] = res.apps[i].name;
        renderApps();
      } else if (!probeService.tries || probeService.tries < 5) {
        probeService.tries = (probeService.tries || 0) + 1;
        setTimeout(probeService, 1500);  // TizenBrew starts the service when the module launches
      }
    });
  }

  // Ask TizenBrew's local service for its module list (same WebSocket its own UI uses).
  function loadModules() {
    var ws;
    try { ws = new WebSocket('ws://127.0.0.1:8081'); } catch (e) { return; }
    var timer = setTimeout(function () { try { ws.close(); } catch (e) {} }, 5000);
    ws.onopen = function () { ws.send(JSON.stringify({ type: 4, payload: false })); };
    ws.onmessage = function (m) {
      var msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.type === 4 && msg.payload && msg.payload.length !== undefined) {
        state.modules = msg.payload;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        renderApps();
      }
    };
    ws.onerror = function () {};
  }

  // ---------- Focus / navigation ----------
  function applyFocus() {
    for (var r = 0; r < state.rows.length; r++) {
      var row = state.rows[r];
      if (!row) continue;
      for (var i = 0; i < row.items.length; i++) {
        var on = !state.overlay && r === state.row && i === state.col[r];
        var e = row.items[i].el;
        var base = e.className.replace(/\s*focused/g, '');
        e.className = on ? base + ' focused' : base;
      }
    }
    var cur = state.rows[1] && state.rows[1].items[state.col[1]];
    $('app-label').innerHTML = state.row === 1 && cur ? esc(cur.label) : '&nbsp;';
    if (state.row === 1 && cur) {
      var labelX = cur.el.offsetLeft;
      $('app-label').style.paddingLeft = Math.max(0, labelX + scrollApps()) + 'px';
    }
  }

  // Keep the focused tile on screen by sliding the row left.
  function scrollApps() {
    var row = state.rows[1];
    if (!row || !row.items.length) return 0;
    var t = row.items[state.col[1]].el;
    var visible = 1920 - 96 - 140;
    var shift = 0;
    var right = t.offsetLeft + t.offsetWidth;
    if (right > visible) shift = visible - right;
    row.el.style.webkitTransform = 'translateX(' + shift + 'px)';
    row.el.style.transform = 'translateX(' + shift + 'px)';
    return shift;
  }

  function move(dx, dy) {
    if (dy) {
      var nr = state.row + dy;
      if (nr < 0 || nr >= state.rows.length || !state.rows[nr] || !state.rows[nr].items.length) return;
      state.row = nr;
    } else {
      var items = state.rows[state.row].items;
      var nc = state.col[state.row] + dx;
      if (nc < 0 || nc >= items.length) return;
      state.col[state.row] = nc;
    }
    applyFocus();
  }

  // ---------- Day detail ----------
  function openDetail(day) {
    var ov = $('detail');
    if (!ov) {
      ov = el('div', 'overlay hidden');
      ov.id = 'detail';
      document.body.appendChild(ov);
    }
    var d = day.date;
    var h = '<div class="sheet"><div class="sheet-title">' + DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + '</div><div class="detail-list">';
    if (!state.feed) h += '<div class="empty">Calendar offline</div>';
    else if (!day.events.length) h += '<div class="empty">Nothing scheduled</div>';
    for (var i = 0; i < day.events.length; i++) h += evHtml(day.events[i], true);
    h += '</div><div class="hint">Press Back to close.</div></div>';
    ov.innerHTML = h;
    ov.className = 'overlay';
    state.overlay = 'detail';
    applyFocus();
  }

  // ---------- Settings ----------
  var SHEET = ['feed-url', 'btn-save', 'btn-reset', 'btn-close'];
  function openSettings() {
    $('feed-url').value = feedUrl();
    $('settings').className = 'overlay';
    state.overlay = 'settings';
    state.sheetIdx = 0;
    sheetFocus();
    applyFocus();
  }
  function closeOverlay() {
    var inp = $('feed-url');
    if (document.activeElement === inp) inp.blur();
    $('settings').className = 'overlay hidden';
    if ($('detail')) $('detail').className = 'overlay hidden';
    state.overlay = null;
    applyFocus();
  }
  function sheetFocus() {
    for (var i = 0; i < SHEET.length; i++) {
      var e = $(SHEET[i]);
      var base = e.className.replace(/\s*focused/g, '');
      e.className = i === state.sheetIdx ? base + ' focused' : base;
    }
  }
  function sheetAction() {
    var id = SHEET[state.sheetIdx];
    if (id === 'feed-url') { $('feed-url').focus(); return; }
    if (id === 'btn-save') {
      var v = $('feed-url').value.replace(/^\s+|\s+$/g, '');
      try { if (v) localStorage.setItem(STORE_FEED, v); } catch (e) {}
      closeOverlay(); toast('Saved. Refreshing calendar\u2026'); loadFeed(); return;
    }
    if (id === 'btn-reset') {
      try { localStorage.removeItem(STORE_FEED); } catch (e) {}
      $('feed-url').value = CFG.feedUrl; toast('Using default feed'); loadFeed(); return;
    }
    closeOverlay();
  }

  function onKey(e) {
    var k = e.keyCode;
    var inp = $('feed-url');
    var typing = document.activeElement === inp;

    if (state.overlay === 'settings') {
      if (typing) {
        if (k === KEY.ENTER || k === KEY.DONE || k === KEY.DOWN) { inp.blur(); state.sheetIdx = 1; sheetFocus(); e.preventDefault(); }
        else if (k === KEY.BACK || k === KEY.CANCEL || k === KEY.ESC) { inp.blur(); e.preventDefault(); }
        return;
      }
      if (k === KEY.UP) state.sheetIdx = 0;
      else if (k === KEY.DOWN && state.sheetIdx === 0) state.sheetIdx = 1;
      else if (k === KEY.LEFT && state.sheetIdx > 1) state.sheetIdx--;
      else if (k === KEY.RIGHT && state.sheetIdx > 0 && state.sheetIdx < SHEET.length - 1) state.sheetIdx++;
      else if (k === KEY.ENTER) sheetAction();
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP) closeOverlay();
      sheetFocus();
      e.preventDefault();
      return;
    }
    if (state.overlay === 'detail') {
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BKSP || k === KEY.ENTER) closeOverlay();
      e.preventDefault();
      return;
    }

    switch (k) {
      case KEY.LEFT: move(-1, 0); break;
      case KEY.RIGHT: move(1, 0); break;
      case KEY.UP: move(0, -1); break;
      case KEY.DOWN: move(0, 1); break;
      case KEY.ENTER: {
        var item = state.rows[state.row].items[state.col[state.row]];
        if (state.row === 0) openDetail(item.day); else launch(item);
        break;
      }
      case KEY.BACK: case KEY.ESC: case KEY.BKSP:
        // Home screen: Back just returns focus to the first app tile.
        state.row = 1; state.col[1] = 0; applyFocus();
        break;
      default: return;
    }
    e.preventDefault();
  }

  // Exposed for automated tests in a desktop browser.
  window.__tvhome = { state: state, move: move, render: function () { renderDays(); renderApps(); }, setFeed: function (f) { state.feed = f; renderDays(); } };

  function init() {
    tickClock();
    setInterval(tickClock, 1000);
    renderDays();
    renderApps();
    document.addEventListener('keydown', onKey, true);
    loadFeed();
    setInterval(loadFeed, (CFG.refreshMinutes || 5) * 60000);
    probeService();
    loadModules();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
