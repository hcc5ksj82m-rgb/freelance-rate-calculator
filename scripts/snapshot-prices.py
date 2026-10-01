#!/usr/bin/env python3
"""
Snapshot public.cards.market_price_usd → public.card_price_history for today.

$0 history growth for PackEV charts. Intended for the PackEV daily upgrade
routine (run after catalog sync, or standalone).

Usage:
  export SUPABASE_URL=https://dubzutcfjezswyvfmizy.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...   # never commit
  python3 scripts/snapshot-prices.py
  python3 scripts/snapshot-prices.py --day 2026-10-01

Idempotent: upserts on (card_id, day).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from typing import Any


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    return v.strip() if isinstance(v, str) and v.strip() else default


def http_json(
    url: str,
    headers: dict[str, str] | None = None,
    method: str = "GET",
    body: bytes | None = None,
) -> Any:
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "PackEV-price-snapshot/1.0")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8").strip()
        if not raw:
            return None
        return json.loads(raw)


def fetch_priced_cards(base: str, key: str) -> list[dict[str, Any]]:
    """Page through cards that have a market_price_usd."""
    all_rows: list[dict[str, Any]] = []
    page_size = 1000
    start = 0
    while True:
        endpoint = (
            base.rstrip("/")
            + "/rest/v1/cards"
            + "?select=id,market_price_usd"
            + "&market_price_usd=not.is.null"
            + "&market_price_usd=gt.0"
            + "&order=id.asc"
        )
        headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Range": f"{start}-{start + page_size - 1}",
            "Prefer": "count=exact",
        }
        req = urllib.request.Request(endpoint, method="GET")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "PackEV-price-snapshot/1.0")
        for k, v in headers.items():
            req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=120) as resp:
            rows = json.loads(resp.read().decode("utf-8") or "[]")
        if not isinstance(rows, list):
            rows = []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size
    return all_rows


def upsert_history(base: str, key: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    endpoint = base.rstrip("/") + "/rest/v1/card_price_history?on_conflict=card_id,day"
    body = json.dumps(rows).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    for attempt in range(5):
        try:
            http_json(endpoint, headers=headers, method="POST", body=body)
            return
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                import time

                time.sleep(2**attempt)
                continue
            detail = e.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(f"History upsert HTTP {e.code}: {detail}") from e


def snapshot(day: str, source: str = "catalog") -> int:
    supabase_url = env("SUPABASE_URL")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — never commit).",
            file=sys.stderr,
        )
        return 1

    print(f"Fetching priced cards for snapshot day={day}…", flush=True)
    cards = fetch_priced_cards(supabase_url, service_key)
    print(f"  {len(cards)} cards with market_price_usd", flush=True)

    batch: list[dict[str, Any]] = []
    upserted = 0
    batch_size = 500
    for c in cards:
        price = c.get("market_price_usd")
        try:
            price_f = float(price)
        except (TypeError, ValueError):
            continue
        if not (price_f > 0):
            continue
        batch.append(
            {
                "card_id": c["id"],
                "day": day,
                "market_price_usd": price_f,
                "source": source,
            }
        )
        if len(batch) >= batch_size:
            upsert_history(supabase_url, service_key, batch)
            upserted += len(batch)
            print(f"  upserted {upserted}…", flush=True)
            batch = []
    if batch:
        upsert_history(supabase_url, service_key, batch)
        upserted += len(batch)

    print(f"Done. Upserted {upserted} history rows for {day} (source={source}).", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot card prices → card_price_history")
    parser.add_argument(
        "--day",
        default=None,
        help="YYYY-MM-DD (default: today UTC)",
    )
    parser.add_argument(
        "--source",
        default="catalog",
        help="source label stored on rows (default: catalog)",
    )
    args = parser.parse_args()
    day = args.day or datetime.now(timezone.utc).date().isoformat()
    # validate
    try:
        date.fromisoformat(day)
    except ValueError:
        print(f"Invalid --day {day!r}", file=sys.stderr)
        return 1
    return snapshot(day, source=args.source)


if __name__ == "__main__":
    raise SystemExit(main())
