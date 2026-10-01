#!/usr/bin/env python3
"""
Sync all Pokemon TCG cards from api.pokemontcg.io into Supabase public.cards.

Usage:
  export SUPABASE_URL=https://dubzutcfjezswyvfmizy.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...   # never commit; bypasses RLS for upserts
  # optional:
  export POKEMONTCG_API_KEY=...         # higher rate limits if you have one
  python3 scripts/sync-pokemon-cards.py
  python3 scripts/sync-pokemon-cards.py --resume   # continue from progress file
  python3 scripts/sync-pokemon-cards.py --sets-only
  python3 scripts/sync-pokemon-cards.py --max-pages 5   # smoke test

Respects 429/5xx with exponential backoff. Progress saved to
  scripts/.sync-cards-progress.json
so you can stop and resume without re-fetching completed set pages.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API = "https://api.pokemontcg.io/v2"
SELECT = "id,name,number,rarity,images,tcgplayer,cardmarket,set"
PROGRESS = Path(__file__).resolve().parent / ".sync-cards-progress.json"
PAGE_SIZE = 250
UPSERT_BATCH = 100


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) and v.strip() else default


def http_json(url: str, headers: dict[str, str] | None = None, method: str = "GET", body: bytes | None = None) -> Any:
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_with_backoff(url: str, api_key: str | None, max_attempts: int = 8) -> Any:
    headers = {}
    if api_key:
        headers["X-Api-Key"] = api_key
    last: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return http_json(url, headers=headers)
        except urllib.error.HTTPError as e:
            last = e
            retryable = e.code == 429 or e.code >= 500
            if not retryable:
                raise
            wait = min(120.0, (2 ** attempt) * 0.8 + (0.1 * attempt))
            print(f"  HTTP {e.code} — backoff {wait:.1f}s (attempt {attempt + 1}/{max_attempts})", flush=True)
            time.sleep(wait)
        except Exception as e:  # network
            last = e
            wait = min(60.0, (2 ** attempt) * 0.5)
            print(f"  network {e} — backoff {wait:.1f}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"Failed after retries: {url}") from last


def load_progress() -> dict[str, Any]:
    if PROGRESS.exists():
        return json.loads(PROGRESS.read_text())
    return {"completed_sets": [], "partial": {}}


def save_progress(p: dict[str, Any]) -> None:
    PROGRESS.write_text(json.dumps(p, indent=2))


def market_usd(card: dict[str, Any]) -> float | None:
    t = (card.get("tcgplayer") or {}).get("prices") or {}
    order = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "1stEditionNormal"]
    keys = order + [k for k in t.keys() if k not in order]
    for k in keys:
        block = t.get(k) or {}
        val = block.get("market")
        if val is None:
            val = block.get("mid")
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                pass
    cm = (card.get("cardmarket") or {}).get("prices") or {}
    val = cm.get("averageSellPrice")
    if val is None:
        val = cm.get("trendPrice")
    if val is not None:
        try:
            return float(val)
        except (TypeError, ValueError):
            pass
    return None


def row_from_card(card: dict[str, Any]) -> dict[str, Any]:
    s = card.get("set") or {}
    return {
        "id": card["id"],
        "name": card.get("name") or "",
        "set_id": s.get("id"),
        "set_name": s.get("name"),
        "number": card.get("number"),
        "rarity": card.get("rarity"),
        "images": card.get("images"),
        "tcgplayer": card.get("tcgplayer"),
        "cardmarket": card.get("cardmarket"),
        "market_price_usd": market_usd(card),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def supabase_upsert(url: str, service_key: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    endpoint = url.rstrip("/") + "/rest/v1/cards?on_conflict=id"
    body = json.dumps(rows).encode("utf-8")
    headers = {
        "apikey": service_key,
        "Authorization": "Bearer " + service_key,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # small retry for upsert
    for attempt in range(5):
        try:
            http_json(endpoint, headers=headers, method="POST", body=body)
            return
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            detail = e.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(f"Supabase upsert HTTP {e.code}: {detail}") from e


def list_sets(api_key: str | None) -> list[dict[str, Any]]:
    sets: list[dict[str, Any]] = []
    page = 1
    while True:
        q = urllib.parse.urlencode({"page": page, "pageSize": 250, "orderBy": "releaseDate"})
        data = fetch_with_backoff(f"{API}/sets?{q}", api_key)
        chunk = data.get("data") or []
        sets.extend(chunk)
        total = data.get("totalCount") or len(sets)
        print(f"sets page {page}: +{len(chunk)} (have {len(sets)} / {total})", flush=True)
        if len(sets) >= total or not chunk:
            break
        page += 1
        time.sleep(0.25)
    return sets


def sync_set_cards(
    set_id: str,
    api_key: str | None,
    supabase_url: str,
    service_key: str,
    progress: dict[str, Any],
    max_pages: int | None,
) -> int:
    partial = progress.setdefault("partial", {})
    start_page = int(partial.get(set_id, 1))
    page = start_page
    upserted = 0
    pages_done = 0
    while True:
        if max_pages is not None and pages_done >= max_pages:
            print(f"  stop early (--max-pages) at page {page}", flush=True)
            break
        params = urllib.parse.urlencode(
            {
                "q": f"set.id:{set_id}",
                "page": page,
                "pageSize": PAGE_SIZE,
                "orderBy": "number",
                "select": SELECT,
            }
        )
        data = fetch_with_backoff(f"{API}/cards?{params}", api_key)
        chunk = data.get("data") or []
        total = data.get("totalCount")
        rows = [row_from_card(c) for c in chunk]
        for i in range(0, len(rows), UPSERT_BATCH):
            supabase_upsert(supabase_url, service_key, rows[i : i + UPSERT_BATCH])
        upserted += len(rows)
        pages_done += 1
        print(
            f"  {set_id} page {page}: +{len(rows)} upserted (set total~{total})",
            flush=True,
        )
        partial[set_id] = page + 1
        save_progress(progress)
        if not chunk or (total is not None and (page * PAGE_SIZE) >= total):
            break
        page += 1
        time.sleep(0.35)
    return upserted


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Pokemon TCG cards → Supabase public.cards")
    parser.add_argument("--resume", action="store_true", help="Skip sets listed in progress file")
    parser.add_argument("--sets-only", action="store_true", help="List sets and exit (no card upserts)")
    parser.add_argument("--max-pages", type=int, default=None, help="Max pages per set (smoke test)")
    parser.add_argument("--set", dest="only_set", default=None, help="Sync a single set id")
    args = parser.parse_args()

    supabase_url = env("SUPABASE_URL")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    api_key = env("POKEMONTCG_API_KEY")

    if not args.sets_only and (not supabase_url or not service_key):
        print(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — never commit).",
            file=sys.stderr,
        )
        return 1

    print("Fetching set list…", flush=True)
    sets = list_sets(api_key)
    print(f"{len(sets)} sets", flush=True)
    if args.sets_only:
        for s in sets[:5]:
            print(f"  sample {s.get('id')} {s.get('name')}")
        return 0

    progress = load_progress() if args.resume else {"completed_sets": [], "partial": {}}
    done = set(progress.get("completed_sets") or [])

    targets = sets
    if args.only_set:
        targets = [s for s in sets if s.get("id") == args.only_set]
        if not targets:
            targets = [{"id": args.only_set, "name": args.only_set}]

    total_upserted = 0
    for s in targets:
        sid = s["id"]
        if sid in done:
            print(f"skip {sid} (already completed)", flush=True)
            continue
        print(f"sync set {sid} — {s.get('name')}", flush=True)
        try:
            n = sync_set_cards(sid, api_key, supabase_url, service_key, progress, args.max_pages)
            total_upserted += n
            if args.max_pages is None:
                done.add(sid)
                progress["completed_sets"] = sorted(done)
                progress.get("partial", {}).pop(sid, None)
                save_progress(progress)
        except Exception as e:
            print(f"ERROR on {sid}: {e}", file=sys.stderr)
            save_progress(progress)
            print("Progress saved — re-run with --resume", flush=True)
            return 2
        time.sleep(0.5)

    print(f"Done. Upserted ~{total_upserted} card rows this run.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
