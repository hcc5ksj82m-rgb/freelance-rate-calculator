#!/usr/bin/env node
'use strict';

var pack = require('../js/pack-ev.js');
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
  return Math.abs(a - b) < 0.02;
}

assert(pack.tier('Common') === 'common', 'common');
assert(pack.tier('Rare Holo') === 'holo', 'holo is not an ex');
assert(pack.tier('Rare Holo EX') === 'double', 'EX is a hit, not a plain holo');
assert(pack.tier('Rare Holo VMAX') === 'double', 'VMAX is a hit');
assert(pack.tier('Illustration Rare') === 'ir', 'illustration rare');
assert(pack.tier('Special Illustration Rare') === 'sir', 'special illustration is not a plain IR');
assert(pack.tier('Hyper Rare') === 'hyper', 'hyper rare');
assert(pack.tier('Double Rare') === 'double', 'double rare');
assert(pack.tier('Promo') === 'skip', 'promos are not in booster slots');
assert(pack.oddsLabel(0.67) === '67% of packs', 'a common hit is a percent, not 1 in 1');
assert(pack.oddsLabel(1 / 3) === '1 in 3', 'a one-in-three hit stays 1 in 3');

assert(pack.usdPrice({
  tcgplayer: { prices: { holofoil: { market: 12.5 } } },
  market_price_usd: 3
}).value === 12.5, 'TCGPlayer market beats the catalog snapshot');
assert(pack.usdPrice({
  cardmarket: { prices: { averageSellPrice: 40 } },
  market_price_usd: 9
}).value === 9, 'EUR Cardmarket prices are not used as USD');
assert(pack.usdPrice({ name: 'x' }) == null, 'no price stays empty');
assert(pack.usdPrice({
  priceUsd: 8,
  priceSource: 'last10',
  tcgplayer: { prices: { holofoil: { market: 20 } } }
}).value === 8, 'a last-10 average replaces the raw market price');
assert(pack.usdPrice({
  tcgplayer: { prices: { normal: { market: 0.18 }, reverseHolofoil: { market: 0.62 } } }
}).value === 0.18, 'a common uses the non-reverse print');

(function vintageEv() {
  var cards = [
    { id: 'c', rarity: 'Common', priceUsd: 1, name: 'C' },
    { id: 'u', rarity: 'Uncommon', priceUsd: 2, name: 'U' },
    { id: 'r', rarity: 'Rare', priceUsd: 4, name: 'R' },
    { id: 'h', rarity: 'Rare Holo', priceUsd: 10, name: 'H' }
  ];
  var model = pack.buildModel(cards, 'vintage');
  assert(close(model.bulk, 13), 'vintage bulk is 7 commons + 3 uncommons (' + model.bulk + ')');
  assert(close(model.hitEv, 5.98), 'vintage hit slot is 33% holo and the rest rare (' + model.hitEv + ')');
  assert(close(model.ev, 18.98), 'vintage EV is bulk plus the hit slot (' + model.ev + ')');
  var sumP = model.hitTable.reduce(function (s, row) { return s + row.p; }, 0);
  assert(close(sumP, 1), 'hit slot probabilities sum to 1');
})();

(function modernDoesNotReplaceBulk() {
  var cards = [
    { id: 'c', rarity: 'Common', priceUsd: 0.2, name: 'C' },
    { id: 'u', rarity: 'Uncommon', priceUsd: 0.2, name: 'U' },
    { id: 'r', rarity: 'Rare', priceUsd: 0.5, name: 'R' },
    { id: 'd', rarity: 'Double Rare', priceUsd: 2, name: 'D' },
    { id: 'i', rarity: 'Illustration Rare', priceUsd: 40, name: 'I' },
    { id: 's', rarity: 'Special Illustration Rare', priceUsd: 100, name: 'S' }
  ];
  var model = pack.buildModel(cards, 'modern-sv');
  assert(close(model.bulk, 1.63), 'modern bulk includes a reverse (' + model.bulk + ')');
  assert(model.ev > model.bulk, 'chase EV is added on top of bulk');
  assert(close(model.ev, 6.68), 'modern EV uses each rarity average (' + model.ev + ')');
  var exclusive = 1.63 * (1 - 1 / 63) + 100 / 63;
  assert(model.ev > exclusive + 1, 'the old either-or formula undercounts this pool');
})();

