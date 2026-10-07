/* Pack EV from real card prices.
 * A pack is bulk in every pack plus one hit slot. A chase does not replace the bulk.
 * Commons and uncommons use the non-reverse print. The reverse slot uses the
 * reverse-holo market when that print exists, otherwise 1.15× the base price.
 * Hit rates are era estimates. Within a rarity, each priced card is equally likely.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PackEVPack = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var COUNTS = {
    vintage: { common: 7, uncommon: 3, reverse: 0 },
    'bw-xy': { common: 5, uncommon: 3, reverse: 1 },
    sm: { common: 5, uncommon: 3, reverse: 1 },
    swsh: { common: 4, uncommon: 3, reverse: 1 },
    'modern-sv': { common: 4, uncommon: 3, reverse: 1 },
    'chase-heavy': { common: 4, uncommon: 3, reverse: 1 },
    specialty: { common: 4, uncommon: 2, reverse: 1 }
  };

  /* Share of the single hit slot. Missing rarities fall through to a regular rare. */
  var SLOT_P = {
    vintage: { sir: 0.01, hyper: 0, ir: 0, ultra: 0.02, ace: 0, double: 0.05, holo: 0.33 },
    'bw-xy': { sir: 0.02, hyper: 0.01, ir: 0, ultra: 0.08, ace: 0.04, double: 0.10, holo: 0.22 },
    sm: { sir: 0.025, hyper: 0.015, ir: 0, ultra: 0.08, ace: 0, double: 0.12, holo: 0.18 },
    swsh: { sir: 0.02, hyper: 0.012, ir: 0.04, ultra: 0.07, ace: 0, double: 0.14, holo: 0.12 },
    'modern-sv': { sir: 0.016, hyper: 0.01, ir: 0.07, ultra: 0.07, ace: 0.02, double: 0.13, holo: 0.08 },
    'chase-heavy': { sir: 0.02, hyper: 0.012, ir: 0.09, ultra: 0.08, ace: 0.02, double: 0.14, holo: 0.08 },
    specialty: { sir: 0.02, hyper: 0.01, ir: 0.06, ultra: 0.08, ace: 0.05, double: 0.12, holo: 0.12 }
  };

  var HIT_ORDER = ['sir', 'hyper', 'ir', 'ultra', 'ace', 'double', 'holo'];
  var TIER_LABEL = {
    sir: 'Special illustration / secret',
    hyper: 'Hyper rare',
    ir: 'Illustration rare',
    ultra: 'Ultra rare',
    ace: 'ACE SPEC',
    double: 'Double rare / ex / V',
    holo: 'Holo rare',
    rare: 'Rare'
  };

  function tier(rarity) {
    var r = String(rarity || '').toLowerCase().trim();
    if (!r || r === 'promo') return 'skip';
    if (r === 'common') return 'common';
    if (r === 'uncommon') return 'uncommon';
    if (/special illustration|rare secret|rare rainbow|rare shiny/.test(r)) return 'sir';
    if (/hyper rare/.test(r)) return 'hyper';
    if (/illustration rare/.test(r)) return 'ir';
    if (/ultra rare|rare ultra|radiant rare|amazing rare|trainer gallery/.test(r)) return 'ultra';
    if (/ace spec/.test(r)) return 'ace';
    if (/double rare|rare holo v|vmax|vstar|v union|rare holo ex|rare holo gx|rare break|rare prime|rare legend|rare holo lv/.test(r)) return 'double';
    if (/rare holo/.test(r)) return 'holo';
    if (r === 'rare' || r.indexOf('rare') === 0) return 'rare';
    return 'skip';
  }

  var BASE_PRINTS = ['normal', 'holofoil', '1stEditionNormal', '1stEditionHolofoil'];

  function printValue(card, key) {
    var t = card && card.tcgplayer && card.tcgplayer.prices;
    var block = t && t[key];
    if (!block) return null;
    var val = block.market != null ? block.market : block.mid;
    if (val == null || !(Number(val) > 0)) return null;
    return Number(val);
  }

  function basePrintKeys(card) {
    var t = card && card.tcgplayer && card.tcgplayer.prices;
    var keys = BASE_PRINTS.slice();
    if (!t) return keys;
    Object.keys(t).forEach(function (k) {
      if (k && k !== 'reverseHolofoil' && keys.indexOf(k) === -1) keys.push(k);
    });
    return keys;
  }

  function usdPrice(card) {
    if (!card) return null;
    if (card.priceUsd > 0 && /^(live|last10)/.test(String(card.priceSource || ''))) {
      return { value: Number(card.priceUsd), source: card.priceSource };
    }
    var keys = basePrintKeys(card);
    for (var i = 0; i < keys.length; i++) {
      var val = printValue(card, keys[i]);
      if (val != null) return { value: val, source: 'tcgplayer' };
    }
    var reverseOnly = printValue(card, 'reverseHolofoil');
    if (reverseOnly != null) return { value: reverseOnly, source: 'tcgplayer' };
    if (card.market_price_usd != null && Number(card.market_price_usd) > 0) {
      return { value: Number(card.market_price_usd), source: 'catalog' };
    }
    if (card.priceUsd != null && Number(card.priceUsd) > 0) {
      return { value: Number(card.priceUsd), source: card.priceSource || 'catalog' };
    }
    return null;
  }

  function reverseUnit(card) {
    if (!card) return null;
    if (card.reverseUsd > 0) return { value: Number(card.reverseUsd), estimated: false };
    var rev = printValue(card, 'reverseHolofoil');
    if (rev != null) return { value: rev, estimated: false };
    if (!(card.priceUsd > 0)) return null;
    return { value: card.priceUsd * 1.15, estimated: true };
  }

  function mean(list) {
    if (!list.length) return null;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i].priceUsd;
    return sum / list.length;
  }

  function roundMoney(n) {
    return Math.round(n * 100) / 100;
  }

  function oddsLabel(p) {
    if (!(p > 0)) return '';
    if (p >= 0.995) return 'every pack';
    if (p >= 0.4) return Math.round(p * 100) + '% of packs';
    return '1 in ' + Math.max(2, Math.round(1 / p));
  }

  function normalizeCard(card) {
    var priced = usdPrice(card);
    var image = card.image || (card.images && (card.images.small || card.images.large)) || '';
    var reverse = printValue(card, 'reverseHolofoil');
    return {
      id: card.id,
      name: card.name || '',
      number: card.number || '',
      rarity: card.rarity || '',
      image: image,
      priceUsd: priced ? priced.value : null,
      priceSource: card.priceSource || (priced ? priced.source : ''),
      priceSamples: card.priceSamples > 0 ? card.priceSamples : null,
      reverseUsd: reverse
    };
  }

  function buildModel(cards, profile) {
    var recipeName = COUNTS[profile] ? profile : 'modern-sv';
    var counts = COUNTS[recipeName];
    var weights = SLOT_P[recipeName];
    var groups = {};
    var priced = 0;
    var skipped = 0;
    (cards || []).forEach(function (raw) {
      var card = normalizeCard(raw);
      if (!(card.priceUsd > 0)) {
        skipped++;
        return;
      }
      priced++;
      var t = tier(card.rarity);
      if (t === 'skip') return;
      if (!groups[t]) groups[t] = [];
      groups[t].push(card);
    });

    var lines = [];
    var bulk = 0;
    function addBulk(label, list, count, premium) {
      if (!list || !list.length || !(count > 0)) return;
      var avg = mean(list);
      var ev = count * avg * (premium || 1);
      bulk += ev;
      lines.push({
        label: label,
        detail: count + ' × avg $' + avg.toFixed(2) + (premium && premium !== 1 ? ' × ' + premium : ''),
        p: 1,
        avg: avg,
        ev: ev,
        n: list.length
      });
    }
    addBulk('Commons', groups.common, counts.common, 1);
    addBulk('Uncommons', groups.uncommon, counts.uncommon, 1);

    function addReverse(pool) {
      if (!pool.length) return;
      var sum = 0;
      var n = 0;
      var estimated = 0;
      pool.forEach(function (card) {
        var unit = reverseUnit(card);
        if (!unit) return;
        sum += unit.value;
        n++;
        if (unit.estimated) estimated++;
      });
      if (!n) return;
      var avg = sum / n;
      bulk += avg;
      var detail = '1 × avg $' + avg.toFixed(2);
      if (estimated === n) detail = '1 × avg $' + (avg / 1.15).toFixed(2) + ' × 1.15';
      else if (!estimated) detail += ' reverse market';
      lines.push({
        label: 'Reverse holo',
        detail: detail,
        p: 1,
        avg: avg,
        ev: avg,
        n: n
      });
    }
    if (counts.reverse) addReverse((groups.common || []).concat(groups.uncommon || []));

    var assigned = {};
    var used = 0;
    HIT_ORDER.forEach(function (t) {
      var p = weights[t] || 0;
      if (p > 0 && groups[t] && groups[t].length) {
        assigned[t] = p;
        used += p;
      }
    });
    var rest = Math.max(0, 1 - used);
    var restTier = null;
    ['rare', 'holo', 'double', 'ultra', 'ir', 'ace', 'sir', 'hyper'].forEach(function (t) {
      if (!restTier && groups[t] && groups[t].length && !assigned[t]) restTier = t;
    });
    if (!restTier) {
      ['holo', 'double', 'rare', 'ultra', 'ir'].forEach(function (t) {
        if (!restTier && groups[t] && groups[t].length) restTier = t;
      });
    }
    if (restTier && rest > 0.0001) assigned[restTier] = (assigned[restTier] || 0) + rest;

    var hitEv = 0;
    var hitTable = [];
    Object.keys(assigned).forEach(function (t) {
      var list = groups[t];
      if (!list || !list.length) return;
      var p = assigned[t];
      var avg = mean(list);
      var ev = p * avg;
      hitEv += ev;
      hitTable.push({ tier: t, p: p, cards: list, avg: avg });
      lines.push({
        label: TIER_LABEL[t] || t,
        detail: oddsLabel(p) + ' · avg $' + avg.toFixed(2) + ' · ' + list.length + ' cards',
        p: p,
        avg: avg,
        ev: ev,
        n: list.length
      });
    });
    hitTable.sort(function (a, b) { return b.p - a.p; });

    var chaseTier = ['sir', 'hyper', 'ir', 'ultra', 'ace', 'double', 'holo', 'rare'].filter(function (t) {
      return assigned[t] && groups[t] && groups[t].length && assigned[t] < 0.5;
    })[0] || null;

    var ev = bulk + hitEv;
    var ready = priced > 0 && (bulk > 0 || hitEv > 0);
    return {
      profile: recipeName,
      ready: ready,
      priced: priced,
      skipped: skipped,
      bulk: roundMoney(bulk),
      hitEv: roundMoney(hitEv),
      ev: ready ? roundMoney(ev) : null,
      lines: lines,
      groups: groups,
      hitTable: hitTable,
      counts: counts,
      chaseTier: chaseTier,
      chaseOdds: chaseTier ? Math.max(1, Math.round(1 / assigned[chaseTier])) : null,
      chaseAvg: chaseTier ? roundMoney(mean(groups[chaseTier])) : null,
      top: pricedCards(groups).sort(function (a, b) { return b.priceUsd - a.priceUsd; }).slice(0, 8)
    };
  }

  function pricedCards(groups) {
    var out = [];
    Object.keys(groups).forEach(function (t) {
      groups[t].forEach(function (c) { out.push(c); });
    });
    return out;
  }

  function pick(list, rng) {
    return list[Math.floor(rng() * list.length)];
  }

  function pickN(list, n, rng) {
    var pool = list.slice();
    var out = [];
    var i;
    for (i = 0; i < n && pool.length; i++) {
      var idx = Math.floor(rng() * pool.length);
      out.push(pool.splice(idx, 1)[0]);
    }
    while (out.length < n && list.length) out.push(pick(list, rng));
    return out;
  }

  function drawPack(model, rng) {
    var random = rng || Math.random;
    if (!model || !model.ready) return { cards: [], total: 0 };
    var pulled = [];
    function pushCard(card, slot, price) {
      pulled.push({
        id: card.id,
        name: card.name,
        number: card.number,
        rarity: card.rarity,
        image: card.image,
        slot: slot,
        priceUsd: roundMoney(price),
        priceSource: card.priceSource || ''
      });
    }
    var g = model.groups;
    if (g.common && g.common.length) {
      pickN(g.common, model.counts.common, random).forEach(function (c) {
        pushCard(c, 'Common', c.priceUsd);
      });
    }
    if (g.uncommon && g.uncommon.length) {
      pickN(g.uncommon, model.counts.uncommon, random).forEach(function (c) {
        pushCard(c, 'Uncommon', c.priceUsd);
      });
    }
    if (model.counts.reverse) {
      var pool = (g.common || []).concat(g.uncommon || []);
      if (pool.length) {
        var rev = pick(pool, random);
        var unit = reverseUnit(rev);
        pushCard(rev, 'Reverse', unit ? unit.value : rev.priceUsd);
      }
    }
    if (model.hitTable.length) {
      var roll = random();
      var acc = 0;
      var chosen = model.hitTable[model.hitTable.length - 1];
      for (var i = 0; i < model.hitTable.length; i++) {
        acc += model.hitTable[i].p;
        if (roll <= acc) {
          chosen = model.hitTable[i];
          break;
        }
      }
      var hit = pick(chosen.cards, random);
      pushCard(hit, hit.rarity || 'Hit', hit.priceUsd);
    }
    var total = 0;
    pulled.forEach(function (c) { total += c.priceUsd; });
    return { cards: pulled, total: roundMoney(total) };
  }

  /* Manual what-if: the chase is added on top of bulk. */
  function manualEv(bulk, odds, chase) {
    var b = Number(bulk);
    var o = Number(odds);
    var c = Number(chase);
    if (!isFinite(b) || !isFinite(c) || !(o >= 1)) return null;
    return roundMoney(b + c / o);
  }

  return {
    COUNTS: COUNTS,
    SLOT_P: SLOT_P,
    tier: tier,
    usdPrice: usdPrice,
    buildModel: buildModel,
    drawPack: drawPack,
    manualEv: manualEv,
    oddsLabel: oddsLabel
  };
});
