#!/usr/bin/env node
'use strict';

var avg = require('../js/sold-average.js');
var failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

function close(a, b) {
  return Math.abs(a - b) < 0.001;
}

(function lastTenDropsTheOldest() {
  var sales = [];
  for (var i = 1; i <= 10; i++) {
    sales.push({ date: '2024-01-' + (i < 10 ? '0' + i : i), value: 1 });
  }
  sales.push({ date: '2024-01-11', value: 21 });
  var daily = avg.dailyLastNAverage(sales, 10);
  assert(daily.length === 11, 'one point per sale day');
  assert(close(daily[9].value, 1), 'tenth day is the average of ten $1 sales');
  assert(daily[9].sampleSize === 10, 'window is full on day 10');
  assert(close(daily[10].value, 3), 'day 11 drops the oldest $1 and averages nine $1s plus $21');
  assert(daily[10].sampleSize === 10, 'day 11 still uses 10 sales');
})();

(function fewerThanTenUsesWhatExists() {
  var daily = avg.dailyLastNAverage([
    { date: '2024-03-01', value: 10, soldAt: '2024-03-01T01:00:00Z' },
    { date: '2024-03-01', value: 30, soldAt: '2024-03-01T02:00:00Z' }
  ], 10);
  assert(daily.length === 1, 'same-day sales collapse to one daily price');
  assert(close(daily[0].value, 20), 'same-day average is 20');
  assert(daily[0].sampleSize === 2, 'sample size is the sales we actually have');
})();

(function monthlyAveragesDailyLastTenNotRawSales() {
  var sales = [
    { date: '2024-01-01', value: 10 },
    { date: '2024-01-02', value: 30 },
    { date: '2024-02-01', value: 30 }
  ];
  var summary = avg.summarize(sales, 10, '2026-10-05');
  assert(close(summary.daily[0].value, 10), '1 Jan daily is 10');
  assert(close(summary.daily[1].value, 20), '2 Jan daily is the last-2 average, 20');
  assert(close(summary.monthly[0].value, 15), 'January averages the daily figures (15), not the raw sales (20)');
  assert(close(summary.daily[2].value, 23.33), 'February daily keeps the rolling last-10, including January sales');
  assert(close(summary.monthly[1].value, 23.33), 'February monthly equals that daily last-10 average');
  assert(summary.latestDaily.date === '2024-02-01', 'latest daily is the newest day');
  assert(summary.latestMonth.month === '2024-02', 'latest month is February');
})();

(function twentyYearWindowDropsOlderPoints() {
  var sales = [];
  sales.push({ date: '1990-06-01', value: 5 });
  sales.push({ date: '2010-06-01', value: 15 });
  sales.push({ date: '2026-09-01', value: 40 });
  var summary = avg.summarize(sales, 10, '2026-10-05');
  assert(summary.daily.length === 3, 'full history keeps every real day');
  assert(summary.daily20.length === 2, '20-year window drops 1990 and keeps 2010 and 2026');
  assert(summary.daily20[0].date === '2010-06-01', 'oldest point inside 20 years is 2010');
  assert(summary.monthly20.length === 2, 'monthly 20-year series has two real months');
  assert(summary.daily20.every(function (p) { return p.date >= '2006-10-06'; }), 'cut is about 20 years before 2026-10-05');
})();

(function ignoresBadPricesAndSorts() {
  var daily = avg.dailyLastNAverage([
    { date: '2024-05-02', value: 8 },
    { date: 'nope', value: 100 },
    { date: '2024-05-01', value: 0 },
    { date: '2024-05-01', value: 4 }
  ], 10);
  assert(daily.length === 2, 'zero, invalid, and undated rows are dropped');
  assert(daily[0].date === '2024-05-01' && close(daily[0].value, 4), 'unsorted input is ordered before the window moves');
  assert(close(daily[1].value, 6), 'second day averages 4 and 8');
})();

(function anchorsDoNotMoveTheLatestComp() {
  var summary = avg.withAnchors(
    [{ date: '2026-10-01', value: 10 }, { date: '2026-10-02', value: 10 }],
    [{ date: '2026-09-01', value: 100, source: 'cardmarket_avg30' }],
    10,
    '2026-10-05'
  );
  assert(summary.daily.length === 3, 'anchor day is kept on the chart');
  assert(summary.daily[0].anchor === true && close(summary.daily[0].value, 100), 'September anchor stays 100');
  assert(close(summary.latestDaily.value, 10), 'latest daily average ignores the anchor');
  assert(summary.latestDaily.sampleSize === 2, 'latest window is the two real sales');
  assert(close(summary.monthly[0].value, 100), 'September monthly is the anchor day');
  assert(close(summary.monthly[1].value, 10), 'October monthly is the real daily averages');
})();

(function emptyAndSpan() {
  var summary = avg.summarize([], 10, '2026-10-05');
  assert(summary.daily.length === 0 && summary.latestDaily == null, 'no sales means no prices');
  assert(avg.spanDays(summary.daily) === 0, 'empty span is 0');
  assert(avg.spanDays([{ date: '2020-01-01', value: 1 }, { date: '2020-01-11', value: 2 }]) === 10, 'span is 10 days');
  assert(avg.DAYS_20Y === 7305, '20-year window is 7305 days');
})();

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all sold-average tests passed');
