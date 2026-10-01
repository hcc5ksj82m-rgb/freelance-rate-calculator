/* PackEV — Google-style price history chart helpers.
 *
 * Free Pokemon TCG API (api.pokemontcg.io) only exposes spot prices plus
 * Cardmarket avg1 / avg7 / avg30. No free multi-year series exists without a
 * paid key (PokemonPriceTracker, PkmnPrices, RapidAPI, etc.).
 *
 * Real series: Cardmarket short window when present.
 * Longer ranges (6M / 1Y / 5Y / Max): labeled DEMO synthetic walk from spot.
 */
(function (root) {
  'use strict';

  var RANGES = [
    { id: '1M', label: '1M', days: 30 },
    { id: '6M', label: '6M', days: 182 },
    { id: '1Y', label: '1Y', days: 365 },
    { id: '5Y', label: '5Y', days: 365 * 5 },
    { id: 'Max', label: 'Max', days: 365 * 5 }
  ];

  function hashSeed(str) {
    var h = 2166136261;
    var s = String(str || 'packev');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function daysAgo(n) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
  }

  function fmtDay(d) {
    return d.toISOString().slice(0, 10);
  }

  function fmtMoney(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var prefix = currency === 'EUR' ? '€' : '$';
    if (Math.abs(n) >= 1000) {
      return prefix + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return prefix + Number(n).toFixed(2);
  }

  /** Extract best Cardmarket short-history anchors (real). */
  function cardmarketAnchors(rawCm, spotFallback) {
    var p = (rawCm && rawCm.prices) || rawCm || null;
    if (!p) return null;
    var cur = p.averageSellPrice != null ? Number(p.averageSellPrice)
      : (p.trendPrice != null ? Number(p.trendPrice) : null);
    if (cur == null || isNaN(cur)) cur = spotFallback != null ? Number(spotFallback) : null;
    var a30 = p.avg30 != null ? Number(p.avg30) : null;
    var a7 = p.avg7 != null ? Number(p.avg7) : null;
    var a1 = p.avg1 != null ? Number(p.avg1) : null;
    var points = [];
    if (a30 != null && !isNaN(a30) && a30 > 0) points.push({ daysAgo: 30, value: a30, label: 'avg30' });
    if (a7 != null && !isNaN(a7) && a7 > 0) points.push({ daysAgo: 7, value: a7, label: 'avg7' });
    if (a1 != null && !isNaN(a1) && a1 > 0) points.push({ daysAgo: 1, value: a1, label: 'avg1' });
    if (cur != null && !isNaN(cur) && cur > 0) points.push({ daysAgo: 0, value: cur, label: 'now' });
    if (points.length < 2) return null;
    return {
      currency: 'EUR',
      source: 'cardmarket',
      points: points
    };
  }

  function interpolateAnchors(anchors, days) {
    var pts = anchors.points.slice().sort(function (a, b) { return b.daysAgo - a.daysAgo; });
    var out = [];
    var step = days <= 30 ? 1 : (days <= 182 ? 3 : (days <= 365 ? 7 : 14));
    for (var d = days; d >= 0; d -= step) {
      var val = null;
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i];
        var b = pts[i + 1];
        if (d <= a.daysAgo && d >= b.daysAgo) {
          var t = (a.daysAgo - d) / Math.max(1, a.daysAgo - b.daysAgo);
          val = a.value + (b.value - a.value) * t;
          break;
        }
      }
      if (val == null) {
        if (d >= pts[0].daysAgo) val = pts[0].value;
        else val = pts[pts.length - 1].value;
      }
      out.push({ date: fmtDay(daysAgo(d)), value: Math.round(val * 100) / 100 });
    }
    if (out.length && out[out.length - 1].date !== fmtDay(daysAgo(0))) {
      out.push({
        date: fmtDay(daysAgo(0)),
        value: Math.round(pts[pts.length - 1].value * 100) / 100
      });
    }
    return out;
  }

  function demoSeries(spot, currency, days, seedStr) {
    var spotN = Number(spot);
    if (!(spotN > 0)) spotN = 10;
    var rand = mulberry32(hashSeed(seedStr + ':' + days));
    var step = days <= 30 ? 1 : (days <= 182 ? 3 : (days <= 365 ? 7 : 14));
    var n = Math.floor(days / step) + 1;
    var values = new Array(n);
    values[n - 1] = spotN;
    var vol = Math.min(0.045, Math.max(0.012, 0.08 / Math.sqrt(Math.max(spotN, 1))));
    for (var i = n - 2; i >= 0; i--) {
      var shock = (rand() - 0.48) * vol;
      var drift = (rand() - 0.5) * 0.004;
      var prev = values[i + 1] * (1 + shock + drift);
      values[i] = Math.max(spotN * 0.15, prev);
    }
    /* mild mean-reversion so the path lands on spot */
    var scale = spotN / values[n - 1];
    var out = [];
    for (var j = 0; j < n; j++) {
      var dAgo = (n - 1 - j) * step;
      out.push({
        date: fmtDay(daysAgo(dAgo)),
        value: Math.round(values[j] * scale * 100) / 100
      });
    }
    return {
      currency: currency || 'USD',
      source: 'demo',
      demo: true,
      points: out
    };
  }

  /**
   * Build series for a range chip.
   * @returns {{currency, source, demo, points:[{date,value}], note}}
   */
  function seriesForRange(card, rangeId) {
    var range = RANGES.find(function (r) { return r.id === rangeId; }) || RANGES[0];
    var spot = card.price != null ? Number(card.price) : null;
    var currency = card.currency || 'USD';
    var cm = cardmarketAnchors(card.cardmarket, currency === 'EUR' ? spot : null);

    if (range.days <= 30 && cm) {
      return {
        currency: 'EUR',
        source: 'cardmarket',
        demo: false,
        points: interpolateAnchors(cm, range.days),
        note: 'Real Cardmarket avg1 / avg7 / avg30 (+ current). Not daily ticks.'
      };
    }

    if (range.days <= 30 && !cm && spot != null) {
      /* Single real spot — still not a history; use DEMO for a readable 1M line */
      var short = demoSeries(spot, currency, range.days, (card.id || card.name) + '-1m');
      short.note = 'DEMO — Pokemon TCG API has no daily history; Cardmarket avgs missing for this print.';
      return short;
    }

    var long = demoSeries(spot, currency, range.days, (card.id || card.name) + '-' + range.id);
    long.note = 'DEMO — illustrative only. Free APIs do not provide multi-year Pokemon card price history.';
    return long;
  }

  function changeStats(points) {
    if (!points || points.length < 2) return null;
    var first = points[0].value;
    var last = points[points.length - 1].value;
    if (!(first > 0)) return null;
    var pct = ((last - first) / first) * 100;
    return {
      first: first,
      last: last,
      abs: last - first,
      pct: pct
    };
  }

  /**
   * Render chips + canvas into container; manages one Chart.js instance on el._packEvChart
   */
  function mount(container, card, ChartLib) {
    if (!container || !card) return;
    var Chart = ChartLib || root.Chart;
    if (!Chart) {
      container.innerHTML = '<p class="tip">Chart library failed to load.</p>';
      return;
    }

    var state = { range: '1M' };
    container.innerHTML = ''
      + '<div class="phist">'
      + '  <div class="phist-head">'
      + '    <div class="phist-title">'
      + '      <strong></strong>'
      + '      <span class="phist-meta tip"></span>'
      + '    </div>'
      + '    <div class="phist-price"></div>'
      + '  </div>'
      + '  <div class="phist-ranges" role="tablist" aria-label="Price history range"></div>'
      + '  <div class="phist-chart-wrap"><canvas></canvas></div>'
      + '  <p class="phist-note tip"></p>'
      + '</div>';

    var titleEl = container.querySelector('.phist-title strong');
    var metaEl = container.querySelector('.phist-meta');
    var priceEl = container.querySelector('.phist-price');
    var rangesEl = container.querySelector('.phist-ranges');
    var noteEl = container.querySelector('.phist-note');
    var canvas = container.querySelector('canvas');

    titleEl.textContent = (card.name || 'Card') + (card.number ? ' #' + card.number : '');
    metaEl.textContent = [card.set, card.printType, card.source].filter(Boolean).join(' · ');

    RANGES.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'phist-chip';
      btn.setAttribute('role', 'tab');
      btn.dataset.range = r.id;
      btn.textContent = r.label;
      btn.addEventListener('click', function () {
        state.range = r.id;
        paint();
      });
      rangesEl.appendChild(btn);
    });

    function paint() {
      var series = seriesForRange(card, state.range);
      var stats = changeStats(series.points);
      Array.prototype.forEach.call(rangesEl.querySelectorAll('.phist-chip'), function (btn) {
        var on = btn.dataset.range === state.range;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      var badge = series.demo
        ? '<span class="badge demo">DEMO</span>'
        : '<span class="badge live">REAL (CM short)</span>';
      var changeHtml = '';
      if (stats) {
        var cls = stats.pct > 0.05 ? 'up' : (stats.pct < -0.05 ? 'down' : 'flat');
        var sign = stats.abs >= 0 ? '+' : '';
        changeHtml = '<span class="' + cls + '">' + sign + fmtMoney(stats.abs, series.currency)
          + ' (' + sign + stats.pct.toFixed(1) + '%)</span>';
      }
      priceEl.innerHTML = '<span class="phist-spot">'
        + fmtMoney(series.points.length ? series.points[series.points.length - 1].value : card.price, series.currency)
        + '</span> ' + badge + ' ' + changeHtml;

      noteEl.textContent = series.note || '';

      if (container._packEvChart) {
        container._packEvChart.destroy();
        container._packEvChart = null;
      }

      var labels = series.points.map(function (p) { return p.date; });
      var data = series.points.map(function (p) { return p.value; });
      var lineColor = series.demo ? '#94a3b8' : '#2563eb';
      var fillColor = series.demo ? 'rgba(148,163,184,.18)' : 'rgba(37,99,235,.12)';

      container._packEvChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: series.demo ? 'DEMO price' : 'Cardmarket avg path',
            data: data,
            borderColor: lineColor,
            backgroundColor: fillColor,
            borderWidth: 2,
            pointRadius: labels.length <= 8 ? 3 : 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: true
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
                label: function (ctx) {
                  return fmtMoney(ctx.parsed.y, series.currency)
                    + (series.demo ? ' (DEMO)' : '');
                }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                maxTicksLimit: 6,
                color: '#64748b',
                font: { size: 10 },
                callback: function (val, i) {
                  var lab = labels[i] || '';
                  return lab.length >= 7 ? lab.slice(2) : lab;
                }
              },
              grid: { display: false }
            },
            y: {
              ticks: {
                color: '#64748b',
                font: { size: 10 },
                callback: function (v) { return fmtMoney(v, series.currency); }
              },
              grid: { color: 'rgba(148,163,184,.25)' }
            }
          }
        }
      });
    }

    paint();
  }

  function unmount(container) {
    if (!container) return;
    if (container._packEvChart) {
      container._packEvChart.destroy();
      container._packEvChart = null;
    }
    container.innerHTML = '';
  }

  root.PackEVPriceHistory = {
    RANGES: RANGES,
    seriesForRange: seriesForRange,
    cardmarketAnchors: cardmarketAnchors,
    mount: mount,
    unmount: unmount,
    fmtMoney: fmtMoney
  };
})(window);
