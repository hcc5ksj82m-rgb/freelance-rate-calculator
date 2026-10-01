/* PackEV — load cards for a set: Pokemon TCG API first, Supabase catalog fallback. */
(function (root) {
  'use strict';

  var API = 'https://api.pokemontcg.io/v2/cards';
  var SELECT = 'id,name,number,rarity,images,tcgplayer,cardmarket,set';
  /* Smaller than the old 100 — large pages often 5xx on pokemontcg.io */
  var PAGE_SIZE = 50;
  var MAX_ATTEMPTS = 5;

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function cfg() {
    return root.PACK_EV_SUPABASE || {};
  }

  function supabaseUrl() {
    return String(cfg().SUPABASE_URL || '').trim().replace(/\/$/, '');
  }

  function supabaseKey() {
    var c = cfg();
    return String(c.SUPABASE_ANON_KEY || c.SUPABASE_PUBLISHABLE_KEY || '').trim();
  }

  function dbRowToCard(row) {
    return {
      id: row.id,
      name: row.name,
      number: row.number || '',
      rarity: row.rarity || '',
      images: {
        small: row.image_small || '',
        large: row.image_large || ''
      },
      tcgplayer: row.tcgplayer || null,
      cardmarket: row.cardmarket || null,
      set: {
        id: row.set_id || '',
        name: row.set_name || '',
        series: row.set_series || ''
      },
      _source: 'db'
    };
  }

  function sortByNumber(cards) {
    return cards.slice().sort(function (a, b) {
      return String(a.number || '').localeCompare(String(b.number || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });
  }

  async function fetchCardsPage(setId, page, pageSize) {
    var size = pageSize || PAGE_SIZE;
    var url = API
      + '?q=set.id:' + encodeURIComponent(setId)
      + '&page=' + page
      + '&pageSize=' + size
      + '&orderBy=number'
      + '&select=' + SELECT;
    var res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      var err = new Error('API ' + res.status + (res.status === 429 ? ' (rate limited)' : ' (server error)'));
      err.retryable = true;
      err.status = res.status;
      throw err;
    }
    if (!res.ok) {
      var err2 = new Error('API ' + res.status);
      err2.retryable = false;
      err2.status = res.status;
      throw err2;
    }
    return res.json();
  }

  async function fetchCardsPageWithRetry(setId, page, pageSize) {
    var lastErr;
    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fetchCardsPage(setId, page, pageSize);
      } catch (e) {
        lastErr = e;
        if (!e.retryable && attempt === 0 && (!e.message || e.message.indexOf('API') !== 0)) {
          /* network — retry */
        } else if (!e.retryable) {
          throw e;
        }
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 200);
      }
    }
    throw lastErr;
  }

  /**
   * Fetch all cards for a set from public.cards via PostgREST (anon key).
   * Returns [] if config missing or no rows. Throws on HTTP errors.
   */
  async function fetchCardsFromDb(setId) {
    var base = supabaseUrl();
    var key = supabaseKey();
    if (!base || !key) return [];

    var all = [];
    var from = 0;
    var pageSize = 1000;
    var select = [
      'id', 'name', 'set_id', 'set_name', 'set_series', 'number', 'rarity',
      'image_small', 'image_large', 'tcgplayer', 'cardmarket', 'market_price_usd'
    ].join(',');

    while (true) {
      var endpoint = base + '/rest/v1/cards'
        + '?set_id=eq.' + encodeURIComponent(setId)
        + '&select=' + select
        + '&order=number.asc';
      var res = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
          apikey: key,
          Authorization: 'Bearer ' + key,
          Range: from + '-' + (from + pageSize - 1),
          Prefer: 'count=exact'
        }
      });
      if (!res.ok) {
        var err = new Error('DB ' + res.status);
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      var rows = await res.json();
      if (!Array.isArray(rows)) rows = [];
      for (var i = 0; i < rows.length; i++) all.push(dbRowToCard(rows[i]));
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return sortByNumber(all);
  }

  /**
   * Load every card for a set.
   * 1) Pokemon TCG API with retries/backoff + pageSize 50
   * 2) On persistent failure → Supabase public.cards for set_id
   * 3) Mid-pagination API failure: prefer DB if it has rows; else keep partial API
   *
   * Returns { cards, source: 'api'|'db'|'api-partial', warning? }
   * Throws only when neither API nor DB can supply cards.
   */
  async function fetchAllForSet(setId, onProgress) {
    var page = 1;
    var total = Infinity;
    var cards = [];
    var apiError = null;
    var pageSize = PAGE_SIZE;

    try {
      while (cards.length < total) {
        if (onProgress) onProgress(cards.length, total, 'api');
        var json = await fetchCardsPageWithRetry(setId, page, pageSize);
        var chunk = json.data || [];
        total = json.totalCount != null ? json.totalCount : (cards.length + chunk.length);
        cards = cards.concat(chunk);
        if (!chunk.length) break;
        page++;
        if (cards.length < total) await sleep(250);
      }
      return { cards: cards, source: 'api' };
    } catch (e) {
      apiError = e;
    }

    if (onProgress) onProgress(cards.length, total, 'db');

    var dbCards = [];
    var dbError = null;
    try {
      dbCards = await fetchCardsFromDb(setId);
    } catch (dbErr) {
      dbError = dbErr;
    }

    /* Prefer DB whenever it has rows and the API failed (incl. mid-pagination) */
    if (dbCards.length) {
      return {
        cards: dbCards,
        source: 'db',
        warning: apiError ? apiError.message : null
      };
    }

    /* DB empty / unavailable — keep any partial API pages rather than stuck empty */
    if (cards.length) {
      return {
        cards: cards,
        source: 'api-partial',
        warning: (apiError && apiError.message) || 'API stopped mid-load'
      };
    }

    var msg = (apiError && apiError.message) || 'Unknown API error';
    if (dbError) msg += '; catalog ' + dbError.message;
    else msg += '; catalog empty for this set';
    var finalErr = new Error(msg);
    finalErr.apiError = apiError;
    finalErr.dbError = dbError;
    throw finalErr;
  }

  root.PackEVCards = {
    PAGE_SIZE: PAGE_SIZE,
    fetchAllForSet: fetchAllForSet,
    fetchCardsFromDb: fetchCardsFromDb,
    dbRowToCard: dbRowToCard
  };
})(window);
