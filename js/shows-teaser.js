/* PackEV — home "Upcoming shows" teaser. Next 5 dated events from data/shows.json. */
(function () {
  'use strict';

  var box = document.getElementById('upcoming-shows');
  if (!box) return;

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

  function ymd(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function startDate(dates) {
    var m = String(dates || '').match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  function endDate(dates) {
    var all = String(dates || '').match(/\d{4}-\d{2}-\d{2}/g);
    return all && all.length ? all[all.length - 1] : null;
  }

  function isPast(dates) {
    var end = endDate(dates);
    if (!end) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var d = new Date(end + 'T23:59:59');
    return !isNaN(d.getTime()) && d < today;
  }

  function daysUntil(dates) {
    var s = startDate(dates);
    if (!s) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    return Math.round((d - today) / 86400000);
  }

  // Local Saturday 00:00 through Sunday 23:59, as inclusive YYYY-MM-DD bounds.
  function weekendWindow() {
    var t = new Date();
    t.setHours(0, 0, 0, 0);
    var day = t.getDay();
    var sat = new Date(t.getTime());
    if (day === 0) sat.setDate(sat.getDate() - 1);
    else if (day !== 6) sat.setDate(sat.getDate() + (6 - day));
    var sun = new Date(sat.getTime());
    sun.setDate(sun.getDate() + 1);
    return { from: ymd(sat), to: ymd(sun) };
  }

  function overlapsWeekend(dates) {
    var s = startDate(dates);
    var e = endDate(dates);
    if (!s || !e) return false;
    var win = weekendWindow();
    return s <= win.to && e >= win.from;
  }

  function soonLabel(dates) {
    if (overlapsWeekend(dates)) return 'This weekend';
    var n = daysUntil(dates);
    if (n === null || n > 21) return '';
    if (n <= 0) return 'On now';
    if (n === 1) return 'Tomorrow';
    return 'In ' + n + ' days';
  }

  function flatten(data) {
    var out = [];
    var countries = (data && data.countries) || [];
    for (var i = 0; i < countries.length; i++) {
      var c = countries[i];
      var cities = c.cities || [];
      for (var j = 0; j < cities.length; j++) {
        var city = cities[j];
        var events = city.events || [];
        for (var k = 0; k < events.length; k++) {
          var e = events[k];
          if (!startDate(e.dates) || isPast(e.dates)) continue;
          out.push({
            name: e.name,
            dates: e.dates,
            url: e.url,
            city: city.name || '',
            country: c.name || '',
            countryId: c.id || ''
          });
        }
      }
    }
    out.sort(function (a, b) {
      var sa = startDate(a.dates);
      var sb = startDate(b.dates);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var auA = a.countryId === 'australia' ? 0 : 1;
      var auB = b.countryId === 'australia' ? 0 : 1;
      if (auA !== auB) return auA - auB;
      var sydA = /sydney|\bNSW\b/i.test(a.city) ? 0 : 1;
      var sydB = /sydney|\bNSW\b/i.test(b.city) ? 0 : 1;
      if (sydA !== sydB) return sydA - sydB;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return out.slice(0, 5);
  }

  function rowHtml(e) {
    var soon = soonLabel(e.dates);
    var url = safeUrl(e.url);
    var place = [e.city, e.country].filter(Boolean).join(', ');
    return '<article class="show-teaser-row">' +
      '<div class="show-teaser-top">' +
        '<strong>' + esc(e.name) + '</strong>' +
        (soon ? '<span class="pill show-soon-pill">' + esc(soon) + '</span>' : '') +
      '</div>' +
      '<p class="tip show-teaser-meta">' + esc(place) + ' · ' + esc(e.dates) + '</p>' +
      (url
        ? '<p class="tip"><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Organizer</a></p>'
        : '') +
    '</article>';
  }

  function paint(events) {
    if (!events.length) return;
    box.innerHTML =
      '<h2>Upcoming shows</h2>' +
      '<span class="tip upcoming-shows-lead">Next five dated events from the curated show list. Confirm dates with the organizer.</span>' +
      events.map(rowHtml).join('') +
      '<p class="tip show-teaser-foot"><a href="shows.html?when=30">All shows</a></p>';
    box.hidden = false;
  }

  fetch('data/shows.json', { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('shows ' + res.status);
      return res.json();
    })
    .then(function (data) { paint(flatten(data)); })
    .catch(function () { /* leave the teaser hidden */ });
})();
