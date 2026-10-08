/* Graded averages for rare-and-above cards.
 * Each figure is the mean of the last 10 recorded sales for that exact grade.
 * A black-label 10 is its own grade. Cardmarket EUR is never used here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PackEVGraded = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var LAST_N = 10;
  var SLOTS = [
    { id: 'PSA|10|', company: 'PSA', grade: '10', qualifier: '', name: '10', query: 'PSA 10' },
    { id: 'PSA|9|', company: 'PSA', grade: '9', qualifier: '', name: '9', query: 'PSA 9' },
    { id: 'PSA|8|', company: 'PSA', grade: '8', qualifier: '', name: '8', query: 'PSA 8' },
    { id: 'BGS|10|black', company: 'BGS', grade: '10', qualifier: 'black', name: 'BL 10', query: 'BGS Black Label 10' },
    { id: 'BGS|10|', company: 'BGS', grade: '10', qualifier: '', name: '10', query: 'BGS 10 -"Black Label"' },
    { id: 'BGS|9.5|', company: 'BGS', grade: '9.5', qualifier: '', name: '9.5', query: 'BGS 9.5' },
    { id: 'BGS|9|', company: 'BGS', grade: '9', qualifier: '', name: '9', query: 'BGS 9' },
    { id: 'BGS|8|', company: 'BGS', grade: '8', qualifier: '', name: '8', query: 'BGS 8' },
    { id: 'CGC|10|black', company: 'CGC', grade: '10', qualifier: 'black', name: 'BL 10', query: 'CGC Pristine 10' },
    { id: 'CGC|9.5|', company: 'CGC', grade: '9.5', qualifier: '', name: '9.5', query: 'CGC 9.5' },
    { id: 'CGC|9|', company: 'CGC', grade: '9', qualifier: '', name: '9', query: 'CGC 9' },
    { id: 'CGC|8|', company: 'CGC', grade: '8', qualifier: '', name: '8', query: 'CGC 8' }
  ];
  var COMPANIES = ['PSA', 'BGS', 'CGC'];

  var cache = Object.create(null);
  var pending = [];
  var flushTimer = null;
  var tableMissing = false;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isRareOrAbove(rarity) {
    var r = String(rarity || '').toLowerCase().trim();
    if (!r || r === 'common' || r === 'uncommon' || r === 'promo') return false;
    if (r.indexOf('rare') !== -1) return true;
    return r === 'legend' || r === 'classic collection';
  }

  function gradeKey(grade) {
    var n = Number(grade);
    if (!isFinite(n)) return '';
    return String(n);
  }

  function qualifierKey(value) {
    var s = String(value || '').toLowerCase();
    if (s.indexOf('black') !== -1 || s.indexOf('pristine') !== -1) return 'black';
    return '';
  }

  function slotId(company, grade, qualifier) {
    return String(company || '').toUpperCase() + '|' + gradeKey(grade) + '|' + qualifierKey(qualifier);
  }

  function saleSlot(sale) {
    if (!sale) return '';
    return slotId(sale.grader || sale.company, sale.grade, sale.qualifier || sale.grade_qualifier);
  }

  function averageByGrade(sales) {
    var groups = Object.create(null);
    (sales || []).forEach(function (sale) {
      var price = Number(sale.price_usd != null ? sale.price_usd : sale.priceUsd);
      var when = Date.parse(sale.sold_at || sale.soldAt || '');
      var id = saleSlot(sale);
      if (!(price > 0) || !isFinite(when) || !id) return;
      if (!groups[id]) groups[id] = [];
      groups[id].push({ price: price, when: when });
    });
    var out = Object.create(null);
    Object.keys(groups).forEach(function (id) {
      var rows = groups[id].sort(function (a, b) { return b.when - a.when; }).slice(0, LAST_N);
      var sum = 0;
      rows.forEach(function (row) { sum += row.price; });
      out[id] = {
        value: Math.round((sum / rows.length) * 100) / 100,
        samples: rows.length
      };
    });
    return out;
  }

  function money(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + n.toFixed(2);
  }

  function setNameOf(card, fallback) {
    if (!card) return fallback || '';
    if (card.setName) return card.setName;
    if (card.set && typeof card.set === 'object') return card.set.name || '';
    if (typeof card.set === 'string') return card.set;
    return fallback || '';
  }

  function soldUrl(card, setName, query) {
    var parts = [card && card.name, setName, card && card.number ? '#' + card.number : '', query];
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(parts.filter(Boolean).join(' '))
      + '&LH_Sold=1&LH_Complete=1';
  }

  function sampleText(avg) {
    if (!avg) return 'no sales stored yet';
    return avg.samples < LAST_N
      ? avg.samples + ' of last ' + LAST_N + ' sold'
      : 'last ' + LAST_N + ' sold';
  }

  function render(card, fallbackSetName) {
    if (!card || !isRareOrAbove(card.rarity)) return '';
    var setName = setNameOf(card, fallbackSetName);
    var known = card.id && cache[card.id];
    var rows = COMPANIES.map(function (company) {
      var cells = SLOTS.filter(function (slot) { return slot.company === company; }).map(function (slot) {
        var avg = known && known[slot.id];
        var label = company + ' ' + (slot.qualifier === 'black' ? 'black label ' : '') + slot.grade;
        var aria = label + ', ' + (avg ? money(avg.value) + ', ' + sampleText(avg) : 'no sales stored yet')
          + '. eBay completed listings.';
        return '<a class="grade-cell" data-grade-id="' + esc(slot.id) + '" href="'
          + esc(soldUrl(card, setName, slot.query)) + '" target="_blank" rel="noopener" aria-label="'
          + esc(aria) + '" title="' + esc(label + ' · ' + sampleText(avg)) + '">'
          + '<span class="grade-name">' + esc(slot.name) + '</span>'
          + '<span class="grade-val">' + (avg ? esc(money(avg.value)) : '—') + '</span></a>';
      }).join('');
      return '<div class="grade-row"><span class="grade-co">' + company + '</span>' + cells + '</div>';
    }).join('');
    return '<div class="grade-board" data-card-id="' + esc(card.id || '') + '">'
      + '<div class="grade-label">Graded avg</div>'
      + rows
      + '<p class="grade-note">Each price is the average of the last 10 recorded sales for that grade. '
      + 'A dash means those sales are not stored yet. CGC black label is Pristine 10. '
      + 'Open a grade for eBay completed listings.</p></div>';
  }

  function fillBoard(board) {
    if (!board) return;
    var id = board.getAttribute('data-card-id');
    var known = id && cache[id];
    var cells = board.querySelectorAll('[data-grade-id]');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var avg = known && known[cell.getAttribute('data-grade-id')];
      var val = cell.querySelector('.grade-val');
      if (!val) continue;
      val.textContent = avg ? money(avg.value) : '—';
      var company = cell.parentNode && cell.parentNode.querySelector('.grade-co');
      var name = cell.querySelector('.grade-name');
      var label = ((company && company.textContent) || '') + ' ' + ((name && name.textContent) || '');
      cell.title = label.trim() + ' · ' + sampleText(avg);
    }
    if (known) board.setAttribute('data-grade-state', 'ready');
    else if (tableMissing) board.setAttribute('data-grade-state', 'unavailable');
  }

  function supabaseCfg() {
    var cfg = (typeof window !== 'undefined' && window.PACK_EV_SUPABASE) || {};
    return {
      url: String(cfg.SUPABASE_URL || '').replace(/\/$/, ''),
      key: String(cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || '')
    };
  }

  function remember(rows) {
    var byCard = Object.create(null);
    (rows || []).forEach(function (row) {
      if (!row.card_id) return;
      if (!byCard[row.card_id]) byCard[row.card_id] = [];
      byCard[row.card_id].push(row);
    });
    Object.keys(byCard).forEach(function (id) {
      cache[id] = averageByGrade(byCard[id]);
    });
  }

  async function fetchGrades(ids) {
    var cfg = supabaseCfg();
    if (!cfg.url || !cfg.key || !ids.length) return;
    var list = '(' + ids.map(function (id) {
      return '"' + String(id).replace(/"/g, '') + '"';
    }).join(',') + ')';
    var endpoint = cfg.url + '/rest/v1/card_grade_comps?card_id=in.' + encodeURIComponent(list)
      + '&select=card_id,grader,grade,qualifier,sold_at,price_usd'
      + '&order=sold_at.desc&limit=1000';
    var res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key
      }
    });
    if (res.status === 404 || res.status === 400) {
      tableMissing = true;
      return;
    }
    if (!res.ok) return;
    var rows = await res.json();
    remember(Array.isArray(rows) ? rows : []);
    ids.forEach(function (id) {
      if (!cache[id]) cache[id] = Object.create(null);
    });
  }

  function flush() {
    flushTimer = null;
    if (tableMissing || typeof fetch !== 'function') {
      pending = [];
      return;
    }
    var ids = [];
    var seen = Object.create(null);
    pending.forEach(function (id) {
      if (!id || seen[id] || cache[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    pending = [];
    var batches = [];
    for (var i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
    batches.forEach(function (batch) {
      fetchGrades(batch).then(function () {
        if (typeof document === 'undefined') return;
        var boards = document.querySelectorAll('.grade-board');
        for (var n = 0; n < boards.length; n++) fillBoard(boards[n]);
      }).catch(function () { /* dashes stay */ });
    });
  }

  function schedule(root) {
    if (!root || !root.querySelectorAll) return;
    var boards = root.querySelectorAll('.grade-board');
    for (var i = 0; i < boards.length; i++) {
      fillBoard(boards[i]);
      var id = boards[i].getAttribute('data-card-id');
      if (id && !cache[id] && !tableMissing) pending.push(id);
    }
    if (!pending.length || flushTimer) return;
    flushTimer = setTimeout(flush, 40);
  }

  /* Kept so older callers can ask whether a payload already carried a graded price. */
  function find() {
    return [];
  }

  return {
    LAST_N: LAST_N,
    SLOTS: SLOTS,
    isRareOrAbove: isRareOrAbove,
    averageByGrade: averageByGrade,
    slotId: slotId,
    render: render,
    schedule: schedule,
    find: find,
    _cache: cache
  };
});
