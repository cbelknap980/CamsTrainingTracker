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
| `js/store.js` | IndexedDB wrapper, settings, backup and restore |
| `js/export.js` | Backup JSON (share sheet or download), Excel export |
| `js/architecture.js` | Architecture tab: diagram drawn from `data/architecture.json`, searchable |
| `js/data.js`, `js/ui.js` | Data loading and small helpers |
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
