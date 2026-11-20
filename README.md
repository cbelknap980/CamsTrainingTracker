# Cam's Training Tracker

A phone web app that plays Cameron's 12-week training plan. Tap Start, and it walks through every warm-up, set, rest, superset, finisher round and stretch on a timer, logs each set with one tap, and sets next session's weights automatically from the plan's progression rules.

Plain HTML, CSS and JavaScript modules. No framework, no build step, no server. Works offline once opened. Data stays on the phone (IndexedDB) and in Cameron's own Drive backups; nothing personal is in this repo.

## Run it locally

From this folder:

```
python -m http.server 8080
```

Then open http://localhost:8080. (Any static server works. Service workers need localhost or HTTPS.)

Tests for the Session Builder and Progression Engine:

```
node tests/run-tests.mjs
```

Phone-sized browser checks (Playwright; each serves the repo on its own port): `tests/browser-test.py`, `sync-test.py`, `catchup-test.py`, `runs-test.py`, `feel-test.py`, `bugfix-test.py`.

## Install on the phone

1. Open the GitHub Pages URL in Chrome on Android.
2. Menu (three dots) > Add to Home screen (or "Install app").
3. Open it from the home screen once while online so the service worker caches everything. After that it works with no signal.

## What's where

| Path | What |
| --- | --- |
| `index.html` | App shell, four tabs: Home, History, Runs, Architecture |
| `css/app.css` | Styles, phone-first |
| `js/app.js` | Boot, tabs, Home, History, Runs, Settings, start/resume/summary flow |
| `js/builder.js` | Session Builder: plan session to a timeline of timed steps; trim to fit |
| `js/player.js` | Player: timestamp timers, cues, wake lock, session clock, pause/skip/back |
| `js/logger.js` | Saves the session record, runs progression, renders the summary; run log form |
| `js/progression.js` | Progression Engine: rules applied after each session, e1RM, what-changed |
| `js/sanity.js` | v1.16: flags numbers that look wrong (under the bar, far off the target, odd reps) and fixes a saved session's weights, recomputing target, records and what-changed |
| `js/store.js` | IndexedDB wrapper, settings, backup and restore |
| `js/export.js` | Backup JSON (share sheet or download), Excel export |
| `js/architecture.js` | Architecture tab: diagram drawn from `data/architecture.json`, searchable |
| `js/data.js`, `js/ui.js` | Data loading and small helpers; since v1.14 `ui.js` also holds the feel helpers (tap buzz, Undo toasts, (i) sheets, view transitions, the Android Back gesture, swipe to delete, status bar color) |
| `js/rings.js` | v1.14: the week's rings on Home and Session done (lifts, runs, hard efforts) |
| `js/share-card.js` | v1.14: Session done drawn as a 1080 x 1350 image for Save image |
| `data/plan.json` | The plan as data: sessions, blocks, exercises, calendar, phases, stretch block |
| `data/rules.json` | Progression, phase overrides, ramp-up, trim order, timing estimates |
| `data/settings.json` | Default settings (overridden in the app's Settings screen) |
| `data/architecture.json` | Parts and flows for the Architecture tab |
| `sw.js` | Service worker, versioned cache |
| `vendor/xlsx.mini.min.js` | SheetJS (community edition) for the Excel export |
| `CHANGELOG.md` | One line per labeled publish |

## Changing the plan or the rules

Edit `data/plan.json` or `data/rules.json`, bump `VERSION` in `sw.js`, add a line to `CHANGELOG.md`, commit and push. The app picks up the new files the next time it opens with signal. If a part of the app is added, removed or renamed, update `data/architecture.json` in the same commit.

## Spec

The spec doc (purpose, block diagram, data model, player logic, progression rules, storage, roadmap, change log) lives in Claude Docs: "General - Cam's Training Tracker: Spec".

## Coach file (v1.9)

The coach review writes `coach.json` to the same private repo as `tracker-data.json`. The app reads it on open and when the sync button in the header is pressed. Only the phone applies adjustments, each one once (ids kept in kv `coachApplied`).

```json
{
  "updatedAt": "2026-11-19T03:00:00Z",
  "messages": [{ "id": "m1", "at": "2026-11-19T03:00:00Z", "replyTo": "chk_...", "text": "Reply shown in Plan > Coach check-ins." }],
  "adjustments": [
    { "id": "a1", "exerciseId": "incline_db_press", "weight": 80, "reps": 8, "reason": "..." },
    { "id": "a2", "exerciseId": "cs_row", "restDelta": -15 },
    { "id": "a3", "sessionId": "lift2", "restDelta": 15 }
  ]
}
```

`weight` and `reps` set the next target. `restDelta` sets that lift's (or the whole session's) rest offset from the plan in seconds, held to ±45. Adjustments only nudge; changes to exercises, sets or sessions go through a plan revision in `data/plan.json`.
