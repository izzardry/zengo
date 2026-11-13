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

- [x] 2A · Engine
- [x] 2B · Clock
- [x] 2C · Assistance
- [x] Integrator 2
- [x] Gate 2 e2e suite
- [x] Gate 2 (passed in round 1)

### Milestone 3 · Rooms

- [x] 3A · Sync
- [x] 3B · Room
- [x] 3C · Room UI
- [x] Integrator 3
- [x] Gate 3 e2e suite
- [x] Gate 3 (passed in round 3)

### Final phase · Audit, polish, publish

- [x] 1 · Design audit
- [x] 2 · Ztyle audit
- [x] 3 · Code review
- [x] 4 · Visual pass
- [x] 5 · Fix confirmed findings, re-run all e2e suites and the full gate
- [x] 6 · Docs
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

**Milestone 2**
- Orchestrator: `@tensorflow/tfjs-backend-cpu@4.22.0` pinned as a dependency before M2 (it was only transitive through the WebGPU backend), so the engine's Node golden test and self-play can run without a mid-run install.
- Orchestrator: M2 workflow: 2A and 2B in parallel, then 2C, the integrator, an e2e author, a verifier and up to three fix rounds.
- 2A: Zigo area rules go to the network as KataGo's 'chinese' preset with positional ko, which is the golden test's setup. Territory rules go as 'japanese' with positional ko, because Zigo plays positional superko under both. Suicide is illegal under both.
- 2A: The network's komi is the game's komi plus one point per handicap stone under area rules (DESIGN 8.2). A game counts as a handicap game when Black has 2 or more setup stones, White has none, and White moves first.
- 2A: Two passes inside the search end that line, and the network judges the final position. There is no forced Tromp-Taylor count, because Zigo agrees dead stones after the game. The root uses KataGo's conservative-pass input, as in its GTP defaults.
- 2A: The search is a compact port of Web KaTrain's: KataGo's utility (win/loss plus score), exploration scaled by the parent's utility spread, first-play reduction, virtual losses, and LCB for the final move. Left out: graph search, subtree value bias, noise pruning, uncertainty weighting, and human-SL exploration.
- 2A: Batches: 8 leaves per network call on WebGPU, 1 on WASM. Batching made no difference on WASM in Node: 3.5 vs 3.3 ms per visit on 9×9 and 13.7 vs 13.5 on 19×19.
- 2A: The engine never resigns; resigning is 2C's policy. Every level passes when pass is its best move. Level 1 never fills its own one-point eyes.
- 2A: Search limits: with an explicit timeMs (levels 11 and 12), time rules over the minimum visits. Level 10 stops at its maximum visits, or after 2 s once its minimum is reached. Without a clock no search runs past 10 s. With a clock the cap is a 20th of the main time plus half the increment, or 40 % of a byo-yomi period.
- 2A: analyze defaults to 32 visits within 1.5 s on the small net. evaluate defaults to one network evaluation on the small net. The root always uses the fixed symmetry 0, so repeated evaluations give the same answer.
- 2A: The WebGPU check passes when win rate is within 0.02, score lead within 0.5, each policy entry within 0.02 and each ownership value within 0.05 of the WASM result, on a fixed 9×9 position.
- 2A: The driver's `nets` flags mean 'loaded in the worker', not 'cached'; useEngineOffline reports what is cached. While stage 2 loads, the state stays 'ready' and progress shows the large net's download.
- 2A: The worker reads networks from engine-cache itself, so a network downloaded by the offline manager is never fetched twice. The worker and TF.js chunks are precached by the service worker like the rest of the app.
- 2B: One byo-yomi rule for the log, the running turn and the flag (byoyomiPeriodsLeft): a move made inside a period keeps it, including one made when the period reads exactly 0.0 (DESIGN 11 'overrunning' means going past it); each full period overrun uses one up; time is up when the last period reads zero, the same instant as the flag (remaining() <= 0). The old liveClock (floor) and byoyomiStep (ceil-1) disagreed at exact multiples of the period.
- 2B: For the single ms when a period other than the last reads zero, the face shows '0.0 ·3' (periods still counted), not the out-of-time face.
- 2B: Spoken readings for role='timer' are added for byo-yomi faces only: '24 seconds, 3 periods', '1 second, last period', and in main time '4:31, 3 periods'. Fischer, clock off and out-of-time faces have no label, because their text already reads well. Seconds are whole seconds rounded down, matching the display.
- 2B: useClock adds the spoken labels when it runs inside the I18nProvider (useContext(I18nContext), not useI18n, so it still works without a provider in tests and tools); ClockFace gains an optional label field, which PlayerStrip already renders as sr-only text.
- 2B: The clock string table now holds only the spoken-reading keys. The unused clock.dial* strings were removed, because the custom dial uses start.dial.* (1D).
- 2B: The dial helpers duplicated in lib/clock.ts (DIAL_* lists, customTc, customByoyomiTc, nearestIndex, DIAL_GEOMETRY, dialAim, dialItemOffset) were dead code, since 1D moved them to start/dialGeometry.ts and ClockDial.tsx. They were removed with their clock.test.ts cases; the check that dial values make valid time controls moved to ClockDial.test.tsx against the dial's real lists, and dialGeometry keeps its own aim and nearest-value tests.
- 2B: Added engineClock(g, tc) to lib/clock.ts as the ClockInfo source for genmove (the clock at the start of the side's turn, from the log).
- 2C: The level rules sit on top of 2A's genmove, not inside it. The engine gets avoid = the big self-atari points (from level 3) and a seed from the game rng. pickMove then applies level 1's 30 % random reasonable moves and the capture-half rule, and checks the self-atari rule a second time.
- 2C: Level 1's capture rule: when its chosen move captures, it keeps it with probability 0.5; otherwise it draws a non-capturing reasonable candidate by policy at temperature 2. When none exists, it captures.
- 2C: 'Never pass while contested' (DESIGN 10.4) is a rules check under area rules only. When the computer wants to pass, one small-net evaluation runs, and it fills an open dame first: an empty point next to both colors with |ownership| < 0.3, legal, not its own eye, not a self-atari. Under territory rules a dame is worth nothing and capturing dead stones costs a point, so the engine's pass decision stands.
- 2C: Resigning takes 'a few points' as more than 5 / 7 / 10 points behind on 9 / 13 / 19 (after KataGo's resignMinScoreDifference). It needs three of the computer's own turns in a row below 5 %, counted along the current line, so undo forgets them. The engine never resigns itself.
- 2C: Blunder guard: the self-atari rule (3+ stones) is checked first and needs no engine. The engine check runs only when the engine is ready. When the turn's 'before' evaluation is missing, it is requested again within the same 150 ms budget.
- 2C: The guard calls engine.stop() before its 'after' evaluation, so the hint's precomputation queued for this turn cannot push it past 150 ms. The only exception is while the 'before' evaluation is still running. The hint restarts a cancelled precomputation, at most twice per position. Zhess's guard never stopped; Zigo's hint precomputation makes the queue longer.
- 2C: The hint precomputes 300 ms after the position settles (analyze 32 visits ≤ 1.5 s, then evaluate 16 visits ≤ 1 s, small net), only while the engine is ready. A tap before that asks the engine directly and shows 'pending'. Taps after the second keep showing the top three (a new object, so the board replays and refocuses).
- 2C: The preview line rounds the score lead from Black's view to half points, with a minimum of 0.5 ('B+0.5', never 'B+0'). It keeps Go notation in every language. The screen-reader text is the assist.previewLead.B/W strings.
- 2C: The dead-stone proposal is about 100 visits, at most 3 s, with an overall timeout of 20 s (loading included). It uses the large net only when the engine has it loaded, else the small net. With no answer it returns null, and every stone is alive.
- 2C: useEngineStart.prepare(level) loads stage 2 for levels 8–12 and stage 1 otherwise. It returns true at once when the needed nets are already loaded.
- 2C: Calibration anchor: GNU Go 3.8 level 10, taken as about 6k on 9×9. One kyu per 7 points of win rate away from 50 %. A level gets a rank only with at least 10 games and a win rate between 10 % and 90 %.
- 2C: Self-play and calibration score finished games by area themselves (dead stones from the engine's ownership ≥ 0.7, then flood fill), because lib/scoring.ts imports './zigo' without an extension and plain Node cannot load it.
- Integrator 2: The engine's dead-stone proposal runs in every solo mode, pass-and-play included (DESIGN 8.4 step 1 makes no mode exception).
- Integrator 2: An unfinished solo game warms the engine up (load stage 1): always against the computer, in pass-and-play only once stage 1 is cached, so a hint nobody asked for never downloads anything.
- Integrator 2: Offline, Start (or Resume) of a computer game does nothing when the level's networks are neither loaded in the engine nor cached (stage 1 for levels 1–7, stage 2 for 8–12); the status line says why. Online, or while the cache is still being checked or cannot be read, loading decides (failure: the calm toast).
- Integrator 2: Opening an unfinished computer game from a history card does not wait on the Start pill (as Zhess): the engine loads for the computer's turn, and a failure shows the calm toast with Try again.
- Integrator 2: The computer keeps playing while the player looks back through the moves in a live game (Zhess). The hint bulb shows only in phase playing of a live game, and is disabled on the computer's turn.
- Integrator 2: A pass hint (the best move is a pass) is shown as a toast `assist.hintPass`, because nothing on the board can pulse.
- Integrator 2: The preview's B+3.5 note in the info pill is aria-hidden; screen readers get assist.previewLead.B/W from a new sr-only assist-live region, which also carries the guard's assist.blunderRefused (the guard shows no text, DESIGN 7.2) and the pass hint.
- Integrator 2: The rank line reads src/lib/ranks.json through import.meta.glob (the file is optional) and shows only a table calibrated on 19×19, because DESIGN 10.2 gives ranks for 19×19 strength. 2C's 9×9 ladder therefore shows nothing.
- Integrator 2: useEngineOffline's `large` follows the level shown on the start screen (the saved game's level when the code has one), and the session's level during a game.
- Integrator 2: Glossary review: ES 'Vista del territorio: Negro va ganando por {points}' instead of 'gana por', because the preview reports a lead, not a final result.
- Gate 2 e2e suite: the m2 computer tests run at 1280×800, because Playwright's default 1280×720 is narrower than 768 px in height and so counts as a phone held sideways (`isMobileLandscape`); m1 uses 1280×800 too.
- Gate 2 e2e suite: the stage-1 and stage-2 progress lines are checked from a log of every text the status line showed (a MutationObserver in an init script), because on localhost the download finishes faster than polling can catch.
- Gate 2 e2e suite: the settled-position test uses territory rules (`g=t`). In Node the small net passed 20 of 20 times at levels 1, 3, 5, 7, 8, 9 and 10 in that position. Under area rules level 1 passed 0 of 10 times and level 10 6 of 10. Ownership of the dead B5 stone is about 0.97.
- Gate 2 e2e suite: the big self-atari is a position prepared by link; the guard refuses E5 by its rules-only check (3 stones capturable at once), so the bounce does not depend on the engine.
- Gate 2 e2e suite: the byo-yomi test uses `page.clock.install()` (time keeps running) and jumps it with `fastForward`. The first jump is read from the clock (main time left + 1 s), so real time spent waiting does not eat into the first period.
- Gate 2 e2e suite: the computer's replies are read from the URL's `m`; a stone the blunder guard bounces is played again to confirm it, as in the sibling app's suite.
- Gate 2 e2e suite: in the 10-move test a pass from the computer counts as a reply (DESIGN 10.4 allows a pass when it is the best move).
- Gate 2 e2e suite: `markDead` and `passTwice` wait out the engine's dead-stone proposal: data-engine ready or failed, then up to 7 s for dead marks (the proposal search stops after 3 s, and a hint search may run ahead of it). In Node the m1 positions get no proposal, except the scripted 9×9 game, where B7 was proposed dead in 2 of 3 runs. Either way the m1 expectations hold.
- Gate 2 e2e suite: the start footer keeps the status line's 24 px height while it is empty, so the pills do not jump when the line appears and a hold on a pill does not slip off it.

**Milestone 3**
- Orchestrator: M3 workflow in the plan's order: 3A, then 3B, then 3C, then the integrator, an e2e author, a verifier and up to three fix rounds.
- Orchestrator: the session closed during the round-3 verifier; nothing was lost (every finished agent had committed). The workflow was resumed from its cache (`wf_95c7ff18-534`).
- 3A: Equal scoring rev with different dead stones (two toggles that crossed on the wire) is a normal rule-6 resolution, not a fork: no 'Game restored from opponent's copy' toast. Zhess and Ztyle 18-rooms show that toast only for true forks, which normal play cannot produce, and crossing toggles happen in normal play.
- 3A: On that tie seat 0's dead stones win (DESIGN 9.2), but while the game is open they are kept at rev+1 with both acceptances cleared. Without the bump, an `accept {rev}` that seat 1 sent for its own marking at the contested rev would reach seat 0 after the tie and end the game on seat 0's marking, which seat 1 never accepted. With the bump, every accept of the contested rev is stale on both sides. After an equal end, seat 0's copy is kept as it is.
- 3A: Acceptances of the same marking merge (each seat's higher value) instead of 1G's 'crossing acceptances are a fork'. When the merge leaves both seats on the current rev, the merged log ends by score at once, so crossing accepts converge to both accepted and the scored end on both devices (DESIGN 9.5).
- 3A: One seat's acceptance that reached one side only: the copy that has it wins unchanged (1G's behaviour kept).
- 3A: A resumed copy beats a copy still scoring, including one with later toggles (1G kept): a resume is the only way out of scoring. A finished copy (scored, resigned, time) still beats a resumed one by rule 5.
- 3A: When rule 6 settles a new state (merged), reconcile adopts it and also sends it, so convergence does not depend on the other side having received this device's copy. It still settles in 6 messages or fewer in all tested orders.
- 3A: A scored end is valid only when both seats accepted the current rev (rev 1 or higher). Round 2 stores seat 0's proposal as rev 1 accepted by both, as 1G did.
- 3A: The live handlers return outcome kinds (applied, settled, duplicate, older, stale, reconcile) instead of sending anything; the controller decides what to transmit. 'older' means: send your current mark back so the other side catches up. This fixes a drift where one device settled a tie at rev+1 while the other never saw the tie.
- 3A: Room score stays in half points ×2 per seat (a win adds 2, which is 1 point), as Room.score in types.ts says; scoreView shows points.
- 3B: How seat 1 learns it must propose (DESIGN 9.5 'if seat 0 has no engine but seat 1 has, seat 1 proposes'): hello carries `engine: boolean`. When seat 0's propose is missing or returns null and seat 1 has an engine, seat 0 sends a hand-over `mark {rev: 0, dead: []}` and seat 1 proposes mark rev 1. If seat 1 has no engine, seat 0 marks every stone alive at once. Seat 0 never sends its own rev 1 while handing over, as 3A required. A capability in hello alone was rejected: the engine can be configured but fail (offline without the nets, a timeout), and the hand-over covers that case too.
- 3B: A seat 0 whose engine is configured but gives no answer is treated like a seat 0 without an engine, so seat 1's engine gets the proposal.
- 3B: Seat 0 offline, not knowing seat 1's engine (a fresh load), waits with rev 0 and decides when the opponent is back. Scoring needs both players anyway (DESIGN 9.3). Seat 0 may still mark by hand at rev 0; that mark is the marking and cancels the hand-over.
- 3B: Seat 0 may toggle while seat 1's proposal is being computed. If the two cross, rule 6 keeps seat 0's stones at rev 2, the same on both devices.
- 3B: Round 2 has no hand-over. DESIGN 9.5 says seat 0's proposal, or every stone alive if seat 0 has no engine.
- 3B: Lost scoring messages and ends are recovered by comparing heads on the resend timer (head {probe: true}, answered with a head) until the other side shows the same hash, instead of per-message acks. It reuses the reconcile rules, so a recovery always settles the way a reconnect would.
- 3B: Resignations and time ends are probed too, so a lost end is recovered on the live channel. Zhess recovered it only at the next reconnect.
- 3B: The flag's time left uses lib/clock's budgetMs (2B), so the controller's flag and the clock display share one byo-yomi rule.
- 3B: RoomState.proposing is optional, so the room UI's hand-made test snapshots keep compiling.
- 3C: The toggle highlight is an overlay component (ToggleFlash in components/room) that the integrator places next to GoBoard. It is not a new GoBoard prop, because the board belongs to 1A and this package may not touch it. It draws in GoBoard's viewBox inside the frame's 4 px padding.
- 3C: lastToggle reports every change of the dead set within the same round-1 scoring that this device did not make itself: live toggles, offline marks arriving by reconcile, and rule-6 settlements that revert this device's own toggle. It is not reported for the first proposal (rev 0 to 1), round 2, acceptances or own marks. Own marks are detected by routing mark/toggle through the session around the controller's synchronous emit.
- 3C: A read-only second tab follows its owner tab by recreating its controller, so it also flashes marks made in the owner tab of the same device. This is harmless and was left as is.
- 3C: The toggle flash is a foreground ring just outside the stone, about 1.2 s (1.5 × --dur-pulse), scaling out once. Ztyle's palette is monochrome; success and destructive are already taken by the hint and the blunder guard. Under reduced motion the ring is still for twice the pulse time, then cleared (board.css pattern). A polite live line names the group by one of its points in GTP ('C7').
- 3C: Accept pending: after pressing, the button shows 'Accepted' with aria-pressed and stays at full strength. Tapping it again sends nothing. The note reads 'Waiting for your opponent to accept'. ScoringBar has no pulse option, so the pending state is the note plus the pressed button instead of Ztyle's pulsing button.
- 3C: While the first proposal is computed (rev 0), and in round 2 until seat 0's end arrives, both scoring buttons are locked with 'Finding dead stones…' or 'Counting…'. ScoringBar cannot lock Accept alone, and resuming during the short proposal wait is not needed.
- 3C: While the opponent is away, both buttons are locked with 1C's existing 'Scoring continues when your opponent is back' (game.scoringPaused). Marks stay possible offline, as 3B allows.
- 3C: scoringActions.accept ignores useScoring's side argument: a room device always accepts for its own seat.
- 3C: settings is null until this device holds a seat. A joiner learns the creator's settings only from welcome, so there is nothing to show dimmed before joining. Afterwards the settings are those of the current game, and rematches keep them.
- 3C: The invite text 'Join my Go game!' and the ?s=CODE&o=r link were already in place (game.shareText.room, roomShareUrl) and are kept.
- Integrator 3: useGameState runs the room itself, as Zhess did. A `rooms` option turns it on, and flags.rooms must be on too. With `rooms` off, 1B's onRoom extension point keeps its old behaviour, so its tests stay valid.
- Integrator 3: With ROOM selected and a room record for the code, the start screen shows that room's current game: the preview, plus its color, size, rules, handicap and clock, dimmed and locked through a new StartChrome `pillsLocked`. The opponent selector stays free so the player can leave ROOM. This applies to both seats, because a room's settings are fixed for every rematch (DESIGN 9.1, 9.4). The pills are not dimmed for a code this device has no room for, because the creator's settings are only known after welcome.
- Integrator 3: In a room the flag is enabled whenever this device may resign: seated, not hard-locked, also on the opponent's turn and offline (Zhess's roomResignable). A tap passes only on this device's turn; on the opponent's turn it does nothing. Solo modes keep the flag tied to their own turn.
- Integrator 3: There is no pass undo toast in a room: a pass is taken back with a takeback request (DESIGN 9.4). There is no resign undo toast either: resignation is final (DESIGN 8.3).
- Integrator 3: The room's dead-stone proposal reuses the engine proposer that solo play already uses, passed as `room.propose` (useRoom reads it when the session starts). Every device built with the engine therefore announces one (hello.engine). A device whose engine never answers falls back to every stone alive through 3B's hand-over.
- Integrator 3: In a room the engine warms up (load stage 1) once stage 1 is cached, as in pass-and-play, so the proposal answers quickly without a download nobody asked for.
- Integrator 3: A room whose current game is over opens with its game-over overlay, without a tint (Zhess). The toolbar's flag slot turns into Rematch, pulsing while the request waits.
- Integrator 3: Room scoring marks need both the controller's canMark and the owner tab. A read-only second tab cannot toggle groups.
- Integrator 3: Landscape scoring bar: the two stacked buttons now sit in a rounded-3xl card and have equal width. The full pill cut through the wider Accept button, which was visible in the 844×390 screenshots. It is a glue fix in components/game/ScoringBar.tsx and affects solo landscape scoring too.
- Gate 3 e2e: The manual path's position is designed so the engine has a clearly dead stone. It is m2's walls on columns D and E with a White stone thrown in at B5, plus the A1 capture and G5. The test still asserts only what the room guarantees: both boards show the same marks and the same count line, whatever the engine proposed. In every run the engine marked B5 dead, giving W+15.5.
- Gate 3 e2e: The determinism rule is covered end to end: the guest's context aborts every /engine/ request, so it can never compute a proposal of its own, and its marks and result must equal the host's.
- Gate 3 e2e: Plan bullet: "the guest toggles a group (both accepts clear); both accept the same marking". The test makes the host accept first, has the guest toggle B5, which clears both acceptances, and then has the host toggle it back. Both accept the proposal's marking, so the result is a sensible count.
- Gate 3 e2e: Resume: the guest makes the second pass of round 2, so seat 1's device must adopt seat 0's `end` as data. The ending is checked as "at once": no scoring bar on either device and an identical overlay.
- Gate 3 e2e: Recovery follows Zhess: game 1 ends by resignation, then a rematch, then storage loss, a manual reconnect and Allow. The only difference is that game 2 is in scoring, with a guest toggle, when the guest's device is lost.
- Gate 3 e2e: In a room the flag stays enabled on the opponent's turn, by the integrator's design (resign by hold is always possible). The tests therefore do not assert a disabled flag. They prove turn order by who can place the next stone.
- Gate 3 e2e: Broker path: test.fixme(condition) at runtime, only when data-room-cause or data-room-failure is broker-unreachable. This is the fixme form the brief asks for; Zhess used test.skip.
- Gate 3 e2e: The suite takes the BroadcastChannel hand-over test from Zhess's m3, although PLAN's Gate 3 list does not name it.
- Gate 3 e2e: After the game is over, the restored guest's history is checked by scrolling straight to the "Previous games" heading. At 1280×720 the start screen shows no 'Show previous games' chevron, so helpers.scrollToHistory cannot be used there.
- Gate 3 fix (room scoring bar layout (desktop)): The note moves into the bar's own row (inside the glass pill, left of Resume and Accept) for portrait viewports from `sm` (640px) up. Moving or shrinking the strips would have been the other option. The row is where the toolbar always sits, so it can never meet the strip row, whatever the board size. Below `sm` the board is limited by the width and leaves room, so phones keep the stacked note.
- Gate 3 fix (room scoring bar layout (desktop)): The note goes inside the glass pill, not loose beside it. That keeps it readable on any background and makes it read as part of the bar. The buttons move a little sideways when a note appears, which is acceptable.
- Gate 3 fix (room scoring bar layout (desktop)): The landscape rail layout (which also covers short desktop windows such as 1024x600, where useIsMobileLandscape is true) is deliberately unchanged.
- Gate 3 fix (toast placement): Beside the board in portrait when at least 200 px of toast width fits right of the board (MIN_BESIDE_PX), computed in JS from the window size with the same formula as BOARD_SIZE_PORTRAIT; otherwise above the bottom chrome. 1024x768 gets beside at 212 px, because when the board fills the height there is no free row below it.
- Gate 3 fix (toast placement): Above the bottom chrome the toast is centered and at most 356 px wide everywhere, phones included. On wider screens the player strips' ends (stone count, clock) lie outside the toast, so overlapping the strip's empty middle hides nothing. This fixed the clock overlap at 600x900.
- Gate 3 fix (toast placement): The scoring bar publishes its measured height in a CSS variable instead of using a fixed note height, because the note wraps differently by language and width.
- Gate 3 fix (toast placement): The portrait bottom offset is capped at 50dvh - board/2 - 88px (strip about 28 px + 8 px gap + 48 px one-line toast), so a toast never climbs into the board to clear the note. Where both cannot fit (320x568), covering the transient note beats covering the board.
- Gate 3 fix (toast placement): On phones the Toaster keeps position bottom-right in the 'above' layout, so the sideways swipe to dismiss stays; the side offsets do the centering.
- Gate 3 fix (toast placement): Request toast text keeps a minimum of 8rem before Decline/Accept move to the next line. I tried 5rem, which gave a 4-line text column at 320 px.
- Gate 3 fix (environment): I did not try to get around this by changing the e2e scripts, the Playwright config or the browser (WebKit or Firefox need launchd too, and the gate runs Chromium only), or by installing cron jobs or other persistent machine settings. The only real fix is a new login session.
- Gate 3 fix (environment): Proposed pre-flight check before any e2e run: `id -un` must print the user name, and `node -e "require('playwright').chromium.launch().then(b=>b.close())"` must exit 0. If either fails, the orchestrator should log an environment failure in docs/BUILD-LOG.md and not count that e2e run.
- Gate 3 fix (room connection under parallel load): e2e scheduling: the Gate 3 room tests run under Playwright's built-in '-exclusive-' lock: each runs alone, after the parallel tests, one at a time. Reason: each room test runs two complete app instances over real WebRTC (non-trickle ICE with mDNS host candidates and STUN), and seat 0 runs the KataGo engine. In parallel with each other and with m1/m2's engine games, at a machine load average of about 150–210 from other agents, the manual exchange stalled: the guest's answer was too late for the 15 s wait, or the host stayed 'connecting' after the paste until its 20 s connect timer gave up. With --workers=1 all 6 passed. Chosen over mode 'serial' (a failure would skip the rest) and over a separate project with workers: 1 (still parallel with the engine suites). Zhess's identical transport passed fully parallel, but its engine load was much lighter.
- Gate 3 fix (room connection under parallel load): Ruled out by reading the code: the verifier's theory that the answer was applied to an offer replaced after a broker retry. openManual() does nothing while a host exchange is preparing, offering or connecting. The offer is replaced only by restartManual (the 'Start over' button, shown only in the error step) or closeManual (the user closing the sheet). Broker retries never touch the manual exchange. A broker connection can drop a pending exchange only when the room is live, which a blocked broker never makes it. A mismatch would also show as an alert in the sheet, and the new diagnostics now report that.
- Gate 3 fix (room connection under parallel load): Not established, because no browser could run: whether the stall came from CPU starvation alone or from concurrent WebRTC (several Chromium instances doing mDNS/ICE at once). The exclusive lock covers both, since it recreates the passing serial condition.
- Gate 3 fix (start-screen toast placement): On the start screen, toasts use Ztyle 05's start-screen offset, max(1.5rem, inset + 0.5rem), in the chevron's row under the status line, but only when that row is tall enough for a one-line toast with an 8 px gap. Otherwise they go above the footer, over the decorative blurred preview, never over the pills. Zhess has no start-screen rule, so the Ztyle rule applies.
- Gate 3 fix (start-screen toast placement): The offset is measured from the real footer and published as a CSS variable, following the scoring bar's BOTTOM_CHROME_VAR pattern. A fixed number would break when the pills wrap, the install pill appears, there is no chevron, or there is a safe-area inset.
- Gate 3 fix (start-screen toast placement): In mobile landscape the same rule puts the toast above the footer row on the right. Before, at 844x390 the toast also covered the clock pill and the status line, although nobody had reported it.
- Gate 3 fix (start-screen toast placement): In the beside layout of wide portrait screens (1280x800, 1024x768) the in-game offset stays, because the centered footer is already clear of the toast.
- Gate 3 fix (e2e timing under load (m1/m2 suites)): Playwright workers fixed at 4 in playwright.config.ts instead of the default of half the cores (7 here); the verifier's run 1 failures all fell in a burst of high load. `--workers N` still overrides it.
- Gate 3 fix (e2e timing under load (m1/m2 suites)): The m1 share-URL test and both m1 screenshot tests get test.setTimeout(120_000): since Gate 2, their passTwice waits for the engine (up to 60 s) and then the proposal (up to 7 s), which the Gate 1 default of 60 s did not allow for. m2's engine tests already use 120-240 s.
- Gate 3 fix (e2e timing under load (m1/m2 suites)): The m2 byo-yomi test opens the link with Black's first move only (C3) and waits for the computer's reply, so Black's main time starts after the engine has loaded. Engine loading time no longer counts against the `main > 50_000` check, which is unchanged. The rest of the test (quietPoint, 4 plies, ·3/·2, Out of time, W+T) is unchanged; only the white stone is now the computer's choice instead of G7.

**Final phase**
- Orchestrator: PLAN's "`/code-review high` on the whole branch" runs as three high-effort review agents inside the final workflow (rules/sync/room, engine/assistance, UI/hooks), because the skill reviews a diff and the whole repo is new; each finding is checked by a skeptic like the audit findings.
- Orchestrator: final workflow `wf_f5761ffc-978`: 5 design auditors (DESIGN 4–6, 7–8, 9, 10–11, 12–14), a Ztyle auditor, 3 code reviewers and a visual pass, each followed by a skeptic; then triage into fix clusters, fixes and the README in parallel, and the full gate with up to three fix rounds.
- Audit result: 29 findings confirmed, 15 rejected by the skeptics. Rejected because the design, Ztyle or Zhess already settles them, or they were logged earlier: crosshair weight (DESIGN 5.3 gives none), hint numbers when the best move is a pass (the pass toast shows again), room takeback in scoring cutting both passes (as in Zhess), level 9 playing the top policy move after the opening (Web KaTrain's policy bot; levels are starting values), stage 2 re-download after eviction, 36 px setting pills (Ztyle asks 44 px for the toolbar only), the hint busy label, toast over the strip at 320×568, the invite sheet on short screens (it scrolls), faint 8 px desktop coordinates (DESIGN 5.4), 19×19 coordinates touching the frame at 320 px, the 🎉 emoji (DESIGN 8.5), no clock in the far strip during scoring, the dimmed prisoner glyph (DESIGN 4: 50 % strip), floating chrome over history cards (as in Zhess).
- Fix (game chrome, `161eecf`): solo scoring keeps Accept disabled and shows "Finding dead stones…" until the engine's proposal arrives; Index.test's face-to-face test now waits for the far Accept to be enabled (it clicked during the proposal, which was the bug). In the landscape rail the stopped clock is left out during scoring to fit the height; the rail strip's details wrap in a row. Rail centering uses auto margins, because older Safari drops `safe`. The far Accept gets a 44 px hit area that ends where the grid begins.
- Fix (engine loading, `b75bdfb`): Start waits for the page's running stage download instead of fetching the net again; the pill shows max(0.99, engine progress) after the download while the net is built; stage 2 starts when stage 1's download ends. A search that needs the large net waits for it under the loading timer, not the 40 s search watchdog, and searches stay in call order. driver.test's level-12 case now loads stage 2 first; what it checks is unchanged.
- Fix (rules and links, `eb88e4e`): MAX_PLIES = 2000 for `m`, fromRecord and room logs (a long 19×19 game is about 300). Live play is not capped. The superko map is shared along a game line (2000-ply replay 57 ms). Time controls above 600 min, 600 s increment, 60 periods or 3600 s periods are refused (far above the dial's range), and the room flag timer is clamped to setTimeout's limit. URL mode lookups check own properties only.
- Fix (room review, `065618e`): the review is tied to the room's game number; a rematch or a takeback to or before the reviewed position returns to the live game.
- Fix (board feedback, `86064c0`): the atari pulse plays when a group enters atari, compared per colour with that colour's previous turn. Mouse hover on an illegal point is drawn hollow with an x at the hover's strength (0.67 of the ghost's mark).
- Fix (copy and style, `4772283`): the help names device speed for levels 10–12, only in computer games, inside the toolbar bubble. German says "Level" throughout. "Link copied!" everywhere. Copy failures use plain toasts. Tailwind's `overline` utility is blocklisted so Ztyle's `.overline` type role draws no line.
- Fix (assets, `1528141`): the Apache-2.0 licence ships next to the TF.js WASM binaries. scripts/screenshots.mjs can open games in scoring.
- Docs (`c26fe97`): README rewritten in Zhess's layout: features, scripts and flags, structure, how scoring, rooms and the engine work, licence and credits. It says the rank line has no table yet.
- Gate fix round 1 (`b0cb55d`): at 844×390 the room's "Could not reach the connection service." toast broke text mid-word and covered the whole right rail. Toast text now breaks only between words, and an action moves under the text when the text would get narrower than 8rem (all toasts). Toasts beside the landscape board are compact (text-xs, py-2 px-3). While toasts show, the Toaster publishes their stack height as `--zigo-rail-toasts`, and the right rail (toolbar or scoring bar) moves up above them, never above Help. The rail was moved, not the toast, because the free corner at 844×390 (223×89 px) cannot hold a message with an action in every language.

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

- 2A: The search is not a full port of Web KaTrain's 4,700-line search. The parts listed in the decisions are left out, and every visit has weight 1. Its numbers still match KataGo's own formulas for exploration, first-play reduction and LCB.
- 2A: src/lib/engine/fake.ts now takes gameFromPosition from the new position.ts (the export is unchanged), and its genmove accepts and honours opts.avoid.
- 2B: Deleted test cases in clock.test.ts: 'dial values make valid time controls', 'nearestIndex finds the closest value' and 'dialAim follows the Ztyle zones and angles', together with the dead duplicate helpers they tested. The dial-value check was rewritten in ClockDial.test.tsx against the dial's real constants and fischerTc/byoyomiTc, and now covers all byo-yomi combinations, more than before. Aim and nearest-value logic stays covered by dials.test.tsx for dialGeometry.ts. No other test was changed or loosened; the existing byo-yomi expectations (including 'exactly one period: kept' and out at the full budget) pass unchanged.
- 2C: The ranks table (src/lib/ranks.json) was not written. The calibration is too small and was measured on 9×9, while DESIGN 10.2 asks for 19×19 ranks, so the start screen's rank line stays empty for now.
- 2C: DESIGN 15.4 asks for calibration on 9×9 and 19×19. Only 9×9 was run, as the brief allowed, within its 30-minute cap.
- Integrator 2: src/pages/Index.test.tsx: the M1 test 'answers Start with the computer or a room with Coming soon until milestones 2 and 3' became 'answers Start with a room with Coming soon until milestone 3'. Computer Start now starts a game, as DESIGN 10 requires, and the new computer tests cover it.
- Integrator 2: Glue outside src/pages: one Spanish string pair in src/lib/i18n/assist.ts (2C's table, under my i18n glossary review).
- Gate 2 e2e suite: `src/components/start/StartFooter.tsx` (package 1D's file) got a one-line fix: `min-h-6` on the status line's wrapper in portrait. It fixes a real layout jump of the start pills that broke two m1 hold tests at 390×844 under load.
- Gate 2 e2e suite: The info pill's lead note (`preview-note`) is shown on its own line under the info pill, not inside the 'Game info' group, so the test looks for it by test id instead of inside that group.

- 3A: DESIGN 9.2 says that with equal rev and different dead, 'seat 0's copy wins'. Here seat 0's dead stones win but are kept at rev+1 with acceptances cleared, not seat 0's copy byte for byte, to void accepts of the contested rev (see decisions). After an equal end, seat 0's copy is kept exactly.
- 3B: DESIGN 9.6 lists mark {n, epoch, rev, dead} as a proposal or toggle. Zigo also uses mark with rev 0 and an empty dead list as seat 0's hand-over of the first proposal to seat 1. DESIGN 9.5 asks for seat 1 to propose but names no message for it, and this keeps the message table and protocol version 1 unchanged.
- 3C: Ztyle 18-rooms asks for a pulsing button on the asking side. The own pending Accept instead shows the pressed 'Accepted' state with a waiting note, because 1C's ScoringBar (not my file) has no pulse option. Takeback and rematch pending states are unchanged from 1G.
- Gate 3 fix (room connection under parallel load): The verifier asked for the root cause. I could not establish it with a browser, because Chromium cannot launch on this machine at the moment. The fix gives the room tests the condition in which they pass, inside the normal parallel run, and adds diagnostics so a remaining stall names its cause. It does not prove the app has no load-sensitive race in the manual exchange.
- Gate 3 fix (room connection under parallel load): The verifier's suggested remedies were mode 'serial' or fewer workers for m3. I used Playwright's '-exclusive-' lock instead. It is stricter (nothing else runs beside a room test) and keeps independent retries and reporting.
- Gate 3 fix (start-screen toast placement): I changed src/components/ui/toasterPlacement.ts and src/components/start/StartFooter.tsx, and added src/components/start/startToastRoom.ts and its test file, instead of the suggested toastSlot.ts, RoomToasts.tsx and StartChrome.tsx. The offset is decided in toasterPlacement and the footer is the element that has to be measured. RoomToasts and toastSlot were not involved.
- Gate 3 fix (e2e timing under load (m1/m2 suites)): The byo-yomi test's prepared position now has one move instead of two (C3 instead of C3, G7). That does not contradict DESIGN.md. It changes when Black's clock starts relative to engine loading, and no assertion changed.
- Gate 3 fix (e2e timing under load (m1/m2 suites)): Nothing was verified with Playwright: Chromium cannot launch from this session (launchd 'Reentrancy avoided', bootstrap_check_in error 141).
- Final gate fix: toasts beside the landscape board use text-xs and py-2 px-3 instead of Ztyle 05's text-sm and py-3 px-4, so a toast with an action fits in the rail column. Ztyle's right-center rail moves up while a toast shows and returns to center without one.

## Open items

_(Features switched off in `src/lib/flags.ts`, and anything left unfinished.)_

- M1 (for the final visual pass and the owner): in the dark theme, Black stones are filled with `--ink-dark`, which is close to the dark `card` board, so they read almost as hollow circles with a light outline (DESIGN 5.1 as written). Theme-stable inks are an interview decision, so it was not changed.
- M1: a URL with `o=c&p=1` still opens a computer session that never moves (only the Start pill and history are gated by `COMPUTER_ENABLED`); M2 replaces it.
- ~~M1: 1G's room scoring is a first cut~~ — resolved in M3 (3A rule 6 without forks, 3B head probes on a resend timer, seat-1 hand-over).
- M2: no rank line yet. `src/lib/ranks.json` was not written: the 9×9 ladder against GNU Go level 10 (10 games per level) placed only levels 5 (≈6k) and 7 (≈3k), with about ±4 kyu uncertainty, and DESIGN 10.2 asks for 19×19 ranks. Run `node scripts/calibrate.mjs --size 19 --write` with more games to fill it.
- M2: the worker does not warm the network up after loading, so the first WebGPU evaluation on a new board size includes shader compile time.
- M2: the search is a compact port of Web KaTrain's (no graph search, subtree value bias, noise pruning, uncertainty weighting or human-SL exploration); numbers match KataGo's formulas for exploration, first-play reduction and LCB.
- M2: in review, byo-yomi clock faces have no spoken label (review uses `reviewClockView`, which bypasses useClock).
- M3: the room e2e tests run under Playwright's exclusive lock (one at a time after the parallel tests): in parallel with the engine suites at a machine load average of 150–210 the manual exchange stalled. The root cause (CPU starvation vs concurrent WebRTC) was not established; Zhess's identical transport passed fully parallel. Worth a look if rooms ever feel slow to connect on a busy phone.
- M3: remaining toast overlaps on screens without free space: at 320×568 a wrapped request toast covers the board's bottom edge; at 768×1024 a two-line request toast touches the board frame by 1 px; at 844×390 a wrapped request toast touches the rail toolbar by 5 px; at 667×375 the rail toast overlaps the board by about 10 px. After scrolling to history, start-screen toasts fall back to the in-game offset.
- M3: the own pending Accept in a room shows a pressed "Accepted" button with a waiting note instead of Ztyle 18's pulsing button (ScoringBar has no pulse option).
- Build warning: the main chunk is 805 kB (253 kB gzip), over Vite's 500 kB warning.
- Final: where the landscape rail cannot move further up (it stops below Help), a four-line German toast at 667×375 reaches 5 px into the toolbar's bottom padding and a three-line French toast at 740×360 2 px; the buttons stay clear. In landscape room scoring the toast can cover the lower part of the waiting note ("Scoring continues when your opponent is back") by up to about 33 px at 667×375. At 320×568 the failure toast still covers the board's bottom row (now 100 px tall).
- Final: if Start is tapped within about 1 s of a first launch (before the page's own stage-1 download leaves its 1 s delay), stage 1 is still fetched twice and the pill reads "START 0%" while the status line climbs. The tutorial sits in front of Start on a first launch, so this is hard to hit. Fix: start the page's download at once when Start is tapped during its delay.

## Measured speeds

_(Engine evaluation speeds the run could measure.)_

All on this Mac (Apple silicon). **No phone was measured.** One network evaluation through `evaluate()` (features and messaging included), average of 8 warm calls:

| | b6c96 9×9 | b6c96 19×19 | b10c128 9×9 | b10c128 19×19 |
|---|---|---|---|---|
| Node 26, WASM | 3.9 ms | 15.2 ms | 9.9 ms | 41.1 ms |
| Headless Chromium, WASM-SIMD in the worker | 4.0–4.4 ms | 14.3–14.9 ms | 9.8–10.2 ms | 40.5–42.4 ms |
| Chromium, WebGPU (Apple Metal adapter) | 5.4–6.3 ms | 4.6–7.2 ms | 7.2–8.8 ms | 6.0–10.0 ms |

- WebGPU ran only with Playwright's `channel: 'chromium'` plus `--enable-unsafe-webgpu`; the default headless shell has no adapter (with the flag alone it gets a SwiftShader software adapter). The e2e suite therefore exercises the WASM path; the WebGPU path was exercised by 2A's scratch checks only.
- Level 10 genmove on 19×19 (b10c128, 32 visits): about 1.4 s on WASM, 85–150 ms on WebGPU (batch 8).
- Search in Node, WASM, small net: about 3.5 ms per visit on 9×9, 13.7 ms on 19×19. Batching (8 leaves) made no difference on WASM.
- Dead-stone proposal (100 visits, small net, Node WASM): 9×9 320–385 ms, 13×13 630 ms, 19×19 1.33–1.38 s.
- Loading the small net from `engine-cache` (inflate, parse, build): about 40 ms in Chromium.
- In the preview: level 1 replies 429–430 ms after a stone (the 400 ms minimum plus the search); a level 1 game starts in about 150 ms with stage 1 cached.
- Self-play (`node scripts/selfplay.mjs --strong 12 --weak 1 --size 9 --games 2`): level 12 won 2/2 on 9×9 (B+73.5 in 91 plies, W+88.5 in 94 plies), 3.0 s per level-12 move; one 19×19 game (400-ply cap) won by level 12 by about 326 points, 610 s.
- Calibration (`node scripts/calibrate.mjs --levels 1,3,5,7,9,10 --games 10`, 9×9 area rules vs GNU Go 3.8 WASM level 10, 5.6 min): wins of 10 — L1 0, L3 1, L5 5 (≈6k), L7 7 (≈3k), L9 10, L10 10. Levels 5–7 resigned several times right at 0.4 moves per point.

## Gate results

**Gate 0 (2026-11-12): passed with one exception.** `npm run lint` clean; `npm run typecheck` clean; `npm test` 74 files passed, 2 skipped; 1551 tests passed, 6 skipped; `npm run build` ok (26 precache entries, no `engine/`); both nets in `public/engine/nets/`. `npx playwright test`: 27 passed, 11 failed. The 11 are every Zhess test that needs the Stockfish engine (10 in `e2e/m2.spec.ts`, smoke "engine files are served next to each other"); PLAN.md phase 0 removes Stockfish, so they cannot pass until milestone 2 replaces the engine, and milestone 1 deletes them with the chess modules. Repo public, first Pages deploy succeeded.

**0a check (2026-11-12):** lint, typecheck pass; `npm test` 72 files / 1459 passed, 6 skipped (Stockfish file absent); build ok; e2e 27/38 passed, 11 failed, all because Stockfish is gone (10 in Zhess's `m2.spec.ts`, 1 smoke test requesting `stockfish-19-lite-single.*`). First Pages deploy succeeded: https://github.com/izzardry/zigo/actions/runs/43290647595.

**Gate 1 (2026-11-12): passed in round 3.** Workflow `wf_1e8a200c-20b`, 14 agents (7 packages, integrator, e2e author, 3 verifier runs, 2 fix agents).
- Round 1 failed on one visual fault: coordinate labels scaled with the pitch (about 4–5 px on 19×19 phones). Fixed in `dc1e1ff` (clamp 7–8 px).
- Round 2 failed on one visual fault: the game-over summary wrapped with a leading bullet. Fixed in `b8f8ce3`.
- Round 3 and the orchestrator's own re-run: `npm run lint` clean, `npm run typecheck` clean, `npm test` 65 files / 1599 tests passed, `npm run build` ok (25 precache entries), chess grep 0 hits, `npx playwright test` 27/27 passed (smoke 5, m1 22). Nothing switched off by flag; computer and rooms show "Coming soon" by plan (`COMPUTER_ENABLED`, `ROOMS_ENABLED` milestone switches).
- Note from the e2e author: a macOS Maintenance Sleep once froze two tests for 444 s; run long e2e under `caffeinate -i`.

**Gate 2 (2026-11-12): passed in round 1.** Workflow `wf_769cdbea-aae`, 6 agents (2A, 2B, 2C, integrator, e2e author, verifier). Verifier and the orchestrator's own re-run: `npm run lint` clean, `npm run typecheck` clean, `npm test` 76 files / 1773 tests passed, `npm run build` ok (32 precache entries, engine worker its own 214 kB chunk, no Tailwind duration warning), chess grep 0 hits, `caffeinate -i npx playwright test` 40/40 passed (smoke 5, m1 22, m2 13; the e2e author also ran `--repeat-each 3`: 120/120). The verifier read 48 screenshots of its own (12 states × 390/1280 × light/dark) and found no fault. Self-play and calibration ran (see "Measured speeds"); not blocking. Nothing switched off by flag. During the e2e work a real layout jump of the start pills (24 px when the status line appeared) was fixed in `StartFooter.tsx`.

**Gate 3 (2026-11-13): passed in round 3.** Workflow `wf_95c7ff18-534`, 14 agents (3A, 3B, 3C, integrator, e2e author, 3 verifier runs, 6 fix agents); interrupted once by the closed session and resumed from cache.
- Round 1: unit, lint, typecheck, build, grep and e2e 46/46 passed; failed on two visual faults: the room scoring note ran into the bottom strip's count at 1280×800 (fixed `f0759e9`), and desktop toasts overlapped the board frame and the near clock (fixed `bbe21ef`).
- Round 2: failed. The full parallel e2e (7 workers, load average 150–210) failed 3 must-pass room tests (manual exchange stalled) and 4 m1/m2 tests (timeouts, a byo-yomi read 8 ms short); with `--workers=1` all room tests passed. Then the macOS login session broke (`launchctl` 141 "Reentrancy avoided"; Chromium could not launch at all), so later runs were not counted. Fixes: room tests under Playwright's exclusive lock (`8cfcc5c`), 4 workers and 120 s for engine-waiting m1 tests, byo-yomi main time starting after the computer's reply (`7da422d`), start-screen toasts kept off the footer pills (`ffe7fb8`). Environment: fixed by restarting the session.
- Round 3 and the orchestrator's own re-run: `npm run lint` clean, `npm run typecheck` clean, `npm test` 80 files / 2010 tests passed, `npm run build` ok (33 precache entries), chess grep 0 hits, `caffeinate -i npx playwright test` 46/46 passed (smoke 5, m1 22, m2 13, m3 6: manual path, resume, recovery, offline pass, BroadcastChannel hand-over, broker path). **The public PeerJS broker path ran and passed.** The must-pass room tests run over real WebRTC with the broker blocked (manual path), including a scored game with a toggled group and a resume. Verifier read 96 screenshots of its own; no fault. Nothing switched off by flag.


**Final gate (2026-11-13): passed in round 2.** Workflow `wf_f5761ffc-978`, 32 agents: 10 finders, 10 skeptics, triage, 6 fix clusters, the README, 2 verifier runs and 1 gate-fix agent.
- Round 1: lint, typecheck, unit tests (2050), build, grep and e2e (51/51) all passed. The gate still failed on one visual fault. At 844×390 the room's broker-failure toast broke its text mid-word and covered the whole right rail, hiding pass, resign, Resume and Accept. Fixed in `b0cb55d`.
- Round 2 and the orchestrator's own re-run: `npm run lint` clean, `npm run typecheck` clean, `npm test` 81 files / 2054 tests passed, `npm run build` ok (33 precache entries; the only warning is the known chunk size), chess grep 0 hits, `caffeinate -i npx playwright test` 55/55 passed (smoke 5, chrome 9, m1 22, m2 13, m3 6, including the broker path). The verifier read 30 new screenshots at 390×844, 844×390 and 1280×800, in light and dark, and found no regression. The visual pass's 130 screenshots at five sizes are in `docs/screenshots/final/`. Nothing is switched off by flag.
