# Zigo build log

The run's memory (PLAN.md section 1, rule 5). Updated after every package and every gate.

## Summary

_(Written at the end of the run.)_

## Package checklist

### Phase 0 · Foundation

- [x] 0a · Copy, rename, repository (commits e31a0bc..629da4c)
- [x] 0b · Core library and contracts (b2a94cd)
- [x] Gate 0 (passed with one logged exception)

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
- 0b: Go contracts take the final names in `src/lib/types.ts`; the chess contracts moved word for word to `src/lib/chessTypes.ts` (deleted with the last chess module in M1).
- 0b: Board arrays and ownership maps are row-major from the top (index = row × size + col); ownership +1 = Black.
- 0b: The scoring round is derived from the plies: a move after two consecutive passes implies a resume, so the next double pass is round 2.
- 0b: `play`/`pass` throw during scoring or after the end; `replay`/`fromRecord` resume automatically when a ply follows a double pass.
- 0b: Dead-stone marks survive undo→redo; a new move drops them. Undo/redo drop the end; goto keeps it (as Zhess).
- 0b: `decodeMoves` never throws and returns the longest well-formed prefix; `isValidMoves` is the strict check.
- 0b: Handicap ≤ 1 becomes 0; above the size's maximum becomes the maximum. An out-of-range `h` in a URL is dropped.
- 0b: `selfAtariSize` counts stones only if the opponent can capture at once (a ko capture counts 0); the 3-stone threshold is 2C's rule.
- 0b: Each side's first move is untimed (as Zhess). Byo-yomi has a simple log derivation that 2B may replace.
- 0b: SGF overtime is written `OT[fischer +7s]` / `OT[5x30 byo-yomi]`; missing names and date are left out; no `RE` while running.
- 0b: Toggling a partly marked chain marks it fully dead. Dead = ownership ≥ 0.7 toward the opponent, compared in float32.
- 0b: A tie (impossible with half-point komi) goes to White with margin 0 (OGS rule).
- 0b: URL `g` is written only for territory, `h` only when ≥ 2. The clock preference is stored per size as `{"9": …}`, `null` = off.

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

- 0b: Contract additions beyond PLAN section 4 (extensions, not changes): `Game.setup`, `IllegalReason`, `SgfMeta`, `ClockState`, `ClockInfo`, `Position`, `GameRecordFields`, `Score`/`ScoreSide` (whole points per side, totals and margin ×2), `GameLog` gains `black, tc, size, rules, handicap`, `WelcomeMsg` gains `size, rules, handicap`; `ZigoApi` gains `replay`, `fromRecord`, `setScoring`, `reopen`, `position`, `colorOfPly`, `lastMove`, `timeUsed`, `clockRunning`.

## Open items

_(Features switched off in `src/lib/flags.ts`, and anything left unfinished.)_

## Measured speeds

_(Engine evaluation speeds the run could measure.)_

## Gate results

**Gate 0 (2026-11-12): passed with one exception.** `npm run lint` clean; `npm run typecheck` clean; `npm test` 74 files passed, 2 skipped; 1551 tests passed, 6 skipped; `npm run build` ok (26 precache entries, no `engine/`); both nets in `public/engine/nets/`. `npx playwright test`: 27 passed, 11 failed. The 11 are every Zhess test that needs the Stockfish engine (10 in `e2e/m2.spec.ts`, smoke "engine files are served next to each other"); PLAN.md phase 0 removes Stockfish, so they cannot pass until milestone 2 replaces the engine, and milestone 1 deletes them with the chess modules. Repo public, first Pages deploy succeeded.

**0a check (2026-11-12):** lint, typecheck pass; `npm test` 72 files / 1459 passed, 6 skipped (Stockfish file absent); build ok; e2e 27/38 passed, 11 failed, all because Stockfish is gone (10 in Zhess's `m2.spec.ts`, 1 smoke test requesting `stockfish-19-lite-single.*`). First Pages deploy succeeded: https://github.com/izzardry/zigo/actions/runs/43290647595.
