---
name: log-workout
description: Log a day's workouts to this site's Workouts calendar. Use when the user says they worked out, or asks to log/add/record a workout, e.g. "log a run", "add today's workout", "I did a run and strength on Tuesday", "mark yesterday as rest". Defaults to the current system date when no date is given.
---

# Log a workout to the Workouts calendar

This site's Workouts page is `content/workouts/_index.md` (a `prose.html` page
that renders the `calendar` component in `templates/_components/calendar.html`)
backed by `content/workouts/workouts.toml`.

The user supplies a **date** (optional, defaults to today) and a **list of
workouts done** (optional, defaults to a rest day if they say they rested or
skipped).

## Data shape

`workouts.toml` has three parts, in this order:

```toml
[stats]            # the four numbers along the top of the calendar
[[type]]           # the category registry: one block per category
[[month]]          # one block per month, each followed by its [[month.day]] blocks
```

A logged day looks like:

```toml
[[month.day]]
date = "2026-09-18"
status = "done"
type = "run"                      # one category
type = ["run", "strength"]        # or several, the square splits between their colors
```

`status` is one of `"done"`, `"rest"`, `"missed"`, `"future"`. Only a `"done"`
day carries a `type`.

## Workflow

1. **Resolve the date.** If the user named one ("today", "yesterday",
   "Tuesday", "the 16th"), resolve it. Otherwise default to the current system
   date. Always get the real date from the system, never assume it:

   ```
   date +%Y-%m-%d
   ```

   Do not trust a date mentioned earlier in the conversation, the session may
   have been running a while.

2. **Map the workouts to category ids.** Read the active `[[type]]` blocks in
   `workouts.toml` and match what the user said against them. Match on intent,
   not exact strings: "ran 5k" or "jog" is `run`, "walked the dog" is `walk`,
   "intervals" or "circuit" is `hiit`, "lifted", "gym" or "strength training"
   is `strength`.

   If a category the user needs is present but **commented out**, uncomment
   that block rather than writing a new one. If it does not exist at all, add
   a new `[[type]]` block after the existing ones:

   ```toml
   [[type]]
   id = "yoga"
   label = "Yoga"
   color = "var(--callout-important-color)"
   ```

   Colors must be theme CSS variables so they track light and dark mode.
   `--callout-tip-color`, `--callout-warning-color`, `--callout-caution-color`
   and `--primary-color` are typically taken already, leaving
   `--callout-important-color` as the one unused theme color. If that is gone
   too, ask the user for a hex pair rather than reusing a color, two categories
   sharing a color makes the grid unreadable.

   A day whose `type` is not in the registry renders neutral gray with the raw
   id in the tooltip, so never write a `type` without its `[[type]]` block.

3. **Find or create the month block.** Day blocks live under a `[[month]]`
   block labelled like `"Sep 2026"` (`date +"%b %Y"`). If the target month has
   no block yet, add one after the last existing month's days.

4. **Insert the day in date order.** Day blocks render in file order, so they
   must stay sorted by date within their month. Insert the new block after the
   last day earlier than it, and **before the commented example blocks** at the
   bottom of the file. Leave those comments in place, they document the format.

   If a block for that date already exists, update it in place rather than
   adding a second one. Two blocks with the same date draw two squares.

5. **Fill any gap.** The grid draws one square per day block with no notion of
   calendar gaps, so a missing date silently collapses the calendar. If the new
   date is more than one day after the last logged date, fill every day in
   between with:

   ```toml
   [[month.day]]
   date = "..."
   status = "rest"
   ```

   Report which dates were filled so the user can flip any of them to
   `"missed"`. Crossing a month boundary means opening the next `[[month]]`
   block partway through the fill.

6. **Recompute `[stats]`.** Derive all four from the day blocks:

   - `completed`: total days with `status = "done"`.
   - `day_streak`: consecutive days back from the most recent logged day with
     no `"missed"` among them.
   - `longest_streak`: the longest such run anywhere in the file.
   - `week_streak`: consecutive weeks back from the most recent logged day's
     week that contain at least one `"done"` day.

   **Do not touch `scheduled_days`.** It is a goal the user sets by hand, not a
   derived number.

7. **Verify.** Run `zola build` from the project root and confirm it succeeds.
   The page may be a draft, check `draft` in `content/workouts/_index.md`, and
   if it is `true` build with `zola build --drafts` instead, otherwise the page
   is skipped and the build proves nothing. Confirm the new date appears in a
   `wc-day` title attribute:

   ```
   grep -o '<span class="wc-day[^>]*>' public/workouts/index.html
   ```

   A multi-category day should carry `type-multi` and an inline
   `linear-gradient`. Then `rm -rf public`, build output is not committed.

8. **Run the content check.** This repo's `CLAUDE.md` requires it after any
   edit under `content/`:

   ```
   grep -rn "—" content/
   ```

   It must come back empty.

9. **Report** the date logged, the categories recorded, any `[[type]]` block
   added or uncommented, any gap days filled with `rest`, and the new stat
   values.
