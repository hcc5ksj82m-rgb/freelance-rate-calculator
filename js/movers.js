/* PackEV — "Today's movers": day-over-day change for LIVE-refreshed cards.
   Reads public.card_daily_movers (anon SELECT, RLS-safe view). One small request. */
(function () {
  'use strict';
  var box = document.getElementById('movers');
  if (!box) return;
  var cfg = window.PACK_EV_SUPABASE || {};
  var url = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
  var key = String(cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || '');
  if (!url || !key) { box.hidden = true; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { n = Number(n); return '$' + (n >= 100 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2)); }
  function fmtDay(iso) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function tile(r) {
    var pct = Number(r.pct_change);
    var cls = pct > 0 ? 'up' : 'down';
    var sign = pct > 0 ? '+' : '';
    return '<a class="mover" href="card.html?id=' + encodeURIComponent(r.card_id) + '">'
      + (r.image_small ? '<img src="' + esc(r.image_small) + '" alt="" loading="lazy" />' : '<span class="mover-ph"></span>')
      + '<span class="mover-m"><strong>' + esc(r.name) + '</strong>'
      + '<span class="tip">' + esc(r.set_name) + (r.number ? ' · #' + esc(r.number) : '') + '</span>'
      + '<span class="mover-p">' + money(r.now_usd) + ' <span class="' + cls + '">' + sign + pct.toFixed(1) + '%</span></span>'
      + '<span class="tip">was ' + money(r.prev_usd) + ' on ' + fmtDay(r.prev_day) + '</span></span></a>';
  }

  function col(title, rows) {
    if (!rows.length) return '';
    return '<div class="movers-col"><h3>' + title + '</h3>' + rows.map(tile).join('') + '</div>';
  }

  var sel = 'card_id,name,set_name,number,image_small,day,prev_day,prev_usd,now_usd,pct_change';
  fetch(url + '/rest/v1/card_daily_movers?select=' + sel + '&limit=500', {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      rows = (rows || []).filter(function (r) { return r && isFinite(Number(r.pct_change)); });
      if (!rows.length) { box.hidden = true; return; }
      var up = rows.filter(function (r) { return r.pct_change > 0; }).sort(function (a, b) { return b.pct_change - a.pct_change; }).slice(0, 5);
      var down = rows.filter(function (r) { return r.pct_change < 0; }).sort(function (a, b) { return a.pct_change - b.pct_change; }).slice(0, 5);
      box.innerHTML = '<div class="movers-head"><h2>Latest movers <span class="badge live">LIVE</span></h2>'
        + '<span class="tip">TCGPlayer prices for our daily-refreshed top cards, ' + fmtDay(rows[0].day)
        + ' vs the previous snapshot. High-value cards trade rarely, so big swings can come from a single sale.</span></div>'
        + '<div class="movers-grid">' + col('Biggest gains', up) + col('Biggest drops', down) + '</div>';
      box.hidden = false;
    })
    .catch(function () { box.hidden = true; });
})();
