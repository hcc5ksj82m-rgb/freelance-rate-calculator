/* Pack rip — live card pool, last-10 prices, and a pack you can open. */
(function () {
  'use strict';

  var PROFILE_LABELS = {
    'chase-heavy': 'Chase-heavy set',
    specialty: 'Specialty / promo-style product',
    'modern-sv': 'Modern Scarlet & Violet pack',
    swsh: 'Sword & Shield pack',
    sm: 'Sun & Moon pack',
    'bw-xy': 'Black & White / XY pack',
    vintage: 'Vintage pack'
  };

  var allSets = [];
  var setsById = {};
  var cards = [];
  var model = null;
  var loadGen = 0;
  var session = { packs: 0, value: 0 };
  var params = new URLSearchParams(window.location.search);

  function $(id) { return document.getElementById(id); }

  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  }

  function sourceLabel(source, samples) {
    var n = Number(samples);
    var partial = n > 0 && n < 10 ? n + ' of last 10' : 'last 10';
    if (source === 'last10-sold') return partial + ' sold';
    if (source === 'last10') return partial + ' avg';
    if (source === 'live') return 'live market';
    if (source === 'tcgplayer') return 'TCGPlayer';
    if (source === 'catalog') return 'catalog';
    return '';
  }

  function fillSetOptions(filterText) {
    var sel = $('set');
    var prev = sel.value;
    var q = String(filterText || '').trim().toLowerCase();
    var list = allSets.filter(function (s) {
      if (!q) return true;
      return (s.name + ' ' + (s.series || '') + ' ' + s.id).toLowerCase().indexOf(q) !== -1;
    });
    sel.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'No sets match';
      sel.appendChild(empty);
      return;
    }
    list.slice().reverse().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name + ' (' + (s.releaseDate || '?') + ')';
      sel.appendChild(o);
    });
    if (prev && list.some(function (s) { return s.id === prev; })) sel.value = prev;
    else if (params.get('set') && list.some(function (s) { return s.id === params.get('set'); })) sel.value = params.get('set');
  }

  function currentSet() {
    return setsById[$('set').value] || null;
  }

  function setStatus(text) {
    var el = $('modelStatus');
    if (el) el.textContent = text || '';
  }

  function renderChase() {
    var box = $('chaseLive');
    var list = $('chaseLiveList');
    if (!box || !list) return;
    list.innerHTML = '';
    if (!model || !model.top.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    model.top.slice(0, 5).forEach(function (card) {
      var a = document.createElement('a');
      a.className = 'chase-chip';
      a.href = 'card.html?id=' + encodeURIComponent(card.id);
      var img = document.createElement('img');
      img.className = 'thumb';
      img.alt = '';
      if (/^https:\/\//.test(card.image || '')) img.src = card.image;
      var meta = document.createElement('span');
      meta.className = 'chase-chip-meta';
      var price = document.createElement('b');
      price.textContent = money(card.priceUsd);
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = card.name;
      var src = document.createElement('span');
      src.className = 'sub';
      src.textContent = sourceLabel(card.priceSource, card.priceSamples);
      meta.appendChild(price);
      meta.appendChild(sub);
      if (src.textContent) meta.appendChild(src);
      a.appendChild(img);
      a.appendChild(meta);
      list.appendChild(a);
    });
  }

  function renderBreakdown() {
    var list = $('breakdown');
    if (!list) return;
    list.innerHTML = '';
    if (!model || !model.lines.length) return;
    model.lines.forEach(function (line) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = line.label;
      var detail = document.createElement('span');
      detail.className = 'tip';
      detail.textContent = line.detail;
      var ev = document.createElement('b');
      ev.textContent = money(line.ev);
      li.appendChild(name);
      li.appendChild(detail);
      li.appendChild(ev);
      list.appendChild(li);
    });
  }

  function renderTotals() {
    var packs = Math.max(1, parseInt($('packs').value, 10) || 1);
    var cost = Number($('cost').value);
    var hasCost = isFinite(cost) && cost > 0;
    var ev = model && model.ev != null ? model.ev : null;
    $('evp').textContent = ev != null ? money(ev) : '—';
    $('evt').textContent = ev != null ? money(ev * packs) : '—';
    $('be').textContent = ev != null ? money(ev) : '—';
    var profit = $('profit');
    if (ev == null || !hasCost) {
      profit.textContent = '—';
      profit.className = '';
    } else {
      var delta = (ev - cost) * packs;
      profit.textContent = (delta >= 0 ? '+' : '') + money(delta);
      profit.className = delta >= 0 ? 'up' : 'down';
    }
    var tip = $('tip');
    if (!model || !model.ready) {
      tip.textContent = 'Card prices for this set are still loading.';
    } else if (!hasCost) {
      tip.textContent = 'Break-even pack cost is ' + money(ev) + '. Paste an eBay sold pack price to see profit. MSRP is not the market.';
    } else {
      var edge = ev - cost;
      tip.textContent = 'At ' + money(cost) + ' a pack, ' + packs + ' packs ' + (edge >= 0 ? 'clear' : 'miss')
        + ' the card-pool EV by ' + money(Math.abs(edge)) + ' each.';
    }
  }

  function renderSession() {
    var el = $('ripSession');
    if (!el) return;
    if (!session.packs) {
      el.textContent = 'No packs opened this visit.';
      return;
    }
    var cost = Number($('cost').value);
    var text = 'Opened ' + session.packs + ' · pulled ' + money(session.value)
      + ' · average ' + money(session.value / session.packs);
    if (isFinite(cost) && cost > 0) {
      var profit = session.value - cost * session.packs;
      text += ' · versus cost ' + (profit >= 0 ? '+' : '-') + money(Math.abs(profit));
    }
    el.textContent = text;
  }

  function renderPack(pull) {
    var row = $('ripRow');
    if (!row) return;
    var wrap = document.createElement('div');
    wrap.className = 'rip-pack';
    var head = document.createElement('div');
    head.className = 'rip-pack-head';
    head.textContent = 'Pack ' + session.packs + ' · ' + money(pull.total);
    wrap.appendChild(head);
    var cardsRow = document.createElement('div');
    cardsRow.className = 'rip-row';
    pull.cards.forEach(function (card) {
      var fig = document.createElement('a');
      var hit = card.slot !== 'Common' && card.slot !== 'Uncommon' && card.slot !== 'Reverse';
      fig.className = hit ? 'rip-card rip-hit' : 'rip-card';
      fig.href = 'card.html?id=' + encodeURIComponent(card.id);
      fig.title = card.name;
      if (/^https:\/\//.test(card.image || '')) {
        var img = document.createElement('img');
        img.alt = card.name;
        img.src = card.image;
        fig.appendChild(img);
      } else {
        var ph = document.createElement('span');
        ph.className = 'rip-ph';
        fig.appendChild(ph);
      }
      var cap = document.createElement('span');
      cap.className = 'rip-cap';
      var nm = document.createElement('b');
      nm.textContent = money(card.priceUsd);
      var who = document.createElement('span');
      who.className = 'rip-name';
      who.textContent = card.name;
      var slot = document.createElement('span');
      slot.textContent = card.slot;
      cap.appendChild(nm);
      cap.appendChild(who);
      cap.appendChild(slot);
      fig.appendChild(cap);
      cardsRow.appendChild(fig);
    });
    wrap.appendChild(cardsRow);
    row.insertBefore(wrap, row.firstChild);
    while (row.children.length > 6) row.removeChild(row.lastChild);
  }

  function render() {
    renderChase();
    renderBreakdown();
    renderTotals();
    renderSession();
    var label = currentSet();
    var profile = label && PROFILE_LABELS[label.evProfile] || 'Pack';
    var ready = !!(model && model.ready);
    if ($('ripOne')) $('ripOne').disabled = !ready;
    if ($('ripTen')) $('ripTen').disabled = !ready;
    if (ready) {
      setStatus(profile + ' · ' + model.priced + ' priced cards'
        + (model.skipped ? ' · ' + model.skipped + ' without a USD price' : '')
        + '. Bulk ' + money(model.bulk) + ' + hit slot ' + money(model.hitEv) + '.');
    }
  }

  function priceRank(list) {
    return list.filter(function (c) { return c.priceUsd > 0; })
      .sort(function (a, b) { return b.priceUsd - a.priceUsd; });
  }

  function rebuild() {
    model = window.PackEVPack.buildModel(cards, (currentSet() || {}).evProfile);
    render();
  }

  async function sharpenPrices(gen) {
    var ranked = priceRank(cards).slice(0, 40);
    if (!ranked.length || gen !== loadGen) return;
    if (window.PackEVPriceHistory && PackEVPriceHistory.fetchLatestAverages) {
      try {
        var map = await PackEVPriceHistory.fetchLatestAverages(ranked.map(function (c) { return c.id; }));
        if (gen !== loadGen) return;
        ranked.forEach(function (card) {
          var row = map[card.id];
          if (!row || !(row.daily > 0)) return;
          card.priceUsd = row.daily;
          card.priceSource = row.kind === 'sold' ? 'last10-sold' : 'last10';
          card.priceSamples = row.samples;
        });
        rebuild();
      } catch (_) { /* catalog prices stay */ }
    }
    var liveIds = priceRank(cards).slice(0, 5).filter(function (c) {
      return c.priceSource !== 'last10-sold';
    });
    await Promise.all(liveIds.map(async function (card) {
      if (!window.PackEVCards || !PackEVCards.fetchLiveCardById) return;
      try {
        var live = await PackEVCards.fetchLiveCardById(card.id);
        if (gen !== loadGen || !live) return;
        var priced = PackEVPack.usdPrice(live);
        if (priced && priced.value > 0) {
          card.priceUsd = priced.value;
          card.priceSource = 'live';
        }
      } catch (_) { /* keep the price we have */ }
    }));
    if (gen !== loadGen) return;
    rebuild();
  }

  async function syncSet() {
    var set = currentSet();
    if (!set) return;
    $('ebayLink').href = set.ebaySoldUrl || '#';
    $('setPageLink').href = 'set.html?id=' + encodeURIComponent(set.id);
    $('pricesLink').href = 'prices.html?q=' + encodeURIComponent(set.name);
    $('cost').value = set.ebayLastSoldUsd != null ? Number(set.ebayLastSoldUsd).toFixed(2) : '';
    $('profileTip').textContent = (PROFILE_LABELS[set.evProfile] || 'Pack')
      + (set.cardCount != null ? ' · ' + set.cardCount + ' cards in the set' : '');
    session = { packs: 0, value: 0 };
    var row = $('ripRow');
    if (row) row.innerHTML = '';
    renderSession();
    var gen = ++loadGen;
    cards = [];
    model = null;
    setStatus('Loading card prices…');
    render();
    try {
      var rows = await PackEVCards.fetchCardsFromDb(set.id);
      if (gen !== loadGen) return;
      cards = rows.map(function (row) {
        var priced = PackEVPack.usdPrice(row);
        return {
          id: row.id,
          name: row.name,
          number: row.number,
          rarity: row.rarity,
          image: row.images && row.images.small,
          tcgplayer: row.tcgplayer,
          market_price_usd: row.market_price_usd,
          priceUsd: priced ? priced.value : null,
          priceSource: priced ? priced.source : ''
        };
      });
      rebuild();
      if (!model.ready) setStatus('No USD card prices for this set yet.');
      sharpenPrices(gen);
    } catch (err) {
      if (gen !== loadGen) return;
      setStatus('Could not load this set. ' + ((err && err.message) || ''));
    }
  }

  function rip(times) {
    if (!model || !model.ready) return;
    var n = Math.max(1, Math.min(10, times || 1));
    for (var i = 0; i < n; i++) {
      var pull = PackEVPack.drawPack(model);
      session.packs += 1;
      session.value += pull.total;
      renderPack(pull);
    }
    renderSession();
  }

  function renderWhatIf() {
    var out = $('whatifOut');
    if (!out) return;
    var ev = PackEVPack.manualEv($('dead').value, $('odds').value, $('chase').value);
    out.textContent = ev == null ? 'Enter bulk, odds of at least 1, and a chase value.' : 'What-if EV ' + money(ev) + ' / pack. This does not change the card-pool number above.';
  }

  function boot(sets) {
    allSets = sets;
    setsById = {};
    sets.forEach(function (s) { setsById[s.id] = s; });
    fillSetOptions('');
    if (params.get('set')) $('set').value = params.get('set');
    $('set').addEventListener('change', syncSet);
    $('setFilter').addEventListener('input', function () {
      var before = $('set').value;
      fillSetOptions(this.value);
      if ($('set').value !== before) syncSet();
    });
    ['cost', 'packs'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        renderTotals();
        renderSession();
      });
    });
    $('ripOne').addEventListener('click', function () { rip(1); });
    $('ripTen').addEventListener('click', function () { rip(10); });
    $('ripClear').addEventListener('click', function () {
      session = { packs: 0, value: 0 };
      $('ripRow').innerHTML = '';
      renderSession();
    });
    ['dead', 'odds', 'chase'].forEach(function (id) {
      $(id).addEventListener('input', renderWhatIf);
    });
    renderWhatIf();
    syncSet();
  }

  fetch('data/sets.json').then(function (r) { return r.json(); }).then(boot);
})();
