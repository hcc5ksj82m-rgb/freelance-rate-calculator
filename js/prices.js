/* PackEV Prices — search the live TCG API by card name */
(function () {
  'use strict';

  var API = 'https://api.pokemontcg.io/v2/cards';
  var SELECT = 'id,name,number,rarity,images,tcgplayer,cardmarket,set';
  var SEARCH_DEBOUNCE = 350;

  var searchTimer = null;
  var searchGen = 0;
  var els = {};
  var lastCards = [];
  var selectedId = null;

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
      priceStatus: p && p.live ? 'live' : 'demo',
      tcgplayer: raw.tcgplayer || null,
      cardmarket: raw.cardmarket || null,
      graded: window.PackEVGraded.find(raw)
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

  function findCard(id) {
    for (var i = 0; i < lastCards.length; i++) {
      if (lastCards[i].id === id) return lastCards[i];
    }
    return null;
  }

  function renderHistory(card) {
    var panel = els.historyPanel;
    if (!panel || !window.PackEVPriceHistory) return;
    panel.hidden = false;
    window.PackEVPriceHistory.mount(els.historyMount, card, window.Chart);
    try {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { /* ignore */ }
  }

  function clearHistory() {
    selectedId = null;
    if (els.historyPanel) els.historyPanel.hidden = true;
    if (window.PackEVPriceHistory && els.historyMount) {
      window.PackEVPriceHistory.unmount(els.historyMount);
    }
    if (els.searchGrid) {
      Array.prototype.forEach.call(els.searchGrid.querySelectorAll('.price-card.selected'), function (el) {
        el.classList.remove('selected');
      });
    }
  }

  function selectCard(id) {
    var card = findCard(id);
    if (!card) return;
    if (selectedId === id) {
      clearHistory();
      return;
    }
    selectedId = id;
    Array.prototype.forEach.call(els.searchGrid.querySelectorAll('.price-card'), function (el) {
      el.classList.toggle('selected', el.getAttribute('data-id') === id);
    });
    renderHistory(card);
  }

  function paintSearchResults(cards) {
    var status = els.searchStatus;
    var grid = els.searchGrid;
    var chart = els.searchChart;
    status.classList.remove('expand-error');
    lastCards = cards;
    clearHistory();

    if (!cards.length) {
      status.textContent = 'No matching cards found.';
      grid.innerHTML = '';
      chart.innerHTML = '<p class="tip">Try another name.</p>';
      return;
    }

    var liveN = cards.filter(function (c) { return c.priceStatus === 'live'; }).length;
    status.textContent = cards.length + ' match' + (cards.length === 1 ? '' : 'es')
      + ' · ' + liveN + ' with LIVE prices (TCGPlayer / Cardmarket)'
      + ' · click a card for price history';

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
      return '<article class="price-card" tabindex="0" role="button" data-id="' + esc(c.id) + '" aria-label="Show price history for ' + esc(c.name) + '">'
        + img
        + '<div class="m">'
        + '<strong>' + esc(c.name) + '</strong>'
        + '<div class="tip">#' + esc(c.number || '?') + ' · ' + esc(c.rarity || '—') + '</div>'
        + '<div class="tip set-of">' + setLink + '</div>'
        + '<div class="price">' + (c.price != null ? fmtMoney(c.price, c.currency) : '—') + ' ' + badge + '</div>'
        + sparkBars(c)
        + window.PackEVGraded.render(c)
        + '<div class="tip">' + esc(c.source || '') + (c.printType ? ' · ' + esc(c.printType) : '') + '</div>'
        + '</div></article>';
    }).join('');
  }

  function onGridActivate(e) {
    var t = e.target;
    if (t.closest && t.closest('a')) return;
    var cardEl = t.closest ? t.closest('.price-card') : null;
    if (!cardEl || !els.searchGrid.contains(cardEl)) return;
    var id = cardEl.getAttribute('data-id');
    if (id) selectCard(id);
  }

  function onGridKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var cardEl = e.target.closest ? e.target.closest('.price-card') : null;
    if (!cardEl || !els.searchGrid.contains(cardEl)) return;
    e.preventDefault();
    var id = cardEl.getAttribute('data-id');
    if (id) selectCard(id);
  }

  function scheduleSearch() {
    var raw = els.q.value.trim();
    clearTimeout(searchTimer);
    if (raw.length < 2) {
      searchGen++;
      els.searchSection.hidden = true;
      els.searchStatus.textContent = '';
      els.searchGrid.innerHTML = '';
      els.searchChart.innerHTML = '';
      lastCards = [];
      clearHistory();
      return;
    }

    els.searchSection.hidden = false;
    els.searchStatus.classList.remove('expand-error');
    els.searchStatus.textContent = 'Searching live API…';
    var gen = ++searchGen;
    searchTimer = setTimeout(async function () {
      try {
        var json = await searchCardsByName(raw);
        if (gen !== searchGen) return;
        var cards = (json.data || []).map(normalizeCard);
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
        lastCards = [];
        clearHistory();
        var btn = els.searchStatus.querySelector('.retry-btn');
        if (btn) btn.onclick = function () { scheduleSearch(); };
      }
    }, SEARCH_DEBOUNCE);
  }

  function init() {
    els = {
      q: $('q'),
      searchSection: $('searchSection'),
      searchStatus: $('searchStatus'),
      searchGrid: $('searchGrid'),
      searchChart: $('searchChart'),
      historyPanel: $('historyPanel'),
      historyMount: $('historyMount')
    };
    els.q.addEventListener('input', scheduleSearch);
    els.searchGrid.addEventListener('click', onGridActivate);
    els.searchGrid.addEventListener('keydown', onGridKey);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
