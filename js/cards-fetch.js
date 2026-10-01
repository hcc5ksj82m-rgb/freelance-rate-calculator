/* PackEV — card catalog: Supabase public.cards primary; Pokemon TCG API optional. */
(function (root) {
  'use strict';

  var API = 'https://api.pokemontcg.io/v2/cards';
  var SELECT = 'id,name,number,rarity,images,tcgplayer,cardmarket,set';
  /* Smaller than the old 100 — large pages often 5xx on pokemontcg.io */
  var PAGE_SIZE = 50;
  var MAX_ATTEMPTS = 2;
  var SEARCH_LIMIT = 24;

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
      market_price_usd: row.market_price_usd != null && row.market_price_usd !== ''
        ? Number(row.market_price_usd)
        : null,
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

  /** Sanitize user text for PostgREST ilike.*pattern* (strip LIKE / filter metachars). */
  function sanitizeSearchTerm(query) {
    return String(query || '')
      .trim()
      .replace(/[%_*\\]/g, ' ')
      .replace(/[,.()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
        await sleep(400 * Math.pow(2, attempt) + Math.random() * 150);
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
   * Search public.cards by name (ilike). Limit defaults to 24.
   * Does not dump the catalog — only runs when the caller passes a query.
   * Returns { cards, source: 'db' }. Throws on config/HTTP failure.
   */
  async function searchByName(query, limit) {
    var base = supabaseUrl();
    var key = supabaseKey();
    var lim = Math.min(Math.max(Number(limit) || SEARCH_LIMIT, 1), 48);
    var term = sanitizeSearchTerm(query);
    if (term.length < 2) {
      return { cards: [], source: 'db' };
    }
    if (!base || !key) {
      var cfgErr = new Error('Catalog unavailable');
      cfgErr.retryable = false;
      throw cfgErr;
    }

    var select = [
      'id', 'name', 'set_id', 'set_name', 'set_series', 'number', 'rarity',
      'image_small', 'image_large', 'tcgplayer', 'cardmarket', 'market_price_usd'
    ].join(',');
    var pattern = '*' + term + '*';
    var endpoint = base + '/rest/v1/cards'
      + '?name=ilike.' + encodeURIComponent(pattern)
      + '&select=' + select
      + '&order=market_price_usd.desc.nullslast'
      + '&limit=' + lim;

    var res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: 'Bearer ' + key
      }
    });
    if (!res.ok) {
      var err = new Error('Catalog ' + res.status);
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    var rows = await res.json();
    if (!Array.isArray(rows)) rows = [];
    var cards = [];
    for (var i = 0; i < rows.length; i++) cards.push(dbRowToCard(rows[i]));
    return { cards: cards, source: 'db' };
  }

  /**
   * Optional: fetch one card from the live Pokemon TCG API (for fresher prices after pick).
   * Returns null on failure — never blocks search UX.
   */
  async function fetchLiveCardById(cardId) {
    if (!cardId) return null;
    try {
      var url = API + '/' + encodeURIComponent(cardId) + '?select=' + SELECT;
      var res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      var json = await res.json();
      return json.data || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Load every card for a set.
   * 1) Supabase public.cards for set_id (fast, reliable)
   * 2) If catalog empty → Pokemon TCG API with short retries
   *
   * Returns { cards, source: 'db'|'api'|'api-partial', warning? }
   * Throws only when neither catalog nor API can supply cards.
   */
  async function fetchAllForSet(setId, onProgress) {
    if (onProgress) onProgress(0, Infinity, 'db');

    var dbCards = [];
    var dbError = null;
    try {
      dbCards = await fetchCardsFromDb(setId);
    } catch (dbErr) {
      dbError = dbErr;
    }
    if (dbCards.length) {
      return { cards: dbCards, source: 'db' };
    }

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
      return {
        cards: cards,
        source: 'api',
        warning: dbError ? dbError.message : (dbCards.length === 0 ? 'Catalog empty for this set' : null)
      };
    } catch (e) {
      apiError = e;
    }

    if (cards.length) {
      return {
        cards: cards,
        source: 'api-partial',
        warning: (apiError && apiError.message) || 'API stopped mid-load'
      };
    }

    var msg = 'Could not load this set';
    if (dbError) msg += ' (catalog ' + dbError.message + ')';
    else msg += ' (catalog empty)';
    if (apiError) msg += ' · live API unavailable';
    var finalErr = new Error(msg);
    finalErr.apiError = apiError;
    finalErr.dbError = dbError;
    throw finalErr;
  }

  root.PackEVCards = {
    PAGE_SIZE: PAGE_SIZE,
    SEARCH_LIMIT: SEARCH_LIMIT,
    fetchAllForSet: fetchAllForSet,
    fetchCardsFromDb: fetchCardsFromDb,
    searchByName: searchByName,
    fetchLiveCardById: fetchLiveCardById,
    dbRowToCard: dbRowToCard,
    sanitizeSearchTerm: sanitizeSearchTerm
  };
})(window);
