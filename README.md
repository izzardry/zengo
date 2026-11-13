# Zigo

**Zero Distractions. Just Go.**

A minimalist Go game built as a Progressive Web App, by [izzardry](https://github.com/izzardry). Play the computer, pass one device between two players, or open a room for two devices with no game server. No ads, no accounts, no nonsense — just Go. Zigo is the sibling of [Zhess](https://github.com/izzardry/zhess), the izzardry chess game.

Play it at **[izzardry.github.io/zigo](https://izzardry.github.io/zigo/)**.

## Features

- **Three modes** — against the computer, pass-and-play on one device (face to face or side by side), or a room across two devices
- **Three board sizes** — 9×9 (default), 13×13 and 19×19
- **Area or territory scoring** — area (Chinese, komi 7.5, the default) or territory (Japanese, komi 6.5), chosen per game by holding the size pill
- **Handicap** — 2–9 stones on the star points (up to 5 on 9×9), komi 0.5; hold the color pill
- **Computer opponent** — KataGo networks in a Web Worker, 12 levels from Beginner to Insane (default Medium); levels 1–4 never resign, so beginners finish their games
- **Hint and territory preview** — tap the bulb for the best point, tap again for the top three; hold it to see who owns which point and the score lead
- **Blunder guard** — against the computer, a stone that drops the score lead by 6 / 8 / 12 points (9×9 / 13×13 / 19×19) and the win rate by 15 points, or puts 3 or more of your stones in atari bounces back once
- **Helpers** — last-move ring, atari glow, ko marker, coordinates and the guard, in one shield toggle
- **Clock** — optional, Fischer or Japanese byo-yomi, with presets per board size and a custom dial on hold
- **Scoring by agreement** — two passes open scoring: the engine proposes dead stones, either player taps groups to change them, both accept; either can resume
- **Rooms for two** — peer to peer over WebRTC, with no server holding the game; a manual link and QR fallback when the broker is blocked; a room is a series with a running score
- **Undo / Redo** — free in solo games, clock restored; a takeback request in rooms; a 5-second undo after a pass or a resignation in solo games
- **Input** — tap places on 9×9; on 13×13 and 19×19 touch shows a ghost stone and a second tap confirms; mouse, keyboard or typed coordinates
- **History and review** — the last 100 games; unfinished games resume, finished ones open in a replay viewer with "continue from here"
- **Sharing** — every game has a 6-character code; a solo game travels as a URL with its moves, a room link carries only the code; SGF export
- **PWA / installable** — offline after the first load; the computer downloads in the background, with progress on the start screen (rooms need a network)
- **Four languages** — English, German, French, Spanish
- **Dark mode** — follows the system

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) (with SWC)
- [Tailwind CSS](https://tailwindcss.com) with the izzardry Ztyle preset
- [shadcn/ui](https://ui.shadcn.com) (Radix UI primitives)
- A small rules core of its own (`src/lib/zigo.ts`), with [goscorer](https://github.com/lightvector/goscorer) for counting
- [TensorFlow.js](https://www.tensorflow.org/js) 4.22.0 (WebGPU and WebAssembly backends) running [KataGo](https://github.com/lightvector/KataGo) networks, with a search ported from [Web KaTrain](https://github.com/Sir-Teo/web-katrain)
- [PeerJS](https://peerjs.com) and WebRTC for rooms, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) for the manual fallback
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app) for service worker and offline support
- [Vitest](https://vitest.dev) and [Playwright](https://playwright.dev) for testing

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (v18+; the scripts in `scripts/` need v23.6+, as they load TypeScript through Node's type stripping)
- npm

### Install & Run

```sh
git clone https://github.com/izzardry/zigo.git
cd zigo
npm install
npm run dev        # http://localhost:8080
```

### Build for Production

```sh
npm run build
npm run preview    # preview the production build locally
```

### Run Tests

```sh
npm run lint
npm run typecheck
npm test           # unit and component tests (Vitest)
npm run e2e        # end-to-end tests (Playwright, Chromium)
```

Before the first e2e run, install the browser once with `npx playwright install chromium`. `npm run e2e` builds the app and serves it on port 4173, so two runs cannot overlap. It also rewrites the screenshots in `docs/screenshots/m1/`, `m2/` and `m3/`. The room tests connect two browser contexts over real WebRTC and run one at a time after the others.

### Scripts

```sh
node scripts/selfplay.mjs     # a strong level plays a weak one in Node with the real engine
node scripts/calibrate.mjs    # computer levels against GNU Go, for the rank line
node scripts/screenshots.mjs <baseURL> <outDir>   # the main screens against a running preview
```

**Self-play.** `--strong 12 --weak 1 --size 9|13|19 --rules area|territory --games 1 --seed 1 --strong-black --max-plies N --backend wasm|cpu --quiet` (defaults shown first). Colors alternate unless `--strong-black` is given; the default ply cap is three plies per point. Exits 0 when the strong level won every game.

**Calibration.** `--levels 1,3,5,7 --games 2 --size 9 --rules area --gnugo-level 10 --seed 1 --anchor 6 --min-games 10 --max-minutes 30 --write --backend wasm|cpu`. It downloads the GNU Go 3.8 WASM build into `~/.cache/zigo/gnugo-wasm-v2/` on first use. A level gets a rank only with at least `--min-games` games and a win rate between 10 % and 90 %; `--write` writes `src/lib/ranks.json` when at least two levels got one. The start screen shows ranks only from a 19×19 table, and none has been written yet.

**Screenshots.** Run `npm run build` and `npx vite preview --port 4180 --strictPort`, then pass `http://localhost:4180/`. `--only start,game-9,…`, `--sizes 390x844,…` and `--themes light,dark` narrow the set. The PeerJS broker is blocked, so nothing leaves the machine.

## Project Structure

```
src/
  pages/           # The stage (Index) and NotFound
  components/
    board/         # GoBoard (SVG with a grid overlay for input), stones, marks, thumbnails
    game/          # Player strips, info pill, move list, toolbar, scoring bar, game-over overlay, share
    start/         # Start screen: code, opponent, size, color, clock pills and their dials
    room/          # Invite and manual-connect sheets, room scoring bar, toasts, requests
    platform/      # History, tutorial, install prompt, language switcher, credits
    ui/            # shadcn/ui primitives
  hooks/           # Game state, clock, engine, computer, hint, blunder guard, scoring, room, history, PWA
  workers/         # The engine worker (TF.js and the KataGo port)
  lib/             # Core logic, framework-free
    zigo.ts        #   rules core: board, captures, ko and superko, handicap, move codec, SGF
    scoring.ts     #   area and territory count over goscorer
    levels.ts      #   level table and move picker
    clock.ts       #   Fischer and byo-yomi arithmetic
    engine/        #   driver, offline download manager, Node engine; katago/ is the port
    sync.ts        #   reconcile, log hashing, seat proof
    room/          #   room state machine (room.ts is its entry point)
    transport/     #   PeerJS, manual (link/QR) and in-memory transports
    vendor/        #   goscorer
    i18n/          #   EN, DE, FR, ES
  ztyle/           # Shared style preset
public/
  engine/          # KataGo networks (CC0) and TF.js WASM backends (Apache-2.0), with their READMEs
e2e/               # Playwright tests
scripts/           # Self-play, calibration, screenshots, brand images
docs/              # Build log, research and screenshots
```

[DESIGN.md](DESIGN.md) is the full spec.

## How Scoring Works

A game ends by resignation, by time, or by two passes in a row. Two passes open scoring, and the clocks stop.

1. **Proposal.** The engine runs a short search (about 100 visits) and marks a stone dead when the ownership of its point is 0.7 or more toward the opponent. Without the engine every stone starts alive.
2. **Adjust.** Tapping a stone (or `Enter` on a focused one) toggles its whole group. Both player strips show the count as it changes: area `B 45 · W 40 + 7.5`, territory `B 12 + 3 · W 10 + 1 + 6.5` (territory + prisoners + komi).
3. **Accept or resume.** Against the computer, Accept ends the game with the marking as shown. In pass-and-play one Accept ends it side by side, both Accepts face to face. Resume plays on.
4. **No second round.** After a resume, the next two passes are scored at once from the engine's proposal (every stone alive without an engine), so a dispute cannot loop.

The count is [goscorer](https://github.com/lightvector/goscorer): area counts stones and surrounded points, territory counts surrounded points and prisoners, and points in seki belong to nobody. With handicap, komi is 0.5, and under area rules White also gets one point per handicap stone. Komi is always a half point, so there are no draws. The result is a pure function of size, rules, komi, handicap, moves and dead stones, in half points. The engine only proposes; no device scores from its own engine output alone.

**In a room** every toggle is sent as a numbered marking (`rev`) and shows on both boards at once; a toggle clears both acceptances. The game ends when both players have accepted the same marking, and each device counts the result from the shared dead stones. The creator's engine makes the first proposal; when it has none, the joiner's engine proposes, and when neither has one, every stone starts alive. After a resume, the creator's device scores the next two passes and sends the result with its dead stones; the joiner checks that count before taking it. Scoring needs both players connected; marks made offline are kept and settle through `rev`.

## How Rooms Work

A room connects exactly two devices over one WebRTC data channel. No server stores anything; each device keeps the full record of every game in the room.

- **Joining is creating.** Pick `ROOM` and press Start: the code is the room. The PeerJS id `zigo-<CODE>` on the public PeerJS broker is claimed by the first device, the *anchor*, which waits; the second device finds it taken and *dials* the anchor. Both repeat this on every reconnect. The creator chooses size, rules, handicap and clock; the joiner sees them dimmed.
- **STUN only.** ICE uses public STUN servers (Google, Cloudflare). There is no TURN relay, so two strict NATs may not connect; the app says so. After the connection, nothing passes through a third party.
- **Manual fallback.** If the broker is unreachable, `Connect manually` sends the offer and answer as links or QR codes (`#/?s=<CODE>&o=r&x=<offer>`, answered with `&y=<answer>`). The answer can be pasted into the waiting tab or opened on the same device.
- **Seat key.** The creator makes a 128-bit secret and hands it to the first device that joins. From then on, on every connection each side proves it holds the key with an HMAC-SHA-256 challenge-response. The key is never sent again, and room links carry only the code.
- **Sync and recovery.** On every connection the devices compare the current game and reconcile: the higher game number wins, then the higher takeback epoch, then the longer log when one continues the other, and a finished log beats an unfinished one of the same length; with the same moves, the higher scoring `rev` wins. Every adopted log is replayed through the rules core, superko included. A device that lost its data asks to rejoin; the other player taps **Allow** and it receives the key, score and every game.
- **Offline moves.** In untimed games the player to move may play or pass while the other is away; the move is delivered on the next connection. Timed games pause while disconnected. Clocks are derived from the time logged per move, so both devices agree.
- **Requests.** Undo asks for a takeback (during scoring it takes back the second pass). Rematch starts the next game with the same settings; colors swap, except in a handicap game.

## Engine

The KataGo C++ program cannot run on GitHub Pages: its browser builds need threads, and threads need COOP/COEP headers that Pages cannot send. Zigo runs KataGo's networks with a search written in TypeScript instead, ported from Web KaTrain (`src/lib/engine/katago/`), in a Web Worker.

- **Backend.** TF.js 4.22.0. The worker starts on single-threaded WASM (SIMD when available) and, once the small net has loaded, tries WebGPU: if an adapter is found and a fixed test position evaluates the same as on WASM, it switches. The choice is remembered per device. In Node, the scripts use the WASM or CPU backend.
- **Networks.** `g170-b6c96` (3.8 MB) runs levels 1–7, hints, the blunder guard and the scoring proposal. `g170e-b10c128` (11 MB) runs levels 8–12.
- **Two-stage download.** Stage 1 (the TF.js WASM files and the small net, about 4.6 MB) downloads after the first paint on the first launch. Stage 2 (the large net) starts when a level of 8 or higher is selected, or at once when the app runs installed. The page downloads both into `engine-cache` with progress on the start screen, checks each file before caching it, and the service worker serves them `CacheFirst`. Every launch checks both stages again.
- **Levels.** Levels 1–9 cost one network evaluation per move: level 1 samples the policy with random slips, levels 2–8 use KaTrain's calibrated-rank pick, level 9 plays the raw policy. Levels 10–12 search, from 16–32 visits up to 3 seconds. The computer answers after at least 400 ms and keeps to its own clock in timed games. Strength at the top levels depends on the device.

## Licence and Credits

Zigo is MIT-licensed (see [LICENSE](LICENSE)).

- **KataGo networks** in [`public/engine/nets/`](public/engine/nets/README.md) are CC0, by Jane Street and David J. Wu, from [katagoarchive.org](https://katagoarchive.org/g170/neuralnets/index.html).
- **The engine** in [`src/lib/engine/katago/`](src/lib/engine/katago/LICENSE) is ported from [Web KaTrain](https://github.com/Sir-Teo/web-katrain) (MIT), which reimplements [KataGo](https://github.com/lightvector/KataGo) (MIT); both notices are kept.
- **TensorFlow.js** is Apache-2.0; its WASM backends ship unmodified in [`public/engine/tfjs/`](public/engine/tfjs/README.md).
- **goscorer** by David J. Wu (lightvector), MIT, is vendored in [`src/lib/vendor/goscorer.js`](src/lib/vendor/goscorer.js).
- **GNU Go** (GPL-3.0) is only fetched by `scripts/calibrate.mjs` into a local cache for calibration. It is never copied into the repository or shipped.

None of the engine files is covered by Zigo's MIT licence. Nothing GPL ships.
