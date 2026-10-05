/* PackEV sold-price averages.
 * Daily price = mean of the last 10 sales (eBay last-sold comp method).
 * Monthly price = mean of those daily averages.
 * Long-range charts use the same averages — they never invent missing years.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PackEVSoldAverage = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var LAST_N = 10;
  var DAYS_20Y = Math.round(365.25 * 20);

  function roundMoney(n) {
    return Math.round(n * 100) / 100;
  }

  function average(values) {
    if (!values || !values.length) return null;
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtDay(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function parseDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function addDays(iso, delta) {
    var utc = parseDay(iso);
    if (utc == null) return '';
    return fmtDay(new Date(utc + delta * 86400000));
  }

  function todayIso(today) {
    if (today) return String(today).slice(0, 10);
    return fmtDay(new Date());
  }

  function cleanSales(sales) {
    var rows = [];
    for (var i = 0; i < (sales || []).length; i++) {
      var row = sales[i];
      if (!row) continue;
      var value = Number(row.value);
      var date = String(row.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!isFinite(value) || value <= 0) continue;
      rows.push({
        date: date,
        value: value,
        soldAt: row.soldAt ? String(row.soldAt) : date
      });
    }
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.soldAt !== b.soldAt) return a.soldAt < b.soldAt ? -1 : 1;
      return a.value - b.value;
    });
    return rows;
  }

  /**
   * One point per day that had at least one sale.
   * The day's price is the average of the last `n` sales up to that day.
   */
  function dailyLastNAverage(sales, n) {
    var windowSize = n || LAST_N;
    var rows = cleanSales(sales);
    var window = [];
    var out = [];
    var lastDate = '';

    function pushDay(date) {
      if (!date || !window.length) return;
      out.push({
        date: date,
        value: roundMoney(average(window)),
        sampleSize: window.length,
        grain: 'day'
      });
    }

    for (var i = 0; i < rows.length; i++) {
      if (lastDate && rows[i].date !== lastDate) pushDay(lastDate);
      window.push(rows[i].value);
      if (window.length > windowSize) window.shift();
      lastDate = rows[i].date;
    }
    pushDay(lastDate);
    return out;
  }

  /** Monthly price = average of the daily last-N prices in that month. */
  function monthlyFromDaily(daily) {
    var groups = [];
    var index = Object.create(null);
    for (var i = 0; i < (daily || []).length; i++) {
      var key = String(daily[i].date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(key)) continue;
      if (index[key] == null) {
        index[key] = groups.length;
        groups.push({ month: key, values: [] });
      }
      groups[index[key]].values.push(daily[i].value);
    }
    return groups.map(function (g) {
      return {
        date: g.month + '-01',
        month: g.month,
        value: roundMoney(average(g.values)),
        sampleSize: g.values.length,
        grain: 'month'
      };
    });
  }

  function filterSince(points, days, today) {
    if (days == null) return (points || []).slice();
    var cut = addDays(todayIso(today), -days);
    return (points || []).filter(function (p) { return p.date >= cut; });
  }

  /**
   * Anchors (older shape points) are drawn on their own days but do not enter
   * the rolling last-N window, so today's price stays an average of real sales.
   */
  function withAnchors(sales, anchors, n, today) {
    var real = cleanSales(sales);
    var extra = cleanSales(anchors);
    var summary = summarize(real.length ? real : extra, n, today);
    if (!real.length || !extra.length) return summary;
    var have = Object.create(null);
    for (var i = 0; i < summary.daily.length; i++) have[summary.daily[i].date] = true;
    for (var j = 0; j < extra.length; j++) {
      if (have[extra[j].date]) continue;
      summary.daily.push({
        date: extra[j].date,
        value: roundMoney(extra[j].value),
        sampleSize: 1,
        grain: 'day',
        anchor: true
      });
      have[extra[j].date] = true;
    }
    summary.daily.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
    summary.monthly = monthlyFromDaily(summary.daily);
    var realDays = summary.daily.filter(function (p) { return !p.anchor; });
    summary.latestDaily = realDays.length ? realDays[realDays.length - 1] : null;
    summary.latestMonth = summary.monthly.length ? summary.monthly[summary.monthly.length - 1] : null;
    summary.daily20 = filterSince(summary.daily, DAYS_20Y, today);
    summary.monthly20 = filterSince(summary.monthly, DAYS_20Y, today);
    return summary;
  }

  function summarize(sales, n, today) {
    var daily = dailyLastNAverage(sales, n || LAST_N);
    var monthly = monthlyFromDaily(daily);
    var daily20 = filterSince(daily, DAYS_20Y, today);
    var monthly20 = filterSince(monthly, DAYS_20Y, today);
    return {
      daily: daily,
      monthly: monthly,
      daily20: daily20,
      monthly20: monthly20,
      latestDaily: daily.length ? daily[daily.length - 1] : null,
      latestMonth: monthly.length ? monthly[monthly.length - 1] : null
    };
  }

  function spanDays(points) {
    if (!points || points.length < 2) return 0;
    var a = parseDay(points[0].date);
    var b = parseDay(points[points.length - 1].date);
    if (a == null || b == null) return 0;
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  return {
    LAST_N: LAST_N,
    DAYS_20Y: DAYS_20Y,
    average: average,
    roundMoney: roundMoney,
    addDays: addDays,
    dailyLastNAverage: dailyLastNAverage,
    monthlyFromDaily: monthlyFromDaily,
    filterSince: filterSince,
    summarize: summarize,
    withAnchors: withAnchors,
    spanDays: spanDays
  };
});
