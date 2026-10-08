/* PackEV Shows — render curated data/shows.json (no demo events). */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // Events rendered with an "Add to calendar" button (index = data-cal).
  var calEvents = [];

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

  function endDate(dates) {
    var all = String(dates || '').match(/\d{4}-\d{2}-\d{2}/g);
    return all && all.length ? all[all.length - 1] : null;
  }

  function ymd(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  // Date window [from, to] (YYYY-MM-DD, inclusive) for the "When" quick view.
  function whenWindow(when) {
    if (!when) return null;
    var t = new Date();
    t.setHours(0, 0, 0, 0);
    if (when === '30') {
      var to = new Date(t.getTime());
      to.setDate(to.getDate() + 30);
      return { from: ymd(t), to: ymd(to) };
    }
    if (when === 'month') {
      return { from: ymd(t), to: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
    }
    if (when === 'next-month') {
      return {
        from: ymd(new Date(t.getFullYear(), t.getMonth() + 1, 1)),
        to: ymd(new Date(t.getFullYear(), t.getMonth() + 2, 0))
      };
    }
    if (when === 'weekend') {
      // Local Saturday 00:00 through Sunday 23:59 (date-inclusive).
      var day = t.getDay();
      var sat = new Date(t.getTime());
      if (day === 0) sat.setDate(sat.getDate() - 1);
      else if (day !== 6) sat.setDate(sat.getDate() + (6 - day));
      var sun = new Date(sat.getTime());
      sun.setDate(sun.getDate() + 1);
      return { from: ymd(sat), to: ymd(sun) };
    }
    return null;
  }

  // True if the event's date range overlaps the window (undated events never match).
  function inWindow(dates, win) {
    if (!win) return true;
    var s = startDate(dates), e = endDate(dates);
    if (!s || !e) return false;
    return s <= win.to && e >= win.from;
  }

  function whenLabel(when) {
    var map = {
      '30': 'in the next 30 days',
      month: 'this month',
      'next-month': 'next month',
      weekend: 'this weekend'
    };
    return map[when] || '';
  }

  // —— Add to calendar (.ics download + Google Calendar link) ——
  function compactDate(ymdStr, addDays) {
    var d = new Date(ymdStr + 'T00:00:00');
    if (addDays) d.setDate(d.getDate() + addDays);
    return ymd(d).replace(/-/g, '');
  }

  function icsText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/([,;])/g, '\\$1');
  }

  // RFC 5545 line folding (kept short so multi-byte characters stay under 75 octets).
  function foldIcs(line) {
    var out = [];
    while (line.length > 60) {
      out.push(line.slice(0, 60));
      line = ' ' + line.slice(60);
    }
    out.push(line);
    return out.join('\r\n');
  }

  function slug(s) {
    return String(s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  }

  function buildIcs(e, cityName, countryName) {
    var s = startDate(e.dates), end = endDate(e.dates);
    if (!s || !end) return '';
    var url = safeUrl(e.url);
    var loc = [e.venue && e.venue !== 'TBD' ? e.venue : '', cityName, countryName].filter(Boolean).join(', ');
    var desc = [e.notes || '', url ? 'Details: ' + url : '', 'Dates can change — confirm with the organizer. Listed on PackEV.']
      .filter(Boolean).join('\n');
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PackEV//Shows//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + slug(e.name) + '-' + compactDate(s) + '@packev',
      'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + compactDate(s),
      'DTEND;VALUE=DATE:' + compactDate(end, 1),
      'SUMMARY:' + icsText(e.name),
      loc ? 'LOCATION:' + icsText(loc) : '',
      'DESCRIPTION:' + icsText(desc),
      url ? 'URL:' + url : '',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean);
    return lines.map(foldIcs).join('\r\n') + '\r\n';
  }

  function googleCalUrl(e, cityName, countryName) {
    var s = startDate(e.dates), end = endDate(e.dates);
    if (!s || !end) return '';
    var url = safeUrl(e.url);
    var loc = [e.venue && e.venue !== 'TBD' ? e.venue : '', cityName, countryName].filter(Boolean).join(', ');
    var details = [e.notes || '', url ? 'Details: ' + url : '', 'Confirm dates with the organizer.'].filter(Boolean).join('\n');
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(e.name || 'Card show') +
      '&dates=' + compactDate(s) + '/' + compactDate(end, 1) +
      '&location=' + encodeURIComponent(loc) +
      '&details=' + encodeURIComponent(details);
  }

  function downloadIcs(text, name) {
    if (!text) return;
    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var href = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = href;
    a.download = slug(name) + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 0);
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

  function render(data, countryId, q, hidePast, when) {
    var root = $('shows-root');
    var jump = $('shows-jump');
    var status = $('shows-status');
    if (!root) return;

    var countries = (data && data.countries) || [];
    var html = '';
    var jumpBits = [];
    var shown = 0;
    var hiddenPast = 0;
    var win = whenWindow(when);
    calEvents = [];

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
          if (!inWindow(e.dates, win)) continue;
          shown++;
          var url = safeUrl(e.url);
          var soon = soonLabel(e.dates);
          var calHtml = '';
          if (!past && startDate(e.dates)) {
            var calIdx = calEvents.push({ e: e, city: city.name, country: c.name }) - 1;
            var gcal = googleCalUrl(e, city.name, c.name);
            calHtml =
              '<p class="tip show-cal">' +
                '<button type="button" class="linkish show-ics" data-cal="' + calIdx + '">Add to calendar (.ics)</button>' +
                (gcal ? ' · <a href="' + esc(gcal) + '" target="_blank" rel="noopener noreferrer">Google Calendar</a>' : '') +
              '</p>';
          }
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
              calHtml +
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

      if (!cityBlocks && (q || hidePast || win)) continue;
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
      root.innerHTML = '<p class="tip">No shows match that filter' +
        (win ? ' ' + esc(whenLabel(when)) : '') +
        '. Clear search, widen “When”, pick another country' +
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
      status.textContent = shown + ' event' + (shown === 1 ? '' : 's') +
        (win ? ' ' + whenLabel(when) : ' shown') +
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

  // Shareable filters: shows.html?country=uk&when=30&q=london&past=1
  function readParams() {
    var out = { country: '', q: '', when: '', past: false };
    try {
      var sp = new URLSearchParams(window.location.search);
      out.country = sp.get('country') || '';
      out.q = sp.get('q') || '';
      out.when = sp.get('when') || '';
      out.past = sp.get('past') === '1';
    } catch (_) { /* old browsers: ignore */ }
    return out;
  }

  function writeParams(country, q, when, showPast) {
    try {
      var sp = new URLSearchParams();
      if (country) sp.set('country', country);
      if (q) sp.set('q', q);
      if (when) sp.set('when', when);
      if (showPast) sp.set('past', '1');
      var qs = sp.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch (_) { /* ignore */ }
  }

  function setSelect(sel, val) {
    if (!sel || !val) return;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === val) { sel.value = val; return; }
    }
  }

  function wire(data) {
    var sel = $('country-filter');
    var q = $('show-q');
    var up = $('show-upcoming');
    var whenSel = $('show-when');
    var root = $('shows-root');

    var init = readParams();
    setSelect(sel, init.country);
    setSelect(whenSel, init.when);
    if (q && init.q) q.value = init.q;
    if (up && init.past) up.checked = false;

    function paint() {
      var country = (sel && sel.value) || '';
      var query = (q && q.value) || '';
      var when = (whenSel && whenSel.value) || '';
      var hidePast = !!(up && up.checked);
      render(data, country, query, hidePast, when);
      writeParams(country, query.trim(), when, !hidePast);
    }
    if (sel) sel.addEventListener('change', paint);
    if (up) up.addEventListener('change', paint);
    if (whenSel) whenSel.addEventListener('change', paint);
    if (q) {
      q.addEventListener('input', function () {
        clearTimeout(q._t);
        q._t = setTimeout(paint, 120);
      });
    }
    if (root) {
      root.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('button.show-ics') : null;
        if (!btn) return;
        var item = calEvents[Number(btn.getAttribute('data-cal'))];
        if (!item) return;
        downloadIcs(buildIcs(item.e, item.city, item.country), item.e.name);
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
