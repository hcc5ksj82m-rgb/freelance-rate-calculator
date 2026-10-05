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

  function usdChange(r) {
    return Number(r.now_usd) - Number(r.prev_usd);
  }

  function signedMoney(n) {
    n = Number(n);
    if (!isFinite(n)) return '—';
    var sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    return sign + money(Math.abs(n));
  }

  function tile(r) {
    var pct = Number(r.pct_change);
    var delta = usdChange(r);
    var cls = delta > 0 ? 'up' : 'down';
    var sign = pct > 0 ? '+' : '';
    return '<a class="mover" href="card.html?id=' + encodeURIComponent(r.card_id) + '">'
      + (r.image_small ? '<img src="' + esc(r.image_small) + '" alt="" loading="lazy" />' : '<span class="mover-ph"></span>')
      + '<span class="mover-m"><strong>' + esc(r.name) + '</strong>'
      + '<span class="tip">' + esc(r.set_name) + (r.number ? ' · #' + esc(r.number) : '') + '</span>'
      + '<span class="mover-p">' + money(r.now_usd) + '</span>'
      + '<span class="mover-delta ' + cls + '">' + sign + pct.toFixed(1) + '% · ' + signedMoney(delta) + '</span>'
      + '<span class="tip">from ' + money(r.prev_usd) + ' on ' + fmtDay(r.prev_day) + '</span></span></a>';
  }

  function col(title, rows) {
    if (!rows.length) return '';
    return '<div class="movers-col"><h3>' + title + '</h3>' + rows.map(tile).join('') + '</div>';
  }

  function paint(rows, mode) {
    var gainTitle = mode === 'usd' ? 'Biggest $ gains' : 'Biggest % gains';
    var dropTitle = mode === 'usd' ? 'Biggest $ drops' : 'Biggest % drops';
    var up = rows.filter(function (r) { return usdChange(r) > 0; });
    var down = rows.filter(function (r) { return usdChange(r) < 0; });
    if (mode === 'usd') {
      up.sort(function (a, b) { return usdChange(b) - usdChange(a); });
      down.sort(function (a, b) { return usdChange(a) - usdChange(b); });
    } else {
      up.sort(function (a, b) { return Number(b.pct_change) - Number(a.pct_change); });
      down.sort(function (a, b) { return Number(a.pct_change) - Number(b.pct_change); });
    }
    up = up.slice(0, 5);
    down = down.slice(0, 5);
    var how = mode === 'usd' ? 'dollar change' : 'percent change';
    box.innerHTML = '<div class="movers-head"><h2>Latest movers <span class="badge live">LIVE</span></h2>'
      + '<span class="tip">TCGPlayer prices for daily-refreshed cards, ' + fmtDay(rows[0].day)
      + ' vs the previous snapshot (within 7 days). Percent and dollar change use those two points only. '
      + 'High-value cards trade rarely, so a big swing can be one sale.</span>'
      + '<div class="movers-sort" role="group" aria-label="Sort movers">'
      + '<button type="button" class="phist-chip' + (mode === 'pct' ? ' active' : '') + '" data-mode="pct">By %</button>'
      + '<button type="button" class="phist-chip' + (mode === 'usd' ? ' active' : '') + '" data-mode="usd">By $</button>'
      + '</div></div>'
      + '<p class="tip movers-caption">Showing the five largest moves by ' + how + '.</p>'
      + '<div class="movers-grid">' + col(gainTitle, up) + col(dropTitle, down) + '</div>';
    box.hidden = false;
    box.querySelectorAll('[data-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { paint(rows, btn.getAttribute('data-mode')); });
    });
  }

  var sel = 'card_id,name,set_name,number,image_small,day,prev_day,prev_usd,now_usd,pct_change';
  fetch(url + '/rest/v1/card_daily_movers?select=' + sel + '&limit=500', {
    headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
  }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      rows = (rows || []).filter(function (r) {
        return r && isFinite(Number(r.pct_change)) && isFinite(Number(r.now_usd)) && isFinite(Number(r.prev_usd));
      });
      if (!rows.length) { box.hidden = true; return; }
      paint(rows, 'pct');
    })
    .catch(function () { box.hidden = true; });
})();
