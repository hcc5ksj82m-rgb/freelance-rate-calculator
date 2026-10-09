/* PackEV — dedicated card page (catalog + real price history) */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoney(n, currency) {
    if (n == null || isNaN(n)) return '—';
    var cur = currency || 'USD';
    var prefix = cur === 'EUR' ? '€' : '$';
    if (Math.abs(n) >= 1000) {
      return prefix + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    return prefix + Number(n).toFixed(2);
  }

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
            source: 'TCGPlayer',
            printType: k,
            low: block.low != null ? Number(block.low) : null,
            mid: block.mid != null ? Number(block.mid) : null,
            high: block.high != null ? Number(block.high) : null,
            market: block.market != null ? Number(block.market) : null,
            url: c.tcgplayer.url || null
          };
        }
      }
    }
    var cm = c.cardmarket && c.cardmarket.prices;
    if (cm && (cm.averageSellPrice != null || cm.trendPrice != null)) {
      return {
        value: Number(cm.averageSellPrice != null ? cm.averageSellPrice : cm.trendPrice),
        currency: 'EUR',
        source: 'Cardmarket',
        printType: 'avg',
        low: cm.lowPrice != null ? Number(cm.lowPrice) : null,
        mid: cm.averageSellPrice != null ? Number(cm.averageSellPrice) : null,
        high: cm.trendPrice != null ? Number(cm.trendPrice) : null,
        market: cm.averageSellPrice != null ? Number(cm.averageSellPrice) : null,
        url: c.cardmarket.url || null
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
        url: null
      };
    }
    return null;
  }

  function ebaySoldUrl(name, setName, number) {
    var parts = [name, setName];
    if (number) parts.push('#' + number);
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(parts.filter(Boolean).join(' '))
      + '&LH_Sold=1&LH_Complete=1';
  }

  function soldHints(c) {
    var hints = [];
    var cm = c.cardmarket && c.cardmarket.prices;
    if (cm) {
      if (cm.avg1 != null) hints.push({ label: 'Cardmarket 1-day avg', value: Number(cm.avg1), currency: 'EUR' });
      if (cm.avg7 != null) hints.push({ label: 'Cardmarket 7-day avg', value: Number(cm.avg7), currency: 'EUR' });
      if (cm.avg30 != null) hints.push({ label: 'Cardmarket 30-day avg', value: Number(cm.avg30), currency: 'EUR' });
      if (cm.averageSellPrice != null && !hints.length) {
        hints.push({ label: 'Cardmarket avg sell', value: Number(cm.averageSellPrice), currency: 'EUR' });
      }
    }
    return hints.filter(function (h) { return h.value != null && !isNaN(h.value) && h.value > 0; }).slice(0, 3);
  }

  function normalizeForHistory(raw, p) {
    var setName = (raw.set && raw.set.name) || raw.setName || '';
    return {
      id: raw.id,
      name: raw.name || '',
      number: raw.number || '',
      set: setName,
      price: p ? p.value : null,
      currency: p ? p.currency : 'USD',
      source: p ? p.source : '',
      printType: p ? p.printType : '',
      tcgplayer: raw.tcgplayer || null,
      cardmarket: raw.cardmarket || null
    };
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtShortDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
  }

  function paintMarketSoldCompare(market, soldAvg) {
    var el = $('marketSoldCompare');
    if (!el) {
      var pb = $('priceBlock');
      if (!pb) return;
      el = document.createElement('div');
      el.id = 'marketSoldCompare';
      el.className = 'tip market-sold-compare';
      pb.appendChild(el);
    }
    if (!(market > 0) || !(soldAvg > 0)) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    var pct = ((market - soldAvg) / soldAvg) * 100;
    var rel = Math.abs(pct) < 0.05 ? 'about even vs recent sold'
      : (pct > 0 ? (pct.toFixed(1) + '% above recent sold')
                 : (Math.abs(pct).toFixed(1) + '% below recent sold'));
    el.hidden = false;
    el.textContent = 'market ' + fmtMoney(market, 'USD')
      + ' · recent sold avg ' + fmtMoney(soldAvg, 'USD')
      + ' (' + rel + ')';
  }

  function paintPriceChange(changes) {
    var el = $('priceChange');
    if (!el) return;
    if (!changes || !changes.length) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = '<span class="tip">Price change</span>' + changes.map(function (c) {
      var body;
      if (c.flat) {
        body = '<span class="flat">Flat since ' + fmtShortDay(c.day) + '</span>';
      } else {
        var pct = Number(c.pct);
        var cls = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
        var sign = pct > 0 ? '+' : '';
        body = '<span class="' + cls + '">' + sign + pct.toFixed(1) + '% since ' + fmtShortDay(c.day) + '</span>';
      }
      return '<span class="price-chip"><span class="badge muted">' + esc(c.label) + '</span>' + body + '</span>';
    }).join('');
  }

  function setBackLink(setId) {
    var a = $('backLink');
    if (!a) return;
    var ref = document.referrer || '';
    try {
      if (ref && new URL(ref).origin === location.origin) {
        a.href = ref;
        if (/set\.html/.test(ref)) a.textContent = '← Back to set';
        else if (/prices\.html/.test(ref)) a.textContent = '← Back to prices';
        else if (/index\.html|\/$/.test(ref)) a.textContent = '← Back to sets';
        return;
      }
    } catch (e) { /* ignore */ }
    if (setId) {
      a.href = 'set.html?id=' + encodeURIComponent(setId);
      a.textContent = '← Back to set';
    }
  }

  function paint(card) {
    var p = priceDetail(card);
    var setName = (card.set && card.set.name) || '';
    var setId = (card.set && card.set.id) || '';
    var img = (card.images && (card.images.large || card.images.small)) || '';

    document.title = (card.name || 'Card') + ' — PackEV';
    setBackLink(setId);

    $('status').hidden = true;
    $('detail').hidden = false;

    $('art').innerHTML = img
      ? '<img src="' + esc(img) + '" alt="' + esc(card.name) + '" />'
      : '<div class="card-detail-ph"></div>';

    $('name').textContent = card.name || 'Unknown card';
    var setLink = setId
      ? '<a href="set.html?id=' + encodeURIComponent(setId) + '">' + esc(setName || setId) + '</a>'
      : esc(setName || '—');
    $('meta').innerHTML = setLink
      + ' · #' + esc(card.number || '?')
      + (card.rarity ? ' · ' + esc(card.rarity) : '');

    var priceHtml = '';
    if (p) {
      priceHtml = '<div class="card-spot">' + fmtMoney(p.value, p.currency) + '</div>'
        + '<div class="tip">' + esc(p.source)
        + (p.printType ? ' · ' + esc(p.printType) : '')
        + ' · current market</div>';
      var bits = [];
      if (p.low != null) bits.push('Low ' + fmtMoney(p.low, p.currency));
      if (p.mid != null) bits.push('Mid ' + fmtMoney(p.mid, p.currency));
      if (p.high != null) bits.push('High ' + fmtMoney(p.high, p.currency));
      if (bits.length) priceHtml += '<div class="tip card-price-range">' + bits.join(' · ') + '</div>';
    } else {
      priceHtml = '<div class="card-spot">—</div><div class="tip">No market price in catalog yet</div>';
    }
    $('priceBlock').innerHTML = priceHtml;

    if (window.PackEVGraded) {
      $('gradedMount').innerHTML = PackEVGraded.render(card, setName);
    }

    var ebay = ebaySoldUrl(card.name, setName, card.number);
    var hints = soldHints(card);
    var soldHtml = '<h2>Sold averages</h2>'
      + '<div class="sold-stats">'
      + '<div class="sold-stat"><span>Daily · last 10</span><b id="soldDaily">…</b><em id="soldDailyN"></em></div>'
      + '<div class="sold-stat"><span>Monthly average</span><b id="soldMonthly">…</b></div>'
      + '</div>'
      + '<p class="tip" id="soldNote">Daily price averages the last 10 recorded sales. Monthly price averages those daily figures. The chart’s 20-year range uses the same averages for every stored month.</p>'
      + '<p><a class="btn sold-btn" href="' + esc(ebay) + '" target="_blank" rel="noopener">eBay completed listings →</a></p>';
    if (hints.length) {
      soldHtml += '<ul class="sold-hints">' + hints.map(function (h) {
        return '<li><span class="tip">' + esc(h.label) + '</span> <strong>'
          + fmtMoney(h.value, h.currency) + '</strong></li>';
      }).join('') + '</ul>'
        + '<p class="tip">Cardmarket averages are a separate EUR hint, not the last-10 sold price.</p>';
    }
    $('soldBlock').innerHTML = soldHtml;

    if (window.PackEVPriceHistory) {
      PackEVPriceHistory.mount($('historyMount'), normalizeForHistory(card, p), window.Chart, {
        onSummary: function (summary) {
          paintPriceChange(summary && summary.priceChanges);
          var soldAvg = null;
          if (summary && !summary.error && summary.latestDaily && summary.latestDaily.value > 0) {
            soldAvg = summary.latestDaily.value;
          }
          /* Sold averages are USD. Skip the % line when the spot price is not. */
          var marketUsd = (p && (!p.currency || p.currency === 'USD')) ? p.value : null;
          paintMarketSoldCompare(marketUsd, soldAvg);
          var dailyEl = $('soldDaily');
          var monthEl = $('soldMonthly');
          var noteEl = $('soldNote');
          if (!dailyEl || !monthEl) return;
          var sampleEl = $('soldDailyN');
          if (!summary || summary.error || !summary.latestDaily) {
            dailyEl.textContent = '—';
            monthEl.textContent = '—';
            if (sampleEl) sampleEl.textContent = '';
            if (noteEl && summary && summary.error) noteEl.textContent = 'Price history could not be loaded.';
            else if (noteEl) noteEl.textContent = 'No recorded sales yet. The 20-year chart fills in only as real prices are stored.';
            return;
          }
          var samples = summary.latestDaily.sampleSize || 0;
          dailyEl.textContent = fmtMoney(summary.latestDaily.value, 'USD');
          if (sampleEl) {
            sampleEl.textContent = samples < 10 ? samples + ' of 10 recorded' : 'last 10 sales';
          }
          monthEl.textContent = summary.latestMonth
            ? fmtMoney(summary.latestMonth.value, 'USD')
            : '—';
          if (noteEl) {
            noteEl.textContent = summary.kind === 'sold'
              ? 'Daily price is the average of the last 10 completed sales. Monthly price is the average of those daily prices. The 20-year chart uses the same averages and leaves years with no sales empty.'
              : 'Daily price is the average of the last 10 recorded market prices — the same method as an eBay last-10 sold comp. Monthly price averages those daily figures. The 20-year chart draws only stored months.';
          }
        }
      });
    }
  }

  function showError(msg) {
    $('detail').hidden = true;
    $('status').hidden = false;
    $('status').classList.add('expand-error');
    $('status').innerHTML = esc(msg || 'Could not load this card.')
      + ' <a href="prices.html">Search prices</a>'
      + ' · <button type="button" class="retry-btn" id="retryBtn">Retry</button>';
    var btn = $('retryBtn');
    if (btn) btn.onclick = function () { load(); };
  }

  async function load() {
    var id = new URLSearchParams(location.search).get('id');
    $('status').hidden = false;
    $('status').classList.remove('expand-error');
    $('status').textContent = 'Loading card…';
    $('detail').hidden = true;
    if (!id) {
      showError('Missing card id.');
      return;
    }
    if (!window.PackEVCards || !PackEVCards.fetchById) {
      showError('Catalog helper missing.');
      return;
    }
    try {
      var card = await PackEVCards.fetchById(id);
      if (!card) {
        showError('Card not found in catalog.');
        return;
      }
      paint(card);
      /* Optional live refresh — never blocks first paint */
      if (PackEVCards.fetchLiveCardById) {
        PackEVCards.fetchLiveCardById(id).then(function (live) {
          if (!live) return;
          var merged = PackEVCards.dbRowToCard({
            id: live.id,
            name: live.name,
            set_id: live.set && live.set.id,
            set_name: live.set && live.set.name,
            set_series: live.set && live.set.series,
            number: live.number,
            rarity: live.rarity,
            image_small: live.images && live.images.small,
            image_large: live.images && live.images.large,
            tcgplayer: live.tcgplayer,
            cardmarket: live.cardmarket,
            market_price_usd: card.market_price_usd
          });
          /* Prefer live pricing blocks when present */
          if (live.tcgplayer || live.cardmarket) {
            paint(merged);
          }
        }).catch(function () { /* ignore */ });
      }
    } catch (e) {
      showError('Could not load this card. Check your connection.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
