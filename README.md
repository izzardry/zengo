# Zigo

**Zero Distractions. Just Go.**

A minimalist Go game built as a Progressive Web App, by [izzardry](https://github.com/izzardry): 9×9 to 19×19, a computer opponent in twelve levels, pass-and-play, and serverless rooms for two. No ads, no accounts. Zigo is the sibling of [Zhess](https://github.com/izzardry/zhess), the izzardry chess game, and starts from its code.

Play it at **[izzardry.github.io/zigo](https://izzardry.github.io/zigo/)**.

> **Work in progress.** The board, the rules and scoring, pass-and-play, the computer and rooms work; the final audit and polish are still to come. See [DESIGN.md](DESIGN.md) for what is being built.

## Rooms

A room is a game between two devices with no server holding the game. Pick `ROOM` on the start screen and press Start: the code is the room. The first device creates it and shows an invite link (`#/?s=CODE&o=r`) and QR code; the other device opens the link, or types the code with `ROOM` selected, and joins. The devices talk over a WebRTC data channel, found through the public PeerJS broker; when the broker cannot be reached, `Connect manually` swaps two links instead. Each device keeps the whole room, so either one can restore the other. After two passes the creator's device proposes the dead stones (or the joiner's, when the creator has no engine), both players can toggle groups, and the game ends when both accept the same marking.

## Tech Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) (with SWC)
- [Tailwind CSS](https://tailwindcss.com) with the izzardry Ztyle preset
- [shadcn/ui](https://ui.shadcn.com) (Radix UI primitives)
- [TensorFlow.js](https://www.tensorflow.org/js) 4.22.0 (WebGPU and WebAssembly backends) running [KataGo](https://github.com/lightvector/KataGo) networks, with a search after [Web KaTrain](https://github.com/Sir-Teo/web-katrain)
- [goscorer](https://github.com/lightvector/goscorer) for counting
- [PeerJS](https://peerjs.com) and WebRTC for rooms, [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) for the manual fallback
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app) for service worker and offline support
- [Vitest](https://vitest.dev) and [Playwright](https://playwright.dev) for testing

## Getting Started

```sh
git clone https://github.com/izzardry/zigo.git
cd zigo
npm install
npm run dev        # http://localhost:8080
```

```sh
npm run build
npm run preview    # preview the production build locally
```

```sh
npm run lint
npm run typecheck
npm test           # unit and component tests (Vitest)
npm run e2e        # end-to-end tests (Playwright, Chromium); builds and serves on port 4173
```

Before the first e2e run, install the browser once with `npx playwright install chromium`.

## Licence

Zigo is MIT-licensed (see [LICENSE](LICENSE)).

The files in [`public/engine/`](public/engine/) are not covered by that licence: the KataGo networks in `public/engine/nets/` are CC0, and the TensorFlow.js WebAssembly backends in `public/engine/tfjs/` are Apache-2.0. Each folder has a README naming its source. [`src/lib/vendor/goscorer.js`](src/lib/vendor/goscorer.js) is goscorer by David J Wu, MIT.
