/* PackEV Shows — render curated data/shows.json (no demo events). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    var s = String(u || '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    return s;
  }

  function typeLabel(t) {
    var map = {
      official: 'Official',
      convention: 'Convention',
      show: 'Card show',
      league: 'League / play',
      hub: 'Hub / finder'
    };
    return map[t] || 'Event';
  }

  function isPast(dates) {
    if (!dates || dates === 'TBD') return false;
    var m = String(dates).match(/(\d{4}-\d{2}-\d{2})\s*[–-]\s*(\d{4}-\d{2}-\d{2})/);
    var end = m ? m[2] : null;
    if (!end) {
      var one = String(dates).match(/^(\d{4}-\d{2}-\d{2})$/);
      end = one ? one[1] : null;
    }
    if (!end) return false;
    try {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var d = new Date(end + 'T23:59:59');
      return d < today;
    } catch (_) {
      return false;
    }
  }

  function startDate(dates) {
    var m = String(dates || '').match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  // Days from today until the event starts (null if undated). Negative = already started.
  function daysUntil(dates) {
    var s = startDate(dates);
    if (!s) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.round((d - today) / 86400000);
  }

  // Upcoming (soonest first) → TBD → past (most recent first).
  function sortEvents(events) {
    return events.slice().sort(function (a, b) {
      var pa = isPast(a.dates), pb = isPast(b.dates);
      if (pa !== pb) return pa ? 1 : -1;
      var sa = startDate(a.dates), sb = startDate(b.dates);
      if (!sa || !sb) return sa ? -1 : (sb ? 1 : 0);
      return pa ? (sa < sb ? 1 : sa > sb ? -1 : 0) : (sa < sb ? -1 : sa > sb ? 1 : 0);
    });
  }

  function soonLabel(dates) {
    if (isPast(dates)) return '';
    var n = daysUntil(dates);
    if (n === null || n > 21) return '';
    if (n <= 0) return 'On now';
    if (n === 1) return 'Tomorrow';
    return 'In ' + n + ' days';
  }

  function matchQ(hay, q) {
    if (!q) return true;
    return hay.toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function render(data, countryId, q, hidePast) {
    var root = $('shows-root');
    var jump = $('shows-jump');
    var status = $('shows-status');
    if (!root) return;

    var countries = (data && data.countries) || [];
    var html = '';
    var jumpBits = [];
    var shown = 0;
    var hiddenPast = 0;

    for (var i = 0; i < countries.length; i++) {
      var c = countries[i];
      if (countryId && c.id !== countryId) continue;

      var cityBlocks = '';
      var cities = c.cities || [];
      for (var j = 0; j < cities.length; j++) {
        var city = cities[j];
        var events = sortEvents(city.events || []);
        var evHtml = '';
        for (var k = 0; k < events.length; k++) {
          var e = events[k];
          var blob = [c.name, city.name, e.name, e.venue, e.notes, e.dates].join(' ');
          if (!matchQ(blob, q)) continue;
          var past = isPast(e.dates);
          if (past && hidePast) { hiddenPast++; continue; }
          shown++;
          var url = safeUrl(e.url);
          var soon = soonLabel(e.dates);
          evHtml +=
            '<article class="show-event' + (past ? ' show-past' : '') + '">' +
              '<div class="show-event-top">' +
                '<strong>' + esc(e.name) + '</strong>' +
                '<span class="pill show-type">' + esc(typeLabel(e.type)) + '</span>' +
                (past ? '<span class="pill show-past-pill">Past</span>' : '') +
                (soon ? '<span class="pill show-soon-pill">' + esc(soon) + '</span>' : '') +
              '</div>' +
              '<div class="show-meta">' +
                '<span><strong>Dates:</strong> ' + esc(e.dates || 'TBD') + '</span>' +
                '<span><strong>Venue:</strong> ' + esc(e.venue || 'TBD') + '</span>' +
              '</div>' +
              (e.notes ? '<p class="tip">' + esc(e.notes) + '</p>' : '') +
              (url
                ? '<p class="tip"><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Organizer / details →</a></p>'
                : '') +
            '</article>';
        }
        if (!evHtml) continue;
        var role = city.role === 'capital' ? 'Capital' : 'Major show city';
        cityBlocks +=
          '<section class="show-city">' +
            '<h3>' + esc(city.name) +
              ' <span class="show-role">' + esc(role) + '</span></h3>' +
            evHtml +
          '</section>';
      }

      if (!cityBlocks && (q || hidePast)) continue;
      if (!cityBlocks) {
        cityBlocks = '<p class="tip">No matching events for this filter.</p>';
      }

      jumpBits.push('<a href="#' + esc(c.id) + '">' + esc(c.name) + '</a>');
      html +=
        '<section class="show-country card-inset" id="' + esc(c.id) + '">' +
          '<h2>' + esc(c.name) + '</h2>' +
          '<p class="tip"><strong>Capital:</strong> ' + esc(c.capital) +
            (c.hubNote ? ' — ' + esc(c.hubNote) : '') +
          '</p>' +
          cityBlocks +
        '</section>';
    }

    if (!html) {
      root.innerHTML = '<p class="tip">No shows match that filter. Clear search, pick another country' +
        (hiddenPast ? ', or untick “Upcoming only” to see ' + hiddenPast + ' past event' + (hiddenPast === 1 ? '' : 's') : '') +
        '.</p>';
      if (jump) { jump.hidden = true; jump.innerHTML = ''; }
      if (status) status.textContent = '';
      return;
    }

    root.innerHTML = html;
    if (jump) {
      jump.hidden = jumpBits.length < 2;
      jump.innerHTML = jumpBits.length ? ('Jump: ' + jumpBits.join(' · ')) : '';
    }
    if (status) {
      status.textContent = shown + ' event' + (shown === 1 ? '' : 's') + ' shown' +
        (hiddenPast ? ' · ' + hiddenPast + ' past hidden' : '');
    }
  }

  function fillCountries(data) {
    var sel = $('country-filter');
    if (!sel) return;
    var countries = (data && data.countries) || [];
    for (var i = 0; i < countries.length; i++) {
      var opt = document.createElement('option');
      opt.value = countries[i].id;
      opt.textContent = countries[i].name;
      sel.appendChild(opt);
    }
  }

  function wire(data) {
    var sel = $('country-filter');
    var q = $('show-q');
    var up = $('show-upcoming');
    function paint() {
      render(data, (sel && sel.value) || '', (q && q.value) || '', !!(up && up.checked));
    }
    if (sel) sel.addEventListener('change', paint);
    if (up) up.addEventListener('change', paint);
    if (q) {
      q.addEventListener('input', function () {
        clearTimeout(q._t);
        q._t = setTimeout(paint, 120);
      });
    }
    paint();
  }

  async function boot() {
    var status = $('shows-status');
    var updated = $('shows-updated');
    if (status) status.textContent = 'Loading show list…';
    try {
      var res = await fetch('data/shows.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('Could not load shows data (' + res.status + ')');
      var data = await res.json();
      if (updated && data.lastUpdated) {
        updated.textContent = ' Last updated: ' + data.lastUpdated + '.';
      }
      fillCountries(data);
      wire(data);
    } catch (err) {
      if (status) {
        status.textContent = (err && err.message) || 'Failed to load shows';
        status.className = 'expand-status expand-error';
      }
      var root = $('shows-root');
      if (root) {
        root.innerHTML = '<p class="tip">Show directory unavailable. Try refreshing the page.</p>';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
