#!/usr/bin/env python3
"""
Backfill short Cardmarket avg anchors into public.card_price_history.

Cardmarket prices are EUR. To keep a coherent USD chart with catalog
snapshots we scale each avg by:

  scale = market_price_usd / averageSellPrice

Then map:
  avg30 → today-30, avg7 → today-7, avg1 → today-2
  (today-2 avoids colliding with recent catalog snapshots)

Skip thin-market outliers where the scaled point is outside 0.25x–4x of
catalog USD. Does not invent DEMO series.

Usage:
  export SUPABASE_URL=https://dubzutcfjezswyvfmizy.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=...
  python3 scripts/backfill-cm-history.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
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
    req.add_header("User-Agent", "PackEV-cm-history-backfill/1.0")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = resp.read().decode("utf-8").strip()
        if not raw:
            return None
        return json.loads(raw)


def fetch_cards(base: str, key: str) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    page_size = 1000
    start = 0
    while True:
        endpoint = (
            base.rstrip("/")
            + "/rest/v1/cards"
            + "?select=id,market_price_usd,cardmarket"
            + "&market_price_usd=not.is.null"
            + "&market_price_usd=gt.0"
            + "&order=id.asc"
        )
        headers = {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Range": f"{start}-{start + page_size - 1}",
        }
        rows = http_json(endpoint, headers=headers) or []
        if not isinstance(rows, list):
            rows = []
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        start += page_size
    return all_rows


def upsert(base: str, key: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    endpoint = base.rstrip("/") + "/rest/v1/card_price_history?on_conflict=card_id,day"
    body = json.dumps(rows).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Prefer": "resolution=ignore-duplicates,return=minimal",
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


def num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not (f > 0):
        return None
    return f


def build_rows(cards: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    day_map = {
        "avg30": (today - timedelta(days=30), "cardmarket_avg30"),
        "avg7": (today - timedelta(days=7), "cardmarket_avg7"),
        "avg1": (today - timedelta(days=2), "cardmarket_avg1"),
    }
    out: list[dict[str, Any]] = []
    for c in cards:
        usd = num(c.get("market_price_usd"))
        cm = c.get("cardmarket") or {}
        prices = cm.get("prices") if isinstance(cm, dict) else None
        if not usd or not isinstance(prices, dict):
            continue
        avg_sell = num(prices.get("averageSellPrice"))
        if not avg_sell:
            continue
        scale = usd / avg_sell
        for key, (day, source) in day_map.items():
            raw = num(prices.get(key))
            if not raw:
                continue
            scaled = round(raw * scale, 2)
            if not (scaled > 0):
                continue
            # Drop thin-market outliers vs catalog USD spot
            if scaled > usd * 4 or scaled < usd * 0.25:
                continue
            out.append(
                {
                    "card_id": c["id"],
                    "day": day.isoformat(),
                    "market_price_usd": scaled,
                    "source": source,
                }
            )
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill CM avg anchors → card_price_history")
    parser.add_argument(
        "--day",
        default=None,
        help="Anchor 'today' as YYYY-MM-DD (default: UTC today)",
    )
    args = parser.parse_args()
    supabase_url = env("SUPABASE_URL")
    service_key = env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        print(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — never commit).",
            file=sys.stderr,
        )
        return 1
    if args.day:
        today = date.fromisoformat(args.day)
    else:
        today = datetime.now(timezone.utc).date()

    print(f"Fetching cards for CM backfill (today={today.isoformat()})…", flush=True)
    cards = fetch_cards(supabase_url, service_key)
    print(f"  {len(cards)} priced cards", flush=True)
    rows = build_rows(cards, today)
    print(f"  {len(rows)} scaled CM anchor rows", flush=True)

    batch_size = 500
    upserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        upsert(supabase_url, service_key, batch)
        upserted += len(batch)
        if upserted % 5000 == 0 or upserted == len(rows):
            print(f"  upserted {upserted}…", flush=True)

    print(f"Done. Upserted {upserted} CM history anchors.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
