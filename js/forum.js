/* PackEV forum — categories, threads, replies via Supabase RLS. */
(function () {
  'use strict';

  var view = null;
  var statusEl = null;
  var guestBanner = null;
  var headingEl = null;
  var leadEl = null;
  var categoriesCache = null;
  var profileCache = Object.create(null);

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
      var d = new Date(iso);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch (_) {
      return iso;
    }
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = 'expand-status' + (kind === 'err' ? ' expand-error' : '');
  }

  function auth() {
    return window.PackEVAuth || null;
  }

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
    var u = sessionUser();
    if (u && u.id === authorId) {
      var name = (u.user_metadata && u.user_metadata.display_name) || (u.email && u.email.split('@')[0]) || 'You';
      profileCache[authorId] = name;
      return name;
    }
    var short = String(authorId).replace(/-/g, '').slice(0, 6);
    return 'Member · ' + short;
  }

  async function hydrateOwnProfile() {
    var a = auth();
    var u = sessionUser();
    if (!a || !u || !a.loadProfile) return;
    try {
      var p = await a.loadProfile();
      if (p && p.display_name) profileCache[u.id] = p.display_name;
    } catch (_) { /* ignore */ }
  }

  function updateGuestBanner() {
    if (!guestBanner) return;
    var loggedIn = !!sessionUser();
    guestBanner.hidden = loggedIn;
  }

  async function loadCategories(c) {
    if (categoriesCache) return categoriesCache;
    var res = await c.from('forum_categories').select('id,title,description,sort_order').order('sort_order');
    if (res.error) throw res.error;
    categoriesCache = res.data || [];
    return categoriesCache;
  }

  async function loadRecentThreads(c, categoryId, limit) {
    var q = c.from('forum_threads')
      .select('id,category_id,author_id,title,body,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(limit || 30);
    if (categoryId) q = q.eq('category_id', categoryId);
    var res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function loadThread(c, threadId) {
    var res = await c.from('forum_threads')
      .select('id,category_id,author_id,title,body,created_at,updated_at')
      .eq('id', threadId)
      .maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  async function loadReplies(c, threadId) {
    var res = await c.from('forum_replies')
      .select('id,thread_id,author_id,body,created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;
    return res.data || [];
  }

  function catTitle(cats, id) {
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id === id) return cats[i].title;
    }
    return id || 'Category';
  }

  function renderList(cats, threads, filterCat) {
    headingEl.textContent = filterCat ? catTitle(cats, filterCat) : 'Forum';
    leadEl.innerHTML = filterCat
      ? 'Threads in this category. <a href="forum.html">← All categories</a> · <a href="index.html">Search cards</a>'
      : 'Talk packs, sets, and fair prices. Guests can read; <a href="join.html">Join</a> or <a href="login.html">Log in</a> to post. Optional: <a href="index.html">search cards by name</a> on Sets.';

    var html = '';
    html += '<div class="forum-cats">';
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var active = filterCat === cat.id ? ' active' : '';
      html +=
        '<a class="forum-cat' + active + '" href="forum.html?cat=' + encodeURIComponent(cat.id) + '">' +
          '<strong>' + esc(cat.title) + '</strong>' +
          (cat.description ? '<span class="sub">' + esc(cat.description) + '</span>' : '') +
        '</a>';
    }
    html += '</div>';

    var loggedIn = !!sessionUser();
    if (loggedIn) {
      html +=
        '<div class="forum-compose card-inset">' +
          '<h2>Start a thread</h2>' +
          '<form id="new-thread-form" class="auth-form">' +
            '<label for="nt-cat">Category</label>' +
            '<select id="nt-cat" required>' +
              cats.map(function (c) {
                var sel = filterCat === c.id ? ' selected' : '';
                return '<option value="' + esc(c.id) + '"' + sel + '>' + esc(c.title) + '</option>';
              }).join('') +
            '</select>' +
            '<label for="nt-title">Title</label>' +
            '<input id="nt-title" type="text" maxlength="160" required placeholder="Short subject" />' +
            '<label for="nt-body">Message</label>' +
            '<textarea id="nt-body" rows="4" maxlength="8000" required placeholder="Details…"></textarea>' +
            '<button type="submit">Post thread</button>' +
            '<p id="nt-msg" class="auth-msg" hidden></p>' +
          '</form>' +
        '</div>';
    }

    html += '<h2>' + (filterCat ? 'Threads' : 'Recent threads') + '</h2>';
    if (!threads.length) {
      html += '<p class="tip">No threads yet — be the first to post.</p>';
    } else {
      html += '<ul class="forum-thread-list">';
      for (var j = 0; j < threads.length; j++) {
        var t = threads[j];
        html +=
          '<li class="forum-thread-item">' +
            '<a href="forum.html?thread=' + encodeURIComponent(t.id) + '"><strong>' + esc(t.title) + '</strong></a>' +
            '<div class="sub">' +
              esc(catTitle(cats, t.category_id)) + ' · ' +
              esc(authorLabel(t.author_id)) + ' · ' +
              esc(fmtWhen(t.created_at)) +
            '</div>' +
            '<p class="forum-snippet">' + esc((t.body || '').slice(0, 160)) + ((t.body || '').length > 160 ? '…' : '') + '</p>' +
          '</li>';
      }
      html += '</ul>';
    }

    view.innerHTML = html;

    var form = $('new-thread-form');
    if (form) {
      form.addEventListener('submit', onCreateThread);
    }
  }

  function renderThread(cats, thread, replies) {
    headingEl.textContent = thread.title;
    leadEl.innerHTML =
      '<a href="forum.html">← Forum</a> · ' +
      '<a href="forum.html?cat=' + encodeURIComponent(thread.category_id) + '">' +
        esc(catTitle(cats, thread.category_id)) +
      '</a> · <a href="index.html">Search cards</a>';

    var html = '';
    html +=
      '<article class="forum-post forum-op">' +
        '<div class="forum-meta">' +
          '<strong>' + esc(authorLabel(thread.author_id)) + '</strong>' +
          '<span class="sub">' + esc(fmtWhen(thread.created_at)) + '</span>' +
        '</div>' +
        '<div class="forum-body">' + esc(thread.body).replace(/\n/g, '<br>') + '</div>' +
      '</article>';

    html += '<h2>Replies (' + replies.length + ')</h2>';
    if (!replies.length) {
      html += '<p class="tip">No replies yet.</p>';
    } else {
      html += '<div class="forum-replies">';
      for (var i = 0; i < replies.length; i++) {
        var r = replies[i];
        html +=
          '<article class="forum-post">' +
            '<div class="forum-meta">' +
              '<strong>' + esc(authorLabel(r.author_id)) + '</strong>' +
              '<span class="sub">' + esc(fmtWhen(r.created_at)) + '</span>' +
            '</div>' +
            '<div class="forum-body">' + esc(r.body).replace(/\n/g, '<br>') + '</div>' +
          '</article>';
      }
      html += '</div>';
    }

    if (sessionUser()) {
      html +=
        '<div class="forum-compose card-inset">' +
          '<h2>Reply</h2>' +
          '<form id="reply-form" class="auth-form">' +
            '<label for="reply-body">Message</label>' +
            '<textarea id="reply-body" rows="4" maxlength="8000" required placeholder="Write a reply…"></textarea>' +
            '<button type="submit">Post reply</button>' +
            '<p id="reply-msg" class="auth-msg" hidden></p>' +
          '</form>' +
        '</div>';
    } else {
      html +=
        '<div class="warn">' +
          'Want to reply? <a href="join.html">Join</a> or <a href="login.html">Log in</a>.' +
        '</div>';
    }

    view.innerHTML = html;
    var form = $('reply-form');
    if (form) form.addEventListener('submit', function (e) { onReply(e, thread.id); });
  }

  function setFormMsg(id, text, kind) {
    var el = $(id);
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }

  async function onCreateThread(e) {
    e.preventDefault();
    var c = client();
    var u = sessionUser();
    if (!c || !u) {
      setFormMsg('nt-msg', 'Please log in to post.', 'err');
      return;
    }
    var cat = ($('nt-cat') || {}).value || '';
    var title = (($('nt-title') || {}).value || '').trim();
    var body = (($('nt-body') || {}).value || '').trim();
    if (!cat || !title || !body) {
      setFormMsg('nt-msg', 'Category, title, and message are required.', 'err');
      return;
    }
    setFormMsg('nt-msg', 'Posting…', '');
    var res = await c.from('forum_threads').insert({
      category_id: cat,
      author_id: u.id,
      title: title,
      body: body
    }).select('id').maybeSingle();
    if (res.error) {
      setFormMsg('nt-msg', res.error.message || 'Could not post', 'err');
      return;
    }
    setFormMsg('nt-msg', 'Posted. Opening…', 'ok');
    window.location.href = 'forum.html?thread=' + encodeURIComponent(res.data.id);
  }

  async function onReply(e, threadId) {
    e.preventDefault();
    var c = client();
    var u = sessionUser();
    if (!c || !u) {
      setFormMsg('reply-msg', 'Please log in to reply.', 'err');
      return;
    }
    var body = (($('reply-body') || {}).value || '').trim();
    if (!body) {
      setFormMsg('reply-msg', 'Message required.', 'err');
      return;
    }
    setFormMsg('reply-msg', 'Posting…', '');
    var res = await c.from('forum_replies').insert({
      thread_id: threadId,
      author_id: u.id,
      body: body
    });
    if (res.error) {
      setFormMsg('reply-msg', res.error.message || 'Could not reply', 'err');
      return;
    }
    setFormMsg('reply-msg', 'Posted.', 'ok');
    await showThread(threadId);
  }

  async function showList(filterCat) {
    var c = client();
    if (!c) {
      setStatus('Supabase is not configured. See SETUP.md.', 'err');
      view.innerHTML = '';
      return;
    }
    setStatus('Loading…');
    try {
      var cats = await loadCategories(c);
      var threads = await loadRecentThreads(c, filterCat || null, 40);
      setStatus('');
      renderList(cats, threads, filterCat || null);
    } catch (err) {
      setStatus((err && err.message) || 'Failed to load forum', 'err');
    }
  }

  async function showThread(threadId) {
    var c = client();
    if (!c) {
      setStatus('Supabase is not configured. See SETUP.md.', 'err');
      view.innerHTML = '';
      return;
    }
    setStatus('Loading thread…');
    try {
      var cats = await loadCategories(c);
      var thread = await loadThread(c, threadId);
      if (!thread) {
        setStatus('Thread not found.', 'err');
        view.innerHTML = '<p class="tip"><a href="forum.html">← Back to forum</a></p>';
        return;
      }
      var replies = await loadReplies(c, threadId);
      setStatus('');
      renderThread(cats, thread, replies);
    } catch (err) {
      setStatus((err && err.message) || 'Failed to load thread', 'err');
    }
  }

  async function route() {
    updateGuestBanner();
    await hydrateOwnProfile();
    var p = params();
    var threadId = p.get('thread');
    var cat = p.get('cat');
    if (threadId) await showThread(threadId);
    else await showList(cat);
  }

  async function boot() {
    view = $('forum-view');
    statusEl = $('forum-status');
    guestBanner = $('forum-guest-banner');
    headingEl = $('forum-heading');
    leadEl = $('forum-lead');
    if (!view) return;

    var a = auth();
    if (a && a.refreshSession) {
      try { await a.refreshSession(); } catch (_) { /* ignore */ }
    }
    await route();

    // Re-render guest chrome if auth state changes after boot
    var c = client();
    if (c && c.auth && c.auth.onAuthStateChange) {
      c.auth.onAuthStateChange(function () {
        updateGuestBanner();
        route();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
