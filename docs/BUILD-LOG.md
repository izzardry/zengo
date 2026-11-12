# Zigo build log

The run's memory (PLAN.md section 1, rule 5). Updated after every package and every gate.

## Summary

_(Written at the end of the run.)_

## Package checklist

### Phase 0 · Foundation

- [x] 0a · Copy, rename, repository (commits e31a0bc..629da4c)
- [ ] 0b · Core library and contracts
- [ ] Gate 0

### Milestone 1 · Board

- [ ] 1A · Board
- [ ] 1B · Game state
- [ ] 1C · Game chrome
- [ ] 1D · Start screen
- [ ] 1E · Platform
- [ ] Integrator 1
- [ ] Gate 1

### Milestone 2 · Computer

- [ ] 2A · Engine
- [ ] 2B · Clock
- [ ] 2C · Assistance
- [ ] Integrator 2
- [ ] Gate 2

### Milestone 3 · Rooms

- [ ] 3A · Sync
- [ ] 3B · Room
- [ ] 3C · Room UI
- [ ] Integrator 3
- [ ] Gate 3

### Final phase · Audit, polish, publish

- [ ] 1 · Design audit
- [ ] 2 · Ztyle audit
- [ ] 3 · Code review
- [ ] 4 · Visual pass
- [ ] 5 · Fix confirmed findings, re-run all e2e suites and the full gate
- [ ] 6 · Docs
- [ ] 7 · Publish and live smoke test

## Decisions

_(One line each: where the design was silent, what was chosen and why.)_

**Phase 0**
- 0a: Ztyle's `--ink-*` and `--checker-*` replace Zhess's own tokens (identical values in both themes).
- 0a: A small Vite plugin serves `engine/**/*.gz` as `application/gzip` without `Content-Encoding` in dev and preview (sirv would mark it gzip-encoded and the browser would inflate it); GitHub Pages sends plain bytes, so local serving now matches.
- 0a: The engine runtime cache matches `/engine/.+\.(js|wasm|gz)$`, CacheFirst in `engine-cache`, 16 entries.
- 0a: The nets' CC0 notice is from `https://katagoarchive.org/g170/LICENSE.txt` (the `neuralnets/LICENSE.txt` link returns 403).
- 0a: README replaced by a short interim one; rewritten in the final phase.
- 0a: Web KaTrain cloned at `a6a67d645048a996d606a410c4e4c4b1051ffd43` (2026-10-28, MIT) into `~/.cache/zigo/web-katrain`; golden test `test/engineGolden.test.ts`. Its `katago-small.bin.gz` is the same b6c96 net (only the gzip timestamp differs).
- 0a: goscorer vendored from `0ac5f59962a9e40f39f4667645335ba5068acf86` (`javascript/goscorer.js`, MIT, © 2024 David J Wu) with a `.d.ts`.
- 0a: Net sha256: b6c96 `f57fddf4…60b1` (3,827,339 B), b10c128 `1a8e05a4…8b04` (11,138,361 B). No differences from PLAN.md section 2's ↻ facts.
- 0a: Stockfish was never copied (`public/engine/` excluded); the 6 engine tests that need its file skip themselves until package 2A replaces them.

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

## Open items

_(Features switched off in `src/lib/flags.ts`, and anything left unfinished.)_

## Measured speeds

_(Engine evaluation speeds the run could measure.)_

## Gate results

**0a check (2026-11-12):** lint, typecheck pass; `npm test` 72 files / 1459 passed, 6 skipped (Stockfish file absent); build ok; e2e 27/38 passed, 11 failed, all because Stockfish is gone (10 in Zhess's `m2.spec.ts`, 1 smoke test requesting `stockfish-19-lite-single.*`). First Pages deploy succeeded: https://github.com/izzardry/zigo/actions/runs/43290647595.
