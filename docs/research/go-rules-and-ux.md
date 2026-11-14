# Zengo — Go rules, formats, libraries and UX research

Research input for **Zengo**, a minimalist Go PWA that follows Zhess (`~/Workspace/zhess/DESIGN.md`) as closely as possible.

- **Date:** 2026-11-12
- **Scope:** rules, board sizes, time controls, record formats, JS libraries, mobile UX, Go-specific helpers, ranks and terminology. The choice of computer opponent (engine) is only touched where hints and scoring depend on it. It needs its own research note.
- **Method:** web sources (linked per section) plus source code read directly from OGS (`online-go/goban`, `online-go/online-go.com`), Sabaki, goscorer and the GTP spec, npm/GitHub metadata pulled on 2026-11-12, and a QR size measurement with the `qrcode-generator` package Zhess already ships.

---

## 0. TL;DR recommendations

| # | Topic | Recommendation for Zengo |
|---|-------|-------------------------|
| 1 | Rule set | **One fixed rule set: area scoring with positional superko and suicide forbidden.** This is Chinese-style scoring on a Tromp-Taylor core. Two passes end play and open a **mark-dead-stones phase**. Both players accept, or either one resumes play, which costs nothing under area scoring. After a resume, 4 consecutive passes end the game with the board scored as it stands, so a dispute cannot stall the game (Tromp-Taylor comment 8). No Japanese rules in v1. |
| 1 | Komi | **7.5 on 9×9, 13×13 and 19×19** (OGS and KGS Chinese default; KataGo's fair 9×9 area komi is 7, so .5 avoids jigo). With handicap: **komi 0.5, and White gets +1 point per handicap stone** (Chinese/KGS compensation). Long-press opens custom komi, as the clock dial does in Zhess. Store komi as an integer number of half points. |
| 1 | Handicap | Fixed placement on star points, in GTP order. Allowed: 2–9 on 19×19 and 13×13, 2–5 on 9×9. Free placement is out of scope. |
| 1 | Determinism | The result must be a pure function of `(size, komi, handicap, moves, dead-set)`. **Never let each device compute dead stones on its own.** One device proposes a dead set, the other accepts, and the accepted set is stored in the log. Use integer arithmetic (half points ×2) and fixed-seed Zobrist hashes or exact board strings for superko. |
| 2 | Sizes | **9×9 (default), 13×13, 19×19.** Leave 7×7 out of v1 (fair komi there is about 9, and few people play it). Coordinates: GTP style (`A–T` without `I`, `1–19` counted from the bottom), drawn on the left and bottom edges, part of the helpers bundle. |
| 3 | Clock | Keep Zhess's **Fischer** clock and add **Japanese byo-yomi**. Canadian, simple and absolute are left out. The presets for each size come from OGS quick-match (section 3). Compact labels: `5+7` for Fischer, `20m 5×30s` for byo-yomi. |
| 4 | Record | **SGF FF[4]** replaces PGN for export and import (import optional). URL `m=`: **two SGF letters per move (`aa`–`ss`), with a pass as `tt`.** A 250-move 19×19 game is a ~560-character URL, which fits a QR code of version 16 (EC L) or 19 (EC M). |
| 5 | Libraries | **Write a small rules core** of about 300 lines, the counterpart of `lib/zhess.ts`. No maintained, MIT-licensed JS library offers immutable state, positional superko, a move codec and SGF all together. Optionally vendor **goscorer.js** (MIT, 51 kB, deterministic) for seki-aware scoring and territory display. `@sabaki/sgf` (MIT, maintained) can parse SGF on import. Avoid jgoboard (CC-BY-NC), tenuki and besogo (stale), and WGo 3 (alpha since 2021). |
| 6 | Stone input | **9×9:** a tap places. **13×13 and 19×19 on touch:** the first tap or drag puts a ghost stone with crosshair lines on the board; a drag moves the ghost with an offset above the finger; a second tap on the ghost commits. **Mouse:** hover ghost, click places. **Keyboard:** arrow keys plus typed coordinates (`D4`, `pass`). |
| 6 | Visuals | Grayscale board (no kaya wood). Black stones use the darker of background and foreground, white stones the lighter, with a thin `foreground` outline: the same rule as the Zhess piece fill. The last move is marked by a small ring in the opposite color. Hoshi dots. Prisoner counts in the player strips. Move numbers can be toggled in review. |
| 6 | Pass / resign | A **Pass** button replaces Zhess's draw offer: it is a move, so it gets its own toolbar slot and a 5-second undo toast. The second consecutive pass opens scoring. Resign stays a 500 ms hold on the flag. Go has no draw offer: a .5 komi makes draws impossible. |
| 7 | Helpers | Helpers bundle: last move, coordinates, **atari glow** (replaces the check glow), **ko point marker**, **self-atari guard** (replaces the blunder guard). Hint bulb: tap shows the best move as a pulsing ghost stone; **hold shows a territory/ownership peek** (replaces the threat peek). There is no live score bar, in line with Zhess's "no evaluation bar". |
| 8 | Levels | Keep the 12 Zudoku level names and add an approximate rank as a subtitle (`5 · Medium · ≈15k`). Rank text comes from calibration, never from a guess. Kyu and dan are used in all four languages. Technical terms (atari, ko, komi, seki, sente, gote, jigo, byo-yomi, hoshi, goban) stay Japanese in DE, FR and ES; the everyday actions (pass, resign, territory, prisoners, handicap) are translated. |

### How each Zhess feature carries over

| Zhess | Zengo |
|-------|------|
| Solo vs computer, 12 levels | Same selector. Needs a Go engine; KataGo nets run in the browser through ONNX/WebGPU/WASM (see 7.6). Levels show an approximate rank. |
| Pass-and-play, face to face | Simpler than chess: stones look the same from every side, so only the strips, clocks, prisoner counts, overlays and coordinate labels rotate. |
| WebRTC rooms, longest valid log wins | Unchanged. A ply is a point or a pass. Validation replays through the Go core, positional superko included. New: a scoring sub-protocol (`ask{kind:'score', dead}` / `reply`), a `resume` and an `end{by:'score', dead, score}` (section 1.8). |
| 6-character codes | Unchanged; the peer id becomes `zengo-<CODE>`. |
| URL `m=` codec | Two SGF letters per ply plus `n=` (size), `k=` (komi), `h=` (handicap). |
| PGN export | SGF export (`Copy SGF`, share as a `.sgf` file). |
| Undo / redo, takeback | Unchanged. Against the computer, undo goes back one full turn. Undo is widely accepted Go etiquette for misclicks online (OGS, KGS and Fox all have undo requests). |
| Clock + Fischer increment | Fischer plus Japanese byo-yomi. |
| Hint (tap = best move, hold = threats) | Tap = best move as a pulsing ghost stone; hold = ownership/territory peek. |
| Blunder guard | Self-atari guard without the engine; a point-loss guard with the engine. |
| Draw offer / resign | No draw offer. Pass button; resign by holding the flag. In rooms: "Count" (request scoring) as one more request type. |
| Automatic endings (mate, stalemate, …) | Only two passes, then scoring, plus timeout and resignation. Superko makes moves illegal; it never ends the game. |
| Material `+2` | Prisoner count, plus a score line during scoring (`B 47 · W 52.5`). |
| History of 100, review, "continue from here" | Unchanged. The SGF and thumbnail render the same way. |
| Tap-tap / drag / keyboard / typed SAN | Tap(+confirm) / ghost-drag / keyboard arrows / typed `D4`, `pass`. |
| Monochrome, light/dark | Grayscale goban; stones filled by the Zhess piece rule. |
| 4 languages | Glossary in section 8.3. |
| Offline PWA, engine cached | Same pattern. Network size depends on the engine choice. |

---

## 1. Rules

### 1.1 The major rule sets compared

| | Japanese (1989) / Korean | Chinese | AGA | Ing (GOE) | New Zealand | Tromp-Taylor |
|---|---|---|---|---|---|---|
| Scoring | Territory + prisoners | Area (stones + territory) | Area or territory, always the same result (pass stones) | Area | Area | Area |
| Komi (even game) | 6.5 | 7.5 (3¾ stones; 5.5 before 2001) | 7.5 | 8 (Black wins ties), in practice 7.5 | 7 | none by default; by agreement |
| Suicide | illegal | illegal | illegal | multi-stone suicide legal | multi-stone suicide legal | legal (author's preference) |
| Ko / repetition | basic ko only; long cycles (triple ko) = "no result" | positional superko in principle; a referee may void the game | situational superko | special Ing ko rule | situational superko | **positional superko** |
| Seki | eyes in seki are **not** territory | counted | counted | counted | counted | counted |
| End of game | 2 passes, then agreement; disputes settled by hypothetical play | 2 passes; disputes by continuing play | 2 passes, White passes last; each pass hands the opponent a prisoner | 2 passes | 2 passes | 2 passes (4 passes = as is) |
| Handicap placement | fixed | free | fixed | free | free | free (consecutive Black moves) |
| Handicap compensation for White | none | +n points | +(n−1) points | +n points | none | none |

OGS's engine encodes these defaults directly (`GobanEngine.ts`, `rules` switch). Chinese: komi 7.5, `superko_algorithm="csk"` (treated as positional superko), free handicap placement, `score_handicap=true`. AGA: 7.5, situational superko, `white_must_pass_last`. Japanese and Korean: 6.5, `score_territory_in_seki=false`, `superko_algorithm="noresult"`. Ing: 7.5, self-capture allowed. NZ: 7, situational superko, self-capture allowed. If a handicap is set and no komi is given, OGS keeps only the fractional part of the komi (`komi -= floor(komi)`), so **handicap games get 0.5**.

### 1.2 Area vs territory scoring

- **Area:** your stones on the board plus the empty points surrounded only by you. Prisoners are irrelevant. Playing inside your own territory costs nothing, and capturing dead stones in the opponent's territory costs nothing. This is what makes disputes cheap: you **play it out**.
- **Territory:** empty points you surround plus prisoners. Playing inside your own territory loses a point, so the dead stones must be agreed on, not played out. The Japanese rules need a whole "confirmation" procedure (hypothetical play), and seki eyes are excluded. That rule set is the hardest to implement correctly (goscorer exists exactly for this).
- The two methods agree on the winner in almost all games. They differ by at most about one point (dame parity, seki, handicap stones). AGA pass stones make them agree exactly.

### 1.3 Suicide

Forbidden under Japanese, Chinese and AGA rules; multi-stone suicide is allowed under NZ, Ing and Tromp-Taylor. **For Zengo, forbid it.** Beginners expect it to be illegal, and every major app and server forbids it by default. Implementation: place the stone, remove opposing groups without liberties, and reject the move if the placed group then has no liberties.

### 1.4 Ko and superko

- **Basic ko:** you may not immediately retake a single stone that would recreate the position before the opponent's last move.
- **Positional superko (PSK):** no move may recreate any earlier whole-board position (stones only). **Situational superko (SSK):** the same, but only when the same player is to move. Tromp: "Only in exceedingly rare cases does the difference matter, sufficient reason for the simpler PSK rule to be preferred."
- Japanese rules have no superko. A triple ko or eternal life makes the game "no result", which a serverless app cannot adjudicate.
- **Zengo: positional superko.** It is a pure function of the move list, and a ply can be validated from the log alone. Keep a set of position hashes: 64-bit Zobrist built from a fixed hard-coded seed, or exact board strings, which cost about 361 bytes × 400 positions ≈ 150 kB at worst. Passes do not create positions. Show a basic-ko point with a marker; when a rare superko violation is refused, say so in a toast ("This would repeat an earlier position").

### 1.5 Seki

Under area scoring, stones in seki count and eyes shared in seki count for nobody, so the plain flood fill gives the right answer and nothing special is needed. Under Japanese rules, eyes inside a seki group are not territory; this needs seki detection (goscorer). Area scoring removes the problem, which is another argument for it.

### 1.6 End of game, dead stones, disputes: how others do it

- **KGS:** after two passes, both players click dead stones; the server marks territory with dots; both must press **Done**. The **Undo** button returns to the position before the passes. Under KGS Chinese/AGA/NZ rules, a dispute is resolved by "undo and play out the situation". Under KGS Japanese rules, the Japanese dispute procedure "is not available", and players must accept a neutral third player's judgment.
- **OGS:** a stone removal phase; the server pre-marks stones with KataGo-based autoscore, and both players accept, or either one resumes play (the OGS UI offers this; not re-verified for this note). Since the June 2024 update, removed stones are drawn semi-transparent with a red X, a click marks one string rather than the whole connected group (to protect beginners), clicking a group that is "definitely alive" is refused unless shift-clicked or long-pressed, and auto-sealing has been replaced by warnings about points that still need sealing. Forum threads still document autoscore errors next to weak walls.
- **Fox (forum reports):** a "request counting" button runs an automatic count; if it is wrong, you decline, return to the game and use "mark dead". OGS forum posts criticise Fox's auto-count for marking a seki group dead.
- **Sabaki (desktop editor):** "Estimate" and "Score" modes. Dead stones are guessed with `@sabaki/deadstones` (Monte Carlo, Rust/WASM), and the user corrects them by clicking.
- **BadukPop:** forum users report Japanese-style territory scoring; there is no public documentation of its dispute flow.

**Recommended Zengo flow (works offline, in pass-and-play and in rooms):**

1. Two consecutive passes, so the next player to move cannot place a stone. The board enters **Scoring**.
2. The app proposes a dead set: from the engine's ownership if it is loaded, otherwise from a deterministic heuristic (for example goscorer's own helpers, or a seeded Monte Carlo run). Dead stones are drawn faded with a small ×, and territory as small squares in the owner's color.
3. Either player taps a string to toggle it, one string per tap as OGS does. In a room, each toggle is sent; every change resets both acceptances.
4. **Accept** by both seats (in pass-and-play, one tap by each player, or one shared tap) ends the game with `by: 'score'`.
5. **Resume** sends the game back to play; the opponent of the last passer moves. Under area scoring this costs nothing, so "play it out" is always the fair resolution.
6. **Fallback:** after a resume, if the game reaches 4 consecutive passes (two pairs), it ends **as is**, with no stones removed (Tromp-Taylor comment 8). This guarantees termination without a referee.
7. Against the computer: the engine accepts the human's marking if it agrees with its own ownership and otherwise resumes and plays it out. Like Stockfish in Zhess, the computer never resigns early (that is optional).

### 1.7 Jigo and resignation

- **Jigo** (draw) happens only with an integer komi or when the score is otherwise tied. With 7.5 or 0.5 komi it cannot happen. If a custom integer komi is allowed, support `1/2-1/2` → SGF `RE[0]`.
- **Resignation** ends a large share of games (in the CWI sample resigned games average 186 moves, counted ones 257). Keep Zhess's 500 ms hold on the flag, with an undo toast in solo modes.

### 1.8 Handicap

- **Fixed placement** (GTP spec, also the OGS/KGS default for AGA/Japanese), in Black's coordinates on 19×19:
  2: D4 Q16 · 3: + D16 · 4: + Q4 · 5: + K10 · 6: D4 Q16 D16 Q4 D10 Q10 · 7: 6 + K10 · 8: 6 + K4 K16 · 9: all nine.
  On 13×13 the same pattern sits on the 4th line (D4, K10, D10, K4, sides D7/K7/G4/G10, center G7). On 9×9 it sits on the 3rd line (C3, G7, C7, G3, center E5, sides C5/G5/E3/E7). GTP allows 9 on both sizes; Zengo should cap 9×9 at 5, because one 9×9 stone is worth about 6 ranks. Some Japanese sources put the 3rd stone in a different corner; follow GTP.
- **Komi in handicap games:** 0.5, so White wins a tie (OGS rule). Under area scoring add **+1 point for White per handicap stone** (Chinese/KGS). Otherwise every extra Black stone on the board is worth a point in area counting. AGA uses n−1.
- **Rank difference → handicap:** 1 rank ≈ 1 stone on 19×19; 13×13 scales by about 2.5–4, 9×9 by about 6 ranks per stone (Wikipedia, Go handicaps). Zengo can suggest a handicap against the computer later. v1: a handicap pill `0 · 2 · 3 · … · 9`, dimmed in rooms after the first game.

### 1.9 Which rule set is most robust for a serverless app

**Area scoring, positional superko, no suicide, 2 passes → agreement, 4 passes → as is.**

- Legality is a pure function of the move list (PSK hashes, no adjudicator, no "no result"). The Zhess reconcile ("replay the shorter log, an illegal ply aborts") carries over unchanged.
- The final score is a pure function of the board plus an explicitly agreed dead set. The flood fill is integer-only and trivially deterministic. A Japanese territory count would need seki detection plus a hypothetical-play dispute rule; KGS itself does not implement the Japanese dispute procedure.
- A dispute costs nothing to resolve by playing on, and there is a termination guarantee (4 passes).
- Things that must **not** run independently on each device: Monte Carlo dead-stone guesses (non-deterministic without a seed) and neural-net ownership (floating point differs between WebGPU, WASM and devices). Use them only to make a proposal, which the other device accepts as data.

Sources: [Wikipedia: Rules of Go](https://en.wikipedia.org/wiki/Rules_of_Go) · [Tromp-Taylor rules](https://tromp.github.io/go.html) · [OGS GobanEngine.ts (rule defaults)](https://github.com/online-go/goban/blob/main/src/engine/GobanEngine.ts) · [KGS rule sets](https://www.gokgs.com/help/rulesets.html) · [KGS playing/scoring help](https://www.gokgs.com/help/playing.html) · [Chinese rules (1988 translation)](https://www.cs.cmu.edu/~wjh/go/rules/Chinese.html) · [Japanese 1989 rules](https://badukworld.co.kr/biz/rules/jpn-rules-en.html) · [OGS stone removal and scoring updates (2024)](https://forums.online-go.com/t/stone-removal-and-scoring-updates/52055) · [OGS autoscore failures 2025](https://forums.online-go.com/t/current-autoscore-failures-2025/57581) · [Fox mark dead / counting (L19)](https://lifein19x19.com/viewtopic.php?p=237943) · [KataGo 9×9 book: fair komi 7 area / 6 territory](https://katagobooks.org/9x9highlights.html) · [OGS: fair komi by board size](https://forums.online-go.com/t/what-is-fair-and-perfect-komi-for-stone-scoring/52537) · [GTP2 spec, fixed handicap](https://www.lysator.liu.se/~gunnar/gtp/gtp2-spec-draft2/gtp2-spec.html) · [Wikipedia: Go handicaps](https://en.wikipedia.org/wiki/Go_handicaps) · [@sabaki/deadstones](https://github.com/SabakiHQ/deadstones)

---

## 2. Board sizes

| | 9×9 | 13×13 | 19×19 |
|---|---|---|---|
| Share of OGS games | ~40 % | ~12 % (least played) | ~35–48 % |
| Typical length (moves) | ~50–60 | ~110–120 | ~211 average; ~186 resigned, ~257 counted (range 38–411) |
| OGS quick-match time estimates | blitz ~5 min, rapid ~10, live ~15 | ~10 / ~20 / ~30 | ~15 / ~25 / ~40 |
| Star points (hoshi) | 5: C3 G3 C7 G7 + E5 (3rd line) | 5: D4 K4 D10 K10 + G7 (4th line) | 9: D4 K4 Q4 D10 K10 Q10 D16 K16 Q16 |
| Fair komi, area (KataGo / OGS forum) | 7 | ~7 | 7 (7.5 used) |

- **7×7:** fair area komi is about 9 and the game is close to solved. It fits a beginner lesson, not a game. Leave it out of v1.
- **Default size: 9×9.** It fits a phone, finishes in 10 minutes, and gives the computer a short game. Remember the last size, the same way the Zhess pill state is remembered.
- **Coordinates:** GTP / most servers use columns `A B C D E F G H J K L M N O P Q R S T` (no `I`) from left to right and rows `1–19` from bottom to top (Black's view). SGF uses `aa` = top-left, the first letter for the column and the second for the row counted **from the top**. Pass in GTP is `pass`.
- **Display:** faint letters along the bottom and numbers along the left (same style as Zhess: `text-[0.5rem] text-foreground/40`), in the margin rather than on the points because Go plays on the intersections. Face-to-face seating mirrors the labels to the top and right edges, rotated. The labels belong to the helpers bundle.
- **Cell size:** 19 lines need 20 cells of width including the margins. At 360 px that is about 18 px per point, well below the 34 px Zhess minimum. This is the core of the input problem in section 6.

Sources: [OGS: board size stats, 91k games](https://nbviewer.jupyter.org/gist/thouis/be68b0d138e70b43769c) · [OGS: 27M game sample](https://forums.online-go.com/t/statistics-from-a-27m-game-sample/39850) · [OGS: why is 13×13 less popular](https://forums.online-go.com/t/why-is-13x13-less-popular/58124) · [CWI game length stats](https://homepages.cwi.nl/~aeb/go/misc/gostat.html) · [OGS: average game length by size](https://forums.online-go.com/t/average-game-length-on-different-board-sizes/35042) · [OGS SPEED_OPTIONS.ts](https://github.com/online-go/online-go.com/blob/main/src/views/Play/SPEED_OPTIONS.ts) · [GTP2 spec, coordinates](https://www.lysator.liu.se/~gunnar/gtp/gtp2-spec-draft2/gtp2-spec.html) · [SGF Go properties](https://www.red-bean.com/sgf/go.html)

---

## 3. Time controls

### 3.1 Systems

| System | Rule | Where |
|--------|------|-------|
| **Absolute** | fixed total; flag = loss | KGS, OGS (OGS code treats short absolute clocks, ≤15 min, as "questionable" for timeout abuse) |
| **Fischer** | main time + increment per move, optional cap | OGS (default in quick match, with a `max_time` cap), Zhess |
| **Japanese byo-yomi** | main time, then N periods of T seconds; a move made inside a period keeps it; overrunning a period uses it up | the Go standard: KGS, OGS, Fox, pro tournaments |
| **Canadian** | main time, then M moves within each T-minute block | KGS, OGS, AGA tournaments |
| **Simple** | a fixed time per move | OGS |

### 3.2 Presets offered by OGS quick-match (`SPEED_OPTIONS.ts`)

| Size | Blitz | Rapid | Live |
|------|-------|-------|------|
| 9×9 | Fischer 30s+5s (max 5m) / byo 30s + 5×10s | 2m+7s / 2m + 5×30s | 3m+10s / 5m + 5×30s |
| 13×13 | 30s+5s / 30s + 5×10s | 3m+7s / 3m + 5×30s | 5m+10s / 10m + 5×30s |
| 19×19 | 30s+5s / 30s + 5×10s | 5m+7s / 5m + 5×30s | 10m+10s / 20m + 5×30s |

Correspondence is 3 days + 1 day per move, max 7 days. KGS documents the same systems with examples of 30 min + 5×30 s byo-yomi and 10 min + 20 moves/8 min Canadian. Fox's typical rated settings are byo-yomi (forum reports, not verified).

### 3.3 Compact display

OGS's own short formatters (`TimeControl/util.ts`): Fischer `%s+%s up to %s`, byo-yomi `%s+%sx%s` (e.g. `20m+5x30s`), Canadian `%s+%s/%s` (e.g. `10m+5m/25`), simple `%s/move`.

### 3.4 Recommendation for Zengo

- Keep the Zhess clock engine (performance.now deltas, ms per ply, pause on disconnect) and add **byo-yomi** as a second mode. Its state is derivable from the per-ply `ms` log. Remaining main time and the periods left follow purely from the sequence of `ms`, so the room clocks stay log-derived exactly as in Zhess 9.8.
- **Clock pill per size** (one cycle, Zhess style). The values below follow OGS:
  - 9×9: `off · 2+7 · 3+10 · 5m 5×30s`
  - 13×13: `off · 3+7 · 5+10 · 10m 5×30s`
  - 19×19: `off · 5+7 · 10+10 · 20m 5×30s`
  - The long-press dial picks the system (Fischer or byo-yomi), then minutes, then increment or period length (periods fixed at 5, or a third dial step).
- **Display:** `m:ss` while in main time. In byo-yomi show the period countdown plus the periods left, for example `0:24 ·3` (or three small dots), bold below 10 s as in Zhess. Store as `tc: "5+7"` or `"20m5x30"` in the URL.
- Leave Canadian, simple and absolute out; they add choice without adding value for casual play.

Sources: [OGS SPEED_OPTIONS.ts](https://github.com/online-go/online-go.com/blob/main/src/views/Play/SPEED_OPTIONS.ts) · [OGS TimeControl/util.ts](https://github.com/online-go/online-go.com/blob/main/src/components/TimeControl/util.ts) · [KGS time systems](https://www.gokgs.com/help/timesystems.html) · [OGS GobanEngine.ts (tc kinds)](https://github.com/online-go/goban/blob/main/src/engine/GobanEngine.ts)

---

## 4. Formats

### 4.1 SGF FF[4] essentials

| Property | Meaning / value for Zengo |
|----------|--------------------------|
| `GM[1]` | Go |
| `FF[4]` | file format 4 |
| `CA[UTF-8]` | charset (the default is ISO-8859-1, so always write it) |
| `AP[Zengo:1.2.3]` | application:version |
| `SZ[19]` | board size (`SZ[19:19]` is illegal for square boards) |
| `KM[7.5]` | komi, a real number |
| `RU[Chinese]` | rules; reserved names `AGA`, `GOE`, `Japanese`, `NZ`; `Chinese` is widely used |
| `HA[4]` | handicap count (≥2) **plus** the stones themselves as `AB[dd][pp][dp][pd]` in the root node |
| `PB` / `PW`, `BR` / `WR` | player names; ranks such as `15k` or `2d` |
| `DT[2026-11-12]` | ISO date (mandatory format) |
| `TM[600]`, `OT[5x30 byo-yomi]` | main time in seconds, overtime as free text |
| `RE[B+R]` | result: `B+3.5`, `W+R`/`W+Resign`, `B+T`/`B+Time`, `B+F`, `0`/`Draw`, `Void`, `?` |
| `;B[pd]`, `;W[dp]` | moves; letters a–s; column then row **from the top** |
| `;B[]` / `;W[tt]` | **pass**; `tt` is only valid for boards ≤19×19, kept for FF[3] compatibility; write `[]` |
| `BL` / `WL`, `OB` / `OW` | time left after the move; byo-yomi moves/periods left (optional) |
| `TB` / `TW` | final territory or area points (optional; useful for showing the agreed dead set) |
| `PL` | player to move (only for set-up positions) |

Example record:

```
(;GM[1]FF[4]CA[UTF-8]AP[Zengo:1.0.0]SZ[9]KM[7.5]RU[Chinese]DT[2026-11-12]
PB[Black]PW[Zengo Level 5]RE[W+4.5]
;B[ee];W[gc];B[cg]…;B[];W[])
```

Write exports with `B[]` for a pass. Accept both `[]` and `[tt]` on import (OGS, Fox and older tools emit `tt`). OGS normalises Fox's non-standard `KM[375]` (meaning 7.5 under Chinese half-counting) to 7.5; an import should do the same.

### 4.2 Compact URL move codec

- Number of symbols per move: size² + 1 (pass), so 82, 170 or 362. That is about 8.5 bits for 19×19, or 1.42 base64 characters in theory.
- **Recommended: two SGF letters per ply.** Pass = `tt`, which is unambiguous because `t` lies beyond `s` for every size ≤19. Same length as Zhess (2 characters per ply), URL-safe, human-debuggable, and it copies straight into SGF. Handicap stones are not in `m`; they follow from `h=` with fixed placement.
- An alternative is base-362 packing: 3 plies in 26 bits, 1.45 characters per ply. It saves about 27 % (measured below) at the cost of readability. It is not worth it, because even the long case fits comfortably.
- URL parameters, mirroring Zhess: `s` code, `o` opponent, `d` level, `w` side, `t` clock, plus **`n` size**, **`k` komi** (e.g. `7.5`), **`h` handicap**, and `m` moves. Room links still carry only `s` and `o`.

### 4.3 Size of a record: URL and QR

Measured with `qrcode-generator` 2.0.4 (the Zhess dependency) on a representative URL, `https://izzardry.github.io/zengo/#/?s=K7QW2M&n=19&k=7.5&r=j&m=…` (59 characters before the moves), byte mode:

| Game | URL length | QR version (EC L) | QR version (EC M) |
|------|-----------|-------------------|-------------------|
| 9×9, 60 plies | 181 | 8 (49×49) | 10 |
| 13×13, 120 plies | 301 | 11 | 13 |
| 19×19, 211 plies (average) | 483 | 15 (77×77) | 17 |
| 19×19, 250 plies | 561 | 16 (81×81) | 19 |
| 19×19, 250 plies, base-362 packed | 424 | 13 | 16 |
| 19×19, 350 plies | 761 | 19 | 22 |
| 19×19, 411 plies (longest in the CWI sample) | 883 | 21 (101×101) | 24 |

- Browsers accept URLs far longer than this (Chrome about 2 MB; the old 2,083-character IE limit does not apply). Chat apps and share sheets handle 1 kB links without trouble.
- A QR code up to about version 20 still scans reliably from a phone screen. Use EC level L for game links, as Zhess does for manual signalling.

Sources: [SGF FF[4] properties](https://www.red-bean.com/sgf/properties.html) · [SGF Go-specific properties](https://www.red-bean.com/sgf/go.html) · [OGS GobanEngine.ts (SGF import, Fox KM)](https://github.com/online-go/goban/blob/main/src/engine/GobanEngine.ts)

---

## 5. JavaScript libraries

| Library | Licence | Latest release | Size (unpacked) | What it gives | Verdict |
|---------|---------|----------------|-----------------|---------------|---------|
| `@sabaki/go-board` | MIT | 1.4.3 (2021-09; repo touched 2026-09) | 40 kB, 0 deps | board data type, `makeMove(sign, v, {preventSuicide, preventKo})`, basic ko only, captures, liberties, `analyzeMove` | Clean reference implementation, but **no superko** and not updated in years. Fine to read; easy to beat with our own code. |
| `@sabaki/sgf` | MIT | 3.5.0 (2026-07) | 135 kB, dep `doken` | SGF parse/stringify, encodings | **Good for import.** Maintained. Export is easy to write by hand. |
| `@sabaki/deadstones` | MIT | 2.2.0 (2026-07) | 41 kB + WASM | Monte Carlo dead-stone guess, probability map | Usable as a **proposal** generator. Random, so never authoritative across devices. |
| `@sabaki/influence` | MIT | 1.2.2 | 23 kB | static influence/area heuristics | Possible cheap territory preview without an engine. |
| `@sabaki/shudan` | MIT | 1.8.0 (2026-07) | 814 kB | Preact goban component | Different stack (Preact) and its own look; Zengo needs its own monochrome board anyway. |
| **goscorer** (lightvector) | MIT (2024) | not on npm; repo 2025-04 | `goscorer.js` 51 kB | territory scoring with **seki detection**, plus an area scoring implementation; needs dead stones marked by the user; pure and deterministic | **Vendor it** if Japanese-style display or seki-correct territory marks are wanted. By KataGo's author. |
| `wgo` (WGo.js) | MIT on npm (no licence detected on GitHub) | 3.0.0-alpha.10 (2021) | 596 kB | board renderer, player, SGF | Alpha for 5 years; not needed. |
| `tenuki` | MIT | 0.3.1 (2019) | 5.4 MB | board + rules (superko options, scoring) | Stale. |
| `godash` | ISC | 2.5.4 (2026-04) | 463 kB, deps `immutable` + `lodash` | immutable board, captures, SGF | Heavy dependencies for little gain. |
| `jgoboard` | **CC-BY-NC-4.0** | 5.0.4 (2026-02) | 3.7 MB | board renderer | **Licence excludes it** (non-commercial). |
| `besogo` | MIT | 0.0.2-alpha (2020) | 1.4 MB | SGF editor/viewer | Stale, editor-focused. |
| `glift` | MIT | not on npm; repo 2019 | — | SGF viewer | Dead. |
| `online-go/goban` | Apache-2.0 | active (2026-10) | large | OGS's full engine + renderer (all rule sets, SGF, clocks) | Excellent **reference** for rules and edge cases, but too large and tied to OGS. |
| `online-go/score-estimator` | MIT | 2019 | — | old OGS estimator (C++/WASM) | Superseded by KataGo autoscore. |

**Recommendation: write the rules core yourself** (`lib/zengo.ts`, the counterpart of `lib/zhess.ts`). It is smaller than chess: a flat `Int8Array(size²)`, a flood fill for groups and liberties, capture, suicide check, a positional superko hash set, the pass and end state, an area count, the handicap tables, the codec and SGF out. That is about 300–400 lines plus tests, with no dependency. Zhess's frozen-value-plus-WeakMap-cache pattern fits unchanged. Optionally add `@sabaki/sgf` (import) and vendored `goscorer.js` (territory marks, seki). Test the core against OGS's `GoEngine.test.ts` cases and goscorer's test positions.

Sources: npm registry metadata (`npm view`, 2026-11-12) · [SabakiHQ/go-board](https://github.com/SabakiHQ/go-board) · [SabakiHQ/sgf](https://github.com/SabakiHQ/sgf) · [SabakiHQ/deadstones](https://github.com/SabakiHQ/deadstones) · [lightvector/goscorer](https://github.com/lightvector/goscorer) · [waltheri/wgo.js](https://github.com/waltheri/wgo.js) · [aprescott/tenuki](https://github.com/aprescott/tenuki) · [duckpunch/godash](https://github.com/duckpunch/godash) · [jokkebk/jgoboard](https://github.com/jokkebk/jgoboard) · [yewang/besogo](https://github.com/yewang/besogo) · [Kashomon/glift](https://github.com/Kashomon/glift) · [online-go/goban](https://github.com/online-go/goban) · [online-go/score-estimator](https://github.com/online-go/score-estimator)

---

## 6. Mobile UX for placing stones and reading the board

### 6.1 Precision on a phone

19×19 at a 360 px viewport gives about 18 px per intersection. The problem is well known; apps answer it in several ways:

| Technique | Who | Notes |
|-----------|-----|-------|
| **Submit / confirm button** | OGS: `one-click-submit-live: true` by default, correspondence needs submit (`one-click-submit-correspondence: false`); `double-click-submit-*` option | Safe but adds a button and a tap. |
| **Offset cursor + guide lines + delay** | AI Sensei (2025-07): stone offset above the finger, crosshair lines, the cross turns **green** after a short delay before release counts; later made **off by default** (opt-in), because it slowed play | Shows the cost of a strict mode as the default. |
| **Zoom / cursor / touch input modes** | Champion Go: three selectable modes | The zoom-to-quadrant variant works well on 19×19 but adds a step. |
| **Shift / snap correction** | GridMaster, Igowin "smart move" | Snap to the nearest legal point. |
| **Hold, stone shown above the finger, adjust, lift** | requested and described in lifein19x19 app threads | The classic touch technique. |

**Zengo recommendation** (no settings screen, Zhess spirit):

- **9×9** (cells ≥ 36 px): a tap places immediately. Drag works too: the ghost follows the finger and release places it.
- **13×13 / 19×19 on a coarse pointer:**
  - First tap: the ghost stone appears at the tapped point, with faint crosshair lines along its row and column and its coordinate in the info pill (`D4`).
  - Drag: the ghost follows the finger **offset about one finger width upwards** and snaps to intersections; release leaves it there.
  - A second tap **on the ghost** (generous hit area) commits; a tap elsewhere moves the ghost; a tap off the board cancels.
  - Rationale: it is the Zhess tap-tap model (select, then confirm), one gesture covers both precise and fast play, and a mis-tap never costs a move. This matters most in rooms, where a takeback needs the opponent's consent.
- **Mouse** (fine pointer): a hover ghost at 40 % opacity, and a click places.
- **Keyboard:** arrows move a focus ring over the intersections; Enter/Space places; typing `D4` + Enter places; `P` or typing `pass` passes. This replaces the typed SAN of Zhess.
- **Illegal points** (occupied, suicide, ko, superko): the ghost turns hollow, or shows a small ×, and the commit does nothing. With helpers on, a one-line toast gives the reason for ko or superko.

### 6.2 Board drawing (monochrome)

- **Board:** grayscale, not kaya wood. The board is one flat tone (a `foreground/6–8` overlay on the background) so that black and white stones both contrast in both themes. Grid lines are `foreground/45` at 1 px; the edge lines can be slightly heavier.
- **Hoshi:** filled dots of about 0.12 cell radius at the star points of section 2.
- **Stones:** flat circles, 0.94–0.96 of the cell, no gradient, no shadow. Fill rule as in Zhess pieces: black = the darker of background and foreground, white = the lighter, in both themes, so "white always looks white". Outline: 1 px `foreground` (in the light theme it shows on white stones, in the dark theme on black ones). This is the same idea as the Zhess commit "Keep chess colors in dark mode".
- **Last move:** a small ring (about 0.3 of the stone) in the opposite color in the center of the last stone. This is the common convention on servers and in editors. OGS also offers an accessibility "last-move crosshair" preference.
- **Move numbers:** a toggle in review (OGS has `show-move-numbers`). Numbers are drawn in the opposite color in the mono font, and only the last N are shown during play if ever.
- **Prisoners:** in the player strips, where Zhess shows captured pieces: a small stone glyph plus a count (`● 12`). Under area scoring they do not count, so do not show a `+n` difference. During scoring the strips switch to area plus komi: `B 45` / `W 40 + 7.5`.
- **Atari indication (helper):** a group of the player to move that is down to one liberty gets the Zhess check-glow treatment (`destructive/15` overlay plus a ring, pulsing once). Show it only for the player's own groups; marking the opponent's would play the game for them.
- **Ko indication (helper):** a small hollow square on the point where an immediate retake is illegal (a proposal; most servers simply refuse the click silently).
- **Territory at the end:** small filled squares (about 0.3 of a cell) in the owner's color on empty points; dead stones drawn at 40 % with a ×, as OGS has done since 2024. Seki or dame points stay unmarked.
- **Coordinates:** see section 2.

### 6.3 Pass, resign, undo

- **Pass** is a move and frequent at the end of a game, so it gets its own toolbar button. It must not be hidden behind a hold. In the slot where Zhess put the draw offer: tap = pass, hold 500 ms on the flag = resign. Confirmation the Zhess way: no dialog, a 5-second undo toast (`You passed · Undo`). When the opponent has just passed, the button reads **Pass & count** and a tap opens scoring.
- A passed turn shows in the move strip as `Pass` and in the player strip as a small "passed" badge until the next stone.
- **Undo etiquette:** OGS, KGS and Fox all offer undo requests, and granting one for a misclick is normal courtesy, especially in casual play. Zhess's free undo in solo modes and takeback request in rooms fit Go culture well.

### 6.4 Face-to-face pass-and-play

Go stones look the same from any side, so only the chrome needs rotating: the far player's strip, clock and prisoners, the coordinate labels (the far edges in face mode), the scoring overlay (two Accept buttons, one per side, or one Accept centered between the two sides), and the game-over overlay. Only "Go Baduk Weiqi Master" was found to advertise same-device two-player mode; BadukPop's listings show online and correspondence play only, and Sabaki is an editor. Zhess's face/side seating is already ahead of most Go apps.

Sources: [OGS preferences.ts (one-click / double-click submit, move numbers)](https://github.com/online-go/online-go.com/blob/main/src/lib/preferences.ts) · [AI Sensei: mobile input changes (2025-07-16)](https://ai-sensei.com/news/2E09d) · [Champion Go input modes](https://apps.apple.com/us/app/id493197735) · [lifein19x19: Android Go apps thread](https://lifein19x19.com/viewtopic.php?p=214944) · [lifein19x19: 1g0 viewer thread](https://lifein19x19.com/viewtopic.php?p=231358) · [BGA: confirm placement request](https://uk.boardgamearena.com/bug?id=64326) · [OGS stone removal update](https://forums.online-go.com/t/stone-removal-and-scoring-updates/52055) · [BadukPop App Store](https://apps.apple.com/us/app/id1472684271) · [Go Baduk Weiqi Master (same-device play)](https://apps.apple.com/us/app/go-baduk-weiqi-master/id6466767290)

---

## 7. Go-specific comfort features

| Feature | How | Engine? | Zengo |
|---------|-----|---------|------|
| **Atari warning** | own groups with 1 liberty glow (6.2) | no | helpers bundle, on |
| **Self-atari guard** (the blunder guard) | a move that leaves its own group of ≥2 stones with 1 liberty, so that the opponent can capture at once, is refused once with a red pulse; playing it again within 5 s commits. Single-stone self-ataris are excluded (throw-ins, ko and snapback are often good) | no | helpers bundle, vs computer and pass-and-play |
| **Point-loss guard** | with the engine: refuse once if the move loses ≥ X points (e.g. 5 on 9×9, 10 on 19×19) | yes | vs computer only, Zhess thresholds style |
| **Ko marker** | 6.2 | no | helpers bundle |
| **Ladder hint** | a deterministic ladder reader (about 50 lines): when a group is in atari or ataris, show whether the ladder works by pulsing the breaker or the escape path | no | optional; good teaching value, low cost |
| **Territory / ownership peek** | hold the bulb: shade each intersection by owner; the engine's ownership, or `@sabaki/influence` without the engine | best with an engine | replaces the threat peek |
| **Score estimate during play** | a number like `B+3.5` | yes | do not show continuously (Zhess rejected an eval bar). It may appear in the ownership peek as one line |
| **"Count" request** | a room request type: proposes moving to scoring early; the opponent accepts or declines; Fox has a request-counting button | no | room and computer: the flag menu gains "Count" only after both have passed once, or simply rely on pass-pass |
| **AI hint** | tap: the best move pulses as a ghost stone at the point (Zhess hint pulse). Hold: ownership peek. Top-3 heat maps (KaTrain/Lizzie style colored circles) clash with the monochrome style; if wanted later, show 1–3 numbered ghosts | yes | tap = best move; hold = ownership |

### 7.6 Engine note (for the separate engine research)

The hints, the point-loss guard, the ownership peek and the computer's dead-stone proposals all want a KataGo-class network. Options seen: KataGo nets converted to ONNX (Kaya repo, MIT, FP32 for WASM, FP16 for WebGPU, UINT8 quantised about 4× smaller), and Web KaTrain (a browser KaTrain clone running KataGo through tfjs WebGPU/WASM). Weak levels can come from KaTrain's "calibrated rank" policy sampling, which matched OGS ranks within about 2 kyu against GnuGo and Pachi. Determinism across devices matters only for things both devices must agree on, and in the design above nothing like that is computed by the engine.

Sources: [Kaya KataGo ONNX models](https://hug-proxy.pages.dev/kaya-go/kaya) · [Web KaTrain (OGS forum)](https://forums.online-go.com/t/web-katrain-browser-based-katrain-clone-with-in-browser-katago-analysis-webgpu-wasm/59096) · [KaTrain calibrated rank (L19)](https://lifein19x19.com/viewtopic.php?p=258517) · [@sabaki/influence](https://github.com/SabakiHQ/influence) · [Fox counting button (L19)](https://lifein19x19.com/viewtopic.php?p=237943)

---

## 8. Ranks, level names, terminology

### 8.1 The kyu/dan scale

- Amateur ranks run from **30k** (absolute beginner, "just learned the rules") to **1k**, then **1d to 7d** (servers go to 9d), and professional **1p–9p**. One rank ≈ one handicap stone on 19×19.
- Bands (Wikipedia): 30–20k beginner, 19–10k casual, 9–1k intermediate, 1d+ advanced.
- Servers differ by several stones (KGS, OGS, Fox and the EGF/AGA scales are not aligned), and a 9×9 rank is not a 19×19 rank. Any rank label for a bot is approximate.
- How others label bots: KaTrain uses "calibrated rank" sliders labelled in kyu/dan; BadukAI maps a 30 → −8 slider to 30k … 9d; OGS shows bots with their rated rank.

**Zengo:** keep the 12 Zudoku names (one family across Zudoku, Zhess and Zengo) and add an **approximate rank, only after calibration**, e.g. `COMPUTER 5 MEDIUM · ≈12k`. The prefix `≈` is honest. Spread the levels roughly from 30k (1 Beginner) to about 1d–3d (12 Insane), depending on what the browser engine reaches on a phone.

### 8.2 Display formats

`15k`, `2d` (SGF `BR`/`WR` use exactly this). Do not translate them; "Kyu" and "Dan" are used in DE, FR and ES. The German Wikibooks glossary offers "Schüler" and "Meister", but nobody uses them in practice.

### 8.3 Terminology in the four languages

| Concept | EN | DE | FR | ES | Loanword? |
|---------|----|----|----|----|-----------|
| board | board | Brett (Goban) | goban / plateau | tablero (goban) | goban in FR, often in ES |
| stone | stone | Stein | pierre | piedra | translated |
| intersection | point | Punkt / Schnittpunkt | intersection | intersección / punto | translated |
| star point | star point | Sternpunkt (Hoshi) | hoshi | hoshi | JA in FR/ES |
| liberty | liberty | Freiheit | liberté | libertad | translated |
| atari | atari | Atari | atari | atari | **JA everywhere** |
| ko | ko | Ko | ko | ko | **JA everywhere** |
| komi | komi | Komi | komi | komi | **JA everywhere** |
| pass | pass | Passen | Passer | Pasar | translated (Sabaki FR "Passer", ES "Pasar") |
| resign | resign | Aufgeben | Abandonner | Abandonar / Rendirse | translated (Sabaki: "Abandonner", "Abandonar") |
| territory | territory | Gebiet | territoire | territorio | translated |
| area (scoring) | area | Fläche (Flächenwertung) | zone / surface (Sabaki: "Surface") | área | translated |
| prisoners / captures | prisoners | Gefangene (Agehama) | prisonniers | capturas / prisioneros | translated (Sabaki ES "Capturas", FR "Prisonniers") |
| handicap | handicap | Vorgabe (Vorgabesteine) | handicap | hándicap (Sabaki: "Ventaja") | DE translates; FR/ES use "handicap" |
| byo-yomi | byo-yomi | Byo-Yomi | byo-yomi | byo-yomi | **JA everywhere** |
| sente / gote | sente / gote | Sente / Gote (Vorhand/Nachhand rare) | sente / gote | sente / gote | **JA everywhere** |
| jigo (draw) | jigo / draw | Jigo / Unentschieden | jigo / partie nulle | jigo / empate | JA as a technical term, translated in UI text |
| seki | seki | Seki | seki | seki | **JA everywhere** |
| dead stones | dead stones | tote Steine | pierres mortes | piedras muertas | translated |
| counting / score | count / score | Zählen / Auszählung, Ergebnis | décompte / score | conteo / recuento | translated (Sabaki ES "Conteo") |
| kyu / dan | kyu / dan | Kyu / Dan | kyu / dan | kyu / dan | **JA everywhere** |
| Black / White | Black / White | Schwarz / Weiß | Noir / Blanc | Negro / Blanco | translated |

UI text should use the plain translated verb wherever possible (`Passen`, `Aufgeben`, `Zählen`) and keep the Japanese terms only where players expect them (Komi, Atari, Ko, Seki, Byo-Yomi). In German, capitalise the loanwords as nouns (`Komi`, `Atari`).

Sources: [Wikipedia: Go ranks and ratings](https://en.wikipedia.org/wiki/Go_ranks_and_ratings) · [KaTrain weak AIs / calibrated rank](https://lifein19x19.com/viewtopic.php?p=258517) · [BadukAI rank slider (L19)](https://lifein19x19.com/viewtopic.php?p=260229) · [Sabaki i18n (es, fr)](https://github.com/SabakiHQ/i18n/tree/master/src) · [German Go glossary (Wikibooks)](https://de.wikibooks.org/wiki/Go/_Anhang/_Glossar) · [Deutsche Go-Regeln (GoVB)](https://govb.de/e107_files/public/1211027676_5_FT3069_regeln.pdf) · [French rules (FFG)](https://jeudego.org/maxiGos/_maxigos/_sample/rules/rules-en.php) · [BGJ glossary](https://britgo.org/node/1373)

---

## 9. Open questions for the Zengo design interview

1. Komi for 9×9: 7.5 (OGS/KGS Chinese default, slightly favors White) or 7 (fair; allows jigo, so a draw result is needed)?
2. Should the self-atari guard count as "assisted", like hints in Zhess?
3. Should the computer resign hopeless games? Under area scoring, a long play-out against a beginner is tedious.
4. Should territory scoring (goscorer) appear as a second line on the result screen for players who learned Japanese counting?
5. Engine choice and network size (separate research): it decides the number of levels, the hint quality, and the first-launch download.
