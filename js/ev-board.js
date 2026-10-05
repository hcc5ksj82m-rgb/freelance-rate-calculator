/* PackEV set EV leaderboard + home teaser. Uses PackEVMath and sets.json only. */
(function () {
  'use strict';

  var math = window.PackEVMath;
  if (!math) return;

  var PROFILE = {
    'chase-heavy': 'Chase-heavy',
    'specialty': 'Specialty',
    'modern-sv': 'Modern SV',
    'swsh': 'Sword & Shield',
    'sm': 'Sun & Moon',
    'bw-xy': 'BW / XY',
    'vintage': 'Vintage'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function loadData() {
    return Promise.all([
      fetch('data/sets.json').then(function (r) { if (!r.ok) throw new Error('sets'); return r.json(); }),
      fetch('data/sealed-assumptions.json').then(function (r) {
        if (!r.ok) throw new Error('assumptions');
        return r.json();
      }).catch(function () { return math.DEFAULT_ASSUMPTIONS; })
    ]).then(function (pair) {
      return { sets: pair[0], assumptions: math.assumptions(pair[1]) };
    });
  }

  function rowModel(set, assumptions, store) {
    var sum = math.summarize(set, assumptions);
    var promo = store.rows[set.id] && store.rows[set.id].promo;
    var evEtb = math.scaled(sum.evPack, sum.etbPacks, promo || 0);
    var pack = math.packCost(set, store);
    var box = math.productCost(set, store, 'box', pack.value, sum.boxPacks);
    var etb = math.productCost(set, store, 'etb', pack.value, sum.etbPacks);
    return {
      set: set,
      sum: sum,
      evEtb: evEtb,
      pack: pack,
      box: box,
      etb: etb,
      packRoi: math.ratio(sum.evPack, pack.value),
      boxRoi: math.ratio(sum.evBox, box.value),
      etbRoi: math.ratio(evEtb, etb.value),
      packEdge: math.edge(sum.evPack, pack.value),
      boxEdge: math.edge(sum.evBox, box.value),
      etbEdge: math.edge(evEtb, etb.value)
    };
  }

  function cmpNum(a, b, dir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return dir * (a - b);
  }

  function sortRows(rows, key) {
    var dir = -1;
    var field = key;
    if (key === 'name') { dir = 1; field = 'name'; }
    if (key === 'newest') { dir = -1; field = 'newest'; }
    rows.sort(function (a, b) {
      var d = 0;
      if (field === 'name') d = String(a.set.name).localeCompare(String(b.set.name));
      else if (field === 'newest') d = String(b.set.releaseDate || '').localeCompare(String(a.set.releaseDate || ''));
      else if (field === 'packEv') d = cmpNum(a.sum.evPack, b.sum.evPack, -1);
      else if (field === 'boxEv') d = cmpNum(a.sum.evBox, b.sum.evBox, -1);
      else if (field === 'etbEv') d = cmpNum(a.evEtb, b.evEtb, -1);
      else if (field === 'packRoi') d = cmpNum(a.packRoi, b.packRoi, -1);
      else if (field === 'boxRoi') d = cmpNum(a.boxRoi, b.boxRoi, -1);
      else if (field === 'etbRoi') d = cmpNum(a.etbRoi, b.etbRoi, -1);
      if (d) return d;
      var byDate = String(b.set.releaseDate || '').localeCompare(String(a.set.releaseDate || ''));
      if (byDate) return byDate;
      return String(a.set.name).localeCompare(String(b.set.name));
    });
    return rows;
  }

  function roiCell(ratio, edge) {
    if (ratio == null) return '<span class="muted-dash">—</span>';
    var cls = edge > 0.005 ? 'up' : (edge < -0.005 ? 'down' : 'flat');
    return '<b class="' + cls + '">' + esc(math.formatRatio(ratio)) + '</b>'
      + '<span class="tip">' + esc(math.signedMoney(edge)) + '</span>';
  }

  function evCell(value, packs, ratio, edge) {
    if (value == null) return '<span class="muted-dash">—</span>';
    var sub = packs ? '<span class="tip">' + esc(packs) + ' pk</span>' : '';
    var roi = ratio == null ? '' : roiCell(ratio, edge);
    return '<b>' + esc(math.money(value)) + '</b>' + sub + roi;
  }

  function mountTeaser(el) {
    if (!el) return;
    el.innerHTML = '<div class="movers-head"><h2>Sealed EV</h2>'
      + '<a href="ev.html">Full EV board →</a></div>'
      + '<p class="tip">Top sets by pack EV from the chase model already stored on each set. Box and ETB scale that pack EV by pack count. Costs are not filled in here.</p>'
      + '<p class="tip" id="sealed-teaser-status">Loading set EV…</p>';
    loadData().then(function (data) {
      var store = math.readCosts();
      var rows = data.sets.filter(function (s) { return !math.excluded(s, data.assumptions); })
        .map(function (s) { return rowModel(s, data.assumptions, store); });
      sortRows(rows, 'packEv');
      var top = rows.slice(0, 5);
      var status = document.getElementById('sealed-teaser-status');
      if (status) status.remove();
      if (!top.length) {
        el.insertAdjacentHTML('beforeend', '<p class="tip">No main sets to rank.</p>');
        return;
      }
      var body = top.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td><a href="rip.html?set=' + encodeURIComponent(r.set.id) + '"><strong>'
          + esc(r.set.name) + '</strong></a><div class="tip">' + esc(r.set.series || '') + '</div></td>'
          + '<td class="num">' + evCell(r.sum.evPack) + '</td>'
          + '<td class="num">' + evCell(r.sum.evBox, r.sum.boxPacks) + '</td>'
          + '<td class="num">' + evCell(r.evEtb, r.sum.etbPacks) + '</td></tr>';
      }).join('');
      el.insertAdjacentHTML('beforeend',
        '<div class="table-scroll"><table class="ev-table compact"><thead><tr>'
        + '<th>#</th><th>Set</th><th class="num">Pack EV</th><th class="num">Box EV</th><th class="num">ETB EV</th>'
        + '</tr></thead><tbody>' + body + '</tbody></table></div>');
      el.hidden = false;
    }).catch(function () {
      el.hidden = false;
      var status = document.getElementById('sealed-teaser-status');
      if (status) status.textContent = 'Could not load set EV.';
    });
  }

  function mountBoard(rootEl) {
    if (!rootEl) return;
    var state = { sets: [], assumptions: null, series: '', q: '', sort: 'packEv' };

    rootEl.innerHTML = ''
      + '<div class="warn">Educational model. Official pull rates are unpublished. '
      + 'EV uses each set’s stored dead-pack value, chase odds, and chase value. Sets that share a profile share the same pack EV until those weights are edited. '
      + 'Box and ETB EV multiply that by the pack counts in <code>data/sealed-assumptions.json</code>. '
      + 'Nothing here is a live sold price — type what you would pay, or turn on MSRP hints (labeled as MSRP, not market).</div>'
      + '<div class="grid three cost-bar">'
      + '  <div><label for="gPack">Market pack cost for every set ($)</label>'
      + '    <input id="gPack" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Leave blank to rank by EV only" /></div>'
      + '  <div><label for="gBox">Market box cost ($)</label>'
      + '    <input id="gBox" type="number" step="0.01" min="0" inputmode="decimal" placeholder="One box price for all sets" /></div>'
      + '  <div><label for="gEtb">Market ETB cost ($)</label>'
      + '    <input id="gEtb" type="number" step="0.01" min="0" inputmode="decimal" placeholder="One ETB price for all sets" /></div>'
      + '</div>'
      + '<div class="toolbar ev-toolbar">'
      + '  <button type="button" class="btn-quiet" id="msrpBtn">Use era MSRP hints</button>'
      + '  <button type="button" class="btn-quiet" id="scaleBtn">Box &amp; ETB = pack cost × packs</button>'
      + '  <button type="button" class="btn-quiet" id="clearBtn">Clear costs</button>'
      + '</div>'
      + '<p class="tip" id="costHint"></p>'
      + '<div class="toolbar">'
      + '  <div><label for="evQ">Filter sets</label><input id="evQ" type="search" placeholder="Name — e.g. Prismatic, Evolving" /></div>'
      + '  <div><label for="evSeries">Series</label><select id="evSeries"><option value="">All main sets</option></select></div>'
      + '</div>'
      + '<div class="stats" id="evSummary"></div>'
      + '<p class="tip" id="evMeta"></p>'
      + '<div class="table-scroll"><table class="ev-table" id="evTable">'
      + '<thead><tr>'
      + '<th>#</th>'
      + '<th><button type="button" class="sort-btn" data-sort="name">Set</button></th>'
      + '<th class="num"><button type="button" class="sort-btn" data-sort="packEv">Pack EV</button> <button type="button" class="sort-btn" data-sort="packRoi">EV/cost</button></th>'
      + '<th class="num"><button type="button" class="sort-btn" data-sort="boxEv">Box EV</button> <button type="button" class="sort-btn" data-sort="boxRoi">EV/cost</button></th>'
      + '<th class="num"><button type="button" class="sort-btn" data-sort="etbEv">ETB EV</button> <button type="button" class="sort-btn" data-sort="etbRoi">EV/cost</button></th>'
      + '<th class="num">Pack $</th>'
      + '</tr></thead><tbody id="evRows"></tbody></table></div>'
      + '<details class="ev-notes"><summary>How this EV is calculated</summary><div id="evNotes"></div></details>';

    var els = {
      gPack: document.getElementById('gPack'),
      gBox: document.getElementById('gBox'),
      gEtb: document.getElementById('gEtb'),
      msrpBtn: document.getElementById('msrpBtn'),
      scaleBtn: document.getElementById('scaleBtn'),
      clearBtn: document.getElementById('clearBtn'),
      hint: document.getElementById('costHint'),
      q: document.getElementById('evQ'),
      series: document.getElementById('evSeries'),
      summary: document.getElementById('evSummary'),
      meta: document.getElementById('evMeta'),
      body: document.getElementById('evRows'),
      notes: document.getElementById('evNotes')
    };

    function syncGlobalInputs() {
      var g = math.readCosts().global;
      els.gPack.value = g.pack || '';
      els.gBox.value = g.box || '';
      els.gEtb.value = g.etb || '';
      els.msrpBtn.classList.toggle('on', !!g.msrp);
      els.msrpBtn.setAttribute('aria-pressed', g.msrp ? 'true' : 'false');
      els.scaleBtn.classList.toggle('on', !!g.scale);
      els.scaleBtn.setAttribute('aria-pressed', g.scale ? 'true' : 'false');
      els.msrpBtn.textContent = g.msrp ? 'MSRP hints on' : 'Use era MSRP hints';
      els.scaleBtn.textContent = g.scale ? 'Scaling box & ETB from pack cost' : 'Box & ETB = pack cost × packs';
    }

    function hintText() {
      var g = math.readCosts().global;
      var bits = ['1.00× means model EV matches the cost you entered.'];
      if (g.msrp) bits.push('Pack costs showing an era MSRP are hints from the set list, not eBay sold prices.');
      if (g.scale) bits.push('Box and ETB costs are that row’s pack cost times pack count, which ignores sealed discounts.');
      if (!g.msrp && !g.pack && !g.box && !g.etb) {
        bits.push('Leave costs blank to rank by EV. A per-set pack price typed on the calculator is reused here.');
      }
      els.hint.textContent = bits.join(' ');
    }

    function visibleRows() {
      var store = math.readCosts();
      var q = state.q.trim().toLowerCase();
      var rows = state.sets.filter(function (s) {
        if (math.excluded(s, state.assumptions)) return false;
        if (state.series && s.series !== state.series) return false;
        if (q && (s.name + ' ' + s.id + ' ' + (s.series || '')).toLowerCase().indexOf(q) === -1) return false;
        return true;
      }).map(function (s) { return rowModel(s, state.assumptions, store); });
      return sortRows(rows, state.sort);
    }

    function paintSummary(rows) {
      function best(pick) {
        var winner = null;
        rows.forEach(function (r) {
          var v = pick(r);
          if (v == null) return;
          if (!winner || v > winner.v || (v === winner.v && String(r.set.releaseDate || '') > winner.date)) {
          winner = { v: v, name: r.set.name, date: String(r.set.releaseDate || '') };
        }
        });
        return winner;
      }
      var bp = best(function (r) { return r.sum.evPack; });
      var bb = best(function (r) { return r.sum.evBox; });
      var br = best(function (r) { return r.packRoi; });
      els.summary.innerHTML = ''
        + '<div class="stat"><span class="tip">Best pack EV</span><b>' + (bp ? esc(math.money(bp.v)) : '—') + '</b><span class="tip">' + (bp ? esc(bp.name) : '') + '</span></div>'
        + '<div class="stat"><span class="tip">Best box EV</span><b>' + (bb ? esc(math.money(bb.v)) : '—') + '</b><span class="tip">' + (bb ? esc(bb.name) : 'No 36-pack box in this filter') + '</span></div>'
        + '<div class="stat"><span class="tip">Best pack EV/cost</span><b>' + (br ? esc(math.formatRatio(br.v)) : '—') + '</b><span class="tip">' + (br ? esc(br.name) : 'Enter a pack cost') + '</span></div>';
    }

    function paintSortHeads() {
      Array.prototype.forEach.call(rootEl.querySelectorAll('.sort-btn'), function (btn) {
        var on = btn.getAttribute('data-sort') === state.sort;
        btn.classList.toggle('active', on);
      });
    }

    function paint() {
      var rows = visibleRows();
      var skipped = state.sets.filter(function (s) { return math.excluded(s, state.assumptions); }).length;
      paintSummary(rows);
      paintSortHeads();
      hintText();
      els.meta.textContent = rows.length + ' main sets'
        + (skipped ? ' · ' + skipped + ' promos, galleries, and other non-booster lists are left off' : '')
        + '. Click a column to sort.';
      if (!rows.length) {
        els.body.innerHTML = '<tr><td colspan="6">No sets match this filter.</td></tr>';
        return;
      }
      els.body.innerHTML = rows.map(function (r, i) {
        var packVal = r.pack.value != null ? r.pack.value.toFixed(2) : '';
        var custom = r.pack.source === 'row' ? ' custom' : '';
        var src = r.pack.source ? ' title="' + esc(r.pack.source === 'msrp' ? 'Era MSRP hint, not a sold price' : (r.pack.source === 'global' ? 'Board-wide pack cost' : (r.pack.source === 'ebay' ? 'Stored eBay last sold' : 'Cost saved for this set'))) + '"' : '';
        return '<tr data-id="' + esc(r.set.id) + '">'
          + '<td class="ev-rank">' + (i + 1) + '</td>'
          + '<td><a href="set.html?id=' + encodeURIComponent(r.set.id) + '"><strong>' + esc(r.set.name) + '</strong></a>'
          + '<div class="tip">' + esc(PROFILE[r.set.evProfile] || r.set.evProfile || '')
          + ' · ' + esc(r.set.series || '') + ' · ' + esc(r.set.releaseDate || '')
          + ' · <a href="rip.html?set=' + encodeURIComponent(r.set.id) + '">Calculator</a>'
          + ' · <a href="' + esc(math.ebaySearch(r.set.name, 'pack')) + '" target="_blank" rel="noopener">Pack sold</a></div>'
          + (r.sum.note ? '<div class="tip">' + esc(r.sum.note) + '</div>' : '')
          + '</td>'
          + '<td class="num js-pack-roi">' + evCell(r.sum.evPack, null, r.packRoi, r.packEdge) + '</td>'
          + '<td class="num js-box-roi">' + evCell(r.sum.evBox, r.sum.boxPacks, r.boxRoi, r.boxEdge) + '</td>'
          + '<td class="num js-etb-roi">' + evCell(r.evEtb, r.sum.etbPacks, r.etbRoi, r.etbEdge) + '</td>'
          + '<td class="num"><input class="cost-in' + custom + '" type="number" step="0.01" min="0" inputmode="decimal" data-id="'
          + esc(r.set.id) + '" value="' + esc(packVal) + '" placeholder="—" aria-label="Pack cost for ' + esc(r.set.name) + '"' + src + ' /></td>'
          + '</tr>';
      }).join('');
    }

    function notes() {
      var a = state.assumptions || {};
      var lines = (a.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
      var formula = a.formula ? '<p>' + esc(a.formula) + '</p>' : '';
      els.notes.innerHTML = formula + '<ul>' + lines + '</ul>'
        + '<p class="tip">Edit pack counts in data/sealed-assumptions.json. Edit chase weights per set in data/sets.json.</p>';
    }

    els.body.addEventListener('change', function (e) {
      var input = e.target.closest ? e.target.closest('.cost-in') : null;
      if (!input) return;
      math.saveRow(input.getAttribute('data-id'), { pack: input.value.trim() });
      paint();
    });
    els.gPack.addEventListener('change', function () {
      math.saveGlobal({ pack: els.gPack.value.trim() });
      paint();
    });
    els.gBox.addEventListener('change', function () {
      math.saveGlobal({ box: els.gBox.value.trim() });
      paint();
    });
    els.gEtb.addEventListener('change', function () {
      math.saveGlobal({ etb: els.gEtb.value.trim() });
      paint();
    });
    els.msrpBtn.addEventListener('click', function () {
      var on = !math.readCosts().global.msrp;
      math.saveGlobal({ msrp: on });
      syncGlobalInputs();
      paint();
    });
    els.scaleBtn.addEventListener('click', function () {
      var on = !math.readCosts().global.scale;
      math.saveGlobal({ scale: on });
      syncGlobalInputs();
      paint();
    });
    els.clearBtn.addEventListener('click', function () {
      var store = math.readCosts();
      store.global = { pack: '', box: '', etb: '', msrp: false, scale: false };
      store.rows = {};
      math.writeCosts(store);
      syncGlobalInputs();
      paint();
    });
    els.q.addEventListener('input', function () {
      state.q = els.q.value;
      paint();
    });
    els.series.addEventListener('change', function () {
      state.series = els.series.value;
      paint();
    });
    rootEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.sort-btn') : null;
      if (!btn) return;
      state.sort = btn.getAttribute('data-sort') || 'packEv';
      paint();
    });

    loadData().then(function (data) {
      state.sets = data.sets;
      state.assumptions = data.assumptions;
      var series = {};
      data.sets.forEach(function (s) {
        if (!math.excluded(s, data.assumptions) && s.series) series[s.series] = true;
      });
      Object.keys(series).sort().forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        els.series.appendChild(o);
      });
      var params = new URLSearchParams(location.search);
      if (params.get('series') && series[params.get('series')]) {
        state.series = params.get('series');
        els.series.value = state.series;
      }
      if (params.get('sort')) state.sort = params.get('sort');
      syncGlobalInputs();
      notes();
      paint();
    }).catch(function () {
      els.meta.textContent = 'Could not load the set list.';
    });
  }

  function boot() {
    mountTeaser(document.getElementById('sealed-teaser'));
    mountBoard(document.getElementById('ev-board'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
