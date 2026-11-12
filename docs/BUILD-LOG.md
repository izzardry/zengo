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

- [x] 1A · Board
- [x] 1B · Game state
- [x] 1C · Game chrome
- [x] 1D · Start screen
- [x] 1E · Platform
- [x] 1F · Engine, assistance and clock decoupling (orchestrator addition)
- [x] 1G · Room core port (orchestrator addition)
- [x] Integrator 1
- [x] Gate 1 e2e suite
- [x] Gate 1 (passed in round 3)

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

**Milestone 1**
- Orchestrator: Gate 1 requires no chess anywhere (PLAN rule 10), but ~40 chess-coupled files belong to M2/M3 packages (Stockfish driver, blunder, draw offer, premove, levels picker, useComputer/useHint/useBlunderGuard, sync, room controller, useRoom). Two packages were added to M1: 1F deletes the chess-only engine/assist modules with their tests (M2 rebuilds them from Zhess's originals) and converts the generic parts (FakeEngine, offline manager, clock, turn bank, flags) to Go; 1G ports the room stack to Go moves with its tests. Zhess's chess e2e suites `m2.spec.ts`, `m3.spec.ts` and the Index computer/room integration tests are deleted with the chess modules they test; M2/M3 write new ones.
- Orchestrator: the M1 workflow has 7 package agents, an integrator, a separate e2e author, a verifier and fix rounds (about 11 agents instead of 8), because the two added packages are independent work.
- Orchestrator: the integrator acts for the orchestrator on `types.ts` and may run exactly `npm uninstall chess.js`.
- 1A: The board is one SVG for drawing plus a transparent HTML role=grid of N×N gridcells laid over it. The overlay carries labels, roving tabindex, focus ring and pointer input, so focus and testing-library roles work reliably (focus on SVG elements is not reliable).
- 1A: Coordinates and hint numbers scale with the pitch (0.28 and 0.38 pitch, laid out at 100× and scaled down) instead of a fixed 0.5rem. The SVG is in pitch units, and a fixed px size can't be expressed there: about 8px on 13×13 phones, about 5px on 19×19 at 320px, 11px on 19×19 desktop.
- 1A: Stone shading uses the theme-stable inks (a highlight of --ink-light at most 6% on Black, a shade of --ink-dark at most 8% on White) instead of literal foreground/6 and /8, which would vanish on Black in the light theme.
- 1A: The stone outline is 1px at foreground/75 (non-scaling stroke); thumbnails use 0.5px.
- 1A: `P` passes only with Enter (`P`+Enter or `pass`+Enter), never on the bare key, because P is a column on 19×19 (P16) and one keystroke must not pass.
- 1A: The size class follows the pointer in use, not the device: touch is coarse; mouse and pen are fine (hover, then click).
- 1A: The confirm hit area is within one pitch of the ghost along both axes (its cell plus half a pitch). A tap in the board margin outside the edge lines counts as off the board and cancels the ghost.
- 1A: The finger lift is 40px (about one finger-width). During a drag the ghost is clamped to the board; on a tap it is not.
- 1A: The parent is told about an illegal point (onIllegal) only with helpers on, both when a ghost lands on it and on every commit attempt. With helpers off, a ghost on an occupied point shows only the crosshairs.
- 1A: A mouse drag places at the release point (as on 9×9 touch).
- 1A: A star point is named in a label only while it is empty (`black stone, D4`, as in DESIGN 14.1).
- 1A: Territory squares are drawn on empty points only; dead stones get only the ×. Preview squares are drawn for |ownership| ≥ 0.1, sized 0.4 × |ownership|. The preview fades stones at the dead threshold (0.7 toward the opponent).
- 1A: The atari pulse plays when a stone first appears in the atari list (the pulse element mounts once per point) and is hidden under reduced motion; the static ring stays.
- 1A: The board keeps Zhess's typed-move bubble below the board for typed coordinates, with a short shake on rejection.
- 1A: The board does not cancel the ghost while it is merely re-rendered; it clears it on commit, on a size change, and when interactive turns false or scoring starts.
- 1B: Continue from here replays the shown plies with ms 0 from a new game of the same settings (no set-up position), so history, thumbnails, links and SGF need nothing new.
- 1B: Continuing at a position right after two passes starts the new game in scoring; Resume plays on. Go has no ending on the board, so the end position of a finished game can always be continued.
- 1B: The URL result r is SGF's RE text (B+4.5, W+R, B+T). Dead-stone marks are not in the URL, so a shared scored game shows its result but an unmarked final board.
- 1B: A game link without n uses the smallest board its moves fit on. Missing g means area and missing h means 0 (both are left out when written). The start-screen URL always writes n.
- 1B: A game link whose moves end in two passes and that has no result opens in scoring.
- 1B: Pass-and-play games are stored with color B (DESIGN 12.1); this replaces Zhess's lowercase w.
- 1B: The scoring rev starts at 0, and accepted cannot tell 0 apart from not accepted. The first Accept of an unmarked board therefore moves rev to 1 without changing the marks.
- 1B: Accept without a side ends the game at once (computer, side-by-side play). Accept with a side records that side; the game ends when both sides have accepted the same rev. A toggle clears both acceptances.
- 1B: A scored ending cannot be reopened. reopen() covers resignation and time-out only, as Zhess covered manual endings only.
- 1B: The pass toast (undoPass) cuts back to before the player's latest pass with no redo tail and does not mark the game assisted (it is a correction, like the resign toast). Against the computer it also removes the computer's later plies. It lifts a round-2 ending that the pass caused, never an Accept.
- 1B: The dead-stone proposer (proposeDead option) runs when a game enters scoring. In round 1 its proposal becomes the marks at rev 1. In round 2 it gives the final count. It returns null for every stone alive. A toggle made before an async proposal arrives wins, and the proposal is dropped.
- 1B: Without a proposer, round 2 is scored in the same update as the second pass, so no unscored round-2 board ever renders.
- 1B: Resign and time-out are refused during scoring (clocks stop), and the turn timer pauses in scoring. Marking and review do not restart the turn timer; a new ply does.
- 1B: Computer games stay startable sessions in M1 (undo by full turn, isComputerTurn); the integrator gates them with Coming soon. Rooms are not run by the hook in M1: Start with ROOM, an invite link and an unfinished room game from history call the onRoom option and return false without it. A finished room game opens in review.
- 1B: storage.ts keeps createGoStore, goStore and isGoSavedGame as aliases of createStore, store and isSavedGame for modules written in phase 0. Stored games in any other shape are dropped on read.
- 1B: SGF export names the computer as Zigo Level n on its side, uses the game's creation date for DT, and uses the git hash (or a version option) for AP.
- 1C: Prisoners show only when the count is above 0 (Zhess shows captured pieces only when there are some).
- 1C: During scoring both strips are at full opacity and show the whole score line in place of prisoners, komi and badge; the clock stays unless the strip carries an action.
- 1C: Face-to-face scoring puts the far player's Accept (ScoringAccept, compact) in the far PlayerStrip's action slot, so the strip's 180° rotation turns it; the near Accept stays in the ScoringBar at the toolbar's place.
- 1C: Under area rules with handicap, White's last score-line term is komi plus compensation ('W 40 + 3.5' for H3), so the line still adds up to the total.
- 1C: Score lines, komi and B/W letters keep Go notation (decimal point) in every language; overlay titles use the language's decimal sign ('Gewonnen mit 4,5 Punkten!').
- 1C: Go counts every ply as a move: the move strip, move list and overlay summary number plies, not pairs ('54 moves').
- 1C: The move list uses two columns so the colors line up; a handicap game starts in the left column with White.
- 1C: The ghost preview shows the next move number and the coordinate ('35. D4?').
- 1C: The resign hold's keyboard twin Shift+Enter (DESIGN 6.3) lives in useLongPress, so every long press has it; Space hold still works.
- 1C: Scoring replaces only the toolbar (StatusBar's scoringBar prop); Back and Help stay.
- 1C: FR uses the plural color names of common.ts ('Les Noirs gagnent de 4,5 points !') to match the shared table.
- 1C: InfoPill has a note prop for 2C's faint territory-preview line 'B+3.5' (DESIGN 7.3).
- 1C: The chrome's tests mock '@/components/board' with a StoneGlyph stub (stoneStub.tsx) that has the same contract, so they don't depend on the board package's own modules.
- 1D: The start package owns HandicapDial and RulesDial (src/components/start/), although DESIGN 15.3 lists HandicapDial under components/board/.
- 1D: The three start dials share one RadialDial with its own geometry module (start/dialGeometry.ts), taken out of lib/clock.ts so the start screen does not depend on the clock module that 1F is rewriting.
- 1D: Two-item dials (rules, clock system) place their items at 9 and 3 o'clock (ring turned by a quarter), clear of the pill under the finger.
- 1D: The rules dial shows CN (area, komi 7.5) and JP (territory, komi 6.5), matching the size pill's '· JP'; the aimed item names itself in the caption.
- 1D: Custom clock dial follows DESIGN 11 in full: system first, then minutes (1,2,3,5,10,15,20,30,60), then increment (0..30) for Fischer, or period seconds (5,10,15,20,30,45,60,90,120) then periods 1/3/5/10 for byo-yomi.
- 1D: The preview board shows the starting position of the selected settings, so a chosen handicap shows its stones; a code with a saved game shows that game's last position (lenient replay).
- 1D: Pass-and-play keeps the color pill enabled for the handicap hold; the color part is dimmed and a tap does nothing. A room joiner's pill (color and handicap) is fully disabled, as the creator's settings apply.
- 1D: The short handicap label is translated: 'H3' in EN, FR, ES and 'V3' in DE (glossary: Vorgabe).
- 1D: StartChrome hosts all three dials itself and closes them when the start screen stops being idle or the settings are locked (Zhess hosted the clock dial in Index).
- 1D: The clock pill switches presets with the size; a stored custom value or another size's preset steps to the next longer preset (by main time, then overtime), else off.
- 1D: The rank line under the level name keeps its height in portrait while empty, so the pills do not jump; it is dropped in landscape when empty.
- 1E: App icon geometry: a board corner of 3×3 cells (4×4 lines, top and left edges heavier, other lines running past the cell); the two stones sit on the centre cell's diagonal and touch at the tile centre (radius = pitch·√2/2), larger than the board's 0.95-pitch stones, so the motif reads at 16 px.
- 1E: Icon stones copy the stone set's dark-theme look from board/stones.tsx (ink fill, foreground outline at 75 %, the 6 %/8 % radial shading). DESIGN 5.1 reuses the stone symbols for the icon, so this faint shading takes precedence over Ztyle's 'no gradients'.
- 1E: Favicon 16/32/48: grid hidden, stones scaled 1.45×, outline 12; 256 is the full icon (as Zhess).
- 1E: The apple-touch icon stays pwa-192x192.png as in Zhess; no separate file, index.html untouched.
- 1E: OG feature line has three items as Ztyle 01 asks: '9×9 to 19×19 | 12 computer levels | zero ads'. The blurred board is a 9×9 Go board with a few stones; White stones at 30 % so they don't show as bright blobs behind the text.
- 1E: History move count = plies including passes (Go numbering, matching '34. D4' and '54 moves').
- 1E: History side to move and thumbnail come from zigo.fromRecord (lenient), so handicap games show White to move first; an invalid stored size falls back to 19×19.
- 1E: History state: wins by count show 'Won by 4.5'; wins by resignation or time show 'Won'; losses show 'Lost'; pass-and-play shows formatResult (B+4.5, W+R, B+T); unfinished games with scoring show 'Scoring'.
- 1E: History size label follows the size pill: '9×9', '19×19 · JP' for territory.
- 1E: Card lines: code/time; opponent/game n/room score; state/moves; size/tc/assisted dot. The byo-yomi tc ('20m5x30') did not fit on the state line at 320 px.
- 1E: GameCard draws BoardThumbnail itself; renderThumbnail stays as an optional override.
- 1E: Tutorial secondary-input bubble = scoring ('After two passes / Tap dead groups, then Accept'); the flag line is 'Tap: pass · Hold: resign' in every mode (DESIGN 4.2); the bulb line is 'Tap: hint · Hold: territory'; an optional size prop picks the 9×9 or ghost-confirm text, and both show when it is omitted.
- 1E: Ghost stone wording: EN 'ghost stone', DE 'Vorschaustein', FR 'pierre fantôme', ES 'piedra fantasma'.
- 1E: Live-region texts use the singular color names common in Go writing (FR Noir/Blanc, ES Negro/Blanco) and glossary prisoners (DE 1 Gefangener / n Gefangene, FR prisonnier(s), ES captura(s)).
- 1E: The screenshot script imports src/lib/zigo.ts through Node's type stripping to encode and validate the prepared games; screens game-9/13/19 and scoring added; the overlay screens accept a stored scoring game (all visible Accept buttons).
- 1F: The milestone gate is a separate `COMPUTER_ENABLED = false` export in lib/flags.ts, not `flags.computer = false`, because src/test/scaffold.test.tsx requires every entry of `flags` to be on; 2A sets it to true.
- 1F: While COMPUTER_ENABLED is false, useEngineOffline reports both stages as 'unsupported' and fetches nothing, and EngineStatus renders nothing.
- 1F: Stage 1 caches tfjs-backend-wasm.wasm, tfjs-backend-wasm-simd.wasm and the b6c96 net (4.56 MB). The threaded-simd wasm is left out because GitHub Pages cannot send COOP/COEP, so TF.js never requests it.
- 1F: Downloads are checked before caching: text/html or a body without `\0asm` (wasm) or `1f 8b` (gzip) magic fails the whole stage, and nothing of that stage is stored.
- 1F: Stage 2 starts only after stage 1 is ready and when a level 8-12 is selected, the app runs standalone, or stage 2 is tapped. With Save-Data on, stage 2 also waits for a tap.
- 1F: navigator.storage.persist() is requested once, after the first successful stage download.
- 1F: The engine status strings moved from start.ts (start.engine.*) to my assist table as engine.status.*, adding the stage-2 texts of DESIGN 14.
- 1F: FakeEngine genmove plays the first legal point that does not fill the mover's own one-point eye, else passes, so fake self-play ends in two passes. Its records are keyed by the plies joined (`movesKey`).
- 1F: FakeEngine rebuilds games from a Position by replaying the setup stones and plies (gameFromPosition), so ko and superko are exact.
- 1F: The generic engine types (EngineSnapshot, EngineHandle, EngineAbortError, EngineUnavailableError, isEngineAbort) moved out of the deleted UCI driver into src/lib/engine/handle.ts.
- 1F: levels.ts keeps only table metadata (name, target rank, net, method, rank, visits, timeMs, clockFraction) and needsLargeNet; LARGE_NET_FROM = 8.
- 1F: Byo-yomi display: main time shows `m:ss`; in periods the face shows the period countdown and the periods left (`0:24 ·3`, the current period counted); low and tenths follow the shown countdown; `ClockFace.ms` is the shown countdown.
- 1F: remaining() returns ms until the flag (main time plus the periods left for byo-yomi), so flagged, msUntilFlag and the room grace work unchanged.
- 1F: Clocks stop during scoring: isCounting is false, useClock does not tick, and turnMs is ignored.
- 1F: The turn identity (useClock, turnBank) is positionKey = cursor plus the encoded plies, replacing the FEN; BankedTurn.fen became `position`.
- 1F: A loss on time shows 0.0 on the loser, the opposite of `end.result.winner`, rather than assuming the side to move.
- 1F: The useClock return type was renamed ClockState to GameClock to avoid the clash with types.ts ClockState.
- 1F: Added DIAL_PERIODS [1, 3, 5, 10] and customByoyomiTc for 2B's custom dial.
- 1G: Seat colors in room logs are `black: Seat` (who plays Black); the first mover is White when the handicap is 2 or more, otherwise Black.
- 1G: A room created with no settings (two invite links, the anchor creates it) is 9×9, area rules, no handicap, no clock, random color (Zhess's default, plus the default size from DESIGN 4.1).
- 1G: Reconcile rule 6 for equal plies and equal ends (DESIGN 9.2): a resumed copy beats a copy still scoring; then the higher rev wins; the same rev with different dead stones is a fork (seat 0 wins); with the same marking, the copy whose acceptances include the other's wins, and acceptances that each lack the other's are a fork.
- 1G: The head hash covers the plies, settings, scoring state (round, rev, acceptances, a hash of the dead stones) and end. When two heads show the same plies but different scoring, both sides send their logs and the logs step decides.
- 1G: A log ending in two passes with a `scoring` field is in scoring; without one it was resumed. A ply after two passes resumes by itself, as ZigoApi.replay does.
- 1G: A received log that ends by score is accepted only if its result equals the count of its own dead stones; resign and time ends are accepted for either winner.
- 1G: Rev 0 means nothing has been proposed yet. Seat 0 sends the first proposal (rev 1) the moment its log enters round-1 scoring, from the injected `propose(game)` or with every stone alive. Seat 1 may mark only after that (rev ≥ 1), so it cannot cross seat 0's first proposal.
- 1G: Round 2 is ended by seat 0 as rev 1 accepted by both, with the result counted from its proposal, and sent as `end {by: 'score', dead}`. Seat 1 checks the claimed result against its own count of those dead stones before taking it.
- 1G: When both seats accept the same rev, each device ends the game locally from the shared dead stones; no `end` message is sent. An accept for an older rev is ignored; an accept for a newer rev triggers a reconcile.
- 1G: Marks are allowed offline and settle through rev. Accept and resume need the opponent connected (DESIGN 9.3: scoring needs both players). There is no marking round in round 2.
- 1G: The controller computes time left itself from zigo.clocks: Fischer remaining time, or byo-yomi main time plus every period left. Clocks and flags are off during scoring.
- 1G: Rematch keeps size, rules, handicap and time control; colors swap except in a handicap game, where Black stays with the same seat (DESIGN 9.4).
- 1G: The creator's size, rules and handicap in RoomCreateSettings are optional; the handicap is normalized for the size (for example 9 on 9×9 becomes 5).
- 1G: Design-section references to Zhess in room comments became plain `DESIGN 9`, so the chess grep stays empty.
- Integrator 1: Rooms have their own milestone switch, ROOMS_ENABLED = false, in pages/stage.ts (it mirrors COMPUTER_ENABLED; M3 sets it to true). PLAYABLE_MODES = { local: true, computer: COMPUTER_ENABLED && flags.computer, room: ROOMS_ENABLED && flags.rooms }.
- Integrator 1: Coming soon also covers resuming an unfinished computer or room game, from the Start pill (RESUME) or from a history card. Finished ones still open in review.
- Integrator 1: Pass-and-play puts Black at the near edge and White at the far edge; review's flip swaps them. The board never rotates.
- Integrator 1: The passed badge marks the trailing run of consecutive passes, so any stone clears both badges. The flag's dot shows when the last ply was a pass in a live, unscored position.
- Integrator 1: The page owns the polite live region (data-testid board-live), built from 1E's plyAnnouncement and newAtariAnnouncements; GoBoard runs with announce={false}. Atari is announced only with helpers on, as part of the helpers bundle. Against the computer the owner is 'you' for the player's own groups; in pass-and-play it is the color.
- Integrator 1: The ko and superko toast shows once per game for each reason, only with helpers on (the board calls onIllegal only then). The texts live in a new table, src/lib/i18n/stage.ts.
- Integrator 1: The hint bulb is hidden in M1 because there is no engine; M2 adds it back.
- Integrator 1: The board takes input only on the player's turn in a live game, or while marking is editable in scoring. The ghost preview clears when input stops.
- Integrator 1: The pass toast remounts on every pass and stays open only while that pass can still be undone (gs.canUndoPass at the same cursor), so the second pass replaces the first one's toast.
- Integrator 1: Undo toasts follow Ztyle 05/09 in a game: above the portrait toolbar (full width on phones, bottom right beside the board from sm on), or beside the board in mobile landscape. This needed a small `placement` prop on 1C's UndoToast. Before, the pass toast covered the scoring bar and the flag.
- Integrator 1: In the glossary review, FR and ES use the singular color names of DESIGN 14 / research 8.3: Noir/Blanc, Negro/Blanco. Changed in common.ts and in 1C's titles and toasts, e.g. 'Noir gagne de 4,5 points !' and '¡Gana Negro por 4,5 puntos!'. The FR strip labels now read 'Prisonniers de Blanc' and 'Pendule de Blanc'.
- Integrator 1: DE writes Byo-Yomi capitalised, as the research's German convention says.
- Integrator 1: Deleted the 9 unused start.engine.* keys per language from start.ts; EngineStatus uses assist's engine.status.*.
- Integrator 1: Continue from here is offered at every review position. 1B: every Go position can be continued.
- Gate 1 e2e: The scripted 9×9 game uses a column-F/G wall with a ko at F5/G5 and a white stone on B7 marked dead. The margins were counted by hand and cross-checked with ZigoApi/ScoringApi: area B 55 vs W 26 + 7.5 = B+21.5, territory B 44+2 vs W 17+0+6.5 = B+22.5.
- Gate 1 e2e: Rules and handicap are set through the real dials: a 700 ms mouse hold on the size or color pill, released in place, then a tap on the menuitemradio. The menu itself is a 0×0 anchor, so the tests wait for the item, not the menu.
- Gate 1 e2e: The 'Copy SGF contains SZ[13] and the result' check finishes the shared 13×13 game in the fresh context (two passes, Accept, W+6.5) and copies the SGF from the overlay's Share menu, because Copy SGF is only offered for finished games.
- Gate 1 e2e: Screenshot names are <shot>-<theme>-<w>x<h>.png. The 19×19 touch shots at 320×568 and 390×844 are game-19-touch-*, so the verifier can check that stones are distinguishable at 320 px.
- Gate 1 e2e: The smoke suite checks the engine files as shipped: the nets as application/gzip without Content-Encoding (b6c96 byte length and gzip magic) and the three TF.js backend .wasm files as application/wasm.
- Gate 1 e2e: Full e2e runs should be wrapped in `caffeinate -i`. An idle Maintenance Sleep (444 s) once froze two tests mid-run.
- Gate 1 fix board coordinates: Board coordinates are clamp(7 px, 0.45 pitch, 8 px) on screen: DESIGN 5.4's text-[0.5rem], with a 7 px floor so the two-digit 19×19 row labels fit the 0.8-pitch margin on phones (pitch about 15 px at 320 px). The margin was not widened, so DESIGN 5.1's pitch formula and the hit-test geometry are unchanged.
- Gate 1 fix board coordinates: CoordinateLayer measures its SVG's layout width (clientWidth, with a ResizeObserver) and sets the label size in pitches. Before measurement (jsdom, first paint) it falls back to the old 0.28 pitch. A CSS-scaled preview keeps the board's own label size.
- Gate 1 fix board coordinates: Label positions are unchanged: centred 0.64 pitch outside the edge lines, between an edge stone and the board edge. On 19×19 phones a 7 px '19' can touch an edge stone by about 1 px and reach about 1.5 px into the 4 px frame padding, which is still inside the frame.
- Gate 1 fix overlay summary: Game-over summary: one row from 640 px (overlay box sm:max-w-xl). On phones it breaks on purpose after the opponent part (code • size • opponent / moves • time), and the bullet opening the second row is screen-reader-only, so no row starts with a separator.
- Gate 1 fix overlay summary: Game-over overlay padding on phones is px-4 py-8 (16 px gutter) instead of p-8, so the first summary group fits at 320 px in all four languages; sm and up keep p-8 as in Zhess.

## Deviations

_(Where a design decision could not be built as stated: what was built instead, and why.)_

- 0b: Contract additions beyond PLAN section 4 (extensions, not changes): `Game.setup`, `IllegalReason`, `SgfMeta`, `ClockState`, `ClockInfo`, `Position`, `GameRecordFields`, `Score`/`ScoreSide` (whole points per side, totals and margin ×2), `GameLog` gains `black, tc, size, rules, handicap`, `WelcomeMsg` gains `size, rules, handicap`; `ZigoApi` gains `replay`, `fromRecord`, `setScoring`, `reopen`, `position`, `colorOfPly`, `lastMove`, `timeUsed`, `clockRunning`.

- 1A: DESIGN 5.4 asks for coordinates as text-[0.5rem]. They scale with the pitch instead (see decisions), because the board is one viewBox-scaled SVG.
- 1B: Zhess's live room integration in useGameState (useRoom, the room session read from the controller, room review) was removed in M1 as the brief directs. Its tests are replaced by tests of the onRoom extension point until M3 brings the room back.
- 1C: Tests changed because they contradict DESIGN.md: draw-offer and flagPending tests (DESIGN 4.2: no draw offer), the 'Resign (hold)' flag label (DESIGN 6.2: tap passes), PGN tests (DESIGN 13.3: SGF), checkmate, draw and figurine tests (Go), and the chess share texts (DESIGN 13.2). No test was skipped or loosened.
- 1D: ClockDial tests were changed to open on the system step (Fischer / byo-yomi), because DESIGN 11 makes the system the first choice; Zhess's dial started at the minutes.
- 1E: The test helper savedGame takes GTP moves (gtp: ['D4', 'pass']) instead of UCI; the chess test cases were rewritten for Go rather than loosened.
- 1E: The icon's stones are 1.41 pitch across rather than 0.95, so that they can touch diagonally as DESIGN 2 asks.
- 1F: The chess-only tests deleted with their modules include the 5 usePremove tests inside useClock.test.tsx; they test the deleted premove module (DESIGN 4.2 removes premove), not useClock.
- 1F: levels.test.ts lost its picker tests (humanizedPlan, engine move time, mate-in-1, hanging queen, pickMove) together with the chess picker; the table and normalization tests were ported, and 2C writes new picker tests.
- 1G: Scoring in rooms is a working first cut rather than M3's full protocol: lost mark, accept and resume messages recover only at the next reconnect (no resend timer), crossing equal-rev toggles end as a fork with the restore toast, and seat 1 does not propose when seat 0 has no engine. 3A and 3B should harden these.
- 1G: Deleted src/pages/Index.room.test.tsx and e2e/m3.spec.ts, the chess room flow tests through the chess Index page (src/pages/Index.tsx, which the integrator is rewriting), as the brief asked. M3's integrator writes the Go versions.
- Integrator 1: src/components/game/PlayerStrip.test.tsx (1C): the French expectations changed from 'Prisonniers des Blancs : 2' and 'Pendule Blancs' to 'Prisonniers de Blanc : 2' and 'Pendule de Blanc'. The old text contradicted the DESIGN 14 glossary (FR Noir/Blanc).
- Integrator 1: Glue fixes outside my own paths:
- src/components/game/ResignUndoToast.tsx and index.ts: the `placement` prop.
- src/lib/i18n/game.ts and start.ts: glossary wording, and the unused engine keys removed.
- src/lib/zigo.ts and zigo.test.ts: one comment each, so the Zhess mention is gone.
- src/hooks/usePWAInstall.ts: one import switched to lib/types.
- Gate 1 fix overlay summary: The Zhess overlay is max-w-md with no deliberate break. Zigo's summary has a fifth part (board size), so the box widens from 640 px and the phone layout uses a fixed two-row split.

## Open items

_(Features switched off in `src/lib/flags.ts`, and anything left unfinished.)_

- M1 (for the final visual pass and the owner): in the dark theme, Black stones are filled with `--ink-dark`, which is close to the dark `card` board, so they read almost as hollow circles with a light outline (DESIGN 5.1 as written). Theme-stable inks are an interview decision, so it was not changed.
- M1: a URL with `o=c&p=1` still opens a computer session that never moves (only the Start pill and history are gated by `COMPUTER_ENABLED`); M2 replaces it.
- M1: 1G's room scoring is a first cut (no resend timer for lost mark/accept/resume; crossing equal-rev toggles settle as a fork; seat 1 does not propose when seat 0 has no engine). M3's 3A/3B harden it.
- Build warning: the main chunk is 627 kB (196 kB gzip), over Vite's 500 kB warning.

## Measured speeds

_(Engine evaluation speeds the run could measure.)_

## Gate results

**Gate 0 (2026-11-12): passed with one exception.** `npm run lint` clean; `npm run typecheck` clean; `npm test` 74 files passed, 2 skipped; 1551 tests passed, 6 skipped; `npm run build` ok (26 precache entries, no `engine/`); both nets in `public/engine/nets/`. `npx playwright test`: 27 passed, 11 failed. The 11 are every Zhess test that needs the Stockfish engine (10 in `e2e/m2.spec.ts`, smoke "engine files are served next to each other"); PLAN.md phase 0 removes Stockfish, so they cannot pass until milestone 2 replaces the engine, and milestone 1 deletes them with the chess modules. Repo public, first Pages deploy succeeded.

**0a check (2026-11-12):** lint, typecheck pass; `npm test` 72 files / 1459 passed, 6 skipped (Stockfish file absent); build ok; e2e 27/38 passed, 11 failed, all because Stockfish is gone (10 in Zhess's `m2.spec.ts`, 1 smoke test requesting `stockfish-19-lite-single.*`). First Pages deploy succeeded: https://github.com/izzardry/zigo/actions/runs/43290647595.

**Gate 1 (2026-11-12): passed in round 3.** Workflow `wf_1e8a200c-20b`, 14 agents (7 packages, integrator, e2e author, 3 verifier runs, 2 fix agents).
- Round 1 failed on one visual fault: coordinate labels scaled with the pitch (about 4–5 px on 19×19 phones). Fixed in `dc1e1ff` (clamp 7–8 px).
- Round 2 failed on one visual fault: the game-over summary wrapped with a leading bullet. Fixed in `b8f8ce3`.
- Round 3 and the orchestrator's own re-run: `npm run lint` clean, `npm run typecheck` clean, `npm test` 65 files / 1599 tests passed, `npm run build` ok (25 precache entries), chess grep 0 hits, `npx playwright test` 27/27 passed (smoke 5, m1 22). Nothing switched off by flag; computer and rooms show "Coming soon" by plan (`COMPUTER_ENABLED`, `ROOMS_ENABLED` milestone switches).
- Note from the e2e author: a macOS Maintenance Sleep once froze two tests for 444 s; run long e2e under `caffeinate -i`.

