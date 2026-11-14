# Zengo — design document

**Zero Distractions. Just Go.**

Zengo is the izzardry Go game: a monochrome, monospaced, no-frills 2D Go board that can be played against the computer, by two people on one device, or by two people in a serverless peer-to-peer room.

Zengo is the sibling of [Zhess](https://github.com/izzardry/zhess), the izzardry chess game. It keeps Zhess's visual style, screen flow, start screen, rooms, history, sharing and platform behaviour, and swaps everything about chess for everything about Go. This document records every product and technical decision taken before the first line of code. It is the specification for the implementation.

- **Status:** agreed design, nothing implemented yet
- **Date:** 2026-11-12
- **House style:** [Ztyle](https://github.com/izzardry/ztyle) at rev `61047cb` or later (pushed 2026-11-12), which already teaches the rules learned from Zhess. Where this document is silent, do what Zhess does (`~/Workspace/zhess`, rev `a6458ff`, its `DESIGN.md` and code); where Zhess is silent, do what Ztyle says.
- **Research:** [docs/research/engines.md](docs/research/engines.md) (Go engines in the browser) and [docs/research/go-rules-and-ux.md](docs/research/go-rules-and-ux.md) (rules, formats, clocks, UX, terminology). Facts marked **[V]** there were verified against sources on 2026-11-12.

Decisions marked **(interview)** were chosen explicitly by the owner. Decisions marked **(derived)** follow from those choices, from Zhess, from Ztyle or from the research, and were filled in while writing; they are open to correction. Decisions marked **(Zhess)** are carried over from Zhess unchanged.

---

## 1. Summary of decisions

| Area | Decision |
|------|----------|
| Modes | Vs computer, pass-and-play, peer-to-peer room. No free analysis board. **(Zhess)** |
| Board sizes | 9×9 (default), 13×13 and 19×19, chosen by a size pill. **(interview)** |
| Scoring | A setting per game: area (Chinese, komi 7.5, default) or territory (Japanese, komi 6.5). It lives behind a hold on the size pill. **(interview)** |
| Handicap | 2–9 stones on fixed star points, picked by holding the color pill. Komi 0.5. **(interview)** |
| Game end | Two passes open scoring: the engine proposes dead stones, either player taps groups to toggle, both accept. Either player can resume. **(interview)** |
| Computer | KataGo networks run by a TypeScript search in a Web Worker, ported from Web KaTrain (MIT), with TF.js on WebGPU and a WASM fallback. **(interview)** |
| Networks | 6-block net (3.8 MB) on the first launch; 10-block net (11 MB) on demand for levels 8–12, or at once when the app is installed. **(interview)** |
| Levels | 12 levels with the Zudoku names, default 5, plus an approximate kyu/dan rank once it has been calibrated. **(interview)** |
| Rules core | A small pure TypeScript core in `lib/zengo.ts` (no rules library); counting with lightvector's goscorer (MIT). **(derived from research)** |
| Code | Every game has a 6-character game code. For rooms the code is the room. **(Zhess)** |
| Rooms | PeerJS public broker, manual link + QR fallback, STUN only, seat key, longest valid log wins, a series with a running score. **(Zhess)** |
| Room scoring | Dead-stone marks are shared live; the game ends when both accept the same marking; either can resume; after a resume the next two passes score by the engine's marking directly. **(interview)** |
| Scoring offline | Without the engine, marking starts with every stone alive and the players tap the dead groups. **(interview)** |
| Clock | Optional. Fischer and Japanese byo-yomi presets per board size; hold the pill for a custom value. **(interview)** |
| Undo | Free in solo modes with clock restored; takeback request in rooms. **(Zhess)** |
| Colors | Random / black / white pill, default random, remembered. **(Zhess, Go order)** |
| Stones | Theme-stable inks (Black always dark, White always light), `foreground` outline, a soft radial shading. **(interview)** |
| Board | Monochrome: thin grid lines and star points on the `card` surface inside the Zhess frame. **(interview)** |
| Input | 9×9 tap places. 13×13 and 19×19 on touch: a ghost stone, then a second tap commits. Mouse and keyboard place directly. **(interview)** |
| Helpers | Last-move ring, atari glow, ko marker, coordinates and the blunder guard, in one shield toggle. **(interview)** |
| Blunder guard | Against the computer: bounce a stone that drops the score lead by 6 / 8 / 12 points (9 / 13 / 19), or self-ataris 3+ stones; play again within 5 s to commit. **(interview)** |
| Hint | Tap = best point, second tap = top 3; hold = territory preview. **(interview)** |
| Pass / resign | The flag slot: tap = pass (5-second undo in solo modes), hold 500 ms = resign. **(interview)** |
| Computer ending | Levels 5–12 resign below 5 % win rate for 3 turns; levels 1–4 never resign. The computer passes when passing is its best move. **(interview)** |
| Assisted | A hint tap, a territory preview, an undo or a guard bounce marks the game assisted. **(interview)** |
| Premove | None. **(interview)** |
| History | Last 100 games; unfinished games resume, finished games open a replay viewer with "continue from here". **(Zhess)** |
| URL | Code + settings + compact move list (two SGF letters per move). Room links carry the code only. **(Zhess, derived)** |
| Records | SGF export (`Copy SGF`). No import. **(interview)** |
| Pass-and-play | Board fixed; the far player's strip, clock and overlays drawn rotated; a button switches seating. **(Zhess)** |
| Board chrome | Prisoners and komi in the player strips, move strip, coordinates. No sound, no haptics. **(derived)** |
| Room talk | None. **(Zhess)** |
| Presence | One dot in the info pill plus a toast on each change. **(Zhess)** |
| Licence | Zengo is MIT. KataGo networks are CC0; the engine port is MIT; TF.js is Apache-2.0. Nothing GPL ships. **(derived)** |
| Code base | A copy of Zhess's source tree, with the chess-specific parts replaced. **(interview)** |
| Delivery | Three milestones plus an audit (section 16), run unattended as Zhess was. **(interview)** |
| Repository | `github.com/izzardry/zengo`, public, GitHub Pages enabled. Created by the build run's phase 0. **(interview)** |

---

## 2. Brand

| Item | Value |
|------|-------|
| Name | Zengo (wordmark `ZENGO`, `font-light tracking-[0.3em]`), from *Igo* (囲碁), the Japanese name of the game; "go" stays visible. |
| Tagline | `Zero Distractions. Just Go.` |
| Page title | `Zengo - Zero Distractions. Just Go.` |
| Meta description | `Zero Distractions. Just Go. A minimalist Go board for one or two players.` |
| OG description | `A minimalist Go game. 9×9 to 19×19, 12 computer levels, serverless rooms for two, and zero ads.` |
| `author` | `izzardry` |
| PWA `short_name` | `Zengo` |
| Storage prefix | `zengo:` |
| Icon | Ztyle icon standard: `#0d0d0d` tile, a faint thin-stroke 3×3 grid corner, one black and one white stone from the stone set touching diagonally in the center. Grayscale. **(interview)** |
| Live URL | `https://izzardry.github.io/zengo/` |

The name is not translated. The game itself is called *Go* in English, German and Spanish UI text, and *go* in French.

---

## 3. Modes

There are three ways to play. They share one board, one move model and one history.

| Mode | Opponent | Network | Engine download |
|------|----------|---------|-----------------|
| **Computer** | KataGo networks at level 1–12 | none | small net on the first launch; large net for levels 8–12 (section 14) |
| **Two players** (pass-and-play) | a person on the same device | none | only for hints, the territory preview and the scoring proposal |
| **Room** | a person on another device | WebRTC | only for the scoring proposal |

Every game has three settings beyond the opponent: board size, scoring rules and handicap. They are chosen on the start screen, travel in the URL and the room record, and cannot change during a game.

Out of scope: free analysis board, SGF import, variants (other sizes, Atari Go, free handicap placement), spectators, more than two peers, chat, tsumego, joseki libraries, ladder hints, an engine score bar, ratings, accounts, KataGo's human-like model and the 18-block "Insane pack" (both listed as later options in section 17).

---

## 4. Screen flow

Exactly as in Zhess: one route, one stage, the board always centered and never moving. **(Zhess)**

| State | Board | Visible UI |
|-------|-------|------------|
| **Start** | Blurred (8 px, 60 %). Shows an empty board of the selected size, or the position of the game the code refers to. | Wordmark, tagline, code field (top). **Start** pill over the board. Opponent selector, color pill, size pill, clock pill, computer status line, install pill, bounce chevron (bottom). Language (top right). Version stamp (bottom right). |
| **Start, scrolled** | Blurred | Sticky wordmark header, history, back-to-top, support button. |
| **Game** | Sharp, interactive | Back (top left), info pill (top center), help (top right), two player strips at the board edges, toolbar (bottom). |
| **Game, UI hidden** | Sharp | Board and the two clocks only. Tapping empty stage toggles. |
| **Scoring** | Sharp; dead stones faded, territory marked | Same as game; the toolbar becomes the scoring bar (section 8.4). |
| **Review** | Sharp, read-only | Same as game; toolbar changes to stepping controls. |
| **Overlay** | Blurred behind scrim | Game-over overlay, tutorial, manual-connect sheet. |

Mobile landscape uses rails as in Ztyle and Zhess: info and player strips on the left, toolbar on the right.

### 4.1 Start screen

```
               Z I G O
      Zero Distractions. Just Go.

               K7QW2M  ✎
              game code

          ┌───────────────┐
          │   (blurred)   │
          │    [ START ]  │
          │               │
          └───────────────┘

         ‹  COMPUTER · LEVEL 5  ›
                 Medium
                  ≈12k
     [ ◐ random ] [ ▦ 9×9 ] [ ⏱ off ]
        ✓ COMPUTER READY OFFLINE
                   ⌄
```

**Opponent selector.** As in Zhess: `ROOM` · `TWO PLAYERS` · `COMPUTER 1 BEGINNER` … `COMPUTER 12 INSANE`. Remembered; first-run default `COMPUTER 5 MEDIUM`. Under the level name, a faint third line shows the approximate rank (`≈12k`) for levels whose rank has been calibrated (section 10.2); uncalibrated levels show nothing. **(interview)**

**Color pill.** Tap cycles random → black → white (Black moves first in Go). Default random, remembered. In a room it sets the creator's color for game 1; a joiner sees it dimmed. **(Zhess)**

**Handicap (hold the color pill, 500 ms).** The radial dial opens with `0` (none), `2` … `9` on 13×13 and 19×19, and `0`, `2` … `5` on 9×9. Black receives the stones, on the fixed star points in GTP order (section 8.2), and komi becomes 0.5. The color pill then reads e.g. `● black · H3`; the player's color still decides who takes Black. Remembered per board size. Available in all three modes; in a room the creator's setting applies. **(interview; limits derived from research)**

**Size pill.** Tap cycles `9×9` → `13×13` → `19×19`. Default 9×9, remembered. Changing the size re-renders the blurred preview at the new size and switches the clock pill to that size's presets. **(interview)**

**Rules (hold the size pill, 500 ms).** The radial dial offers `Area` (Chinese scoring, komi 7.5, the default) and `Territory` (Japanese scoring, komi 6.5). The pill shows `9×9` for area and `9×9 · JP` for territory. Remembered. **(interview)**

**Clock pill.** Tap cycles the presets of the current size (section 11); a 500 ms hold opens the custom dial. Remembered per size. **(interview)**

**Computer status line.** As in Zhess, but for the two networks (section 14). **(Zhess, derived)**

**Code field and Start pill.** Exactly as in Zhess, including `START` / `RESUME` / `REVIEW` and "joining is starting with `ROOM`". A code that matches a saved game shows that game's opponent, color, size, rules, handicap and clock, dimmed. **(Zhess)**

With four controls under the opponent stepper, the pills row may wrap to two lines on a 320 px phone; the board preview shrinks to fit as in Zhess's `previewFit`, and the board's own layout box never moves. **(derived)**

### 4.2 Game screen

```
 (←)      [ K7QW2M ● │ LEVEL 5 │ 34. D4 ]      (?)

            ● 3                          4:31
          ┌────────────────────────────────┐
          │                                │
          │          BOARD (N×N)           │
          │                                │
          └────────────────────────────────┘
            ○ 1  +7.5                    5:02 ·3

              [ ↶  ↷ │ 💡  🛡 │ ⚑  ⇪ ]
```

**Info pill** (top center), three cells:

1. Game code, with the presence dot in a room. **(Zhess)**
2. Opponent: `LEVEL 5`, `2 PLAYERS`, or the room score `2 – 1`. **(Zhess)**
3. Move strip: the last move with its number in GTP coordinates (`34. D4`, `35. Pass`). Tapping opens the full move list; tapping a move there jumps to it in review. While a ghost stone is shown, this cell previews its coordinate (`D4?`). **(derived)**

**Player strips.** One strip at the far edge of the board for the far player and one at the near edge. Each holds:

- **prisoners:** a small stone glyph of the captured color and the count (`● 3` on White's strip means White has captured 3 black stones);
- **komi** on White's strip, faint (`+7.5`, `+0.5` with handicap);
- **a `passed` badge** after that player's pass, until the next stone;
- **the clock** (byo-yomi as `0:24 ·3`, section 11), or time used, dimmed, with the clock off.

The strip of the player to move is at full opacity; the other at 50 %. During scoring both strips show the running score instead (section 8.4). **(derived)**

**Toolbar** (bottom center), by mode. Same slots as Zhess; premove and draw offer are gone. **(interview)**

| Slot | Computer | Two players | Room | Review |
|------|----------|-------------|------|--------|
| Undo | one full turn back | one move back | takeback request | step back (hold: to start) |
| Redo | replay | replay | hidden | step forward (hold: to end) |
| Hint | tap best / top 3, hold territory | same | hidden | hidden |
| Helpers shield | yes | yes | yes | yes |
| Seating | hidden | yes | hidden | flip board |
| Flag | tap pass, hold resign | tap pass, hold resign | tap pass, hold resign | "continue from here" |
| Share | yes | yes | invite link | link or SGF |

In scoring the toolbar is replaced by the scoring bar (section 8.4).

---

## 5. Board

### 5.1 Drawing

- The board is an SVG of N×N intersections on the `card` surface, inside Zhess's rounded frame (`rounded-lg bg-foreground/10 p-1 shadow-lg`). Grid lines are 1 px `foreground/40`, the outer lines slightly heavier. Star points are small filled dots (radius ≈ 0.12 cell): 9×9 at 3-3, 3-7, 7-3, 7-7 and 5-5; 13×13 at 4-4, 4-10, 10-4, 10-10 and 7-7; 19×19 at the nine 4-4, 4-10, 4-16 … points. **(interview: monochrome grid)**
- Size from one variable: `--board-size: clamp(280px, min(94vw, 100dvh - 14rem), 768px)` in portrait (14rem stays free for the chrome, as Zhess measured), the landscape rail variant as in Zhess. The intersection pitch is `--board-size / (N + 0.6)`, leaving half a pitch of margin for stones and coordinates on the edge lines. **(derived from Zhess 5.1)**
- **Stones** fill 0.95 of the pitch. Black is filled with `--ink-dark`, White with `--ink-light` (Ztyle tokens: the darker and the lighter of `background` and `foreground`), in both themes, so White always looks white. Each stone has a thin `foreground` outline, so it contrasts with the board in both themes, and a soft radial shading: a highlight toward the top left of at most `foreground/6` on Black and a shade toward the bottom right of at most `foreground/8` on White, built from the same tokens. No drop shadow. **(interview)**
- The same stone symbols are reused for prisoners, thumbnails, the handicap dial, the move list, the tutorial and the app icon. **(Zhess)**
- Your color is at the bottom of the strips; the board itself never rotates (stones look the same from every side). In review the seating slot flips which strip is near. **(derived)**

### 5.2 Pass-and-play seating

As in Zhess, two seatings switched by the toolbar button and remembered (`zengo:seating`): **face to face** (default on touch) draws the far player's strip, clock, prisoners, passed badge, coordinate labels on the far edges and the scoring bar's far Accept button rotated 180°; **side by side** (default with a mouse) draws everything upright. Stones need no rotation. **(Zhess, derived)**

### 5.3 Point states

Overlays and marks on intersections, in priority order, lowest first.

| State | Visual | Needs helpers |
|-------|--------|---------------|
| Star point | small filled dot under any stone | — |
| Last move | small ring (≈ 0.3 of the stone) in the opposite ink, centered on the last stone | yes |
| Ghost stone | the stone at 45 % opacity, with faint crosshair lines along its row and column; hollow with a small × when the point is illegal | no |
| Hover (fine pointer) | the stone at 30 % opacity, no crosshairs | no |
| Ko point | a small hollow square on the point that cannot be retaken this turn | yes |
| Atari | the mover's own groups with one liberty: each stone gets a `destructive/40` ring, pulsing once when the group enters atari (Zhess's check glow) | yes |
| Blunder warning | the bounced stone pulses `destructive` once at its point, then disappears | yes |
| Hint | `animate-hint-pulse` (green, 800 ms, once) on the best point; numbers 1–3 in a small mono font for the top 3 | — |
| Territory preview | while held: each empty point gets a small square in the owner's ink sized by ownership strength; stones whose owner is the opponent fade to 50 % | — |
| Scoring | dead stones at 40 % with a small ×; territory as small filled squares (≈ 0.3 of a pitch) in the owner's ink; seki and dame points unmarked | — |

Glows and pulses are never clipped by the board edge or by neighbouring points (Ztyle rule learned from Zhess): the board SVG has `overflow: visible`, and pulse layers sit above the stone layer. **(derived)**

State is never shown by color alone: atari is announced in the live region, the ko point has its own shape, and hints move keyboard focus to the point. **(Zhess)**

### 5.4 Coordinates

GTP style: columns `A`–`T` without `I`, rows `1`–N counted from the bottom, drawn faintly (`text-[0.5rem] text-foreground/40`) outside the left and bottom edge lines, inside the frame. Part of the helpers bundle. **(derived from research)**

---

## 6. Interaction

### 6.1 Placing stones

| Input | 9×9 | 13×13 and 19×19 |
|-------|-----|-----------------|
| Touch (coarse pointer) | A tap places at once. A drag shows the ghost following the finger; release places. | First tap or drag: the ghost stone appears with crosshairs; while dragging it floats one finger-width above the touch point and snaps to intersections. A second tap on the ghost (generous hit area, the ghost's cell plus half a pitch) commits. A tap elsewhere on the board moves the ghost; a tap off the board cancels it. **(interview)** |
| Mouse (fine pointer) | Hover ghost; click places. | Same. |
| Keyboard | Arrow keys move a focus ring over the intersections; `Enter` or `Space` places. Typing a coordinate (`D4`) and `Enter` places directly; `P` or typing `pass` + `Enter` passes. `Z` / `Shift+Z` undo and redo; `←` / `→` step in review. **(derived from Zhess 6.1)** |

An illegal point (occupied, suicide, ko, positional superko) never commits. With helpers on, the ghost turns hollow with a ×, and a one-line toast names ko or superko the first time per game. With helpers off, the tap is ignored without comment. **(derived)**

Handicap stones are placed automatically at game start; White moves first in a handicap game. **(derived)**

### 6.2 Passing

- **Tap the flag button = pass.** Against the computer and in pass-and-play, a 5-second undo toast (`You passed · Undo`) can take it back. In a room a pass is a move like any other and is sent at once; a takeback request undoes it. **(interview)**
- After the opponent has passed, the flag button carries a small dot and its `aria-label` says `Pass and end the game`. A second consecutive pass opens scoring. **(derived)**
- A pass shows as `Pass` in the move strip and as the `passed` badge on the player's strip. **(derived)**

### 6.3 Long-press ladder

| Hold | Where | Action |
|------|-------|--------|
| 500 ms | Color pill | Handicap dial |
| 500 ms | Size pill | Rules dial (area / territory) |
| 500 ms | Clock pill | Custom time control |
| 500 ms | Flag button | Resign (tap = pass) |
| 500 ms | Undo / redo in review | Jump to start / end |
| 1000 ms | Hint bulb | Territory preview while held |
| 3000 ms | Help button | Easter egg (donation prompt), as in Zhess |

Each long press suppresses the click that follows, is announced in the `aria-label`, and has a keyboard twin (hold `Space`, or `Shift+Enter`), as Ztyle requires. **(Zhess)**

---

## 7. Helpers and hints

### 7.1 Helpers shield

One toggle, on by default, stored in `zengo:helpers`. It bundles: **(interview)**

- the last-move ring,
- the atari glow,
- the ko marker,
- coordinates,
- the blunder guard (against the computer).

Off is purist mode: a bare grid.

### 7.2 Blunder guard

Active against the computer only, with helpers on. **(interview)**

When the player's turn begins, the engine evaluates the position with the 6-block net (score lead and win rate) and caches it. When the player commits a stone, one more evaluation runs on the position after it. The stone is flagged if:

- the score lead, from the player's view, drops by **6 points on 9×9, 8 on 13×13 or 12 on 19×19** or more, **and** the win rate drops by at least 15 percentage points; or
- the move puts the player's own group of **3 or more stones** into atari where the opponent can capture at once (a rules-only check that needs no engine). Single-stone self-ataris are never flagged: throw-ins, ko and snapback are often good.

**(derived from research; thresholds to be tuned by self-play, preferring a missed blunder to a false bounce)**

A flagged stone is not played. It pulses red once at its point and disappears. Placing the same stone again within 5 seconds commits it. No dialog, no text. The check must finish within about 150 ms; if the engine has not answered, the stone goes through. A bounce marks the game assisted. **(Zhess, interview)**

### 7.3 Hint bulb

Available against the computer and in pass-and-play. Hidden in rooms. **(Zhess)**

- **Tap:** the engine's best point pulses green (Zhess hint pulse). A second tap shows the top three candidates with small numbers `1`–`3` until the next move. The hint never plays the move. **(interview)**
- **Hold 1 s:** territory preview. While held, the engine's ownership map marks every point toward Black or White and fades stones that look dead (section 5.3), with one faint line in the info pill: `B+3.5` (the engine's score lead). Without the engine it shows nothing and the toast says `The computer is still downloading`. **(interview)**
- The best move and ownership are computed while the player thinks, so both appear at once in most cases. **(derived)**

Hints are unlimited. A hint tap, a territory preview, an undo or a guard bounce marks the game `assisted` in history with a small hollow dot. **(interview)**

---

## 8. Rules, scoring and endings

### 8.1 Rules core

`lib/zengo.ts` is a small pure TypeScript core with no React and no DOM, the counterpart of `lib/zhess.ts`. It provides board state, legal moves, captures, suicide (forbidden), ko and **positional superko** for both rule sets, handicap placement, the move codec, SGF export, clock arithmetic and log replay for room sync. No rules library is used: none that is maintained and permissively licensed offers immutable state, positional superko, a codec and SGF together. **(derived from research)**

Counting uses **goscorer** by lightvector (MIT, vendored as one file), which computes both area and territory scores and detects seki, given the agreed set of dead stones. **(derived from research)**

The result of a game is a pure function of `(size, rules, komi, handicap, moves, dead stones)` in integer half points. The engine may propose dead stones, but no device ever computes a result from its own engine output alone: the proposal is data that both sides see and accept. **(derived; this is what keeps rooms deterministic across WebGPU and WASM numerics)**

### 8.2 Rule sets, komi and handicap

| | Area (default) | Territory |
|---|---|---|
| Score | stones on the board + surrounded empty points | surrounded empty points + prisoners |
| Komi | 7.5 | 6.5 |
| Komi with handicap | 0.5, and White receives 1 extra point per handicap stone (Chinese compensation) | 0.5 |
| Ko | positional superko | positional superko (no "no result") |
| Seki | points in seki count for nobody's territory; stones in seki count under area | as area for points; no territory in seki |
| Disputes | play on: filling your own territory costs nothing | playing on costs points, which is accepted |

**(interview: per-game setting; values derived from research)**

Half-point komi makes a draw (jigo) impossible. There is no draw result in Zengo. Custom komi is not offered. **(derived)**

Handicap stones go on the star points in GTP order (19×19 names; 13×13 uses the 4th line and 9×9 the 3rd): 2 = D4 Q16; 3 adds D16; 4 adds Q4; 5 adds the center K10; 6 = the four corners plus D10 Q10; 7 = 6 plus the center; 8 = 6 plus K4 K16; 9 = all nine star points. On 9×9 the limit is 5. **(derived from research, GTP spec)**

### 8.3 Endings

The game ends on:

- **two consecutive passes** → scoring (8.4);
- **resignation** (hold the flag 500 ms; against the computer and in pass-and-play a 5-second undo toast can take it back; final in a room);
- **time** (the clock of the player to move runs out, including the last byo-yomi period);
- **the computer resigning** (section 10.4).

Superko makes a move illegal; it never ends the game. **(derived)**

### 8.4 Scoring

After two consecutive passes, the board enters scoring. Clocks stop. **(interview)**

1. **Proposal.** The engine runs a short search (about 100 visits on the 6-block net, or the 10-block net if present) and proposes dead stones from its ownership map, using OGS's thresholds: a stone whose point has ownership of 0.7 or more toward the opponent is dead. Without the engine, every stone starts alive. **(interview, derived)**
2. **Adjust.** Tapping a stone toggles its whole group between alive and dead. Territory and the score update at once. Keyboard: focus a stone and press `Enter`. **(interview)**
3. **Score line.** Both strips show the current count: area `B 45 · W 40 + 7.5`, territory `B 12 + 3 · W 10 + 1 + 6.5` (territory + prisoners + komi). **(derived)**
4. **Scoring bar** replaces the toolbar: **Resume** (ghost) and **Accept** (primary). In face-to-face pass-and-play each side gets its own Accept, rotated for the far player. **(derived)**
   - **Computer:** Accept ends the game with the marking as shown; the computer agrees to any marking. Resume returns to play with the player to move. **(derived)**
   - **Pass-and-play:** one Accept (side by side) or both Accepts (face to face) end the game. **(derived)**
   - **Room:** section 9.7.
5. **After a resume**, play continues. If the game reaches two consecutive passes again, it is scored at once by the engine's proposal (or, without an engine on the scoring device, with every stone alive), with no second marking round, so a dispute cannot loop. **(interview)**

The scoring position, marks and acceptances are part of the saved game, so a reload during scoring returns to the same marks. **(derived)**

### 8.5 Game-over overlay

As in Ztyle and Zhess: the page tints over 1000 ms, then the overlay appears. **(Zhess)**

| Outcome for the device's player | Tint | Glyph | Title |
|---------------------------------|------|-------|-------|
| Win | `success/12` | 🎉 | `You won by 4.5!` / `You won by resignation!` / `You won on time!` / `Level 8 resigned. You won!` |
| Loss | `destructive/12` | none | `Lost by 4.5` / `Resigned` / `Out of time` |
| Pass-and-play | none | 🎉 | `Black wins by 4.5!` / `White wins by resignation!` |

Summary line: `K7QW2M • 9×9 • Level 5 • 54 moves • 12:08`. For a scored game a second line gives the count, as in the score line of 8.4. **(derived)**

Actions: ghost **Share**, primary **New game** (computer, pass-and-play) or **Rematch** (room). Tapping the scrim dismisses the overlay to look at the board with its final marking. The one-time donation prompt follows the first win after 1.5 s. **(Zhess)**

---

## 9. Rooms

Rooms work exactly as in Zhess section 9: the code is the room, creating and joining are one action, the seat key with HMAC challenge-response, the five reconcile rules, recovery with one Allow toast, offline moves in untimed games, requests, clocks paused on disconnect, the manual link/QR fallback, presence, protocol versioning and the Web Locks tab guard. Only the differences are listed here. **(Zhess)**

### 9.1 Identifiers

- PeerJS peer id `zengo-<CODE>`; Web Lock `zengo:room:<CODE>`; storage `zengo:rooms`. **(derived)**
- The `welcome` message also carries the game settings chosen by the creator: `{key, seat, tc, color, size, rules, handicap}`. A joiner sees them dimmed on the start screen. **(derived)**

### 9.2 Game log

```ts
type GameLog = {
  n: number;          // game number within the room, 1-based
  epoch: number;      // incremented on every accepted takeback
  plies: Ply[];       // { m: string /* two SGF letters, "tt" = pass */, ms: number }
  scoring?: Scoring;  // present after two consecutive passes
  end?: { result: Result; by: Termination };
};

type Scoring = {
  round: 1 | 2;            // 2 = after a resume: scored directly, no marking round
  rev: number;             // incremented on every toggle; the higher rev wins a reconcile
  dead: string[];          // dead stones as sorted SGF points
  accepted: [number, number];  // the rev each seat accepted, 0 = none
};

type Result = { winner: 'B' | 'W'; by: 'score' | 'resign' | 'time'; margin?: number /* half points ×2 */ };
```

Reconcile gains one rule after Zhess's five: with equal `n`, `epoch` and plies, the higher `scoring.rev` wins; with equal `rev` and different `dead`, seat 0's copy wins (it cannot happen in normal play). Adopted plies are replayed through `lib/zengo.ts`, positional superko included. **(derived)**

### 9.3 Offline moves and passes

As in Zhess: in an untimed room game the player to move may place a stone or pass while the opponent is away; it is delivered on the next connection. Scoring needs both players: while disconnected, the scoring bar shows `Scoring continues when your opponent is back`, and marks made offline are kept and synced through `rev`. **(derived)**

### 9.4 Requests

| Request | Trigger | Effect when accepted |
|---------|---------|----------------------|
| Takeback | Undo button | As in Zhess. It also works during scoring: it cuts the second pass and ends scoring. |
| Rematch | Overlay button | Game `n+1` with the same size, rules, handicap and time control. Colors swap, except in a handicap game, where the player who took Black keeps it. |

There is no draw request and no redo in a room. Score: a win adds 1 to the winner. **(derived)**

### 9.5 Scoring in a room

- Every toggle is sent as `mark {n, epoch, rev, dead}` and shown on both boards at once. Any toggle by either player clears both acceptances. **(interview)**
- **Accept** sends `accept {n, rev}`. The game ends when both seats have accepted the same `rev`: each device computes the identical result from the shared `dead` set and stores it. **(interview)**
- **Resume** sends `resume {n, epoch}`: scoring is dropped and play continues with the player to move. In round 2, the second consecutive pass is scored at once from seat 0's engine proposal, which seat 0's device sends as `end {n, result, by: 'score', dead}`; seat 1 adopts it as data. If seat 0 has no engine, every stone counts alive. **(interview, derived for determinism)**
- The initial proposal comes from seat 0's engine too, sent as the first `mark` with `rev: 1`. If seat 0 has no engine but seat 1 has, seat 1 proposes. **(derived)**

### 9.6 Protocol additions

| Message | Purpose |
|---------|---------|
| `move {n, epoch, i, m, ms}` | `m` is two SGF letters or `tt` for a pass. |
| `mark {n, epoch, rev, dead}` | A scoring proposal or toggle. |
| `accept {n, rev}` | Acceptance of a marking. |
| `resume {n, epoch}` | Leave scoring and play on. |
| `end {n, result, by, dead?}` | Resign, time, or a round-2 score. |

The protocol version `v` starts at 1 for Zengo. Zengo and Zhess peers never meet (different id prefixes). **(derived)**

### 9.7 Clocks in a room

As in Zhess 9.8, with byo-yomi: the remaining main time, the current period and the periods left are derived purely from the per-ply `ms` log and the time control, so both devices agree after every sync. Clocks stop during scoring. **(derived)**

---

## 10. Computer opponent

### 10.1 Engine

- **KataGo networks run by a TypeScript search in a Web Worker.** The KataGo C++ program cannot run on GitHub Pages: every browser build needs threads, and threads need COOP/COEP headers that Pages cannot send. A search written in TypeScript, with the network run single-threaded in WASM or on WebGPU, needs no headers. **(interview, research [V])**
- **Starting point:** the engine of [Web KaTrain](https://github.com/Sir-Teo/web-katrain) (MIT; a TypeScript KataGo reimplementation running as an offline PWA on GitHub Pages): network loader, input features, PUCT search with LCB, ownership, and KaTrain-style weak-bot strategies. It is ported, not linked, into `src/lib/engine/katago/`, keeping its licence notice. **(derived from research)**
- **Runtime:** TF.js 4.22.0, pinned and self-hosted, with the WebGPU backend when the worker can get an adapter and a warm-up evaluation matches the WASM result on a fixed position, otherwise the WASM-SIMD backend (single-threaded). The choice is remembered per device (`zengo:engine-backend`). **(derived)** Plan B if TF.js fails: ONNX Runtime Web (adds 3.8–6.9 MB).
- **Networks** (both CC0):
  - `g170-b6c96` (3.83 MB): levels 1–7, the blunder guard, hints and the scoring proposal;
  - `g170e-b10c128` (11.1 MB): levels 8–12.
- `useZengoEngine` owns the worker and mirrors Zhess's driver rules (lazy, one search at a time, queueing, `stop`, failure state): `genmove(position, level, clock?)`, `evaluate(position, {visits | timeMs}, timeoutMs?)` → `{winrate, scoreLead, ownership, policy}`, `analyze(position, n)` → top-n moves, `stop()`. A position is `{size, rules, komi, handicap, moves}`. **(derived)**

### 10.2 Levels

Twelve levels reuse Zudoku's names; default 5. The rank column is a target; the rank shown on the start screen comes only from calibration (Node self-play against GNU Go, section 15.4), prefixed `≈`, for 19×19 strength. **(interview)** Starting values, to be tuned:

| # | Name | Target | Method |
|---|------|--------|--------|
| 1 | Beginner | ~30–25k | b6c96 policy sampled at high temperature among legal moves that don't fill own eyes; 30 % of moves random among "reasonable" (policy > 0.1 %); captures a group in atari only half the time. |
| 2 | Novice | ~22k | KaTrain calibrated-rank pick, rank 22, b6c96 |
| 3 | Easy | ~18k | rank 18, b6c96; from here on never self-ataris a group of 4+ stones |
| 4 | Casual | ~15k | rank 15, b6c96 |
| 5 | Medium | ~12k | rank 12, b6c96 |
| 6 | Moderate | ~9k | rank 9, b6c96 |
| 7 | Tricky | ~6k | rank 6, b6c96 |
| 8 | Hard | ~3k | rank 3, b10c128 |
| 9 | Tough | ~1k | b10c128 raw policy, low temperature |
| 10 | Expert | ~2d | b10c128, 16–32 visits |
| 11 | Master | ~4d | b10c128, 64–200 visits (WebGPU) or as many as fit in 3 s |
| 12 | Insane | ~5d on CPU, stronger on WebGPU | b10c128, as many visits as fit in 3 s, or 1/30 of its remaining clock if longer |

On 9×9 and 13×13 the same methods apply with visit counts scaled by board area. Levels 1–7 cost one network evaluation per move. The computer answers after at least 400 ms, and respects its own clock in timed games. Strength on levels 10–12 depends on the device; that is stated in the help text, not hidden. **(derived from research)**

### 10.3 Undo against the computer

As in Zhess: undo steps back one full turn, redo replays both moves, and if the player is White in an even game (or Black in a handicap game, where White moves first) and undoes the very first turn, the computer moves again. **(Zhess)**

### 10.4 Passing and resigning

- The computer passes when passing is its best move; it never passes while a point is still contested. When the player passes and the computer's best move is also pass, the game goes to scoring. **(interview)**
- Levels 5–12 resign when the computer's win rate stays below 5 % for 3 of its turns, past the opening (at least 0.4 moves per board point played) and only if it trails by more than a few points. Levels 1–4 never resign, so beginners finish their games. **(interview; thresholds from KataGo's defaults)**

---

## 11. Clock

The Zhess clock engine is kept: `performance.now()` deltas, ms per ply, pause on hidden tab in solo modes, restore on undo, log-derived in rooms. Japanese byo-yomi is added. **(interview)**

| Size | Presets (tap cycles) |
|------|----------------------|
| 9×9 | `off` · `2+7` · `3+10` · `5m 5×30s` |
| 13×13 | `off` · `3+7` · `5+10` · `10m 5×30s` |
| 19×19 | `off` · `5+7` · `10+10` · `20m 5×30s` · `30m 5×60s` |

**(derived from OGS quick-match presets)**

- **Fischer** `m+s`: main time in minutes, increment in seconds, added after each completed move. **(Zhess)**
- **Byo-yomi** `Mm P×Ss`: main time, then P periods of S seconds. A move made inside a period keeps it; overrunning a period uses it up; the last period running out loses. **(interview)**
- **Custom dial** (hold 500 ms): first the system (Fischer / byo-yomi), then minutes, then increment seconds (Fischer) or period seconds then periods `1 · 3 · 5 · 10` (byo-yomi). **(derived)**
- **Display:** main time `m:ss`; in byo-yomi the period countdown and the periods left, `0:24 ·3`; below 10 s `font-bold` and tenths; at 0 `0.0` in `destructive`. **(Zhess, derived)**
- Stored as `5+7` or `20m5x30` in the URL and records. **(derived)**
- With the clock off, time used per ply is still recorded and shown in history and review. **(Zhess)**

---

## 12. History and review

### 12.1 Stored game

```ts
type SavedGame = {
  id: string;                 // code for solo games, `${code}.${n}` for room games
  code: string;
  mode: 'computer' | 'local' | 'room';
  level?: number;             // computer only
  color: 'B' | 'W';           // this device's side; 'B' in pass-and-play
  size: 9 | 13 | 19;
  rules: 'area' | 'territory';
  handicap: number;           // 0 or 2–9
  tc: string | null;          // "5+7", "20m5x30" or null
  moves: string;              // compact encoding, section 13.2
  ms: number[];               // time used per ply
  scoring?: Scoring;          // during or after scoring
  result?: Result;
  assisted: boolean;
  room?: { n: number; epoch: number };
  createdAt: number;
  lastPlayedAt: number;
};
```

Saved on every move, pass, undo, redo, scoring toggle and result; last 100 kept; the 15-second "last played" rule; session-only redo. **(Zhess)**

### 12.2 History list

As in Zhess. Each card shows a thumbnail of the board (stones only, star points, no coordinates), the code (and room number and score), the opponent, the size (`9×9`), the state (`Your move`, `Their move`, `Scoring`, or the result `Won by 4.5`, `Lost`, `B+R`), the move count, the time control, the relative time and the assisted dot. **(derived)**

### 12.3 Review

As in Zhess: read-only board, stepping with undo/redo, hold to jump, arrow keys and swipe, the move list popover, clocks as they stood. The final position shows the agreed dead stones and territory. **(Zhess, derived)**

- **Share** offers the link and `Copy SGF`.
- **Continue from here** starts a new solo game from the shown position with a new code, at the same size, rules and handicap. **(Zhess)**

---

## 13. Persistence and sharing

### 13.1 Storage keys

| Key | Content |
|-----|---------|
| `zengo:games` | `SavedGame[]`, at most 100 |
| `zengo:rooms` | `Room[]` (as Zhess) |
| `zengo:opponent` | last opponent selector value |
| `zengo:color` | `random` / `B` / `W` |
| `zengo:size` | `9` / `13` / `19` |
| `zengo:rules` | `area` / `territory` |
| `zengo:handicap` | `{9: n, 13: n, 19: n}` |
| `zengo:clock` | `{9: tc, 13: tc, 19: tc}` |
| `zengo:helpers` | `'true'` / `'false'` |
| `zengo:seating` | `face` / `side` |
| `zengo:engine-backend` | `webgpu` / `wasm` |
| `zengo:lang` | language code |
| `zengo:tutorial-seen`, `zengo:donation-shown`, `zengo:install-dismissed` | flags |

All values JSON, every read guarded. **(Zhess, derived)**

### 13.2 URL

`HashRouter`, state in the query string, written with `replace: true`. Zhess's letters are kept; Go adds three.

| Param | Meaning |
|-------|---------|
| `s` | game code |
| `d` | computer level 1–12 |
| `p` | `1` = playing |
| `o` | opponent: `c` computer, `l` local, `r` room |
| `w` | this side: `B` or `W` |
| `t` | time control, e.g. `5+7`, `20m5x30` |
| `n` | board size: `9`, `13`, `19` |
| `g` | rules: `a` area (default, may be omitted), `t` territory |
| `h` | handicap stones |
| `m` | moves |
| `r` | result (as in Zhess) |
| `x`, `y` | manual signalling offer and answer (transient) |

**Move encoding.** Each move is two SGF letters (`a`–`s`, column then row from the top); a pass is `tt`. Handicap stones are not in `m`; they follow from `h`. A 250-move 19×19 game is a URL of about 560 characters, which still fits a QR code of version 16. **(derived from research)**

Sharing works as in Zhess: a solo game sends the full URL (a new local game for the receiver); a room sends `?s=<CODE>&o=r` only; a finished game sends the full URL or SGF. Share texts: `Join my Go game!` (room), `Look at this Go game.` (solo), `I beat Level {level}! Can you?` (win against the computer). **(Zhess)**

### 13.3 SGF export

`Copy SGF` writes FF[4] with `GM[1]`, `CA[UTF-8]`, `AP[Zengo:<version>]`, `SZ`, `KM`, `RU[Chinese]` or `RU[Japanese]`, `HA` and `AB` for handicap, `PB` / `PW` (`Zengo Level 5` for the computer), `DT`, `RE` (`B+4.5`, `W+R`, `B+T`), `TM` and `OT` for the clock, and moves with `B[]` / `W[]` for passes. No import. **(interview, derived)**

---

## 14. Platform

Everything in Ztyle chapter 12 and in Zhess section 14 applies unchanged: PWA manifest with relative icon paths, network-first HTML, update toast with hourly check (no automatic reload during a game), version stamp, install sheet and pill, GitHub Pages with `base: "./"` and absolute `og:image`. **(Zhess)**

**Engine downloads** (the Zhess pattern, in two stages): **(interview)**

1. **Stage 1, on the first launch:** the engine worker's TF.js backends and the 6-block net, about 4.2 MB, downloaded by the page into `engine-cache` after the first paint, with progress, and served `CacheFirst` by the service worker. Save-Data waits for a tap.
2. **Stage 2, on demand:** the 10-block net (11 MB) starts downloading in the background the first time a level of 8 or higher is selected, or at once when the app runs installed (`display-mode: standalone`), so an installed app is fully offline.

Every launch checks both stages again and downloads anything iOS has evicted; the app requests `navigator.storage.persist()`.

**Status line** under the pills:

| State | Text |
|-------|------|
| Stage 1 downloading | `Computer 43%` with a thin bar |
| Stage 1 ready, level 1–7 selected | `✓ Computer ready offline` |
| Level 8–12 selected, stage 2 downloading | `Levels 8–12 · 43%` with a thin bar |
| Level 8–12 selected, stage 2 missing offline | `Levels 8–12 need a connection` |
| Both ready | `✓ Computer ready offline` |
| Failure | `Download failed · Retry` (tap) |

Starting a level 8–12 game before stage 2 is complete shows Zhess's spinner with progress on the Start pill; offline, the Start pill does nothing and the status line explains why. **(derived)**

Languages: EN, DE, FR, ES, complete including `aria-label`s, following the glossary in the research: atari, ko, komi, seki and byo-yomi stay Japanese in all four; pass, resign, territory, prisoners and handicap are translated (DE `Passen`, `Aufgeben`, `Gebiet`, `Gefangene`, `Vorgabe`; FR `Passer`, `Abandonner`, `territoire`, `prisonniers`, `handicap`; ES `Pasar`, `Abandonar`, `territorio`, `capturas`, `hándicap`); kyu and dan are not translated. No sound, no vibration. Theme follows the system. **(derived)**

### 14.1 Accessibility

- The board is a `grid` of N×N `gridcell`s with labels such as `black stone, D4`, `empty, D4, star point`, `empty, D4, ko`. **(derived)**
- A polite live region announces each move: `Black: D4, captures 2`, `White passes`, `Your group at C3 is in atari`. **(derived)**
- Clocks are `role="timer"`; byo-yomi periods are spoken (`24 seconds, 3 periods`). **(derived)**
- Focus ring from Ztyle; reduced motion shows still marks instead of pulses, as in Zhess. **(Zhess)**
- Toolbar targets at least 44 px. Intersections are below that on 13×13 and 19×19 phones; the ghost-and-confirm input exists for exactly that reason. **(derived)**

### 14.2 Onboarding

A coach-mark tutorial on the first game, dismissed by tapping anywhere, reachable through `?`. It teaches: tap a point to place (on 13×13 and 19×19, tap the ghost again to confirm); tap the flag to pass, hold to resign; the shield; the bulb (tap and hold); after two passes, tap dead groups and press Accept; tap the background to hide the UI. **(derived)**

---

## 15. Technology

### 15.1 Stack

The Zhess stack unchanged: React 18, TypeScript strict, Vite 5 with SWC, Tailwind 3 with the Ztyle preset, the shadcn/ui primitives in use, `lucide-react`, `sonner`, `HashRouter`, `vite-plugin-pwa`, Vitest, Playwright (Chromium). **(Zhess)**

Runtime dependencies besides the Zhess ones minus `chess.js`:

| Package | Purpose | Licence |
|---------|---------|---------|
| `@tensorflow/tfjs-core`, `-backend-webgpu`, `-backend-wasm` 4.22.0 | network inference in the worker | Apache-2.0 |
| goscorer (vendored file) | area and territory counting, seki | MIT |
| KataGo networks `g170-b6c96`, `g170e-b10c128` (static assets) | the computer | CC0 |
| engine port from Web KaTrain (vendored source) | features, search, weak bots | MIT |

`peerjs` and `qrcode-generator` stay. Exact versions are pinned at implementation time. Dev-only: GNU Go 3.8 WASM for calibration in Node (GPL-3.0, fetched by the script, never shipped). **(derived)**

### 15.2 Licence

Zengo source is MIT. The networks are CC0 and sit in `public/engine/nets/` with a README naming their source. The engine port keeps Web KaTrain's and KataGo's MIT notices in `src/lib/engine/katago/LICENSE`. The start screen's scroll area carries a one-line credit: `computer opponent: KataGo networks (CC0), search after Web KaTrain (MIT)`, linking to both. Nothing GPL ships. **(derived)**

### 15.3 Project layout

Zhess's layout, with these replacements:

```
src/
  components/
    board/      GoBoard (SVG), Stone, PointStates, GhostStone, ScoringLayer,
                BoardThumbnail, HandicapDial            (replaces ChessBoard, Square, Piece,
                                                         PromotionDial)
    game/       PlayerStrip (prisoners, komi, passed badge), InfoPill, MoveList,
                StatusBar, ScoringBar, GameOverOverlay
    start/      as Zhess + SizePill, RulesDial; ColorPill gains the handicap hold
    room/       as Zhess
    platform/   as Zhess
  hooks/        useGameState, useZengoEngine, useComputer, useHint, useBlunderGuard,
                useScoring, useClock, useRoom, useEngineOffline (two stages), … as Zhess
  lib/          zengo.ts        pure: board, legality, superko, captures, handicap, codec, SGF
                scoring.ts     pure: goscorer wrapper, area/territory, proposals → marks
                levels.ts      pure: level table and move picker
                clock.ts       Fischer and byo-yomi arithmetic
                sync.ts, room.ts, transport/, url.ts, storage.ts, i18n/ … as Zhess
                engine/        katago/ (port), worker.ts, driver.ts, offline.ts, node.ts
public/         engine/ (TF.js wasm files, nets/, README), icons, og-image, fonts
scripts/        selfplay.mjs, calibrate.mjs, screenshots.mjs, brand images
```

Removed from Zhess: `chess.js`, the Stockfish files, `premove.ts`, `drawOffer.ts`, the promotion dial, PGN. **(derived)**

### 15.4 Testing

- `zengo.ts`: captures (single, multiple groups, edge and corner), suicide refused, simple ko, positional superko (triple ko), handicap placement for every count and size, codec round-trips including passes, SGF export, replay validation. **(derived)**
- `scoring.ts`: fixed fixtures for area and territory on each size, including seki, dame, dead stones inside territory, handicap compensation, half-point komi, and identical results for identical inputs. **(derived)**
- `clock.ts`: Fischer as in Zhess; byo-yomi period use, keep, run-out and undo restore; derivation from a ply log. **(derived)**
- `sync.ts` and `room.ts`: Zhess's suites plus passes, the scoring round (mark, toggle clearing accepts, accept, resume, round-2 end from seat 0, seat 1 proposing when seat 0 has no engine), takeback during scoring, reconcile by `rev`. **(derived)**
- Engine: a golden test that the ported b6c96 evaluation matches Web KaTrain's reference output on a fixed position (in Node, WASM backend); `levels.ts` picker with a seeded PRNG; the guard thresholds against prepared positions. **(derived)**
- `scripts/selfplay.mjs`: level 12 beats level 1 on 9×9 and 19×19. `scripts/calibrate.mjs`: each level against GNU Go level 10 on 9×9 and 19×19, to fit the ranks shown on the start screen. Logged, not blocking. **(derived)**
- Playwright e2e at 390 × 844 and 1280 × 800, as in Zhess, plus a 320 × 568 run for 19×19 ghost placement. **(derived)**

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass before every push. **(Zhess)**

---

## 16. Milestones

| Milestone | Contents | Done when |
|-----------|----------|-----------|
| **M1 · Board** | Copy of Zhess with chess removed; the rules core; the board at three sizes with all input paths and point states; pass-and-play with both seatings, passes, undo and redo; scoring with manual marking (no engine yet) and both rule sets; handicap; resign; game-over overlay; history, review and "continue from here"; URL state and SGF; start screen with size, rules and handicap; PWA shell; i18n; tutorial. | Two people play a 9×9 game to scoring on one phone, agree dead stones by hand, close the app and find the result in history. |
| **M2 · Computer** | Engine port, TF.js worker with WebGPU and WASM, the two-stage download and status line, 12 levels, computer passing and resigning, hint and territory preview, blunder guard, engine dead-stone proposal, clock with Fischer and byo-yomi presets and custom dial, assisted marker, donation prompt, self-play and calibration scripts. | A beginner beats level 1 on 9×9 and a club player loses to level 12, offline, on a phone. |
| **M3 · Rooms** | Zhess's rooms with the Go settings in `welcome`, passes, the scoring sub-protocol (mark, accept, resume, round 2), byo-yomi in rooms, rematch with handicap. | Two phones on different networks finish a series including a scored game with a disputed group; one clears its storage mid-game and is restored with one tap. |
| **Final** | Design and Ztyle audits, code review, visual pass, README, public repository and GitHub Pages. | The Ztyle launch checklist passes and the app is live. |

---

## 17. Risks and open questions

**Risks**

1. **TF.js maintenance.** No release since 4.22.0 (2024-10-21). Pin it and self-host; ONNX Runtime Web is plan B at a larger download.
2. **WebGPU on iOS.** WebGPU in a worker inside an installed iOS PWA is listed as supported from Safari 26 but unconfirmed; the WASM fallback must carry iPhones that cannot run iOS 26. **Accepted for now (owner, 2026-11-12):** assume GPU acceleration is sufficient, implement first, and adjust the level table and backend choice after testing on real devices.
3. **Low-end Android.** The 10-block net on CPU may take 0.5–0.8 s per evaluation, which slows levels 10–12. Levels cap by time, not visits.
4. **Engine numerics differ by device.** WebGPU and WASM do not produce identical floats. This is harmless only because no result is ever computed from a device's own engine output (8.1, 9.5); every test of the scoring protocol must keep it that way.
5. **Blunder guard accuracy and latency.** A raw 6-block evaluation is noisy, and 150 ms on a low-end phone is unproven. The guard prefers missing a blunder to a false bounce and lets the stone through on timeout.
6. **Calibration below 18k.** KaTrain's rank formula is calibrated for roughly 18k–2d; levels 1–2 need Zengo's own tuning and play-testing with real beginners.
7. **Bandwidth.** About 15 MB per installed device against GitHub Pages' soft limit of 100 GB per month. Stage 2 stays on demand for browser visitors.
8. **Territory rules and disputes.** Under territory scoring, resuming to settle a dispute costs points; the round-2 rule ends it, which experienced players may find abrupt.
9. **19×19 on a 320 px phone.** The pitch falls to about 15 px; the ghost-and-confirm input must be tested at that size.
10. **Copying a shipped app.** Starting from a copy of Zhess brings its known limits along (STUN only, the public PeerJS broker, the iOS manual-fallback question); they are documented in Zhess's build log and apply here unchanged.

**Open questions**

- Custom komi (for example 7 with jigo allowed, or 5.5 on 9×9) behind the rules dial.
- Move numbers on stones in review.
- A ladder hint as a teaching aid.
- KataGo's human-like model as a "human style" option for levels 1–9 on WebGPU devices (about 99 MB).
- An opt-in 18-block net for a stronger level 12 on WebGPU (about 58–96 MB), hosted outside GitHub Pages if it becomes popular.
- SGF import.
- Whether Zengo, Zhess and Zudoku should link to each other from their start screens.
