/* PackEV — "Latest movers": 1D / 7D / 30D for LIVE-refreshed cards.
   One read of public.card_period_movers. Falls back to card_daily_movers. */
(function () {
  'use strict';
  var box = document.getElementById('movers');
  if (!box) return;
  var cfg = window.PACK_EV_SUPABASE || {};
  var url = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
  var key = String(cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || '');
  if (!url || !key) { box.hidden = true; return; }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var STORE = 'packev-movers-window';
  var ORDER = ['1d', '7d', '30d'];
  var WINDOWS = {
    '1d': { label: '1D', pct: 'pct_1d', usd: 'prev_usd_1d', day: 'prev_day_1d' },
    '7d': { label: '7D', pct: 'pct_7d', usd: 'base_usd_7d', day: 'base_day_7d' },
    '30d': { label: '30D', pct: 'pct_30d', usd: 'base_usd_30d', day: 'base_day_30d' }
  };

  var periodRows = null;
  var active = '1d';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { n = Number(n); return '$' + (n >= 100 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2)); }
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
  }
  function daysBetween(later, earlier) {
    var a = Date.parse(String(later).slice(0, 10) + 'T00:00:00Z');
    var b = Date.parse(String(earlier).slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.round((a - b) / 86400000);
  }
  function readStore() {
    try { return localStorage.getItem(STORE); } catch (e) { return null; }
  }
  function writeStore(v) {
    try { localStorage.setItem(STORE, v); } catch (e) { /* private mode */ }
  }

  function tile(r, pctKey, usdKey, dayKey) {
    var pct = Number(r[pctKey]);
    var cls = pct > 0 ? 'up' : 'down';
    var sign = pct > 0 ? '+' : '';
    return '<a class="mover" href="card.html?id=' + encodeURIComponent(r.card_id) + '">'
      + (r.image_small ? '<img src="' + esc(r.image_small) + '" alt="" loading="lazy" />' : '<span class="mover-ph"></span>')
      + '<span class="mover-m"><strong>' + esc(r.name) + '</strong>'
      + '<span class="tip">' + esc(r.set_name) + (r.number ? ' · #' + esc(r.number) : '') + '</span>'
      + '<span class="mover-p">' + money(r.now_usd) + ' <span class="' + cls + '">' + sign + pct.toFixed(1) + '%</span></span>'
      + '<span class="tip">was ' + money(r[usdKey]) + ' on ' + fmtDay(r[dayKey]) + '</span></span></a>';
  }

  function col(title, rows, pctKey, usdKey, dayKey) {
    if (!rows.length) return '';
    return '<div class="movers-col"><h3>' + title + '</h3>' + rows.map(function (r) {
      return tile(r, pctKey, usdKey, dayKey);
    }).join('') + '</div>';
  }

  function ranked(rows, pctKey) {
    var list = rows.filter(function (r) {
      var p = Number(r[pctKey]);
      return isFinite(p) && p !== 0;
    });
    return {
      up: list.filter(function (r) { return Number(r[pctKey]) > 0; })
        .sort(function (a, b) { return Number(b[pctKey]) - Number(a[pctKey]); }).slice(0, 5),
      down: list.filter(function (r) { return Number(r[pctKey]) < 0; })
        .sort(function (a, b) { return Number(a[pctKey]) - Number(b[pctKey]); }).slice(0, 5)
    };
  }

  function windowOn(rows, id) {
    if (id === '7d') {
      return rows.some(function (r) {
        return r.base_day_7d && r.prev_day_1d && String(r.base_day_7d) < String(r.prev_day_1d);
      });
    }
    if (id === '30d') {
      return rows.some(function (r) {
        return r.base_day_30d && r.base_day_7d && String(r.base_day_30d) < String(r.base_day_7d);
      });
    }
    return true;
  }

  function hasMovers(rows, id) {
    var key = WINDOWS[id].pct;
    return rows.some(function (r) {
      var p = Number(r[key]);
      return isFinite(p) && p !== 0;
    });
  }

  function choose(rows) {
    var saved = readStore();
    if (saved && WINDOWS[saved] && windowOn(rows, saved)) return saved;
    if (windowOn(rows, '7d') && hasMovers(rows, '7d')) return '7d';
    return '1d';
  }

  function comparisonPhrase(live, bases) {
    if (!live || !bases.length) return 'vs the previous TCGPlayer snapshot';
    if (bases.length === 1) {
      var n = daysBetween(live, bases[0]);
      var span = n == null ? '' : ' (' + n + ' day' + (n === 1 ? '' : 's') + ')';
      return 'vs snapshots from ' + fmtDay(bases[0]) + span;
    }
    var newest = daysBetween(live, bases[bases.length - 1]);
    var oldest = daysBetween(live, bases[0]);
    var span = (newest != null && oldest != null) ? ' (' + newest + '–' + oldest + ' days)' : '';
    return 'vs snapshots from ' + fmtDay(bases[0]) + ' to ' + fmtDay(bases[bases.length - 1]) + span;
  }

  function basesFor(rows, id, onlyMoved) {
    var dayKey = WINDOWS[id].day;
    var pctKey = WINDOWS[id].pct;
    var seen = Object.create(null);
    var out = [];
    rows.forEach(function (r) {
      if (onlyMoved) {
        var p = Number(r[pctKey]);
        if (!isFinite(p) || p === 0) return;
      }
      var d = r[dayKey] ? String(r[dayKey]).slice(0, 10) : '';
      if (!d || seen[d]) return;
      seen[d] = true;
      out.push(d);
    });
    out.sort();
    return out;
  }

  function liveDay(rows) {
    var d = '';
    rows.forEach(function (r) {
      var day = String(r.day || '').slice(0, 10);
      if (day > d) d = day;
    });
    return d;
  }

  function paintDaily(rows) {
    rows = (rows || []).filter(function (r) { return r && isFinite(Number(r.pct_change)); });
    if (!rows.length) { box.hidden = true; return; }
    var lists = ranked(rows, 'pct_change');
    box.innerHTML = '<div class="movers-head"><h2>Latest movers <span class="badge live">LIVE</span></h2>'
      + '<span class="tip">TCGPlayer prices for our daily-refreshed top cards, ' + fmtDay(rows[0].day)
      + ' vs the previous snapshot. High-value cards trade rarely, so big swings can come from a single sale.</span></div>'
      + '<div class="movers-grid">'
      + col('Biggest gains', lists.up, 'pct_change', 'prev_usd', 'prev_day')
      + col('Biggest drops', lists.down, 'pct_change', 'prev_usd', 'prev_day')
      + '</div>';
    box.hidden = false;
  }

  function paintPeriod() {
    var rows = periodRows || [];
    if (!rows.length) { box.hidden = true; return; }
    var win = WINDOWS[active] || WINDOWS['1d'];
    var lists = ranked(rows, win.pct);
    var live = liveDay(rows);
    var bases = basesFor(rows, active, true);
    if (!bases.length) bases = basesFor(rows, active, false);
    var phrase = comparisonPhrase(live, bases);
    var toggle = '<div class="movers-toggle" role="tablist" aria-label="Price change window">'
      + ORDER.map(function (id) {
        var on = windowOn(rows, id);
        return '<button type="button" role="tab" data-win="' + id + '" aria-selected="' + (id === active ? 'true' : 'false') + '"'
          + (on ? '' : ' disabled title="Needs more history"')
          + '>' + WINDOWS[id].label + '</button>';
      }).join('')
      + '</div>';
    var grid = (!lists.up.length && !lists.down.length)
      ? '<p class="tip">No price changes in this window.</p>'
      : '<div class="movers-grid">'
        + col('Biggest gains', lists.up, win.pct, win.usd, win.day)
        + col('Biggest drops', lists.down, win.pct, win.usd, win.day)
        + '</div>';
    box.innerHTML = '<div class="movers-head"><div class="movers-head-top"><h2>Latest movers <span class="badge live">LIVE</span></h2>'
      + toggle + '</div>'
      + '<span class="tip">TCGPlayer prices for our daily-refreshed top cards, ' + fmtDay(live) + ' '
      + phrase + '. High-value cards trade rarely, so big swings can come from a single sale.</span></div>'
      + grid;
    box.hidden = false;
  }

  box.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('button[data-win]') : null;
    if (!btn || btn.disabled || !periodRows) return;
    var id = btn.getAttribute('data-win');
    if (!id || !WINDOWS[id] || id === active || !windowOn(periodRows, id)) return;
    active = id;
    writeStore(id);
    paintPeriod();
  });

  function headers() {
    return { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' };
  }

  function loadDaily() {
    var sel = 'card_id,name,set_name,number,image_small,day,prev_day,prev_usd,now_usd,pct_change';
    return fetch(url + '/rest/v1/card_daily_movers?select=' + sel + '&limit=500', { headers: headers() })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(paintDaily)
      .catch(function () { box.hidden = true; });
  }

  var sel = 'card_id,name,set_name,number,image_small,day,now_usd,prev_day_1d,prev_usd_1d,pct_1d,base_day_7d,base_usd_7d,pct_7d,base_day_30d,base_usd_30d,pct_30d';
  fetch(url + '/rest/v1/card_period_movers?select=' + sel + '&limit=500', { headers: headers() })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      if (!Array.isArray(rows)) throw new Error('bad');
      if (!rows.length) { box.hidden = true; return; }
      periodRows = rows;
      active = choose(rows);
      paintPeriod();
    })
    .catch(loadDaily);
})();
