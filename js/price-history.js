/* PackEV price history.
 * Daily price = average of the last 10 recorded sales.
 * Monthly price = average of those daily prices.
 * 20Y / Max plot that average across stored history only — missing years stay empty.
 * eBay completed sales in public.card_sold_comps win over catalog snapshots.
 */
(function (root) {
  'use strict';

  var Sold = function () { return root.PackEVSoldAverage; };

  var RANGES = [
    { id: '1M', label: '1M', days: 30, grain: 'day' },
    { id: '6M', label: '6M', days: 182, grain: 'day' },
    { id: '1Y', label: '1Y', days: 365, grain: 'day' },
    { id: '5Y', label: '5Y', days: 365 * 5, grain: 'month' },
    { id: '10Y', label: '10Y', days: 365 * 10, grain: 'month' },
    { id: '20Y', label: '20Y', days: null, grain: 'month', years: 20 },
    { id: 'Max', label: 'Max', days: null, grain: 'month' }
  ];

  var TIP_BUILD = 'More history builds as sales are recorded. Missing years are left empty.';
  var TIP_FLAT = 'Recent prices are flat — the last 10 are almost the same';
  var PAGE = 1000;
  var MAX_ROWS = 8000;

  function cfg() {
    return root.PACK_EV_SUPABASE || {};
  }

  function supabaseUrl() {
    return String(cfg().SUPABASE_URL || '').trim().replace(/\/$/, '');
  }

  function supabaseKey() {
    var c = cfg();
    return String(c.SUPABASE_ANON_KEY || c.SUPABASE_PUBLISHABLE_KEY || '').trim();
  }

  function headers() {
    var key = supabaseKey();
    return {
      Accept: 'application/json',
      apikey: key,
      Authorization: 'Bearer ' + key
    };
  }

  function fmtDay(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtMoney(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var prefix = currency === 'EUR' ? '€' : '$';
    if (Math.abs(n) >= 1000) {
      return prefix + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return prefix + Number(n).toFixed(2);
  }

  function fmtAxisDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1];
  }

  function fmtLongDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return String(Number(m[3])) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  function fmtMonth(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return MONTHS[Number(m[2]) - 1] + ' ' + m[1];
  }

  function yBounds(values) {
    var min = values[0];
    var max = values[0];
    for (var i = 1; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var span = max - min;
    var pad = span > 0
      ? Math.max(span * 0.45, Math.abs(max) * 0.02, 0.05)
      : Math.max(Math.abs(max) * 0.08, 0.25);
    var lo = min - pad;
    if (lo < 0 && min >= 0) lo = 0;
    return { min: lo, max: max + pad };
  }

  function changeStats(points) {
    if (!points || points.length < 2) return null;
    var first = points[0].value;
    var last = points[points.length - 1].value;
    if (!(first > 0)) return null;
    var pct = ((last - first) / first) * 100;
    return { first: first, last: last, abs: last - first, pct: pct };
  }

  function isFlatSeries(points) {
    if (!points || points.length < 2) return true;
    var min = points[0].value;
    var max = points[0].value;
    for (var i = 1; i < points.length; i++) {
      var v = points[i].value;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > 0)) return true;
    return (max - min) / max < 0.005;
  }

  function rangeById(id) {
    for (var i = 0; i < RANGES.length; i++) {
      if (RANGES[i].id === id) return RANGES[i];
    }
    return RANGES[0];
  }

  function rangeDays(range) {
    if (!range) return null;
    if (range.years) {
      var sold = Sold();
      return sold ? sold.DAYS_20Y : Math.round(365.25 * range.years);
    }
    return range.days;
  }

  function filterByRange(points, rangeId, today) {
    var sold = Sold();
    var range = rangeById(rangeId);
    var days = rangeDays(range);
    if (!sold) {
      if (days == null) return (points || []).slice();
      var cut = fmtDay(new Date(Date.now() - days * 86400000));
      return (points || []).filter(function (p) { return p.date >= cut; });
    }
    return sold.filterSince(points || [], days, today);
  }

  function inList(ids) {
    return '(' + ids.map(function (id) {
      return '"' + String(id).replace(/"/g, '') + '"';
    }).join(',') + ')';
  }

  async function fetchPages(path, mapRow) {
    var base = supabaseUrl();
    var key = supabaseKey();
    if (!base || !key) return [];
    var out = [];
    var offset = 0;
    while (out.length < MAX_ROWS) {
      var join = path.indexOf('?') === -1 ? '?' : '&';
      var res = await fetch(base + path + join + 'limit=' + PAGE + '&offset=' + offset, { headers: headers() });
      if (res.status === 404) {
        var missing = new Error('missing');
        missing.status = 404;
        throw missing;
      }
      if (!res.ok) {
        var err = new Error('History ' + res.status);
        err.status = res.status;
        throw err;
      }
      var rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) break;
      for (var i = 0; i < rows.length; i++) {
        var mapped = mapRow(rows[i]);
        if (mapped) out.push(mapped);
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
    return out;
  }

  function mapSnapshot(row) {
    var v = row.market_price_usd != null ? Number(row.market_price_usd) : NaN;
    if (!(v > 0) || !row.day) return null;
    return {
      date: fmtDay(row.day),
      value: Math.round(v * 100) / 100,
      source: row.source || 'snapshot',
      cardId: row.card_id || ''
    };
  }

  function mapSold(row) {
    var v = row.price_usd != null ? Number(row.price_usd) : NaN;
    if (!(v > 0) || !row.sold_at) return null;
    return {
      date: fmtDay(row.sold_at),
      soldAt: row.sold_at,
      value: Math.round(v * 100) / 100,
      source: row.source || 'ebay_sold',
      cardId: row.card_id || ''
    };
  }

  async function fetchHistory(cardId) {
    if (!cardId) return [];
    var path = '/rest/v1/card_price_history'
      + '?card_id=eq.' + encodeURIComponent(cardId)
      + '&select=day,market_price_usd,source'
      + '&order=day.asc';
    return fetchPages(path, mapSnapshot);
  }

  async function fetchSoldComps(cardId) {
    if (!cardId) return [];
    var path = '/rest/v1/card_sold_comps'
      + '?card_id=eq.' + encodeURIComponent(cardId)
      + '&select=sold_at,price_usd,source'
      + '&order=sold_at.asc';
    try {
      return await fetchPages(path, mapSold);
    } catch (err) {
      if (err && (err.status === 404 || err.status === 400)) return [];
      throw err;
    }
  }

  function shiftDay(iso, days) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
    if (isNaN(d.getTime())) return '';
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /* 1D / 7D / 30D from this card's own TCGPlayer-basis snapshots.
     1D = the previous snapshot. 7D / 30D = earliest snapshot inside the window.
     30D is dropped when it lands on the same day as 7D. */
  function periodChanges(points) {
    var byDay = Object.create(null);
    (points || []).forEach(function (p) {
      if (!p) return;
      var source = p.source || '';
      if (source !== 'live_api' && source !== 'catalog') return;
      var day = String(p.date || p.day || '').slice(0, 10);
      var value = Number(p.value != null ? p.value : p.market_price_usd);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(value > 0)) return;
      var prev = byDay[day];
      if (!prev || (source === 'live_api' && prev.source !== 'live_api')) {
        byDay[day] = { day: day, value: value, source: source };
      }
    });
    var days = Object.keys(byDay).sort();
    if (days.length < 2) return [];
    var latest = byDay[days[days.length - 1]];
    var onlyCatalog = days.every(function (d) { return byDay[d].source === 'catalog'; });

    function earliestWithin(span) {
      var cut = shiftDay(latest.day, -span);
      for (var i = 0; i < days.length; i++) {
        if (days[i] >= cut && days[i] < latest.day) return byDay[days[i]];
      }
      return null;
    }

    function chip(id, label, base) {
      if (!base) return null;
      var pct = Math.round(((latest.value - base.value) / base.value) * 10000) / 100;
      return {
        id: id,
        label: label,
        pct: pct,
        day: base.day,
        flat: onlyCatalog && pct === 0
      };
    }

    var c1 = chip('1d', '1D', byDay[days[days.length - 2]]);
    var c7 = chip('7d', '7D', earliestWithin(7));
    var c30 = chip('30d', '30D', earliestWithin(30));
    if (c30 && c7 && c30.day === c7.day) c30 = null;
    return [c1, c7, c30].filter(Boolean);
  }

  async function fetchSeries(cardId) {
    if (!cardId) return { points: [], kind: 'snapshot', basis: [] };
    var sold = [];
    var snaps = [];
    var soldErr = null;
    var snapErr = null;
    await Promise.all([
      fetchSoldComps(cardId).then(function (rows) { sold = rows || []; }, function (err) { soldErr = err; }),
      fetchHistory(cardId).then(function (rows) { snaps = rows || []; }, function (err) { snapErr = err; })
    ]);
    if (sold.length) return { points: sold, kind: 'sold', basis: snaps };
    if (!snaps.length && (snapErr || soldErr)) throw (snapErr || soldErr);
    return { points: snaps, kind: 'snapshot', basis: snaps };
  }

  function groupRows(rows) {
    var map = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].cardId;
      if (!id) continue;
      if (!map[id]) map[id] = [];
      map[id].push(rows[i]);
    }
    return map;
  }

  async function fetchGrouped(table, ids, select, order, mapRow) {
    if (!ids.length || !supabaseUrl() || !supabaseKey()) return Object.create(null);
    var path = '/rest/v1/' + table
      + '?card_id=in.' + inList(ids)
      + '&select=' + select
      + '&order=' + order
      + '&limit=1000';
    var res = await fetch(supabaseUrl() + path, { headers: headers() });
    if (!res.ok) {
      var err = new Error('History ' + res.status);
      err.status = res.status;
      throw err;
    }
    var rows = await res.json();
    if (!Array.isArray(rows)) return Object.create(null);
    var mapped = [];
    for (var i = 0; i < rows.length; i++) {
      var row = mapRow(rows[i]);
      if (row) mapped.push(row);
    }
    return groupRows(mapped);
  }

  function isAnchor(point) {
    return String(point && point.source || '').indexOf('cardmarket_avg') === 0;
  }

  function averaged(points) {
    var soldApi = Sold();
    var rows = points || [];
    if (!soldApi) {
      return { daily: rows.slice(), monthly: [], latestDaily: null, latestMonth: null };
    }
    var sales = [];
    var anchors = [];
    for (var i = 0; i < rows.length; i++) {
      if (isAnchor(rows[i])) anchors.push(rows[i]);
      else sales.push(rows[i]);
    }
    return soldApi.withAnchors(sales, anchors, soldApi.LAST_N);
  }

  async function fetchLatestAverages(cardIds) {
    var soldApi = Sold();
    var ids = [];
    var seen = Object.create(null);
    for (var i = 0; i < (cardIds || []).length && ids.length < 40; i++) {
      var id = cardIds[i];
      if (!id || seen[id]) continue;
      seen[id] = true;
      ids.push(id);
    }
    if (!ids.length || !soldApi || !supabaseUrl() || !supabaseKey()) return {};

    var soldMap = null;
    try {
      soldMap = await fetchGrouped(
        'card_sold_comps', ids, 'card_id,sold_at,price_usd,source', 'sold_at.desc', mapSold
      );
    } catch (err) {
      if (!(err && (err.status === 404 || err.status === 400))) soldMap = null;
    }

    var snapMap = Object.create(null);
    try {
      snapMap = await fetchGrouped(
        'card_price_history', ids, 'card_id,day,market_price_usd,source', 'day.desc', mapSnapshot
      );
    } catch (_) { /* search still has the spot price */ }

    var thin = ids.filter(function (id) {
      var snaps = snapMap[id] || [];
      var comps = soldMap && soldMap[id];
      if (comps && comps.length) return false;
      return snaps.length < soldApi.LAST_N;
    });
    if (thin.length && thin.length < ids.length) {
      try {
        var extra = await fetchGrouped(
          'card_price_history', thin, 'card_id,day,market_price_usd,source', 'day.desc', mapSnapshot
        );
        thin.forEach(function (id) {
          if (extra[id] && extra[id].length > (snapMap[id] || []).length) snapMap[id] = extra[id];
        });
      } catch (_) { /* keep the first page */ }
    }

    var out = {};
    ids.forEach(function (id) {
      var comps = soldMap && soldMap[id];
      var sales = (comps && comps.length) ? comps : (snapMap[id] || []);
      if (!sales.length) return;
      var summary = averaged(sales);
      if (!summary.latestDaily) return;
      out[id] = {
        daily: summary.latestDaily.value,
        monthly: summary.latestMonth ? summary.latestMonth.value : null,
        samples: summary.latestDaily.sampleSize,
        kind: (comps && comps.length) ? 'sold' : 'snapshot'
      };
    });
    return out;
  }

  function availableRanges(points) {
    return RANGES.filter(function (r) {
      return filterByRange(points, r.id).length >= 2;
    });
  }

  function mount(container, card, ChartLib, options) {
    if (!container || !card) return;
    var Chart = ChartLib || root.Chart;
    var opts = options || {};
    if (!Chart) {
      container.innerHTML = '<p class="tip">Chart library failed to load.</p>';
      return;
    }

    var state = {
      range: '1M',
      grain: null,
      raw: [],
      basis: [],
      daily: [],
      monthly: [],
      kind: 'snapshot',
      loading: true,
      error: null,
      gen: (container._packEvHistGen || 0) + 1
    };
    container._packEvHistGen = state.gen;

    container.innerHTML = ''
      + '<div class="phist">'
      + '  <div class="phist-head">'
      + '    <div class="phist-title">'
      + '      <strong></strong>'
      + '      <span class="phist-meta tip"></span>'
      + '    </div>'
      + '    <div class="phist-price"></div>'
      + '  </div>'
      + '  <div class="phist-controls">'
      + '    <div class="phist-ranges" role="tablist" aria-label="Price history range"></div>'
      + '    <div class="phist-grain" role="group" aria-label="Daily or monthly average"></div>'
      + '  </div>'
      + '  <div class="phist-chart-wrap"><canvas></canvas></div>'
      + '  <p class="phist-note tip"></p>'
      + '</div>';

    var titleEl = container.querySelector('.phist-title strong');
    var metaEl = container.querySelector('.phist-meta');
    var priceEl = container.querySelector('.phist-price');
    var rangesEl = container.querySelector('.phist-ranges');
    var grainEl = container.querySelector('.phist-grain');
    var noteEl = container.querySelector('.phist-note');
    var canvas = container.querySelector('canvas');
    var wrap = container.querySelector('.phist-chart-wrap');

    titleEl.textContent = (card.name || 'Card') + (card.number ? ' #' + card.number : '');
    metaEl.textContent = [card.set, card.printType, card.source].filter(Boolean).join(' · ');
    priceEl.innerHTML = '<span class="tip">Loading history…</span>';
    noteEl.textContent = '';

    function destroyChart() {
      if (container._packEvChart) {
        container._packEvChart.destroy();
        container._packEvChart = null;
      }
    }

    function paintEmpty(msg) {
      destroyChart();
      priceEl.innerHTML = card.price != null
        ? '<span class="phist-spot">' + fmtMoney(card.price, card.currency || 'USD') + '</span>'
        : '';
      noteEl.textContent = msg || TIP_BUILD;
      if (wrap) {
        wrap.innerHTML = '<p class="phist-empty tip">' + (msg || TIP_BUILD) + '</p><canvas hidden></canvas>';
        canvas = wrap.querySelector('canvas');
      }
    }

    function enabledRanges() {
      return RANGES.filter(function (r) {
        var grain = r.grain === 'month' ? state.monthly : state.daily;
        var pts = filterByRange(grain, r.id);
        if (pts.length >= 2) return true;
        var other = r.grain === 'month' ? state.daily : state.monthly;
        return filterByRange(other, r.id).length >= 2;
      });
    }

    function rebuildChips() {
      var avail = enabledRanges();
      rangesEl.innerHTML = '';
      if (avail.length && !avail.some(function (r) { return r.id === state.range; })) {
        state.range = avail[0].id;
      }
      RANGES.forEach(function (r) {
        var on = avail.some(function (a) { return a.id === r.id; });
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'phist-chip';
        btn.setAttribute('role', 'tab');
        btn.dataset.range = r.id;
        btn.textContent = r.label;
        btn.disabled = !on;
        btn.title = on ? '' : 'Not enough recorded prices in this range yet';
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          state.range = r.id;
          state.grain = null;
          paint();
        });
        rangesEl.appendChild(btn);
      });

      grainEl.innerHTML = '';
      ['day', 'month'].forEach(function (grain) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'phist-chip phist-grain-btn';
        btn.dataset.grain = grain;
        btn.textContent = grain === 'day' ? 'Daily' : 'Monthly';
        btn.addEventListener('click', function () {
          state.grain = grain;
          paint();
        });
        grainEl.appendChild(btn);
      });
    }

    function visibleSeries() {
      var range = rangeById(state.range);
      var grain = state.grain || range.grain;
      var monthly = filterByRange(state.monthly, state.range);
      var daily = filterByRange(state.daily, state.range);
      if (grain === 'month' && monthly.length >= 2) {
        return { pts: monthly, grain: 'month', fallback: false };
      }
      if (grain === 'month') {
        return { pts: daily, grain: 'day', fallback: true };
      }
      if (daily.length >= 2) return { pts: daily, grain: 'day', fallback: false };
      if (monthly.length >= 2) return { pts: monthly, grain: 'month', fallback: true };
      return { pts: daily.length ? daily : monthly, grain: grain, fallback: false };
    }

    function paint() {
      if (state.loading) return;
      if (state.error) {
        paintEmpty('Could not load price history.');
        rebuildChips();
        return;
      }

      rebuildChips();
      var avail = enabledRanges();
      if (!avail.length) {
        paintEmpty(state.raw.length === 1
          ? 'Only one price recorded so far. ' + TIP_BUILD
          : TIP_BUILD);
        rebuildChips();
        return;
      }

      var series = visibleSeries();
      var seriesPts = series.pts;
      if (seriesPts.length < 2) {
        paintEmpty(TIP_BUILD);
        rebuildChips();
        return;
      }

      if (!canvas || canvas.hidden || !wrap.contains(canvas)) {
        wrap.innerHTML = '<canvas></canvas>';
        canvas = wrap.querySelector('canvas');
      }

      var flat = isFlatSeries(seriesPts);
      var stats = changeStats(seriesPts);
      var currency = 'USD';
      Array.prototype.forEach.call(rangesEl.querySelectorAll('.phist-chip'), function (btn) {
        var on = btn.dataset.range === state.range;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Array.prototype.forEach.call(grainEl.querySelectorAll('.phist-grain-btn'), function (btn) {
        var on = btn.dataset.grain === series.grain;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });

      var changeHtml = '';
      if (stats) {
        var cls = stats.pct > 0.05 ? 'up' : (stats.pct < -0.05 ? 'down' : 'flat');
        var sign = stats.abs >= 0 ? '+' : '';
        changeHtml = '<span class="' + cls + '">' + sign + fmtMoney(stats.abs, currency)
          + ' (' + sign + stats.pct.toFixed(1) + '%)</span>';
      }
      var latestDaily = state.daily.length ? state.daily[state.daily.length - 1] : null;
      var latestMonth = state.monthly.length ? state.monthly[state.monthly.length - 1] : null;
      var sub = '';
      if (latestDaily) {
        sub += '<span class="phist-sub">Daily last ' + (Sold() ? Sold().LAST_N : 10) + ' avg '
          + fmtMoney(latestDaily.value, currency);
        if (latestDaily.sampleSize < (Sold() ? Sold().LAST_N : 10)) {
          sub += ' (' + latestDaily.sampleSize + ' sales)';
        }
        sub += '</span>';
      }
      if (latestMonth) {
        sub += '<span class="phist-sub">Monthly avg ' + fmtMoney(latestMonth.value, currency) + '</span>';
      }
      priceEl.innerHTML = '<span class="phist-spot">'
        + fmtMoney(seriesPts[seriesPts.length - 1].value, currency)
        + '</span> ' + changeHtml + sub;

      var soldApi = Sold();
      var span = soldApi ? soldApi.spanDays(seriesPts) : 0;
      var fullSpan = soldApi ? soldApi.spanDays(state.daily) : span;
      var noteBits = [];
      noteBits.push(series.grain === 'month'
        ? 'Monthly average of the daily last-10 prices'
        : 'Daily price = average of the last 10 recorded sales');
      if (series.fallback) noteBits.push('Not enough months yet, so this range stays on daily averages');
      noteBits.push(seriesPts.length + ' points');
      if (span) noteBits.push(span >= 365 ? ('~' + Math.round(span / 365) + 'y span') : ('~' + span + 'd span'));
      noteBits.push(series.grain === 'month'
        ? ('through ' + fmtMonth(seriesPts[seriesPts.length - 1].date))
        : ('latest ' + fmtLongDay(seriesPts[seriesPts.length - 1].date)));
      if (state.range === '20Y' || state.range === 'Max' || fullSpan >= 365) {
        noteBits.push(fullSpan >= (soldApi ? soldApi.DAYS_20Y : 7305) - 1
          ? 'Last 20 years of averaged prices'
          : '20-year window is on — only stored prices are drawn, nothing is filled in for missing years');
      }
      if (seriesPts.some(function (p) { return p.anchor; })) {
        noteBits.push('Older points marked from Cardmarket averages are shape anchors, not extra sales');
      }
      if (flat) noteBits.push(TIP_FLAT);
      noteBits.push(state.kind === 'sold'
        ? 'Source: completed sales'
        : 'Source: recorded market prices, averaged with the eBay last-10 sold method');
      if (state.kind !== 'sold') noteBits.push(TIP_BUILD);
      noteEl.textContent = noteBits.join(' · ');

      destroyChart();
      var labels = seriesPts.map(function (p) { return p.date; });
      var data = seriesPts.map(function (p) { return p.value; });
      var bounds = yBounds(data);
      var showYear = span > 370 || series.grain === 'month';

      container._packEvChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: series.grain === 'month' ? 'Monthly average' : 'Daily last-10 average',
            data: data,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,.12)',
            borderWidth: 2,
            pointRadius: labels.length <= 18 ? 3 : 0,
            pointHoverRadius: 4,
            tension: labels.length > 48 ? 0.15 : 0.2,
            fill: true,
            spanGaps: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: function (items) {
                  var iso = items && items[0] && items[0].label;
                  return series.grain === 'month' ? fmtMonth(iso) : fmtLongDay(iso);
                },
                label: function (ctx) {
                  var pt = seriesPts[ctx.dataIndex];
                  var line = fmtMoney(ctx.parsed.y, currency);
                  if (pt && series.grain === 'day') {
                    line += ' · avg of last ' + pt.sampleSize;
                  } else if (pt && series.grain === 'month') {
                    line += ' · avg of ' + pt.sampleSize + ' daily price' + (pt.sampleSize === 1 ? '' : 's');
                  }
                  return line;
                }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                maxTicksLimit: 6,
                color: '#64748b',
                font: { size: 11 },
                callback: function (val) {
                  var iso = this.getLabelForValue(val);
                  if (series.grain === 'month' || showYear) {
                    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
                    if (!m) return iso;
                    return MONTHS[Number(m[2]) - 1] + ' ' + String(m[1]).slice(2);
                  }
                  return fmtAxisDay(iso);
                }
              },
              grid: { display: false }
            },
            y: {
              min: bounds.min,
              max: bounds.max,
              ticks: {
                maxTicksLimit: 5,
                color: '#64748b',
                font: { size: 11 },
                callback: function (v) { return fmtMoney(v, currency); }
              },
              grid: { color: 'rgba(148,163,184,.35)' }
            }
          }
        }
      });
    }

    function publish() {
      if (typeof opts.onSummary !== 'function') return;
      var latestDaily = state.daily.length ? state.daily[state.daily.length - 1] : null;
      var latestMonth = state.monthly.length ? state.monthly[state.monthly.length - 1] : null;
      opts.onSummary({
        kind: state.kind,
        error: state.error,
        latestDaily: latestDaily,
        latestMonth: latestMonth,
        dailyCount: state.daily.length,
        monthlyCount: state.monthly.length,
        priceChanges: periodChanges(state.basis || [])
      });
    }

    fetchSeries(card.id).then(function (series) {
      if (container._packEvHistGen !== state.gen) return;
      state.loading = false;
      state.raw = series.points || [];
      state.kind = series.kind || 'snapshot';
      state.basis = series.basis || (state.kind === 'snapshot' ? state.raw : []);
      var soldApi = Sold();
      if (soldApi) {
        var summary = averaged(state.raw);
        state.daily = summary.daily;
        state.monthly = summary.monthly;
      } else {
        state.daily = state.raw.slice();
        state.monthly = [];
      }
      var span = soldApi ? soldApi.spanDays(state.daily) : 0;
      if (span >= 365 && filterByRange(state.monthly, '20Y').length >= 2) state.range = '20Y';
      else if (filterByRange(state.daily, '1M').length >= 2) state.range = '1M';
      else if (enabledRanges().length) state.range = enabledRanges()[0].id;
      publish();
      paint();
    }).catch(function () {
      if (container._packEvHistGen !== state.gen) return;
      state.loading = false;
      state.error = true;
      publish();
      paint();
    });
  }

  function unmount(container) {
    if (!container) return;
    container._packEvHistGen = (container._packEvHistGen || 0) + 1;
    if (container._packEvChart) {
      container._packEvChart.destroy();
      container._packEvChart = null;
    }
    container.innerHTML = '';
  }

  root.PackEVPriceHistory = {
    RANGES: RANGES,
    fetchHistory: fetchHistory,
    fetchSeries: fetchSeries,
    periodChanges: periodChanges,
    fetchLatestAverages: fetchLatestAverages,
    availableRanges: availableRanges,
    filterByRange: filterByRange,
    isFlatSeries: isFlatSeries,
    mount: mount,
    unmount: unmount,
    fmtMoney: fmtMoney
  };
})(window);
