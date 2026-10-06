/* PackEV — Google-style price history charts from Supabase public.card_price_history.
 * Only real points we store (catalog snapshots + Cardmarket avg anchors). No DEMO.
 */
(function (root) {
  'use strict';

  var RANGES = [
    { id: '1M', label: '1M', days: 30 },
    { id: '6M', label: '6M', days: 182 },
    { id: '1Y', label: '1Y', days: 365 },
    { id: '5Y', label: '5Y', days: 365 * 5 },
    { id: 'Max', label: 'Max', days: null }
  ];

  var TIP_BUILD = 'More history builds daily';
  var TIP_FLAT = 'History is just starting — snapshots are still flat for this card';
  var TIP_CM = 'Short anchors from Cardmarket avgs (EUR shape scaled to USD spot)';
  var TIP_THIN = 'Thin history — only real snapshot points, no filled gaps';

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

  function fmtDay(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  function daysAgoDate(n) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return fmtDay(d);
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

  /** YYYY-MM-DD → "3 Oct" (axis). Avoids slicing the year into "26-10-03". */
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

  /** Pad the Y scale so a flat or tiny move stays a readable line, not a crushed edge. */
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

  /** True when all values are effectively equal (no visible movement). */
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
    return (max - min) / max < 0.005; /* <0.5% spread */
  }

  function hasCardmarketAnchors(points) {
    return (points || []).some(function (p) {
      return String(p.source || '').indexOf('cardmarket') === 0;
    });
  }

  function filterByRange(points, rangeId) {
    var range = RANGES.find(function (r) { return r.id === rangeId; }) || RANGES[0];
    if (range.days == null) return points.slice();
    var cut = daysAgoDate(range.days);
    return points.filter(function (p) { return p.date >= cut; });
  }

  /**
   * Chips that can draw a line (≥2 points). Wider chips that contain the
   * same points as a tighter one are hidden — a 10-day series is not a 5Y chart.
   */
  function availableRanges(points) {
    var kept = [];
    var seen = {};
    RANGES.forEach(function (r) {
      var n = filterByRange(points, r.id).length;
      if (n < 2 || seen[n]) return;
      seen[n] = true;
      kept.push(r);
    });
    return kept;
  }

  /**
   * Fetch history rows for one card (anon PostgREST).
   * @returns {Promise<{date:string,value:number,source:string}[]>}
   */
  async function fetchHistory(cardId) {
    var base = supabaseUrl();
    var key = supabaseKey();
    if (!base || !key || !cardId) return [];

    var endpoint = base + '/rest/v1/card_price_history'
      + '?card_id=eq.' + encodeURIComponent(cardId)
      + '&select=day,market_price_usd,source'
      + '&order=day.asc'
      + '&limit=2000';

    var res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key
      }
    });
    if (!res.ok) {
      var err = new Error('History ' + res.status);
      err.status = res.status;
      throw err;
    }
    var rows = await res.json();
    if (!Array.isArray(rows)) return [];
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i].market_price_usd != null ? Number(rows[i].market_price_usd) : NaN;
      if (!(v > 0)) continue;
      out.push({
        date: fmtDay(rows[i].day),
        value: Math.round(v * 100) / 100,
        source: rows[i].source || ''
      });
    }
    return out;
  }

  /**
   * Render chips + canvas; loads real history from Supabase.
   * Manages one Chart.js instance on el._packEvChart
   */
  function mount(container, card, ChartLib) {
    if (!container || !card) return;
    var Chart = ChartLib || root.Chart;
    if (!Chart) {
      container.innerHTML = '<p class="tip">Chart library failed to load.</p>';
      return;
    }

    var state = {
      range: '1M',
      points: [],
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

    function rebuildChips(avail) {
      rangesEl.innerHTML = '';
      if (!avail.length) return;
      if (!avail.some(function (r) { return r.id === state.range; })) {
        state.range = avail[0].id;
      }
      avail.forEach(function (r) {
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
    }

    function paint() {
      if (state.loading) return;
      if (state.error) {
        paintEmpty('Could not load price history.');
        return;
      }

      var avail = availableRanges(state.points);
      rebuildChips(avail);

      rangesEl.hidden = !avail.length;
      if (!avail.length) {
        if (state.points.length === 1) {
          paintEmpty('Only one price point so far. ' + TIP_THIN + '. ' + TIP_BUILD + '.');
        } else {
          paintEmpty(TIP_BUILD + '.');
        }
        return;
      }

      var seriesPts = filterByRange(state.points, state.range);
      if (seriesPts.length < 2) {
        paintEmpty(TIP_BUILD + '.');
        return;
      }

      var flat = isFlatSeries(seriesPts);

      /* restore canvas if we swapped in empty state */
      if (!canvas || canvas.hidden || !wrap.contains(canvas)) {
        wrap.innerHTML = '<canvas></canvas>';
        canvas = wrap.querySelector('canvas');
      }

      var stats = changeStats(seriesPts);
      Array.prototype.forEach.call(rangesEl.querySelectorAll('.phist-chip'), function (btn) {
        var on = btn.dataset.range === state.range;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      var currency = 'USD';
      var changeHtml = '';
      if (stats) {
        var cls = stats.pct > 0.05 ? 'up' : (stats.pct < -0.05 ? 'down' : 'flat');
        var sign = stats.abs >= 0 ? '+' : '';
        changeHtml = '<span class="' + cls + '">' + sign + fmtMoney(stats.abs, currency)
          + ' (' + sign + stats.pct.toFixed(1) + '%)</span>';
      }
      priceEl.innerHTML = '<span class="phist-spot">'
        + fmtMoney(seriesPts[seriesPts.length - 1].value, currency)
        + '</span> ' + changeHtml;

      var spanDays = (function () {
        var a = new Date(seriesPts[0].date + 'T12:00:00');
        var b = new Date(seriesPts[seriesPts.length - 1].date + 'T12:00:00');
        return Math.max(0, Math.round((b - a) / 86400000));
      })();
      var noteBits = [seriesPts.length + ' points'];
      if (spanDays) noteBits.push('~' + spanDays + 'd span');
      noteBits.push('latest ' + fmtLongDay(seriesPts[seriesPts.length - 1].date));
      if (seriesPts.length < 8) noteBits.push(TIP_THIN);
      if (flat) noteBits.push(TIP_FLAT);
      if (hasCardmarketAnchors(seriesPts)) noteBits.push(TIP_CM);
      noteBits.push(TIP_BUILD);
      noteEl.textContent = noteBits.join(' · ');

      destroyChart();

      var labels = seriesPts.map(function (p) { return p.date; });
      var data = seriesPts.map(function (p) { return p.value; });
      var bounds = yBounds(data);

      container._packEvChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Market price',
            data: data,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,.12)',
            borderWidth: 2,
            pointRadius: labels.length <= 12 ? 3 : 0,
            pointHoverRadius: 4,
            tension: 0.2,
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
                  return fmtLongDay(iso);
                },
                label: function (ctx) {
                  return fmtMoney(ctx.parsed.y, currency);
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
                  return fmtAxisDay(this.getLabelForValue(val));
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

    fetchHistory(card.id).then(function (pts) {
      if (container._packEvHistGen !== state.gen) return;
      state.loading = false;
      state.points = pts;
      /* Prefer widest range that still has data when opening */
      var avail = availableRanges(pts);
      if (avail.length) {
        var prefer = ['1M', '6M', '1Y', '5Y', 'Max'];
        state.range = prefer.find(function (id) {
          return avail.some(function (r) { return r.id === id; });
        }) || avail[0].id;
      }
      paint();
    }).catch(function () {
      if (container._packEvHistGen !== state.gen) return;
      state.loading = false;
      state.error = true;
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
    availableRanges: availableRanges,
    filterByRange: filterByRange,
    isFlatSeries: isFlatSeries,
    mount: mount,
    unmount: unmount,
    fmtMoney: fmtMoney
  };
})(window);