(function unpricedAndPromoIgnored() {
  var model = pack.buildModel([
    { rarity: 'Common', priceUsd: 1, name: 'C' },
    { rarity: 'Common', priceUsd: 0, name: 'Free' },
    { rarity: 'Promo', priceUsd: 500, name: 'Promo' },
    { rarity: 'Rare', name: 'No price' }
  ], 'vintage');
  assert(model.groups.common.length === 1, 'zero-price cards stay out of the average');
  assert(!model.groups.skip, 'promos are not a slot');
  assert(close(model.bulk, 7), 'one priced common still fills 7 slots at $1');
})();

(function drawKeepsSlotCounts() {
  var cards = [];
  for (var i = 0; i < 8; i++) cards.push({ id: 'c' + i, rarity: 'Common', priceUsd: 1, name: 'C' + i });
  for (var j = 0; j < 4; j++) cards.push({ id: 'u' + j, rarity: 'Uncommon', priceUsd: 2, name: 'U' + j });
  cards.push({ id: 'r', rarity: 'Rare', priceUsd: 4, name: 'R' });
  cards.push({ id: 'h', rarity: 'Rare Holo', priceUsd: 10, name: 'H' });
  var model = pack.buildModel(cards, 'vintage');
  var packPull = pack.drawPack(model, function () { return 0; });
  var commons = packPull.cards.filter(function (c) { return c.slot === 'Common'; });
  var uncommons = packPull.cards.filter(function (c) { return c.slot === 'Uncommon'; });
  assert(commons.length === 7, 'a vintage pack draws 7 commons');
  assert(uncommons.length === 3, 'a vintage pack draws 3 uncommons');
  assert(packPull.cards.length === 11, 'vintage pack is 11 cards');
  assert(packPull.cards[10].priceUsd === 4, 'the most likely hit (roll 0) is the regular rare');
  var before = cards[0].priceUsd;
  pack.drawPack(pack.buildModel(cards, 'modern-sv'), Math.random);
  assert(cards[0].priceUsd === before, 'a reverse premium does not change the card pool');
})();

(function reversePrintIsNotBulk() {
  var cards = [
    {
      id: 'c', rarity: 'Common', name: 'C',
      tcgplayer: { prices: { normal: { market: 0.18 }, reverseHolofoil: { market: 0.62 } } }
    },
    {
      id: 'u', rarity: 'Uncommon', name: 'U',
      tcgplayer: { prices: { normal: { market: 0.20 }, reverseHolofoil: { market: 0.78 } } }
    }
  ];
  var model = pack.buildModel(cards, 'modern-sv');
  assert(close(model.bulk, 2.02), 'modern bulk uses normal prints plus the reverse market (' + model.bulk + ')');
  var pull = pack.drawPack(model, function () { return 0; });
  var commons = pull.cards.filter(function (c) { return c.slot === 'Common'; });
  var reverse = pull.cards.filter(function (c) { return c.slot === 'Reverse'; })[0];
  assert(commons.length === 4 && commons[0].priceUsd === 0.18, 'opened commons stay at the normal price');
  assert(reverse && reverse.priceUsd === 0.62, 'the reverse slot uses the reverse-holo market');
  assert(cards[0].tcgplayer.prices.normal.market === 0.18, 'opening a pack does not rewrite the catalog price');
})();

(function manualAddsChase() {
  assert(pack.manualEv(1.5, 60, 120) === 3.5, 'manual EV is bulk plus chase divided by odds');
  var exclusive = 1.5 * (59 / 60) + 120 / 60;
  assert(Math.abs(pack.manualEv(1.5, 60, 120) - exclusive - 1.5 / 60) < 0.001, 'keeping bulk on a chase pack is worth bulk divided by the odds');
  assert(pack.manualEv(1, 0, 10) == null, 'odds below 1 are rejected');
})();

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all pack-ev tests passed');
