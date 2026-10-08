#!/usr/bin/env node
'use strict';

var graded = require('../js/graded.js');
var failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

assert(graded.isRareOrAbove('Rare'), 'a rare is graded');
assert(graded.isRareOrAbove('Rare Holo'), 'a holo rare is graded');
assert(graded.isRareOrAbove('Illustration Rare'), 'an illustration rare is graded');
assert(graded.isRareOrAbove('Special Illustration Rare'), 'a special illustration rare is graded');
assert(graded.isRareOrAbove('Double Rare'), 'a double rare is graded');
assert(graded.isRareOrAbove('LEGEND'), 'a legend is graded');
assert(graded.isRareOrAbove('Classic Collection'), 'a classic collection card is graded');
assert(!graded.isRareOrAbove('Common'), 'a common stays off the grade ladder');
assert(!graded.isRareOrAbove('Uncommon'), 'an uncommon stays off the grade ladder');
assert(!graded.isRareOrAbove('Promo'), 'a promo stays off the grade ladder');
assert(!graded.isRareOrAbove(''), 'a blank rarity stays off the grade ladder');

assert(graded.render({ name: 'Pidgey', rarity: 'Common', id: 'base1-57' }) === '', 'commons render no grade board');

var board = graded.render({
  id: 'sv3pt5-199',
  name: 'Charizard ex',
  number: '199',
  rarity: 'Special Illustration Rare',
  set: { name: '151' }
});
assert(board.indexOf('PSA') !== -1 && board.indexOf('BGS') !== -1 && board.indexOf('CGC') !== -1, 'the ladder names PSA, BGS, and CGC');
assert(board.indexOf('BL 10') !== -1, 'black label 10 has its own cell');
assert(board.indexOf('PSA 10') !== -1 && board.indexOf('BGS 9.5') !== -1 && board.indexOf('CGC 9.5') !== -1, 'the sold search names each grade');
assert(board.indexOf('CGC%20Pristine%2010') !== -1, 'CGC black label searches Pristine 10');
assert(board.indexOf('-$') === -1 && board.indexOf('>$') === -1, 'a card with no sales does not invent a dollar price');
assert((board.match(/grade-val/g) || []).length === 12, 'rare and above shows twelve grades');

(function lastTen() {
  var sales = [];
  for (var i = 0; i < 11; i++) {
    sales.push({
      grader: 'PSA',
      grade: '10',
      sold_at: '2026-01-' + String(i + 1).padStart(2, '0'),
      price_usd: i === 0 ? 1 : 10
    });
  }
  sales.push({ grader: 'PSA', grade: '9', sold_at: '2026-02-01', price_usd: 500 });
  sales.push({ grader: 'BGS', grade: '10', qualifier: 'Black Label', sold_at: '2026-02-02', price_usd: 900 });
  sales.push({ grader: 'BGS', grade: '10', sold_at: '2026-02-03', price_usd: 200 });
  sales.push({ grader: 'CGC', grade: '10', qualifier: 'Pristine', sold_at: '2026-02-04', price_usd: 700 });
  sales.push({ grader: 'CGC', grade: '9.5', sold_at: '2026-02-05', price_usd: 40 });
  sales.push({ grader: 'PSA', grade: '10', sold_at: 'not-a-date', price_usd: 9999 });
  var avg = graded.averageByGrade(sales);
  assert(avg['PSA|10|'].samples === 10, 'PSA 10 uses the last 10 sales');
  assert(avg['PSA|10|'].value === 10, 'the oldest PSA 10 sale drops out of the average');
  assert(avg['PSA|9|'].value === 500, 'PSA 9 stays separate from PSA 10');
  assert(avg['BGS|10|black'].value === 900, 'a BGS black label is its own average');
  assert(avg['BGS|10|'].value === 200, 'a plain BGS 10 does not include the black label');
  assert(avg['CGC|10|black'].value === 700, 'a CGC Pristine 10 is the black label average');
  assert(avg['CGC|9.5|'].value === 40, 'CGC 9.5 is its own average');
  assert(!avg['CGC|10|'], 'a pristine 10 does not fill a plain CGC 10 slot');
})();

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all graded tests passed');
