/* PackEV forum — boards, search, paging, edits, and public display names. */
(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var TITLE_MAX = 160;
  var BODY_MAX = 8000;

  var view = null;
  var statusEl = null;
  var guestBanner = null;
  var headingEl = null;
  var leadEl = null;
  var categoriesCache = null;
  var profileCache = Object.create(null);
  var schemaProbe = null;
  var postCache = Object.create(null);
  var editing = null;
  var lastUid = null;
  var booted = false;

  function $(id) { return document.getElementById(id); }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) {
      return String(iso);
    }
  }

  function relTime(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var sec = Math.max(0, (Date.now() - t) / 1000);
    if (sec < 45) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    if (sec < 86400 * 14) return Math.floor(sec / 86400) + 'd ago';
    return fmtWhen(iso);
  }

  function timeHtml(iso) {
    if (!iso) return '';
    return '<time datetime="' + esc(iso) + '" title="' + esc(fmtWhen(iso)) + '">' + esc(relTime(iso)) + '</time>';
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'expand-status' + (kind === 'err' ? ' expand-error' : '');
  }

  function auth() { return window.PackEVAuth || null; }

  function sessionUser() {
    var a = auth();
    var s = a && a.getSession && a.getSession();
    return (s && s.user) || null;
  }

  function client() {
    var a = auth();
    if (!a || !a.isConfigured || !a.isConfigured()) return null;
    return a.getClient ? a.getClient() : null;
  }

  function authorLabel(authorId) {
    if (!authorId) return 'Member';
    if (profileCache[authorId]) return profileCache[authorId];
    return 'Member · ' + String(authorId).replace(/-/g, '').slice(0, 6);
  }

  function authorHtml(authorId) {
    var html = esc(authorLabel(authorId));
    var u = sessionUser();
    if (u && u.id === authorId) html += ' <span class="forum-you">You</span>';
    return html;
  }

  function wasEdited(created, updated) {
    if (!created || !updated) return false;
    return new Date(updated).getTime() - new Date(created).getTime() > 2 * 60 * 1000;
  }

  function replyCountOf(row) {
    if (!row) return 0;
    if (row.reply_count != null && row.reply_count !== '') return Number(row.reply_count) || 0;
    var emb = row.forum_replies;
    if (Array.isArray(emb) && emb[0] && emb[0].count != null) return Number(emb[0].count) || 0;
    return 0;
  }

  function threadCountOf(cat) {
    var emb = cat && cat.forum_threads;
    if (Array.isArray(emb) && emb[0] && emb[0].count != null) return Number(emb[0].count) || 0;
    return null;
  }

  function catTitle(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return cats[i].title;
    }
    return 'Category';
  }

  function snippet(body) {
    var text = String(body || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 180) return text;
    var cut = text.slice(0, 180);
    var sp = cut.lastIndexOf(' ');
    if (sp > 120) cut = cut.slice(0, sp);
    return cut + '…';
  }

  function formatBody(text) {
    var html = esc(text);
    html = html.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g, function (_m, label, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    });
    html = html.replace(/(^|[\s>(])(https?:\/\/[^\s<]+)/g, function (_m, pre, url) {
      var clean = url.replace(/[),.;]+$/, '');
      return pre + '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + '</a>' + url.slice(clean.length);
    });
    html = html.replace(/^&gt; ?(.*)$/gm, '<span class="forum-quote">$1</span>');
    return html.replace(/\n/g, '<br>');
  }

  function likeTerm(q) {
    return String(q || '').replace(/[%_(),*'"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function listHref(over) {
    var p = params();
    var next = {
      cat: over && over.cat !== undefined ? over.cat : (p.get('cat') || ''),
      q: over && over.q !== undefined ? over.q : (p.get('q') || ''),
      sort: over && over.sort !== undefined ? over.sort : (p.get('sort') || 'active'),
      page: over && over.page !== undefined ? over.page : (p.get('page') || '1')
    };
    var usp = new URLSearchParams();
    if (next.cat) usp.set('cat', next.cat);
    if (next.q) usp.set('q', next.q);
    if (next.sort && next.sort !== 'active') usp.set('sort', next.sort);
    if (next.page && String(next.page) !== '1') usp.set('page', String(next.page));
    var s = usp.toString();
    return 'forum.html' + (s ? '?' + s : '');
  }

  function highlight(text, query) {
    var src = String(text || '');
    var q = String(query || '').trim();
    if (q.length < 2) return esc(src);
    var i = src.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(src);
    return esc(src.slice(0, i)) + '<mark class="qmark">' + esc(src.slice(i, i + q.length)) + '</mark>' + esc(src.slice(i + q.length));
  }

  async function hydrateOwnProfile() {
    var a = auth();
    var u = sessionUser();
    if (!a || !u || !a.loadProfile) return;
    try {
      var p = await a.loadProfile();
      if (p && p.display_name) profileCache[u.id] = p.display_name;
    } catch (_) { /* own metadata still works as a fallback */ }
  }

  async function loadProbe(c) {
    if (schemaProbe) return schemaProbe;
    var next = { replyCount: false, replyUpdated: false, authors: false };
    var rc = await c.from('forum_threads').select('reply_count,last_reply_at').limit(1);
    next.replyCount = !rc.error;
    var ru = await c.from('forum_replies').select('updated_at').limit(1);
    next.replyUpdated = !ru.error;
    var au = await c.from('forum_authors').select('id').limit(1);
    next.authors = !au.error;
    schemaProbe = next;
    return next;
  }

  async function hydrateAuthors(c, ids) {
    var missing = [];
    var seen = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!id || profileCache[id] || seen[id]) continue;
      seen[id] = true;
      missing.push(id);
    }
    if (!missing.length) return;
    var probe = await loadProbe(c);
    var table = probe.authors ? 'forum_authors' : 'profiles';
    for (var start = 0; start < missing.length; start += 80) {
      var chunk = missing.slice(start, start + 80);
      var res = await c.from(table).select('id,display_name').in('id', chunk);
      if (res.error || !res.data) continue;
      for (var j = 0; j < res.data.length; j++) {
        var row = res.data[j];
        if (row.display_name) profileCache[row.id] = String(row.display_name).slice(0, 40);
      }
    }
  }

  function updateGuestBanner() {
    if (!guestBanner) return;
    guestBanner.hidden = !!sessionUser();
  }

  async function loadCategories(c) {
    if (categoriesCache) return categoriesCache;
    var res = await c.from('forum_categories')
      .select('id,title,description,sort_order,forum_threads(count)')
      .order('sort_order');
    if (res.error) {
      res = await c.from('forum_categories').select('id,title,description,sort_order').order('sort_order');
    }
    if (res.error) throw res.error;
    categoriesCache = res.data || [];
    return categoriesCache;
  }

  function cachePosts(rows) {
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      postCache[row.id] = {
        author: authorLabel(row.author_id),
        body: row.body || '',
        title: row.title || ''
      };
    }
  }

  function sortMode() {
    var sort = params().get('sort') || 'active';
    if (sort === 'new' || sort === 'replies' || sort === 'active') return sort;
    return 'active';
  }

  function pageNum() {
    var n = parseInt(params().get('page') || '1', 10);
    return n > 0 ? n : 1;
  }

  async function loadThreadPage(c, filterCat, query, sort, page) {
    var probe = await loadProbe(c);
    var cols = 'id,category_id,author_id,title,body,created_at,updated_at,forum_replies(count)';
    if (probe.replyCount) {
      cols = 'id,category_id,author_id,title,body,created_at,updated_at,reply_count,last_reply_at,forum_replies(count)';
    }
    var term = likeTerm(query);
    function base() {
      var q = c.from('forum_threads').select(cols, { count: 'exact' });
      if (filterCat) q = q.eq('category_id', filterCat);
      if (term) q = q.or('title.ilike.%' + term + '%,body.ilike.%' + term + '%');
      return q;
    }

    if (sort === 'replies' && !probe.replyCount) {
      var broad = await base().order('updated_at', { ascending: false }).limit(100);
      if (broad.error) throw broad.error;
      var rows = broad.data || [];
      rows.sort(function (a, b) { return replyCountOf(b) - replyCountOf(a); });
      var from = (page - 1) * PAGE_SIZE;
      return { rows: rows.slice(from, from + PAGE_SIZE), total: rows.length, capped: rows.length === 100 };
    }

    var q = base();
    if (sort === 'new') q = q.order('created_at', { ascending: false });
    else if (sort === 'replies') q = q.order('reply_count', { ascending: false }).order('updated_at', { ascending: false });
    else q = q.order('updated_at', { ascending: false });
    var fromIdx = (page - 1) * PAGE_SIZE;
    var res = await q.range(fromIdx, fromIdx + PAGE_SIZE - 1);
    if (res.error) throw res.error;
    return { rows: res.data || [], total: res.count || 0, capped: false };
  }

  function pagerHtml(page, total) {
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages < 2) return '';
    var html = '<nav class="forum-pager" aria-label="Thread pages">';
    if (page > 1) html += '<a href="' + esc(listHref({ page: page - 1 })) + '">← Previous</a>';
    html += '<span class="here">Page ' + page + ' of ' + pages + '</span>';
    if (page < pages) html += '<a href="' + esc(listHref({ page: page + 1 })) + '">Next →</a>';
    html += '</nav>';
    return html;
  }

  function composeHtml(cats, filterCat, open) {
    return '<div class="forum-compose card-inset"' + (open ? '' : ' hidden') + ' id="compose-box">'
      + '<h2>New thread</h2>'
      + '<form id="new-thread-form" class="auth-form">'
      + '<label for="nt-cat">Board</label>'
      + '<select id="nt-cat" required>'
      + cats.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (filterCat === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>';
      }).join('')
      + '</select>'
      + '<label for="nt-title">Title</label>'
      + '<input id="nt-title" type="text" maxlength="' + TITLE_MAX + '" required placeholder="Card, set, and the question" />'
      + '<label for="nt-body">Message</label>'
      + formatTools('nt-body')
      + '<textarea id="nt-body" rows="5" maxlength="' + BODY_MAX + '" required placeholder="Price, condition, and what you already checked."></textarea>'
      + '<p class="forum-count" id="nt-count">0 / ' + BODY_MAX + '</p>'
      + '<button type="submit">Post thread</button>'
      + '<p id="nt-msg" class="auth-msg" hidden></p>'
      + '</form></div>';
  }

  function formatTools(forId) {
    return '<div class="forum-tools">'
      + '<button type="button" data-wrap="**" data-for="' + forId + '">Bold</button>'
      + '<button type="button" data-link-for="' + forId + '">Link</button>'
      + '</div>';
  }

  function renderList(cats, threads, filterCat, query, sort, page, total, capped) {
    var title = filterCat ? catTitle(cats, filterCat) : 'Forum';
    headingEl.textContent = title;
    document.title = title + ' — PackEV';
    leadEl.innerHTML = filterCat
      ? esc((cats.filter(function (c) { return c.id === filterCat; })[0] || {}).description || 'Threads in this board.')
        + ' <a href="forum.html">All boards</a>'
      : 'Pick a board, search it, then post the card, the condition, and the price.';

    var totalThreads = 0;
    var counted = true;
    for (var n = 0; n < cats.length; n++) {
      var ct = threadCountOf(cats[n]);
      if (ct == null) counted = false;
      else totalThreads += ct;
    }

    var html = '<div class="forum-stats">';
    html += '<span>' + cats.length + ' boards</span>';
    if (counted) html += '<span>' + totalThreads + ' threads</span>';
    html += '<span>Name the card and the price</span>';
    html += '</div>';

    html += '<div class="forum-cats">';
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var count = threadCountOf(cat);
      html += '<a class="forum-cat' + (filterCat === cat.id ? ' active' : '') + '" href="forum.html?cat=' + encodeURIComponent(cat.id) + '">'
        + '<strong>' + esc(cat.title) + (count != null ? ' · ' + count : '') + '</strong>'
        + (cat.description ? '<span class="sub">' + esc(cat.description) + '</span>' : '')
        + '</a>';
    }
    html += '</div>';

    html += '<div class="forum-toolbar">'
      + '<form class="forum-search grow" action="forum.html" method="get">'
      + (filterCat ? '<input type="hidden" name="cat" value="' + esc(filterCat) + '" />' : '')
      + (sort !== 'active' ? '<input type="hidden" name="sort" value="' + esc(sort) + '" />' : '')
      + '<input type="search" name="q" value="' + esc(query) + '" placeholder="Search threads" aria-label="Search threads" />'
      + '<button type="submit">Search</button>'
      + '</form>'
      + '<div><label for="forum-sort">Sort</label>'
      + '<select id="forum-sort">'
      + '<option value="active"' + (sort === 'active' ? ' selected' : '') + '>Latest activity</option>'
      + '<option value="new"' + (sort === 'new' ? ' selected' : '') + '>Newest</option>'
      + '<option value="replies"' + (sort === 'replies' ? ' selected' : '') + '>Most replies</option>'
      + '</select></div>';
    if (sessionUser()) {
      html += '<button type="button" class="forum-new" id="toggle-compose">New thread</button>';
    } else {
      html += '<a class="forum-new" href="login.html">Log in to post</a>';
    }
    html += '</div>';

    var loggedIn = !!sessionUser();
    if (loggedIn) html += composeHtml(cats, filterCat, !threads.length);

    var heading = query ? 'Matches' : (filterCat ? 'Threads' : 'Latest threads');
    html += '<h2>' + heading + '</h2>';
    if (query) html += '<p class="tip">' + total + ' match' + (total === 1 ? '' : 'es') + ' for “' + esc(query) + '”.</p>';
    if (capped) html += '<p class="tip">Reply sort covers the latest 100 threads.</p>';
    if (!threads.length) {
      html += '<p class="tip">' + (query ? 'Nothing matches that search.' : 'No threads yet — be the first to post.') + '</p>';
    } else {
      html += '<ul class="forum-thread-list">';
      for (var j = 0; j < threads.length; j++) {
        var t = threads[j];
        var replies = replyCountOf(t);
        var when = t.last_reply_at || t.updated_at || t.created_at;
        html += '<li class="forum-thread-item"><div class="forum-thread-top">'
          + '<div><a href="forum.html?thread=' + encodeURIComponent(t.id) + '"><strong>' + highlight(t.title, query) + '</strong></a>'
          + '<div class="sub">' + esc(catTitle(cats, t.category_id)) + ' · ' + esc(authorLabel(t.author_id))
          + ' · ' + timeHtml(t.created_at)
          + (when && when !== t.created_at ? ' · active ' + timeHtml(when) : '')
          + '</div>'
          + '<p class="forum-snippet">' + esc(snippet(t.body)) + '</p></div>'
          + '<div class="forum-reply-count"><b>' + replies + '</b><span>' + (replies === 1 ? 'reply' : 'replies') + '</span></div>'
          + '</div></li>';
      }
      html += '</ul>';
      html += pagerHtml(page, total);
    }

    view.innerHTML = html;
    var toggle = $('toggle-compose');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var box = $('compose-box');
        if (!box) return;
        box.hidden = !box.hidden;
        if (!box.hidden) {
          var title = $('nt-title');
          if (title) title.focus();
        }
      });
    }
    var sortEl = $('forum-sort');
    if (sortEl) {
      sortEl.addEventListener('change', function () {
        window.location.href = listHref({ sort: sortEl.value, page: 1 });
      });
    }
    bindComposer($('new-thread-form'), 'nt-body', 'nt-count');
  }

  function editedHtml(row, isThread) {
    if (!row) return '';
    if (isThread) {
      if (!wasEdited(row.created_at, row.updated_at)) return '';
      if (row.last_reply_at && Math.abs(new Date(row.updated_at) - new Date(row.last_reply_at)) < 2 * 60 * 1000) return '';
      if (!row.last_reply_at && replyCountOf(row) > 0) return '';
    } else if (!wasEdited(row.created_at, row.updated_at)) {
      return '';
    }
    return ' · edited';
  }

  function actionButtons(kind, id, mine) {
    var html = '<div class="forum-actions">';
    if (sessionUser()) html += '<button type="button" data-act="quote" data-id="' + esc(id) + '">Quote</button>';
    if (mine) {
      html += '<button type="button" data-act="edit" data-kind="' + kind + '" data-id="' + esc(id) + '">Edit</button>';
      html += '<button type="button" data-act="delete" data-kind="' + kind + '" data-id="' + esc(id) + '">Delete</button>';
    }
    html += '</div>';
    return html;
  }

  function renderThread(cats, thread, replies) {
    headingEl.textContent = thread.title;
    document.title = thread.title + ' — Forum — PackEV';
    leadEl.innerHTML = '<a href="forum.html">Forum</a> · '
      + '<a href="forum.html?cat=' + encodeURIComponent(thread.category_id) + '">' + esc(catTitle(cats, thread.category_id)) + '</a>';

    var mineThread = sessionUser() && sessionUser().id === thread.author_id;
    var html = '';
    html += '<article class="forum-post forum-op" id="post-' + esc(thread.id) + '">';
    html += '<div class="forum-meta"><strong>' + authorHtml(thread.author_id) + '</strong> '
      + timeHtml(thread.created_at) + esc(editedHtml(thread, true)) + '</div>';
    if (editing && editing.kind === 'thread' && editing.id === thread.id) {
      html += editForm('thread', thread.id, thread.title, thread.body);
    } else {
      html += '<div class="forum-body">' + formatBody(thread.body) + '</div>';
      html += actionButtons('thread', thread.id, mineThread);
    }
    html += '</article>';

    html += '<h2 id="replies">Replies (' + replies.length + ')</h2>';
    if (!replies.length) html += '<p class="tip">No replies yet. A useful reply names the price and the condition.</p>';
    else {
      html += '<div class="forum-replies">';
      for (var i = 0; i < replies.length; i++) {
        var r = replies[i];
        var mine = sessionUser() && sessionUser().id === r.author_id;
        html += '<article class="forum-post" id="post-' + esc(r.id) + '">';
        html += '<div class="forum-meta"><strong>' + authorHtml(r.author_id) + '</strong> '
          + timeHtml(r.created_at) + esc(editedHtml(r, false)) + '</div>';
        if (editing && editing.kind === 'reply' && editing.id === r.id) {
          html += editForm('reply', r.id, '', r.body);
        } else {
          html += '<div class="forum-body">' + formatBody(r.body) + '</div>';
          html += actionButtons('reply', r.id, mine);
        }
        html += '</article>';
      }
      html += '</div>';
    }

    if (sessionUser()) {
      html += '<div class="forum-compose card-inset" id="reply-box"><h2>Reply</h2>'
        + '<form id="reply-form" class="auth-form">'
        + '<label for="reply-body">Message</label>'
        + formatTools('reply-body')
        + '<textarea id="reply-body" rows="5" maxlength="' + BODY_MAX + '" required placeholder="Quote the price you are responding to."></textarea>'
        + '<p class="forum-count" id="reply-count">0 / ' + BODY_MAX + '</p>'
        + '<button type="submit">Post reply</button>'
        + '<p id="reply-msg" class="auth-msg" hidden></p>'
        + '</form></div>';
    } else {
      html += '<div class="warn">Want to reply? <a href="join.html">Join</a> or <a href="login.html">Log in</a>.</div>';
    }
    html += '<p class="forum-actions"><button type="button" id="copy-thread">Copy link</button></p>';

    view.innerHTML = html;
    cachePosts([thread].concat(replies));
    bindComposer($('reply-form'), 'reply-body', 'reply-count');
    bindComposer($('edit-form'), 'edit-body', null);
    var copy = $('copy-thread');
    if (copy) {
      copy.addEventListener('click', function () {
        var done = function () { copy.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(window.location.href).then(done).catch(function () {});
        }
      });
    }
  }

  function editForm(kind, id, title, body) {
    return '<form id="edit-form" class="auth-form" data-kind="' + kind + '" data-id="' + esc(id) + '">'
      + (kind === 'thread'
        ? '<label for="edit-title">Title</label><input id="edit-title" maxlength="' + TITLE_MAX + '" required value="' + esc(title) + '" />'
        : '')
      + '<label for="edit-body">Message</label>'
      + '<textarea id="edit-body" rows="5" maxlength="' + BODY_MAX + '" required>' + esc(body) + '</textarea>'
      + '<button type="submit">Save</button> '
      + '<button type="button" id="cancel-edit" class="forum-new">Cancel</button>'
      + '<p id="edit-msg" class="auth-msg" hidden></p></form>';
  }

  function bindComposer(form, areaId, countId) {
    if (!form) return;
    var area = $(areaId);
    var count = $(countId);
    function paintCount() {
      if (!count || !area) return;
      count.textContent = String(area.value || '').length + ' / ' + BODY_MAX;
    }
    if (area) area.addEventListener('input', paintCount);
    paintCount();
    form.addEventListener('submit', function (e) {
      if (form.id === 'new-thread-form') onCreateThread(e);
      else if (form.id === 'reply-form') onReply(e);
      else onSaveEdit(e);
    });
  }

  function wrapSelection(area, before, after) {
    if (!area) return;
    var start = area.selectionStart || 0;
    var end = area.selectionEnd || 0;
    var val = area.value || '';
    var sel = val.slice(start, end) || 'text';
    area.value = val.slice(0, start) + before + sel + after + val.slice(end);
    area.focus();
    area.dispatchEvent(new Event('input'));
  }

  function setFormMsg(id, text, kind) {
    var el = $(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }

  function friendlyError(error) {
    var msg = (error && error.message) || 'Something went wrong';
    if (/row-level security|permission|not allowed|policy/i.test(msg)) {
      return 'That action is not available on your account yet. Editing still works.';
    }
    if (/invalid input syntax for type uuid/i.test(msg)) return 'Thread not found.';
    return msg;
  }

  async function onCreateThread(e) {
    e.preventDefault();
    var form = e.target;
    var c = client();
    var u = sessionUser();
    if (!c || !u) {
      setFormMsg('nt-msg', 'Please log in to post.', 'err');
      return;
    }
    var cat = ($('nt-cat') || {}).value || '';
    var title = (($('nt-title') || {}).value || '').trim();
    var body = (($('nt-body') || {}).value || '').trim();
    if (!cat || title.length < 3 || body.length < 2) {
      setFormMsg('nt-msg', 'Add a board, a title of at least 3 characters, and a message.', 'err');
      return;
    }
    if (title.length > TITLE_MAX || body.length > BODY_MAX) {
      setFormMsg('nt-msg', 'Title or message is too long.', 'err');
      return;
    }
    var btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    setFormMsg('nt-msg', 'Posting…', '');
    var res = await c.from('forum_threads').insert({
      category_id: cat,
      author_id: u.id,
      title: title,
      body: body
    }).select('id').maybeSingle();
    if (res.error || !res.data || !res.data.id) {
      if (btn) btn.disabled = false;
      setFormMsg('nt-msg', friendlyError(res.error || { message: 'Could not open the new thread' }), 'err');
      return;
    }
    categoriesCache = null;
    window.location.href = 'forum.html?thread=' + encodeURIComponent(res.data.id);
  }

  async function onReply(e, threadId) {
    e.preventDefault();
    var form = e.target;
    threadId = threadId || (params().get('thread'));
    var c = client();
    var u = sessionUser();
    if (!c || !u) {
      setFormMsg('reply-msg', 'Please log in to reply.', 'err');
      return;
    }
    var body = (($('reply-body') || {}).value || '').trim();
    if (body.length < 2) {
      setFormMsg('reply-msg', 'Write a reply first.', 'err');
      return;
    }
    var btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    setFormMsg('reply-msg', 'Posting…', '');
    var res = await c.from('forum_replies').insert({
      thread_id: threadId,
      author_id: u.id,
      body: body
    });
    if (res.error) {
      if (btn) btn.disabled = false;
      setFormMsg('reply-msg', friendlyError(res.error), 'err');
      return;
    }
    editing = null;
    await showThread(threadId, true);
  }

  async function onSaveEdit(e) {
    e.preventDefault();
    var form = e.target;
    var c = client();
    var u = sessionUser();
    if (!c || !u || !editing) return;
    var body = (($('edit-body') || {}).value || '').trim();
    var title = (($('edit-title') || {}).value || '').trim();
    if (body.length < 2 || (editing.kind === 'thread' && title.length < 3)) {
      setFormMsg('edit-msg', 'Title and message are required.', 'err');
      return;
    }
    var btn = form.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    setFormMsg('edit-msg', 'Saving…', '');
    var res;
    if (editing.kind === 'thread') {
      res = await c.from('forum_threads').update({
        title: title,
        body: body,
        updated_at: new Date().toISOString()
      }).eq('id', editing.id).eq('author_id', u.id);
    } else {
      var payload = { body: body };
      if (schemaProbe && schemaProbe.replyUpdated) payload.updated_at = new Date().toISOString();
      res = await c.from('forum_replies').update(payload).eq('id', editing.id).eq('author_id', u.id);
    }
    if (res.error) {
      if (btn) btn.disabled = false;
      setFormMsg('edit-msg', friendlyError(res.error), 'err');
      return;
    }
    editing = null;
    var threadId = params().get('thread');
    if (threadId) await showThread(threadId, false);
  }

  async function onDelete(kind, id) {
    var c = client();
    var u = sessionUser();
    if (!c || !u) return;
    var cached = postCache[id];
    var label = cached && cached.title ? cached.title : 'this post';
    if (!window.confirm('Delete “' + label.slice(0, 80) + '”?')) return;
    var table = kind === 'thread' ? 'forum_threads' : 'forum_replies';
    var res = await c.from(table).delete().eq('id', id).eq('author_id', u.id);
    if (res.error) {
      setStatus(friendlyError(res.error), 'err');
      return;
    }
    categoriesCache = null;
    editing = null;
    if (kind === 'thread') {
      window.location.href = 'forum.html';
      return;
    }
    await showThread(params().get('thread'), false);
  }

  function onQuote(id) {
    var cached = postCache[id];
    var box = $('reply-body');
    if (!cached || !box) {
      var login = document.querySelector('.warn a[href="login.html"]');
      if (login) login.focus();
      return;
    }
    var lines = String(cached.body || '').split('\n').map(function (line) { return '> ' + line; }).join('\n');
    var block = cached.author + ' wrote:\n' + lines + '\n\n';
    box.value = block + box.value;
    box.focus();
    box.dispatchEvent(new Event('input'));
    var wrap = $('reply-box');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function onViewClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var wrapBtn = t.closest('[data-wrap]');
    if (wrapBtn) {
      wrapSelection($(wrapBtn.getAttribute('data-for')), wrapBtn.getAttribute('data-wrap'), wrapBtn.getAttribute('data-wrap'));
      return;
    }
    var linkBtn = t.closest('[data-link-for]');
    if (linkBtn) {
      wrapSelection($(linkBtn.getAttribute('data-link-for')), '[', '](https://)');
      return;
    }
    if (t.id === 'cancel-edit') {
      editing = null;
      var threadId = params().get('thread');
      if (threadId) showThread(threadId, false);
      return;
    }
    var act = t.closest('[data-act]');
    if (!act) return;
    var id = act.getAttribute('data-id');
    var kind = act.getAttribute('data-kind');
    var action = act.getAttribute('data-act');
    if (action === 'quote') onQuote(id);
    else if (action === 'edit') {
      editing = { kind: kind, id: id };
      showThread(params().get('thread'), false);
    } else if (action === 'delete') onDelete(kind, id);
  }

  async function showList(filterCat) {
    var c = client();
    if (!c) {
      setStatus('Supabase is not configured. See SETUP.md.', 'err');
      view.innerHTML = '';
      return;
    }
    setStatus('Loading forum…');
    editing = null;
    try {
      var cats = await loadCategories(c);
      var query = params().get('q') || '';
      var sort = sortMode();
      var page = pageNum();
      if (filterCat && !cats.some(function (cat) { return cat.id === filterCat; })) {
        setStatus('That board does not exist.', 'err');
        if (window.history && history.replaceState) history.replaceState(null, '', 'forum.html');
        filterCat = null;
      }
      var result = await loadThreadPage(c, filterCat, query, sort, page);
      var ids = result.rows.map(function (row) { return row.author_id; });
      await hydrateAuthors(c, ids);
      setStatus('');
      renderList(cats, result.rows, filterCat, query.trim(), sort, page, result.total, result.capped);
    } catch (err) {
      setStatus(friendlyError(err), 'err');
    }
  }

  async function showThread(threadId, scrollToLast) {
    var c = client();
    if (!c) {
      setStatus('Supabase is not configured. See SETUP.md.', 'err');
      view.innerHTML = '';
      return;
    }
    setStatus('Loading thread…');
    try {
      var probe = await loadProbe(c);
      var cats = await loadCategories(c);
      var threadRes = await c.from('forum_threads')
        .select('id,category_id,author_id,title,body,created_at,updated_at' + (probe.replyCount ? ',reply_count,last_reply_at' : ''))
        .eq('id', threadId)
        .maybeSingle();
      if (threadRes.error) throw threadRes.error;
      var thread = threadRes.data;
      if (!thread) {
        setStatus('Thread not found.', 'err');
        headingEl.textContent = 'Forum';
        view.innerHTML = '<p class="tip"><a href="forum.html">Back to the forum</a></p>';
        return;
      }
      var replyCols = 'id,thread_id,author_id,body,created_at' + (probe.replyUpdated ? ',updated_at' : '');
      var replyRes = await c.from('forum_replies').select(replyCols).eq('thread_id', threadId).order('created_at', { ascending: true });
      if (replyRes.error) throw replyRes.error;
      var replies = replyRes.data || [];
      var ids = [thread.author_id].concat(replies.map(function (r) { return r.author_id; }));
      await hydrateAuthors(c, ids);
      setStatus('');
      renderThread(cats, thread, replies);
      if (scrollToLast) {
        var posts = view.querySelectorAll('.forum-post');
        var last = posts[posts.length - 1];
        if (last && last.scrollIntoView) last.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      setStatus(friendlyError(err), 'err');
      headingEl.textContent = 'Forum';
      view.innerHTML = '<p class="tip"><a href="forum.html">Back to the forum</a></p>';
    }
  }

  async function route() {
    updateGuestBanner();
    await hydrateOwnProfile();
    var p = params();
    var threadId = p.get('thread');
    if (threadId) await showThread(threadId, false);
    else await showList(p.get('cat'));
  }

  async function boot() {
    view = $('forum-view');
    statusEl = $('forum-status');
    guestBanner = $('forum-guest-banner');
    headingEl = $('forum-heading');
    leadEl = $('forum-lead');
    if (!view) return;
    view.addEventListener('click', onViewClick);

    var a = auth();
    if (a && a.refreshSession) {
      try { await a.refreshSession(); } catch (_) { /* guests can still read */ }
    }
    await route();
    var current = sessionUser();
    lastUid = current ? current.id : null;
    booted = true;

    var c = client();
    if (c && c.auth && c.auth.onAuthStateChange) {
      c.auth.onAuthStateChange(function (event, sess) {
        if (!booted) return;
        updateGuestBanner();
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
        var uid = (sess && sess.user && sess.user.id) || null;
        if (uid === lastUid) return;
        lastUid = uid;
        categoriesCache = null;
        route();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
