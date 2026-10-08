/* PackEV Prices — search catalog (Supabase) by card name; live API optional after pick */
(function () {
  'use strict';

  var SEARCH_DEBOUNCE = 350;
  var SEARCH_LIMIT = 24;

  var searchTimer = null;
  var searchGen = 0;
  var els = {};
  var lastCards = [];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Best TCGPlayer print block + market/mid value; then Cardmarket; then catalog USD */
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
    if (c.market_price_usd != null && !isNaN(Number(c.market_price_usd))) {
      return {
        value: Number(c.market_price_usd),
        currency: 'USD',
        source: 'catalog',
        printType: '',
        low: null,
        mid: null,
        high: null,
        market: Number(c.market_price_usd),
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

  function normalizeCard(raw) {
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
      priceStatus: p && p.live ? 'live' : 'none',
      tcgplayer: raw.tcgplayer || null,
      cardmarket: raw.cardmarket || null,
      market_price_usd: raw.market_price_usd != null ? Number(raw.market_price_usd) : null,
      graded: window.PackEVGraded.find(raw)
    };
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

  function openCardPage(id) {
    if (!id) return;
    location.href = 'card.html?id=' + encodeURIComponent(id);
  }

  function nameRank(card, query) {
    var name = String(card.name || '').toLowerCase();
    var q = String(query || '').trim().toLowerCase();
    if (!q) return 3;
    if (name === q) return 0;
    if (name.indexOf(q) === 0) return 1;
    var words = name.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) === 0) return 2;
    }
    return 3;
  }

  function highlightName(name, query) {
    var src = String(name || '');
    var q = String(query || '').trim();
    if (q.length < 2) return esc(src);
    var i = src.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(src);
    return esc(src.slice(0, i))
      + '<mark class="qmark">' + esc(src.slice(i, i + q.length)) + '</mark>'
      + esc(src.slice(i + q.length));
  }

  function chartValue(card) {
    if (card.avgDaily != null && card.currency !== 'EUR') return Number(card.avgDaily);
    return card.price != null ? Number(card.price) : null;
  }

  async function enrichAverages(cards, gen, query) {
    if (!window.PackEVPriceHistory || !PackEVPriceHistory.fetchLatestAverages) return;
    var ids = cards.map(function (c) { return c.id; }).filter(Boolean);
    if (!ids.length) return;
    try {
      var map = await PackEVPriceHistory.fetchLatestAverages(ids);
      if (gen !== searchGen) return;
      var changed = false;
      cards.forEach(function (c) {
        var row = map[c.id];
        if (!row || row.daily == null) return;
        c.avgDaily = row.daily;
        c.avgMonthly = row.monthly;
        c.avgSamples = row.samples;
        changed = true;
      });
      if (changed) paintSearchResults(cards, query);
    } catch (_) { /* spot prices stay on screen */ }
  }

  function paintSearchResults(cards, query) {
    var status = els.searchStatus;
    var grid = els.searchGrid;
    var chart = els.searchChart;
    status.classList.remove('expand-error');
    lastCards = cards;

    if (!cards.length) {
      status.textContent = 'No matching cards — try another name.';
      grid.innerHTML = '';
      chart.innerHTML = '<p class="tip">Tip: use 2+ letters (e.g. Charizard, Umbreon).</p>';
      return;
    }

    var liveN = cards.filter(function (c) { return c.priceStatus === 'live'; }).length;
    status.textContent = cards.length + ' match' + (cards.length === 1 ? '' : 'es')
      + ' · ' + liveN + ' with prices'
      + ' · click a card for details + history';

    var anyAvg = cards.some(function (c) { return c.avgDaily != null && c.currency !== 'EUR'; });
    var shownVals = cards.slice(0, 12).map(chartValue).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    var mid = shownVals.length ? shownVals[Math.floor(shownVals.length / 2)] : 1;
    var max = Math.max.apply(null, shownVals.concat([1]));
    var spreadNote = max > mid * 8 ? ' One result is much higher, so the other bars look short.' : '';
    chart.innerHTML = '<p class="chart-caption tip">'
      + (anyAvg
        ? 'Bar height is the daily price: the average of the last 10 recorded prices. Exact name matches are listed first.'
        : 'Market price of these results (taller = higher). Last-10 averages appear when history is available. Exact name matches are listed first.')
      + spreadNote
      + '</p><div class="chart-bars">'
      + cards.slice(0, 12).map(function (c) {
      var shown = chartValue(c);
      var h = Math.max(8, Math.round(((Number(shown) || 0) / max) * 108));
      var label = (c.name || '').split(' ').slice(0, 2).join(' ');
      var val = shown != null ? fmtMoney(shown, c.currency === 'EUR' ? 'EUR' : 'USD') : '—';
      return '<div class="bar-wrap" title="' + esc(c.name) + ' ' + esc(val) + '">'
        + '<div class="bar-val">' + esc(val) + '</div>'
        + '<div class="bar" style="height:' + h + 'px"></div>'
        + '<div class="bar-label">' + esc(label) + '</div></div>';
    }).join('') + '</div>';

    grid.innerHTML = cards.map(function (c) {
      var badge = c.priceStatus === 'live'
        ? '<span class="badge live">LIVE</span>'
        : '<span class="badge muted">No live price</span>';
      var img = c.image
        ? '<img src="' + esc(c.image) + '" alt="" loading="lazy" />'
        : '<div class="ph"></div>';
      var setLink = c.setId
        ? '<a href="set.html?id=' + encodeURIComponent(c.setId) + '">' + esc(c.set || c.setId) + '</a>'
        : esc(c.set || '');
      var avgLine = '';
      if (c.avgDaily != null) {
        avgLine = '<div class="tip">Last 10 avg ' + fmtMoney(c.avgDaily, 'USD')
          + (c.avgSamples < 10 ? ' (' + c.avgSamples + '/10)' : '')
          + (c.avgMonthly != null ? ' · month ' + fmtMoney(c.avgMonthly, 'USD') : '')
          + '</div>';
      }
      return '<article class="price-card" tabindex="0" role="button" data-id="' + esc(c.id) + '" aria-label="Open card page for ' + esc(c.name) + '">'
        + img
        + '<div class="m">'
        + '<strong>' + highlightName(c.name, query) + '</strong>'
        + '<div class="tip">#' + esc(c.number || '?') + ' · ' + esc(c.rarity || '—') + '</div>'
        + '<div class="tip set-of">' + setLink + '</div>'
        + '<div class="price">' + (c.price != null ? fmtMoney(c.price, c.currency) : '—') + ' ' + badge + '</div>'
        + avgLine
        + sparkBars(c)
        + window.PackEVGraded.render(c)
        + '<div class="tip">' + esc(c.source || '') + (c.printType ? ' · ' + esc(c.printType) : '') + '</div>'
        + '</div></article>';
    }).join('');
    if (window.PackEVGraded && PackEVGraded.schedule) PackEVGraded.schedule(grid);
  }

  function clearSearchUi() {
    els.searchSection.hidden = true;
    els.searchStatus.classList.remove('expand-error');
    els.searchStatus.textContent = '';
    els.searchGrid.innerHTML = '';
    els.searchChart.innerHTML = '';
    lastCards = [];
  }

  function onGridActivate(e) {
    var t = e.target;
    if (t.closest && t.closest('a')) return;
    var cardEl = t.closest ? t.closest('.price-card') : null;
    if (!cardEl || !els.searchGrid.contains(cardEl)) return;
    var id = cardEl.getAttribute('data-id');
    if (id) openCardPage(id);
  }

  function onGridKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var cardEl = e.target.closest ? e.target.closest('.price-card') : null;
    if (!cardEl || !els.searchGrid.contains(cardEl)) return;
    e.preventDefault();
    var id = cardEl.getAttribute('data-id');
    if (id) openCardPage(id);
  }

  function scheduleSearch() {
    var raw = els.q.value.trim();
    clearTimeout(searchTimer);
    if (raw.length < 2) {
      searchGen++;
      clearSearchUi();
      return;
    }

    els.searchSection.hidden = false;
    els.searchStatus.classList.remove('expand-error');
    els.searchStatus.textContent = 'Searching catalog…';
    var gen = ++searchGen;
    searchTimer = setTimeout(async function () {
      try {
        if (!window.PackEVCards || !window.PackEVCards.searchByName) {
          throw new Error('Catalog helper missing');
        }
        var result = await window.PackEVCards.searchByName(raw, SEARCH_LIMIT);
        if (gen !== searchGen) return;
        var cards = (result.cards || []).map(normalizeCard);
        cards.sort(function (a, b) {
          var ra = nameRank(a, raw);
          var rb = nameRank(b, raw);
          if (ra !== rb) return ra - rb;
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        });
        paintSearchResults(cards, raw);
        enrichAverages(cards, gen, raw);
      } catch (e) {
        if (gen !== searchGen) return;
        els.searchStatus.classList.add('expand-error');
        els.searchStatus.innerHTML = 'Search failed — check your connection and try again.'
          + ' <button type="button" class="retry-btn">Retry</button>';
        els.searchGrid.innerHTML = '';
        els.searchChart.innerHTML = '<p class="tip">Catalog search is temporarily unavailable.</p>';
        lastCards = [];
        var btn = els.searchStatus.querySelector('.retry-btn');
        if (btn) btn.onclick = function () { scheduleSearch(); };
      }
    }, SEARCH_DEBOUNCE);
  }

  function fmtSnapshotDay(iso) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    return String(Number(m[3])) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
  }

  /** One-row read of the newest history day. Does not load the card catalog. */
  async function loadFreshness() {
    var el = document.getElementById('freshness');
    if (!el) return;
    var cfg = window.PACK_EV_SUPABASE || {};
    var base = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
    var key = String(cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || '');
    if (!base || !key) {
      el.hidden = true;
      return;
    }
    try {
      var res = await fetch(base + '/rest/v1/card_price_history?select=day&order=day.desc&limit=1', {
        headers: { Accept: 'application/json', apikey: key, Authorization: 'Bearer ' + key }
      });
      if (!res.ok) throw new Error(String(res.status));
      var rows = await res.json();
      var day = rows && rows[0] && rows[0].day;
      var label = fmtSnapshotDay(day);
      if (!label) throw new Error('empty');
      el.textContent = 'Catalog price snapshot through ' + label + ' (Sydney). Search to see cards — nothing loads until you type.';
    } catch (_) {
      el.textContent = 'Search the catalog by name. Cards load only after you type.';
    }
  }

  function init() {
    els = {
      q: $('q'),
      searchSection: $('searchSection'),
      searchStatus: $('searchStatus'),
      searchGrid: $('searchGrid'),
      searchChart: $('searchChart')
    };
    if (!els.q) return;
    els.q.addEventListener('input', scheduleSearch);
    loadFreshness();
    els.searchGrid.addEventListener('click', onGridActivate);
    els.searchGrid.addEventListener('keydown', onGridKey);
    /* Deep-link from rip.html / shares: prices.html?q=Charizard */
    try {
      var q0 = new URLSearchParams(location.search).get('q');
      if (q0 && String(q0).trim()) {
        els.q.value = String(q0).trim();
        scheduleSearch();
      }
    } catch (_) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
