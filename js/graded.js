/* Small graded-price display shared by card listings. */
(function (root) {
  'use strict';

  var GRADED_KEY = /graded|grade|psa|cgc|bgs|beckett|sgc|cga|hga|tag/i;
  var GENERIC_KEY = /^(tcgplayer|cardmarket|prices?|market|mid|high|low|value|price|data)$/i;
  var MAX_ITEMS = 8;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function numberValue(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function directValue(value) {
    var n = numberValue(value);
    if (n != null) return n;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var keys = ['market', 'mid', 'value', 'price', 'average', 'avg'];
    for (var i = 0; i < keys.length; i++) {
      n = numberValue(value[keys[i]]);
      if (n != null) return n;
    }
    return null;
  }

  function words(key) {
    return String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function labelFor(path) {
    var useful = path.filter(function (part) { return !GENERIC_KEY.test(String(part)); });
    if (!useful.length) return 'Graded';
    var text = useful.map(words).join(' ');
    text = text.replace(/\b(psa|cgc|bgs|sgc|cga|hga|tag)\s*(\d+(?:\.\d+)?)/ig,
      function (_, brand, grade) { return brand.toUpperCase() + ' ' + grade; });
    text = text.replace(/\bgraded?\b/ig, '').replace(/\bgrade\b/ig, '')
      .replace(/\s+/g, ' ').trim();
    return text || 'Graded';
  }

  function find(card) {
    var result = [];
    var seenLabels = Object.create(null);
    var seenObjects = [];

    function add(path, value) {
      var label = labelFor(path);
      if (seenLabels[label]) return;
      seenLabels[label] = true;
      result.push({ label: label, value: value });
    }

    function walk(node, path, gradedContext, depth) {
      if (result.length >= MAX_ITEMS || node == null || depth > 8) return;
      var scalar = directValue(node);
      if (gradedContext && scalar != null) add(path, scalar);
      if (typeof node !== 'object' || Array.isArray(node)) return;
      if (seenObjects.indexOf(node) !== -1) return;
      seenObjects.push(node);
      Object.keys(node).forEach(function (key) {
        if (result.length >= MAX_ITEMS) return;
        var nextPath = path.concat(key);
        var nextGraded = gradedContext || GRADED_KEY.test(key);
        walk(node[key], nextPath, nextGraded, depth + 1);
      });
    }

    walk(card, [], false, 0);
    return result;
  }

  function money(value) {
    return value == null ? '—' : '$' + Number(value).toFixed(2);
  }

  function soldUrl(name, setName, grade) {
    var query = [name, setName, grade].filter(Boolean).join(' ');
    return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query)
      + '&amp;LH_Sold=1&amp;LH_Complete=1';
  }

  function render(card, fallbackSetName) {
    var graded = card && card.graded ? card.graded : find(card || {});
    var name = card && card.name || '';
    var setName = card && (card.setName || (typeof card.set === 'string' ? card.set : card.set && card.set.name)) || fallbackSetName || '';
    var body;
    if (graded.length) {
      body = graded.map(function (item) {
        return '<span class="graded-item">' + esc(item.label) + ' ' + money(item.value) + '</span>';
      }).join('');
      return '<div class="graded-row"><span class="graded-label">Graded</span>' + body + '</div>';
    }
    body = ['PSA 10', 'PSA 9', 'CGC 10'].map(function (grade) {
      return '<a href="' + soldUrl(name, setName, grade) + '" target="_blank" rel="noopener">' + grade + '</a>';
    }).join('');
    return '<div class="graded-row"><span class="graded-label">Graded · sold comps (not auto-filled $)</span>' + body + '</div>';
  }

  root.PackEVGraded = { find: find, render: render };
})(window);
