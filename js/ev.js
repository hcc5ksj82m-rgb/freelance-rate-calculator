/* PackEV sealed EV — same two-bucket model as the pack calculator, scaled to box and ETB.
   Pack counts come from data/sealed-assumptions.json. Costs are never invented. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PackEVMath = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  var COST_KEY = 'packev.sealedCosts.v1';

  var DEFAULT_ASSUMPTIONS = {
    version: 1,
    model: 'two-bucket',
    box: { packs: 36, label: 'Booster box' },
    etb: {
      label: 'Elite Trainer Box',
      packsBySeries: {
        'XY': 8,
        'Sun & Moon': 8,
        'Sword & Shield': 8,
        'Scarlet & Violet': 9,
        'Mega Evolution': 9
      }
    },
    exclude: {
      profiles: ['specialty'],
      nameIncludes: ['Shiny Vault', 'Trainer Gallery', 'Galarian Gallery', 'Classic Collection']
    },
    overrides: {},
    notes: []
  };

  function assumptions(raw) {
    if (!raw || !raw.box) return DEFAULT_ASSUMPTIONS;
    return raw;
  }

  function num(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** EV of one pack from the set's stored dead / odds / chase fields. */
  function packEv(set) {
    if (!set) return null;
    var dead = num(set.evDeadUsd);
    var odds = num(set.evChaseOdds);
    var chase = num(set.evChaseUsd);
    if (dead == null || chase == null || !(odds >= 1)) return null;
    var p = 1 / odds;
    return dead * (1 - p) + chase * p;
  }

  function excluded(set, raw) {
    var a = assumptions(raw);
    var ex = a.exclude || {};
    var profiles = ex.profiles || [];
    if (profiles.indexOf(set && set.evProfile) !== -1) return true;
    var name = String(set && set.name || '');
    var bits = ex.nameIncludes || [];
    for (var i = 0; i < bits.length; i++) {
      if (bits[i] && name.indexOf(bits[i]) !== -1) return true;
    }
    return false;
  }

  function geometry(set, raw) {
    var a = assumptions(raw);
    var over = (a.overrides && set && a.overrides[set.id]) || {};
    var skip = excluded(set, a);
    var boxPacks = null;
    var etbPacks = null;
    if (!skip) {
      if (Object.prototype.hasOwnProperty.call(over, 'boxPacks')) boxPacks = over.boxPacks;
      else boxPacks = a.box && a.box.packs != null ? a.box.packs : null;
      if (Object.prototype.hasOwnProperty.call(over, 'etbPacks')) etbPacks = over.etbPacks;
      else {
        var map = (a.etb && a.etb.packsBySeries) || {};
        etbPacks = Object.prototype.hasOwnProperty.call(map, set.series) ? map[set.series] : null;
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(over, 'boxPacks')) boxPacks = over.boxPacks;
      if (Object.prototype.hasOwnProperty.call(over, 'etbPacks')) etbPacks = over.etbPacks;
    }
    return {
      boxPacks: boxPacks == null ? null : num(boxPacks),
      etbPacks: etbPacks == null ? null : num(etbPacks),
      mainline: !skip,
      note: over.note || ''
    };
  }

  function scaled(evPack, packs, extra) {
    var n = num(packs);
    if (evPack == null || !(n > 0)) return null;
    return evPack * n + (num(extra) || 0);
  }

  function edge(ev, cost) {
    var c = num(cost);
    if (ev == null || !(c > 0)) return null;
    return ev - c;
  }

  function ratio(ev, cost) {
    var c = num(cost);
    if (ev == null || !(c > 0)) return null;
    return ev / c;
  }

  function summarize(set, raw) {
    var ev = packEv(set);
    var g = geometry(set, raw);
    return {
      evPack: ev,
      boxPacks: g.boxPacks,
      etbPacks: g.etbPacks,
      evBox: scaled(ev, g.boxPacks, 0),
      evEtb: scaled(ev, g.etbPacks, 0),
      mainline: g.mainline,
      note: g.note
    };
  }

  function money(n) {
    var v = num(n);
    if (v == null) return '—';
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  }

  function signedMoney(n) {
    var v = num(n);
    if (v == null) return '—';
    if (Math.abs(v) < 0.005) return '$0.00';
    return (v > 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
  }

  function formatRatio(r) {
    if (r == null || !isFinite(Number(r))) return '—';
    return Number(r).toFixed(2) + '×';
  }

  function ebaySearch(name, kind) {
    var q;
    if (kind === 'box') q = 'pokemon ' + name + ' booster box -etb -case -bundle';
    else if (kind === 'etb') q = 'pokemon ' + name + ' elite trainer box';
    else q = 'pokemon ' + name + ' booster pack -box -etb -bundle -case';
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q)
      + '&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60';
  }

  function emptyStore() {
    return { global: { pack: '', box: '', etb: '', msrp: false, scale: false }, rows: {} };
  }

  function readCosts() {
    var store = emptyStore();
    try {
      if (typeof localStorage === 'undefined') return store;
      var raw = localStorage.getItem(COST_KEY);
      if (!raw) return store;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return store;
      store.global = Object.assign(store.global, data.global || {});
      store.rows = data.rows && typeof data.rows === 'object' ? data.rows : {};
    } catch (e) { /* ignore private mode / bad json */ }
    return store;
  }

  function writeCosts(store) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(COST_KEY, JSON.stringify(store));
    } catch (e) { /* ignore */ }
  }

  function saveGlobal(patch) {
    var store = readCosts();
    Object.keys(patch || {}).forEach(function (k) {
      store.global[k] = patch[k];
    });
    writeCosts(store);
    return store;
  }

  function saveRow(setId, patch) {
    if (!setId) return readCosts();
    var store = readCosts();
    var row = Object.assign({}, store.rows[setId] || {});
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] == null || patch[k] === '') delete row[k];
      else row[k] = patch[k];
    });
    if (Object.keys(row).length) store.rows[setId] = row;
    else delete store.rows[setId];
    writeCosts(store);
    return store;
  }

  function positive(v) {
    var n = num(v);
    return n != null && n > 0 ? n : null;
  }

  /** Pack cost: typed per-set, else MSRP mode, else board-wide, else stored eBay sold. */
  function packCost(set, store) {
    store = store || readCosts();
    var row = store.rows[set.id] || {};
    var typed = positive(row.pack);
    if (typed != null) return { value: typed, source: 'row' };
    if (store.global.msrp) {
      var msrp = positive(set.packMsrpUsd);
      if (msrp != null) return { value: msrp, source: 'msrp' };
    }
    var globalPack = positive(store.global.pack);
    if (globalPack != null) return { value: globalPack, source: 'global' };
    var ebay = positive(set.ebayLastSoldUsd);
    if (ebay != null) return { value: ebay, source: 'ebay' };
    return { value: null, source: '' };
  }

  function productCost(set, store, kind, packValue, packs) {
    store = store || readCosts();
    var row = store.rows[set.id] || {};
    var typed = positive(row[kind]);
    if (typed != null) return { value: typed, source: 'row' };
    if (store.global.scale && packValue > 0 && packs > 0) {
      return { value: packValue * packs, source: 'scale' };
    }
    var globalCost = positive(store.global[kind]);
    if (globalCost != null) return { value: globalCost, source: 'global' };
    if (store.global.msrp && positive(set.packMsrpUsd) && packs > 0) {
      return { value: Number(set.packMsrpUsd) * packs, source: 'msrp' };
    }
    return { value: null, source: '' };
  }

  return {
    COST_KEY: COST_KEY,
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS,
    assumptions: assumptions,
    packEv: packEv,
    excluded: excluded,
    geometry: geometry,
    scaled: scaled,
    edge: edge,
    ratio: ratio,
    summarize: summarize,
    money: money,
    signedMoney: signedMoney,
    formatRatio: formatRatio,
    ebaySearch: ebaySearch,
    readCosts: readCosts,
    writeCosts: writeCosts,
    saveGlobal: saveGlobal,
    saveRow: saveRow,
    packCost: packCost,
    productCost: productCost
  };
});
