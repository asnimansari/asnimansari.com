#!/usr/bin/env python3
"""Sync Strava activities into content/workouts/workouts.toml.

Usage:
    python3 scripts/fetch_strava_workouts.py
        No arguments: fetch the athlete's entire activity history.

    python3 scripts/fetch_strava_workouts.py 2026-06-01 2026-09-01
        Fetch only activities with a local start date in [start, end]
        (inclusive) and merge them into the existing data.

    python3 scripts/fetch_strava_workouts.py --dry-run [start end]
        Fetch and report what would change, without writing any files.

    python3 scripts/fetch_strava_workouts.py --exchange AUTH_CODE
        One-time helper: turn a fresh OAuth authorization code into a
        refresh token (see setup below), then exit.

Every run always re-renders content/workouts/workouts.toml from the full,
accumulated local cache (see "How duplicates are avoided" below) -- the
start/end arguments only limit what gets *fetched* from Strava in that
run, not what ends up in the rendered calendar.

Setup (one-time)
----------------
1. Create a Strava API application: https://www.strava.com/settings/api
2. Authorize it for read access to your activities by visiting (with your
   own client_id):
     https://www.strava.com/oauth/authorize?client_id=YOUR_ID&redirect_uri=http://localhost&response_type=code&scope=activity:read_all
   Approve it, then copy the `code` query parameter from the localhost
   redirect it bounces you to.
3. Exchange that code for a refresh token:
     python3 scripts/fetch_strava_workouts.py --exchange PASTE_CODE_HERE
4. Put the three credentials in a `.env` file at the repo root (already
   gitignored, never commit it):
     STRAVA_CLIENT_ID=...
     STRAVA_CLIENT_SECRET=...
     STRAVA_REFRESH_TOKEN=...

No third-party dependencies are required (Python 3.9+, stdlib only).

How duplicates are avoided
---------------------------
Every fetched activity is upserted into a local cache file,
`.strava_cache.json` at the repo root, keyed by its unique Strava
activity id. Re-fetching an overlapping or repeated date range just
overwrites the same cache entries in place, it can never produce two
entries for the same activity. `workouts.toml` itself is never hand
merged: it is fully regenerated from the cache on every run, so it can
never accumulate duplicate day blocks either. The cache is local-only
(gitignored) since it stores activity names; only the derived
date/status/type calendar in workouts.toml is committed.

Classifying activities
-----------------------
Each day on the calendar can only show one workout type, so when
multiple activities land on the same day, "strength" wins over "cardio"
(see build_day_types). Tune STRENGTH_SPORT_TYPES below if your Strava
usage doesn't match these defaults; everything not listed there falls
back to "cardio" (runs, rides, swims, HIIT, walks, hikes, etc).
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
from datetime import date, datetime, time as dt_time, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKOUTS_DIR = REPO_ROOT / "content" / "workouts"
TOML_PATH = WORKOUTS_DIR / "workouts.toml"
CACHE_PATH = REPO_ROOT / ".strava_cache.json"
ENV_PATH = REPO_ROOT / ".env"

TOKEN_URL = "https://www.strava.com/oauth/token"
ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
PER_PAGE = 200

# Strava sport_type values treated as "strength"; everything else is "cardio".
STRENGTH_SPORT_TYPES = {"WeightTraining", "Crossfit", "Workout"}

MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_credentials(require_refresh_token: bool = True) -> tuple[str, str, str | None]:
    load_dotenv(ENV_PATH)
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")

    missing = [name for name, value in [
        ("STRAVA_CLIENT_ID", client_id),
        ("STRAVA_CLIENT_SECRET", client_secret),
    ] if not value]
    if require_refresh_token and not refresh_token:
        missing.append("STRAVA_REFRESH_TOKEN")
    if missing:
        sys.exit(
            "Missing required credential(s): " + ", ".join(missing) +
            "\nSee the setup instructions in this script's module docstring."
        )
    return client_id, client_secret, refresh_token


def post_form(url: str, fields: dict) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"Strava token request failed ({e.code}): {e.read().decode()}")


def exchange_code(client_id: str, client_secret: str, code: str) -> None:
    payload = post_form(TOKEN_URL, {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "authorization_code",
        "code": code,
    })
    print("Success. Add this to your .env file:")
    print(f"STRAVA_REFRESH_TOKEN={payload['refresh_token']}")


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    payload = post_form(TOKEN_URL, {
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    })
    return payload["access_token"]


def api_get(url: str, params: dict, access_token: str, max_retries: int = 5) -> list:
    query = urllib.parse.urlencode(params)
    full_url = f"{url}?{query}"
    for attempt in range(max_retries):
        req = urllib.request.Request(full_url, headers={"Authorization": f"Bearer {access_token}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                wait = int(e.headers.get("Retry-After", 30))
                print(f"Rate limited by Strava, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                continue
            sys.exit(f"Strava API error {e.code}: {e.read().decode()}")
    sys.exit("Exceeded retries against the Strava API.")


def fetch_activities(access_token: str, after_epoch: int | None, before_epoch: int | None) -> list:
    activities = []
    page = 1
    while True:
        params = {"per_page": PER_PAGE, "page": page}
        if after_epoch is not None:
            params["after"] = after_epoch
        if before_epoch is not None:
            params["before"] = before_epoch
        batch = api_get(ACTIVITIES_URL, params, access_token)
        if not batch:
            break
        activities.extend(batch)
        if len(batch) < PER_PAGE:
            break
        page += 1
    return activities


def load_cache() -> dict:
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text())


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")


def merge_activities(cache: dict, activities: list) -> tuple[int, int]:
    added = updated = 0
    for act in activities:
        act_id = str(act["id"])
        entry = {
            "date": act["start_date_local"][:10],
            "sport_type": act.get("sport_type") or act.get("type") or "Workout",
            "name": act.get("name", ""),
        }
        if act_id not in cache:
            added += 1
        elif cache[act_id] != entry:
            updated += 1
        cache[act_id] = entry
    return added, updated


def classify(sport_type: str) -> str:
    return "strength" if sport_type in STRENGTH_SPORT_TYPES else "cardio"


def build_day_types(cache: dict) -> dict[str, str]:
    by_date: dict[str, list[str]] = {}
    for entry in cache.values():
        by_date.setdefault(entry["date"], []).append(classify(entry["sport_type"]))
    return {
        day: ("strength" if "strength" in kinds else "cardio")
        for day, kinds in by_date.items()
    }


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def compute_stats(days: list[date], day_type: dict[str, str], today: date) -> dict:
    is_done = {d: (d.isoformat() in day_type) for d in days}

    completed = sum(1 for d in days if is_done[d])
    scheduled_days = len(days)

    longest_streak = 0
    run = 0
    for d in days:
        if is_done[d]:
            run += 1
            longest_streak = max(longest_streak, run)
        else:
            run = 0

    cursor = today
    if cursor in is_done and not is_done[cursor]:
        cursor -= timedelta(days=1)  # don't penalize "today" not logged yet
    day_streak = 0
    while cursor in is_done and is_done[cursor]:
        day_streak += 1
        cursor -= timedelta(days=1)

    weeks_order: list[tuple[int, int]] = []
    weeks_seen: set[tuple[int, int]] = set()
    week_has_workout: dict[tuple[int, int], bool] = {}
    for d in days:
        key = d.isocalendar()[:2]
        if key not in weeks_seen:
            weeks_seen.add(key)
            weeks_order.append(key)
            week_has_workout[key] = False
        if is_done[d]:
            week_has_workout[key] = True
    week_streak = 0
    for key in reversed(weeks_order):
        if not week_has_workout[key]:
            break
        week_streak += 1

    return {
        "day_streak": day_streak,
        "week_streak": week_streak,
        "longest_streak": longest_streak,
        "completed": completed,
        "scheduled_days": scheduled_days,
    }


def render_toml(day_type: dict[str, str], today: date) -> str:
    if day_type:
        start = min(date.fromisoformat(d) for d in day_type)
    else:
        start = today
    days = list(daterange(start, today))

    stats = compute_stats(days, day_type, today)

    lines = ["[stats]"]
    for key in ("day_streak", "week_streak", "longest_streak", "completed", "scheduled_days"):
        lines.append(f"{key} = {stats[key]}")
    lines.append("")

    current_key = None
    for d in days:
        key = (d.year, d.month)
        if key != current_key:
            current_key = key
            lines.append("[[month]]")
            lines.append(f'label = "{MONTH_NAMES[d.month - 1]} {d.year}"')
        iso = d.isoformat()
        lines.append("[[month.day]]")
        lines.append(f'date = "{iso}"')
        kind = day_type.get(iso)
        lines.append(f'status = "{"done" if kind else "rest"}"')
        if kind:
            lines.append(f'type = "{kind}"')

    return "\n".join(lines) + "\n"


def parse_date_arg(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"Invalid date '{value}', expected YYYY-MM-DD")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("start", nargs="?", help="Start date YYYY-MM-DD (inclusive). Omit both dates for full history.")
    parser.add_argument("end", nargs="?", help="End date YYYY-MM-DD (inclusive).")
    parser.add_argument("--exchange", metavar="CODE", help="Exchange a fresh OAuth authorization code for a refresh token, then exit.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and report changes without writing the cache or workouts.toml.")
    args = parser.parse_args()

    if args.exchange:
        client_id, client_secret, _ = get_credentials(require_refresh_token=False)
        exchange_code(client_id, client_secret, args.exchange)
        return

    if bool(args.start) != bool(args.end):
        parser.error("start and end must both be given (or neither, for full history)")

    after_epoch = before_epoch = None
    if args.start:
        start_date = parse_date_arg(args.start)
        end_date = parse_date_arg(args.end)
        if end_date < start_date:
            parser.error("end date must not be before start date")
        after_epoch = int(datetime.combine(start_date, dt_time.min).timestamp()) - 1
        before_epoch = int(datetime.combine(end_date + timedelta(days=1), dt_time.min).timestamp())

    client_id, client_secret, refresh_token = get_credentials()
    access_token = refresh_access_token(client_id, client_secret, refresh_token)

    print("Fetching activities from Strava..." if after_epoch is None
          else f"Fetching activities from {args.start} to {args.end}...")
    activities = fetch_activities(access_token, after_epoch, before_epoch)
    print(f"Fetched {len(activities)} activities.")

    cache = load_cache()
    added, updated = merge_activities(cache, activities)
    print(f"Cache: {added} new, {updated} updated, {len(cache)} total activities.")

    day_type = build_day_types(cache)
    today = date.today()
    toml_text = render_toml(day_type, today)

    if args.dry_run:
        print(f"[dry-run] Would write {len(day_type)} active days to {TOML_PATH}")
        return

    WORKOUTS_DIR.mkdir(parents=True, exist_ok=True)
    save_cache(cache)
    TOML_PATH.write_text(toml_text)
    print(f"Wrote {TOML_PATH}")


if __name__ == "__main__":
    main()
