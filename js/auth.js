/* PackEV member auth — Supabase Email when configured; otherwise setup UI. */
(function () {
  'use strict';

  var cfg = (window.PACK_EV_SUPABASE || {});
  var url = (cfg.SUPABASE_URL || '').trim();
  // Prefer the legacy JWT anon key, but accept Supabase's newer publishable key format.
  var key = (cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || '').trim();
  var configured = !!(url && key && url.indexOf('YOUR_') !== 0 && key.indexOf('YOUR_') !== 0);
  var emailRedirectTo = 'https://hcc5ksj82m-rgb.github.io/freelance-rate-calculator/login.html';

  var client = null;
  var session = null;

  function $(id) { return document.getElementById(id); }

  function isConfigured() { return configured; }

  function getClient() {
    if (!configured) return null;
    if (client) return client;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.warn('Supabase JS CDN not loaded');
      return null;
    }
    client = supabase.createClient(url, key);
    return client;
  }

  function setupHtml() {
    return (
      '<div class="warn auth-setup" role="status">' +
        '<strong>Members not live yet.</strong> Supabase credentials are missing. ' +
        'Open <a href="SETUP.md">SETUP.md</a>: create a free Supabase project, paste ' +
        '<code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code> into ' +
        '<code>js/supabase-config.js</code>, run <code>supabase/schema.sql</code>, enable Email auth.' +
      '</div>'
    );
  }

  function renderAuthNav() {
    var el = $('auth-nav');
    if (!el) return;
    if (session && session.user) {
      el.innerHTML =
        '<a href="account.html">Account</a>' +
        '<a href="#" id="auth-nav-signout">Log out</a>';
      var so = $('auth-nav-signout');
      if (so) {
        so.addEventListener('click', function (e) {
          e.preventDefault();
          signOut().then(function () {
            window.location.href = 'index.html';
          });
        });
      }
    } else {
      el.innerHTML =
        '<a href="join.html">Join</a>' +
        '<a href="login.html">Log in</a>';
    }
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
    el.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }

  function disableForm(form, reason) {
    if (!form) return;
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.title = reason || 'Auth not configured';
    }
    form.querySelectorAll('input,button').forEach(function (n) {
      if (n.type !== 'submit') n.disabled = true;
    });
  }

  async function refreshSession() {
    var c = getClient();
    if (!c) {
      session = null;
      renderAuthNav();
      return null;
    }
    var res = await c.auth.getSession();
    session = (res && res.data && res.data.session) || null;
    renderAuthNav();
    return session;
  }

  async function signUp(email, password, displayName) {
    var c = getClient();
    if (!c) throw new Error('Supabase is not configured.');
    var res = await c.auth.signUp({
      email: email,
      password: password,
      options: {
        emailRedirectTo: emailRedirectTo,
        data: { display_name: displayName || '' }
      }
    });
    if (res.error) throw res.error;
    if (res.data && res.data.user) {
      try {
        await c.from('profiles').upsert({
          id: res.data.user.id,
          display_name: displayName || (email.split('@')[0]),
          updated_at: new Date().toISOString()
        });
      } catch (_) { /* RLS / missing table — schema.sql handles this */ }
    }
    return res.data;
  }

  async function signIn(email, password) {
    var c = getClient();
    if (!c) throw new Error('Supabase is not configured.');
    var res = await c.auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw res.error;
    session = res.data.session;
    renderAuthNav();
    return res.data;
  }

  async function signOut() {
    var c = getClient();
    if (c) await c.auth.signOut();
    session = null;
    renderAuthNav();
  }

  async function loadProfile() {
    var c = getClient();
    if (!c || !session || !session.user) return null;
    var res = await c.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  async function saveProfile(fields) {
    var c = getClient();
    if (!c || !session || !session.user) throw new Error('Not signed in');
    var payload = Object.assign({ id: session.user.id, updated_at: new Date().toISOString() }, fields);
    var res = await c.from('profiles').upsert(payload).select().maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  function wireJoin() {
    var form = $('join-form');
    if (!form) return;
    var banner = $('auth-config-banner');
    var msg = $('auth-form-msg');
    if (!configured) {
      if (banner) banner.innerHTML = setupHtml();
      disableForm(form, 'Add Supabase URL + anon key in js/supabase-config.js first');
      setMsg(msg, 'Submit disabled until Supabase is configured. See SETUP.md.', 'warn');
      return;
    }
    if (banner) banner.innerHTML = '';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('join-email') || {}).value || '';
      var password = ($('join-password') || {}).value || '';
      var name = ($('join-name') || {}).value || '';
      setMsg(msg, 'Creating account…', '');
      signUp(email.trim(), password, name.trim())
        .then(function (data) {
          if (data && data.session) {
            setMsg(msg, 'Welcome! Redirecting…', 'ok');
            window.location.href = 'account.html';
          } else {
            setMsg(msg, 'Check your email to confirm, then log in. If the link fails, ask the admin to disable email confirmation.', 'ok');
          }
        })
        .catch(function (err) {
          setMsg(msg, (err && err.message) || 'Sign up failed', 'err');
        });
    });
  }

  function wireLogin() {
    var form = $('login-form');
    if (!form) return;
    var banner = $('auth-config-banner');
    var msg = $('auth-form-msg');
    if (!configured) {
      if (banner) banner.innerHTML = setupHtml();
      disableForm(form, 'Add Supabase URL + anon key in js/supabase-config.js first');
      setMsg(msg, 'Submit disabled until Supabase is configured. See SETUP.md.', 'warn');
      return;
    }
    if (banner) banner.innerHTML = '';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = ($('login-email') || {}).value || '';
      var password = ($('login-password') || {}).value || '';
      setMsg(msg, 'Signing in…', '');
      signIn(email.trim(), password)
        .then(function () {
          setMsg(msg, 'Signed in. Redirecting…', 'ok');
          window.location.href = 'account.html';
        })
        .catch(function (err) {
          setMsg(msg, (err && err.message) || 'Sign in failed', 'err');
        });
    });
  }

  function wireAccount() {
    var panel = $('account-panel');
    if (!panel) return;
    var banner = $('auth-config-banner');
    var msg = $('auth-form-msg');
    var form = $('profile-form');

    if (!configured) {
      if (banner) banner.innerHTML = setupHtml();
      panel.innerHTML =
        '<p class="lead">Account pages activate after Supabase is configured. Members never get GitHub access — only their own profile row via RLS.</p>';
      return;
    }

    refreshSession().then(function (s) {
      if (!s || !s.user) {
        panel.innerHTML =
          '<p class="lead">You are not signed in.</p>' +
          '<p><a class="btn" href="login.html">Log in</a></p>';
        return;
      }
      var emailEl = $('acct-email');
      var nameEl = $('acct-name');
      if (emailEl) emailEl.textContent = s.user.email || '';
      loadProfile()
        .then(function (p) {
          if (nameEl && p && p.display_name) nameEl.value = p.display_name;
          else if (nameEl && s.user.user_metadata && s.user.user_metadata.display_name) {
            nameEl.value = s.user.user_metadata.display_name;
          }
        })
        .catch(function (err) {
          setMsg(msg, (err && err.message) || 'Could not load profile', 'err');
        });

      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var dn = (nameEl && nameEl.value) || '';
          setMsg(msg, 'Saving…', '');
          saveProfile({ display_name: dn.trim() })
            .then(function () { setMsg(msg, 'Profile saved.', 'ok'); })
            .catch(function (err) {
              setMsg(msg, (err && err.message) || 'Save failed', 'err');
            });
        });
      }
      var out = $('acct-signout');
      if (out) {
        out.addEventListener('click', function (e) {
          e.preventDefault();
          signOut().then(function () { window.location.href = 'index.html'; });
        });
      }
    });
  }

  function boot() {
    renderAuthNav();
    if (configured) {
      var c = getClient();
      if (c) {
        c.auth.onAuthStateChange(function (_event, s) {
          session = s;
          renderAuthNav();
        });
        refreshSession();
      }
    }
    wireJoin();
    wireLogin();
    wireAccount();
  }

  window.PackEVAuth = {
    isConfigured: isConfigured,
    getClient: getClient,
    getSession: function () { return session; },
    signOut: signOut,
    refreshSession: refreshSession,
    loadProfile: loadProfile
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
