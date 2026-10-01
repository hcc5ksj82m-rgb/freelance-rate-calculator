/* PackEV Prices — live TCG API chase rotation + name search charts */
(function () {
  'use strict';

  var API = 'https://api.pokemontcg.io/v2/cards';
  var SELECT = 'id,name,number,rarity,images,tcgplayer,cardmarket,set';
  var FEATURED_SIZE = 20;
  var POOL_TARGET = 100;
  var ROTATE_MS = 10000;
  var SEARCH_DEBOUNCE = 350;

  var pool = [];           // ranked chase cards (live or fallback)
  var rotateOffset = 0;
  var rotateTimer = null;
  var searchTimer = null;
  var searchGen = 0;
  var searching = false;

  var els = {};

  function $(id) { return document.getElementById(id); }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function escapeLucene(s) {
    return String(s).replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Best TCGPlayer print block + market/mid value */
  function priceDetail(c) {
    var t = c.tcgplayer && c.tcgplayer.prices;
    if (t) {
      var keys = ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil', '1stEditionNormal']
        .concat(Object.keys(t));
      var seen = {};
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!k || seen[k] || !t[k]) continue;
        seen[k] = true;
        var block = t[k];
        var val = block.market != null ? block.market : block.mid;
        if (val != null) {
          return {
            value: Number(val),
            currency: 'USD',
            source: 'tcgplayer',
            printType: k,
            low: block.low != null ? Number(block.low) : null,
            mid: block.mid != null ? Number(block.mid) : null,
            high: block.high != null ? Number(block.high) : null,
            market: block.market != null ? Number(block.market) : null,
            live: true
          };
        }
      }
    }
    var cm = c.cardmarket && c.cardmarket.prices;
    if (cm && (cm.averageSellPrice != null || cm.trendPrice != null)) {
      return {
        value: Number(cm.averageSellPrice != null ? cm.averageSellPrice : cm.trendPrice),
        currency: 'EUR',
        source: 'cardmarket',
        printType: 'avg',
        low: cm.lowPrice != null ? Number(cm.lowPrice) : null,
        mid: cm.averageSellPrice != null ? Number(cm.averageSellPrice) : null,
        high: cm.trendPrice != null ? Number(cm.trendPrice) : null,
        market: cm.averageSellPrice != null ? Number(cm.averageSellPrice) : null,
        live: true
      };
    }
    return null;
  }

  function fmtMoney(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var cur = currency || 'USD';
    var prefix = cur === 'EUR' ? '€' : '$';
    if (Math.abs(n) >= 1000) return prefix + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    return prefix + Number(n).toFixed(2);
  }

  function normalizeCard(raw, fallbackStatus) {
    var p = priceDetail(raw);
    var setName = (raw.set && raw.set.name) || raw.setName || raw.set || '';
    var setId = (raw.set && raw.set.id) || raw.setId || '';
    var img = (raw.images && (raw.images.small || raw.images.large)) || raw.image || '';
    return {
      id: raw.id || raw.cardId,
      name: raw.name || raw.displayName || '',
      number: raw.number || '',
      rarity: raw.rarity || '',
      set: setName,
      setId: setId,
      image: img,
      price: p ? p.value : (raw.priceUsdApprox != null ? raw.priceUsdApprox : raw.price),
      currency: p ? p.currency : (raw.currency || 'USD'),
      source: p ? p.source : (raw.source || ''),
      printType: p ? p.printType : (raw.printType || ''),
      low: p ? p.low : null,
      mid: p ? p.mid : null,
      high: p ? p.high : null,
      market: p ? p.market : null,
      priceStatus: p && p.live ? 'live' : (raw.priceStatus || fallbackStatus || 'demo'),
      _raw: raw
    };
  }

  async function fetchJsonWithRetry(url) {
    var lastErr;
    for (var attempt = 0; attempt < 5; attempt++) {
      try {
        var res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.status === 429 || res.status >= 500) {
          var err = new Error('API ' + res.status + (res.status === 429 ? ' (rate limited)' : ' (server error)'));
          err.retryable = true;
          throw err;
        }
        if (!res.ok) {
          var err2 = new Error('API ' + res.status);
          err2.retryable = false;
          throw err2;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (!e.retryable && attempt === 0 && (!e.message || e.message.indexOf('API') !== 0)) {
          /* network — retry */
        } else if (!e.retryable) {
          throw e;
        }
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
      }
    }
    throw lastErr;
  }

  async function fetchCardsByIds(ids) {
    if (!ids.length) return [];
    // Batch OR queries — keep URL reasonable
    var batchSize = 12;
    var out = [];
    for (var i = 0; i < ids.length; i += batchSize) {
      var chunk = ids.slice(i, i + batchSize);
      var q = chunk.map(function (id) { return 'id:' + id; }).join(' OR ');
      var url = API + '?q=' + encodeURIComponent(q)
        + '&pageSize=' + chunk.length
        + '&select=' + SELECT;
      try {
        var json = await fetchJsonWithRetry(url);
        out = out.concat(json.data || []);
      } catch (e) {
        console.warn('chase batch failed', e.message);
      }
      if (i + batchSize < ids.length) await sleep(280);
    }
    return out;
  }

  async function searchCardsByName(query) {
    var q = escapeLucene(query.trim());
    var url = API + '?q=name:' + encodeURIComponent('"' + q + '*"')
      + '&page=1&pageSize=24&select=' + SELECT;
    return fetchJsonWithRetry(url);
  }

  function sparkBars(card) {
    var parts = [
      { label: 'Low', v: card.low },
      { label: 'Mid', v: card.mid },
      { label: 'Mkt', v: card.market != null ? card.market : card.price },
      { label: 'High', v: card.high }
    ].filter(function (p) { return p.v != null && !isNaN(p.v); });
    if (!parts.length) {
      return '<div class="spark empty tip">No price fields</div>';
    }
    var max = Math.max.apply(null, parts.map(function (p) { return p.v; }).concat([1]));
    return '<div class="spark" title="TCGPlayer/Cardmarket snapshot fields">'
      + parts.map(function (p) {
        var h = Math.max(4, Math.round((p.v / max) * 36));
        return '<div class="spark-col"><div class="spark-bar" style="height:' + h + 'px"></div>'
          + '<span>' + p.label + '</span></div>';
      }).join('')
      + '</div>';
  }

  function featuredSlice() {
    if (!pool.length) return [];
    var n = Math.min(FEATURED_SIZE, pool.length);
    var slice = [];
    for (var i = 0; i < n; i++) {
      slice.push(pool[(rotateOffset + i) % pool.length]);
    }
    return slice;
  }

  function renderFeaturedChart(list) {
    var chart = els.chart;
    if (!list.length) {
      chart.innerHTML = '<p class="tip">Loading chase cards…</p>';
      return;
    }
    var max = Math.max.apply(null, list.map(function (c) { return Number(c.price) || 0 }).concat([1]));
    chart.innerHTML = list.slice(0, FEATURED_SIZE).map(function (c) {
      var h = Math.max(8, Math.round(((Number(c.price) || 0) / max) * 140));
      var label = (c.name || '').split(' ').slice(0, 2).join(' ');
      return '<div class="bar-wrap"><div class="bar" style="height:' + h + 'px" title="'
        + esc(c.name) + ' · ' + fmtMoney(c.price, c.currency) + '"></div>'
        + '<div class="bar-label">' + esc(label) + '</div></div>';
    }).join('');
  }

  function renderFeaturedGrid(list) {
    var grid = els.featuredGrid;
    grid.innerHTML = list.map(function (c) {
      var badge = c.priceStatus === 'live'
        ? '<span class="badge live">LIVE</span>'
        : '<span class="badge demo">DEMO</span>';
      var img = c.image
        ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" />'
        : '<div class="ph"></div>';
      return '<article class="price-card">'
        + img
        + '<div class="m">'
        + '<strong>' + esc(c.name) + '</strong>'
        + '<div class="tip">#' + esc(c.number || '?') + ' · ' + esc(c.set || '') + '</div>'
        + '<div class="price">' + fmtMoney(c.price, c.currency) + ' ' + badge + '</div>'
        + sparkBars(c)
        + '<div class="tip">' + esc(c.source || '—') + (c.printType ? ' · ' + esc(c.printType) : '') + '</div>'
        + '</div></article>';
    }).join('');
  }

  function updateFeaturedMeta() {
    var live = pool.filter(function (c) { return c.priceStatus === 'live'; }).length;
    var start = pool.length ? (rotateOffset % pool.length) + 1 : 0;
    var end = pool.length ? Math.min(start + FEATURED_SIZE - 1, pool.length) : 0;
    // sliding window label (wrap-aware)
    els.metaLine.textContent = pool.length
      ? 'Featuring ' + Math.min(FEATURED_SIZE, pool.length) + ' of top ' + pool.length
        + ' chase · ' + live + ' LIVE · rotates ~every ' + (ROTATE_MS / 1000) + 's'
      : 'Loading chase pool…';
    els.rotateHint.textContent = pool.length
      ? 'Window offset ' + (rotateOffset % pool.length) + ' · educational prices, not investment advice'
      : '';
  }

  function paintFeatured() {
    if (searching) return;
    var list = featuredSlice();
    renderFeaturedChart(list);
    renderFeaturedGrid(list);
    updateFeaturedMeta();
    els.featuredSection.hidden = false;
    els.searchSection.hidden = true;
  }

  function startRotation() {
    stopRotation();
    if (pool.length <= FEATURED_SIZE) return;
    rotateTimer = setInterval(function () {
      if (searching) return;
      rotateOffset = (rotateOffset + FEATURED_SIZE) % pool.length;
      els.featuredSection.classList.add('rotating');
      paintFeatured();
      setTimeout(function () { els.featuredSection.classList.remove('rotating'); }, 400);
    }, ROTATE_MS);
  }

  function stopRotation() {
    if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = null; }
  }

  function paintSearchResults(cards) {
    els.featuredSection.hidden = true;
    els.searchSection.hidden = false;
    var status = els.searchStatus;
    var grid = els.searchGrid;
    var chart = els.searchChart;
    status.classList.remove('expand-error');

    if (!cards.length) {
      status.textContent = 'No matching cards found.';
      grid.innerHTML = '';
      chart.innerHTML = '<p class="tip">Try another name.</p>';
      return;
    }

    var liveN = cards.filter(function (c) { return c.priceStatus === 'live'; }).length;
    status.textContent = cards.length + ' match' + (cards.length === 1 ? '' : 'es')
      + ' · ' + liveN + ' with LIVE prices (TCGPlayer / Cardmarket)';

    var max = Math.max.apply(null, cards.map(function (c) { return Number(c.price) || 0 }).concat([1]));
    chart.innerHTML = cards.slice(0, 12).map(function (c) {
      var h = Math.max(8, Math.round(((Number(c.price) || 0) / max) * 140));
      var label = (c.name || '').split(' ').slice(0, 2).join(' ');
      return '<div class="bar-wrap"><div class="bar" style="height:' + h + 'px"></div>'
        + '<div class="bar-label">' + esc(label) + '</div></div>';
    }).join('');

    grid.innerHTML = cards.map(function (c) {
      var badge = c.priceStatus === 'live'
        ? '<span class="badge live">LIVE</span>'
        : '<span class="badge demo">No live price</span>';
      var img = c.image
        ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" />'
        : '<div class="ph"></div>';
      var setLink = c.setId
        ? '<a href="set.html?id=' + encodeURIComponent(c.setId) + '">' + esc(c.set || c.setId) + '</a>'
        : esc(c.set || '');
      return '<article class="price-card">'
        + img
        + '<div class="m">'
        + '<strong>' + esc(c.name) + '</strong>'
        + '<div class="tip">#' + esc(c.number || '?') + ' · ' + esc(c.rarity || '—') + '</div>'
        + '<div class="tip set-of">' + setLink + '</div>'
        + '<div class="price">' + (c.price != null ? fmtMoney(c.price, c.currency) : '—') + ' ' + badge + '</div>'
        + sparkBars(c)
        + '<div class="tip">' + esc(c.source || '') + (c.printType ? ' · ' + esc(c.printType) : '') + '</div>'
        + '</div></article>';
    }).join('');
  }

  function clearSearchUI() {
    searching = false;
    els.searchSection.hidden = true;
    els.searchStatus.textContent = '';
    els.searchGrid.innerHTML = '';
    els.searchChart.innerHTML = '';
    els.featuredSection.hidden = false;
    paintFeatured();
    startRotation();
  }

  function scheduleSearch() {
    var raw = els.q.value.trim();
    clearTimeout(searchTimer);
    if (raw.length < 2) {
      searchGen++;
      clearSearchUI();
      return;
    }
    searching = true;
    stopRotation();
    els.featuredSection.hidden = true;
    els.searchSection.hidden = false;
    els.searchStatus.classList.remove('expand-error');
    els.searchStatus.textContent = 'Searching live API…';
    var gen = ++searchGen;
    searchTimer = setTimeout(async function () {
      try {
        var json = await searchCardsByName(raw);
        if (gen !== searchGen) return;
        var cards = (json.data || []).map(function (c) { return normalizeCard(c); });
        // Prefer higher priced matches first
        cards.sort(function (a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
        paintSearchResults(cards);
      } catch (e) {
        if (gen !== searchGen) return;
        els.searchStatus.classList.add('expand-error');
        els.searchStatus.innerHTML = 'Could not search cards: ' + esc(e.message)
          + '. The Pokemon TCG API is often flaky — try again.'
          + ' <button type="button" class="retry-btn">Retry</button>';
        els.searchGrid.innerHTML = '';
        els.searchChart.innerHTML = '';
        var btn = els.searchStatus.querySelector('.retry-btn');
        if (btn) btn.onclick = function () { scheduleSearch(); };
      }
    }, SEARCH_DEBOUNCE);
  }

  async function loadPool() {
    els.metaLine.textContent = 'Loading top chase cards from live API…';
    var seedIds = [];
    var demoFallback = [];

    try {
      var poolJson = await fetch('data/chase-pool.json').then(function (r) { return r.json(); });
      seedIds = (poolJson.cards || []).map(function (c) { return c.id; }).filter(Boolean);
    } catch (_) {}

    try {
      demoFallback = await fetch('data/demo-cards.json').then(function (r) { return r.json(); });
    } catch (_) {}

    var liveCards = [];
    if (seedIds.length) {
      try {
        liveCards = await fetchCardsByIds(seedIds.slice(0, 120));
      } catch (e) {
        console.warn('live chase fetch failed', e);
      }
    }

    var normalized = liveCards.map(function (c) { return normalizeCard(c); })
      .filter(function (c) { return c.price != null && Number(c.price) > 0; });

    // Merge demo fallback for missing IDs / empty live
    var byId = {};
    normalized.forEach(function (c) { byId[c.id] = c; });
    (demoFallback || []).forEach(function (d) {
      var n = normalizeCard(d, 'demo');
      if (!byId[n.id] && n.price != null) {
        byId[n.id] = n;
      }
    });

    pool = Object.keys(byId).map(function (k) { return byId[k]; });
    pool.sort(function (a, b) { return (Number(b.price) || 0) - (Number(a.price) || 0); });
    if (pool.length > POOL_TARGET) pool = pool.slice(0, POOL_TARGET);

    if (!pool.length) {
      els.metaLine.textContent = 'Could not load chase pool — try search, or reload.';
      els.chart.innerHTML = '<p class="tip">API unavailable. Use search when the Pokemon TCG API recovers.</p>';
      els.featuredGrid.innerHTML = '';
      return;
    }

    rotateOffset = 0;
    paintFeatured();
    startRotation();
  }

  function init() {
    els = {
      q: $('q'),
      metaLine: $('metaLine'),
      rotateHint: $('rotateHint'),
      chart: $('chart'),
      featuredSection: $('featuredSection'),
      featuredGrid: $('featuredGrid'),
      searchSection: $('searchSection'),
      searchStatus: $('searchStatus'),
      searchGrid: $('searchGrid'),
      searchChart: $('searchChart')
    };
    els.q.addEventListener('input', scheduleSearch);
    loadPool();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
