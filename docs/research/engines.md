# Zigo — Go engine research

Research date: 2026-11-12. Scope: which Go engine can replace Stockfish in a Zhess-style PWA. The app is static on GitHub Pages, has no COOP/COEP headers, works offline, and must run on iPhone home-screen PWAs, Android Chrome and low-end phones.

Markers used below:
- **[V]** verified against the linked source (repo, release asset, docs, or a measurement I ran on the files).
- **[C]** claimed by a third party and not independently checked.
- **[E]** my own estimate, with the reasoning shown.

---

## TL;DR recommendation

1. **Use KataGo networks, run by a TypeScript MCTS in a classic Web Worker.** Do not port the KataGo C++ binary. Every C++→WASM port found needs pthreads (`SharedArrayBuffer`), which means COOP/COEP headers, which GitHub Pages cannot send. Those ports are toyoshi/katago-wasm, katago-web, saigo katago-webgpu (search build) and pachi-web. A TS search with single-threaded WASM inference, or WebGPU inference, needs no headers. Web KaTrain already does exactly this as an MIT-licensed PWA on GitHub Pages **[V]**.
2. **Choosing the inference runtime:**
   - **Default:** TF.js 4.22 with a WebGPU backend, falling back to the WASM-SIMD backend. The runtime adds about 0.33 MB gzipped **[V, measured]**. Web KaTrain's MIT engine (`src/engine/katago/*`) can be ported or vendored as the starting point.
   - **Risk:** TF.js has had no release since 4.22.0 (2024-10-21) **[V]**.
   - **Plan B:** ONNX Runtime Web 1.31 (actively released), but its WASM is 3.8 MB gzipped CPU-only and 6.9 MB gzipped with WebGPU (JSEP) **[V, measured]**.
   - **Plan C:** hand-written WGSL and WASM-SIMD kernels for the two small convnets, which only need conv3×3, conv1×1, BN, ReLU, global pooling and matmul.
3. **Use two small official nets as the core download:**
   - `g170-b6c96` is 3.83 MB **[V]**. It is fast enough for CPU everywhere, and it runs the blunder guard and the low levels.
   - `g170e-b10c128` is 11.1 MB **[V]**. It runs the mid/high levels.
   - Both are **CC0** **[V]**.
   - Core engine download is about **4.2 MB** at first launch (runtime plus b6c96). b10c128 follows in the background, for about **15.5 MB** in total. Converting both to fp16 cuts that to about 8 MB **[E]**.
4. **The optional "Insane" pack is WebGPU-only.** It is `kata1-b18c384nbt` at about 96 MB fp32 .bin.gz **[V]**, or about 48–58 MB as fp16 **[V for ONNX fp16, 58 MB]**. Never download it automatically: GitHub Pages has a **100 GB/month soft bandwidth limit** **[V]**, which is only about 1,000 downloads of a 96 MB net.
5. **Weak and human-like levels:**
   - Use KaTrain-style policy sampling on the small nets. This is the "calibrated rank" bot, plus Zhess-style humanizing.
   - **Do not** use KataGo's Human-SL net (`b18c384nbt-humanv0`) for v1. It is 99.07 MB **[V]** and takes about 0.2 s per 9×9 eval on a 2025 flagship CPU in WASM **[V, toyoshi]**, which is about 1 s on 19×19 **[E]**. Its low-kyu calibration is questioned by users **[C]**. It is an attractive later "human style" add-on for WebGPU devices.
6. **Game-end tooling:**
   - KataGo's **ownership head** gives territory peek, dead-stone proposals and score estimate.
   - Port the thresholds from OGS's Apache-2.0 `autoscore.ts`: 0.7 to remove, 0.3 to seal **[V]**.
   - Count with lightvector's **goscorer** (MIT, JS, area and territory scoring with seki detection) **[V]**.
7. **Calibration anchor:** **GNU Go 3.8 WASM** (GPL-3.0, 0.93 MB gzipped **[V, measured]**, GTP, runs in Node **[V]**). Use it in the Node self-play and calibration script the way Zhess uses Stockfish self-play. KaTrain calibrated its rank bot against GNU Go and Pachi **[V]**. It could optionally ship as a no-NN fallback opponent (about 5–8k **[C]**).

---

## Comparison table

| Candidate | Runs in browser without COOP/COEP? | Download (gz) | Strength (19×19 unless noted) | Speed on phone | Licence | Protocol / API | Strength control | Activity |
|---|---|---|---|---|---|---|---|---|
| **KataGo nets + TS MCTS** (Web KaTrain engine, TF.js WebGPU→WASM) | **Yes**: WebGPU unaffected, WASM single-threaded **[V]** | TF.js ≈0.33 MB **[V meas.]** + net | Depends on net and visits (see the net table) | b6c96 CPU ≈30 ms/eval flagship, 150–250 ms low-end **[E]** | App MIT **[V]**; KataGo code MIT **[V]**; nets CC0 (g170) / MIT-style (kata1) **[V]** | Custom JS (worker messages) | visits, temperature, policy sampling, KaTrain strategies, human SL | Web KaTrain pushed 2026-10-28 **[V]** |
| **KataGo nets + ONNX Runtime Web** (Kaya, katago-web "legacy TS core") | Yes in single-thread WASM / WebGPU mode | ORT 3.8 MB (CPU) / 6.9 MB (WebGPU JSEP) **[V meas.]** + net | same | b18 WebGPU ≈100 ms/eval on a desktop iGPU **[C, Kaya via yagoo]** | ORT MIT; Kaya **AGPL-3.0** (idea-only); katago-web MIT | Custom JS | same | ORT 1.31.1 on 2026-10-26 **[V]** |
| **KataGo C++ → WASM (Eigen)** (toyoshi/katago-wasm) | **No**: pthreads need COOP/COEP **[V]** | katago.wasm 5.4 MiB raw **[V]** + net | Full KataGo | b6c96 9×9: 148 visits/s on Cortex-X925, 125 visits/s on M2 Safari **[V]** | MIT wrapper + KataGo MIT | GTP / analysis JSON | all KataGo params, humanSLProfile | Spike, 0★, 2026-07 |
| **katago-web** (JuneKim0712) | **No**: C++ path needs JSPI + pthreads; the pure-TS path might work | ORT + net | Full | n/a | MIT **[V]** | Custom "Contract v1" | visits | 0★, 2026-10 |
| **saigo katago-webgpu** | Eval-only build: probably; MT search build: **no** | kataeval.wasm + net | Full, nets through v17 incl. transformers **[C]** | ~7 ms fixed per WebGPU batch (desktop) **[C]** | MIT per README (GitHub: NOASSERTION) | C API / demo | visits | 3★, 2026-09 |
| **KataGo Human-SL net** (b18c384nbt-humanv0) | Same as the runtime that runs it | **99.07 MB** **[V]** | Imitates 20k…9d (calibration disputed at low kyu **[C]**) | CPU ≈0.2 s/eval 9×9 flagship **[V]**, ≈1 s 19×19 **[E]** | MIT-style (KataGo) | humanSLProfile | profile + temperature | Released 2024-07 (v1.15.0) |
| **Bare policy net, no search** (maksimKorzh/go PWA) | Yes (TF.js) | 4 MB / 11 MB | b6c96 ≈ OGS 5k, b10c128 ≈ OGS 1d **[C]** | instant | KataGo nets; repo has no licence | Custom | none | 2026-01 |
| **GNU Go 3.8 WASM** (marinahane/gnugo-wasm) | **Yes** (no threads) | **0.93 MB** (6.16 MB raw) **[V meas.]** | ~5–8k KGS (19×19); 5–7k on 9×9 **[C]** | Classical; level 10 typically ≲1–3 s native **[E]** | **GPL-3.0+** **[V]** | **GTP over stdin/stdout**, one `callMain` per instance **[V]** | `--level 0..10`, randomness | v2 released 2026-10-15 **[V]** |
| **Pachi (nodcnn) WASM** (saigo-online/pachi-web) | **No**: pthreads **[V]** (a single-threaded build is possible but not offered) | ≈1 MB assets **[C]** | KGS 2k at 5–10k playouts (native, MCTS only) **[V Pachi README]** | WASM phone: far fewer playouts → probably 5–10k **[E]** | **GPL-2.0** **[V]** | GTP via worker | playouts / time | 0★, 2026-07 |
| **Michi** (Python MCTS) | Would need a JS port; only a 2013 toy port exists | tiny | "fast impl ≈4k KGS", Python ≈ GNU Go on 9×9 **[C]** | — | MIT **[V]** | GTP | playouts | 2018, dormant |
| Leela Zero / ELF / Minigo / SAI | **No browser ports found** **[V search]** | — | — | — | GPL-3 / BSD / Apache / GPL-3 | GTP | — | LZ last push 2024-05; ELF and Minigo archived **[V]** |
| Pure-JS hobby MCTS (KoLocal, brett-buskirk/go, gextam/go-web) | Yes | tiny | Unknown, likely 20k+ | — | MIT (some) | none / custom | playouts | 0★ toys **[V]** |

### KataGo network sizes (official files)

| Net | File | Size | Licence | Notes |
|---|---|---|---|---|
| g170-b6c96 (last self-play 6-block) | `g170-b6c96-s175395328-d26788732.bin.gz` | **3,827,339 B** (4.12 MB unzipped; float32 barely compresses) **[V meas.]** | CC0 **[V]** | Elo −1184 on the g170 scale **[V]**. Web KaTrain's bundled default and golden test **[V]** |
| g170e-b10c128 (extended) | `g170e-b10c128-s1141046784-d204142634.bin.gz` | **11,138,361 B** (12.0 MB unzipped) **[V meas.]** | CC0 | Elo +300. "Nearly matches … LZ150" **[V]** |
| g170e-b15c192 (extended) | `g170e-b15c192-s1672170752-d466197061.bin.gz` | **36,948,927 B** **[V]** | CC0 | Elo +935. "Almost matches ELFv2" **[V]** |
| kata1 b18c384nbt (strong current conv net) | e.g. `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` | ≈96–98 MB **[V/C]** | MIT-style **[V]** | Web KaTrain's "browser-practical" recommendation **[V]**. ONNX fp16 is 58 MB, uint8 is 29.6 MB but shifts winrate by about 4 percentage points **[C, yagoo]** |
| kata9x9-b18c384nbt | release v1.13.2-kata9x9 | 97,878,277 B **[V]** | MIT-style | Strongest net on 9×9 **[V]** |
| b10c384h6 transformer | `b10c384h6nbttflrs.bin.gz` (v1.17.0) | 38,245,488 B **[V]** | MIT-style | "Stronger per visit than the strongest b18" **[V]**. Model version 17: Web KaTrain's parser supports only versions 8–16 **[V]** |
| kata1 b28c512nbt | ONNX on Hugging Face (Kaya) | fp32 293 MB / fp16 147 MB / uint8 75 MB **[V]** | MIT-style | Too large for phones |
| b18c384nbt-humanv0 (Human SL) | `b18c384nbt-humanv0.bin.gz` | **99,066,230 B** **[V]** | MIT-style | Model version 15 **[V]** |

Rough compute per 19×19 eval, counting only 3×3/1×1 trunk multiply-adds **[E]**:

| Net | Multiply-adds per eval | Relative to b6c96 |
|---|---|---|
| b6c96 | ≈0.36 G | 1× |
| b10c128 | ≈1.06 G | ≈2.9× |
| b15c192 | ≈3.6 G | ≈10× |
| b18c384nbt | ≈9.6 G | ≈27× |
| b28c512nbt | ≈26 G | ≈73× |

A 9×9 eval costs about 1/4.5 of a 19×19 eval.

---

## 1. Candidates in detail

### 1.1 KataGo in the browser

**Licences.**
- KataGo code is MIT ("Copyright 2025 David J Wu … Permission is hereby granted…") **[V]**.
- Networks under katagotraining.org/network_license are MIT-style: redistribution allowed, notice required **[V]**.
- **g170 nets are CC0** **[V]**.
- External nets may differ. Zhizi nets have their own MIT-style licence **[V]**.
- Shipping nets inside an MIT app is fine; include the notice.
- KataGo's download host sends **no CORS headers** **[C, Web KaTrain + yagoo]**, so self-host the nets on Pages.

**Latest engine.** v1.18.2 (2026-08-30) **[V]**.
- v1.17 added transformer nets (model version 17) **[V]**.
- v1.18 added an ONNX Runtime backend and `katago dumponnx` .bin.gz→ONNX conversion. This is native, not browser **[V release notes]** / **[C dumponnx, yagoo]**.
- No upstream WebGPU or WASM backend exists **[C, yagoo]**.

#### Ports and projects found

**Web KaTrain** (Sir-Teo/web-katrain, MIT, pushed 2026-10-28, live at sir-teo.github.io/web-katrain) **[V]**. This is the closest precedent and the strongest candidate to borrow from.
- A pure TypeScript KataGo reimplementation running in a Web Worker:
  - `.bin` parser for model versions 8–16
  - TF.js graph
  - v7 input features (22 spatial planes, 19 global)
  - PUCT/MCTS with KataGo's LCB, subtree value bias, uncertainty weighting, root symmetry pruning
  - ownership
  - `avoidMoves`
- Golden test against KataGo's own b6c96 output, matching to within a permille **[V docs/engine.md]**.
- Backend order is WebGPU → WASM → CPU. On GitHub Pages WASM runs single-threaded, and WebGPU is unaffected **[V]**.
- PWA service worker precaches the shell, the worker, the 3.6 MB default model and one TF.js WASM build (`tfjs-backend-wasm-simd.wasm`) **[V docs/deployment.md]**.
- KaTrain AI strategies are included (`rank`, `policy`, `weighted`, `scoreloss`, …), plus a `human` strategy using the Human-SL net **[V]**.
- Sibling apps exist: **web-chess** (Stockfish) and web-xiangqi (Pikafish). The author mirrors the Zhess → Zigo relationship **[V]**.
- Caveats:
  - Physical phones are "unvalidated" in its own audit **[V docs/continuous-audit.md]**.
  - A forum user reported a crash on a phone in Jan 2026, and the author says mobile was then optimised and works on an iPhone **[C, OGS forum]**.
  - It is a one-person project, 30★.

**katago-web** (JuneKim0712, MIT, 0★, 2026-10) **[V]**.
- "Pattern C": KataGo v1.18.1 C++ compiled to WASM with **JSPI + pthreads**, plus ORT WebGPU. This needs cross-origin isolation, and JSPI is only in Safari 27 (beta at WWDC26) **[C]**.
- It also has a pure-TS core (BoardHistory, superko, PUCT) and a legacy TF.js engine.
- Very new and unproven.

**saigo-online/katago-webgpu** (3★, 2026-09) **[V README]**.
- Hand-written WGSL backend for KataGo via Dawn/emdawnwebgpu. Evaluates conv, nbt and **transformer** nets byte-identically to Eigen **[C]**.
- One WASM contains both WebGPU and Eigen-CPU, with automatic fallback **[C]**.
- The real search needs the threaded (`MT=1`) build, so COOP/COEP.
- Latency-bound at about 7 ms per batch on desktop **[C]**.
- fp16 overflows on g170 nets **[C]**.
- Useful as kernel reference.

**toyoshi/katago-wasm** (MIT wrapper, 2026-07) **[V BENCHMARK.md]**. Unmodified KataGo v1.16.5 Eigen compiled with Emscripten 6.0.3 and `-msimd128`.
- katago.wasm is **5.4 MiB**, katago.js 132 KiB.
- b6c96, 9×9, 400 visits, 1 search thread:

  | Host | Visits/s |
  |---|---|
  | Cortex-X925, Node | **148** |
  | Cortex-X925, Chromium 150 | 156 |
  | Cortex-X925, Firefox 153 | 141 |
  | M2 Mac mini, Safari | **125** |
  | M2 Mac mini, Chrome | 125 |
  | Same build without SIMD | ≈106 |

- Human-SL as the primary search model: **5.05 visits/s**. Human-SL as an extra policy only: "about 0.2 s per position" warm.
- Requires pthreads and therefore COOP/COEP.
- iPad untested.

**Kaya** (kaya-go/kaya, **AGPL-3.0**, 133★, kayago.app) **[V]**.
- ONNX Runtime Web with WebGPU / WebNN / WASM, and MCTS in a worker.
- ONNX nets on Hugging Face (b28c512 only: fp32 293 MB / fp16 147 MB / uint8 75 MB) **[V]**.
- Reported b18 timings **[C, quoted in yagoo #5]**:
  - WebGPU ≈ **100 ms/eval** at batch 1 on a Radeon 8060S iGPU, after decomposing Softplus/LogSoftmax. Undecomposed, it fell back to CPU at 14.7 s/eval.
  - 8-thread WASM ≈160–176 ms/eval.
- AGPL: read for ideas, do not copy code.

**yet-another-ai/yagoo issue #5** (Apache-2.0 project, 2026-10) **[V]**. A thorough feasibility study, partly in Chinese, that measured ONNX exports of b18:
- fp32: 115 MB
- **fp16: 58 MB**, same winrate/score/top-5 as fp32
- uint8: 29.6 MB, winrate −4 points, top-5 reordered, and *slower* on CPU

**maksimKorzh/go** (PWA, 27★, 2026-01) **[V README]**.
- Bare policy net, no search: b6c96 "≈ OGS 5 kyu", b10c128 "≈ OGS 1 dan" **[C]**.
- The predecessor, kata-model-js, implemented only about half the input features, per yagoo **[C]**, so its strength claims may understate a correct implementation.

**y-ich's TF.js KataGo conversion** (old). Does not support model version 12+ **[C, yagoo]**.

**Others.** These are 0★ experiments **[V search]**:
- setup888/zengo (TF.js)
- aerinSie/OnnxGo-models
- `@multi-game-engines/adapter-katago` (stub weights **[C]**)
- Sagebati/katago-rs (Rust → WASM/WebGPU)

#### Expected speed on phones

These are estimates **[E]**, anchored to toyoshi's measured 148 visits/s for b6c96 on 9×9 with a flagship ARM core and to the FLOP ratios above.

| Net, 19×19, batch 1 | WASM-SIMD 1 thread, flagship (A17/A18, X925-class) | WASM, low-end Android (A55-heavy) | WebGPU, recent phone |
|---|---|---|---|
| b6c96 | ≈25–35 ms (≈30 visits/s) | ≈150–250 ms | ≈10–20 ms (latency-bound) |
| b10c128 | ≈80–100 ms (≈10 visits/s) | ≈0.5–0.8 s | ≈15–30 ms |
| b18c384nbt | ≈0.8–1 s | 5+ s (impractical) | ≈100–300 ms; batching 8 gives perhaps 20–40 evals/s |

- 9×9 runs roughly 4× faster.
- For reference, the native iOS app *A Master of Go* claims b18 at over 250 playouts/s on an M2 iPad Pro via CoreML **[C, App Store]**. WebGPU will be well below native CoreML/ANE.

#### Browser support for the GPU tier

- **Safari 26** (iOS/iPadOS/macOS, Sept 2025) ships WebGPU **[V webkit.org]**.
- WebKit says ONNX Runtime and Transformers.js "work great" **[V]**.
- caniuse lists `WorkerNavigator.gpu` (WebGPU inside workers) as supported from Safari 26.0 **[C caniuse]**.
- Older iPhones that cannot run iOS 26 get WASM only.
- **Android Chrome:** WebGPU on by default since Chrome 121 on Android 12+ with Adreno/Mali GPUs **[V developer.chrome.com]**. Chrome 146 adds a "compatibility mode" on OpenGL ES 3.1 for older devices **[C]**.
- WebGPU in an iOS **home-screen** PWA is not explicitly documented. It should be the same WebKit, but **test on a device**.
- `SharedArrayBuffer` via **coi-serviceworker** on GitHub Pages works in Chromium. One deployment guide says it is "not compatible with Safari" **[C]**. Treat multithreaded WASM as unavailable on iOS.

#### Quantization

- KataGo `.bin` stores float32. gzip saves only about 7%: b6c96 goes from 4.12 MB to 3.83 MB **[V meas.]**.
- Repacking weights as fp16 for transport halves the download. Expand to fp32 at load, or keep fp16 on WebGPU with `shader-f16`. Watch g170 nets overflowing in fp16 compute **[C]**.
- uint8 hurts accuracy **[C]**.

### 1.2 KataGo Human-SL model

**What it does.** Predicts the move of a player with a given `humanSLProfile` **[V Analysis_Engine.md]**:
- `rank_20k` … `rank_9d`
- `preaz_{rank}` (pre-AlphaZero style)
- `proyear_1800` … `proyear_2023`
- asymmetric `rank_{BR}_{WR}`

The recommended imitation recipe **[V]**:
- 1 visit
- full temperature, sampling from `humanPolicy`
- `ignorePreRootHistory=false`
- optionally `rootNumSymmetriesToSample=2..8`

KataGo warns:
- "for some weaker ranks … may pass too early" → use the main model's search to decide passes **[V]**.
- Many visits make it stronger than the profile **[V]**.
- For style with more strength: `humanPrior * exp(utility/0.5)` / `humanSLChosenMovePiklLambda` **[V]**.

**In the browser.** Feasible: Web KaTrain supports it as an optional download, and toyoshi ran it in Safari on an M2 Mac **[V]**. But:
- **Size:** 99.07 MB (94.5 MiB) **[V]**. That is about 50× Zhess's entire engine, and roughly the 100 MB file ceiling for a git-pushed Pages site.
- **Speed:** one 19×19 eval takes about 1 s on a flagship CPU in WASM, and several seconds on low-end phones **[E from V]**. WebGPU makes it ≈0.1–0.3 s **[E]**.
- **Calibration:**
  - Training data peaks around 5k.
  - OGS forum users (Nov–Dec 2025) report the 10k–20k profiles feel off, mostly weaker than labelled **[C]**.
  - No systematic measurement was found.
- **Bandwidth:** about 1,000 downloads exhaust GitHub Pages' 100 GB/month soft limit **[V limit]**.

**Verdict.** It is the most *human-like* source of weak moves available. It is not the best fit for v1's size/latency/offline/low-end constraints. Offer it later as an opt-in "Human style" pack on WebGPU devices.

A distilled small human-SL net (b6/b10 size) would be ideal, but none exists off the shelf. KataGo's `writetrainingdata` and training scripts make one possible, as an ML project **[V release notes]**.

### 1.3 Leela Zero, Minigo, ELF, SAI

No maintained browser ports found **[V GitHub search]**.

| Engine | Licence | Status |
|---|---|---|
| leela-zero | GPL-3.0 | Last push 2024-05 |
| ELF | — | Archived |
| tensorflow/minigo | Apache-2.0 | Archived 2021 |
| SAI | GPL-3.0 | Last push 2023-09 |

- Minigo's web UI ("minigui") is a front-end to a Python engine over GTP **[C]**.
- Leela Chess Zero had a 2018 TF.js port (lc0-js), but not Leela Zero Go **[C]**.

All are weaker per byte and per FLOP than KataGo nets (KataGo g170 surpassed LZ's 40-block nets **[V TrainingHistory]**). **Not recommended.**

### 1.4 Classical engines compiled to WASM

**GNU Go 3.8**
- **marinahane/gnugo-wasm** (GPL-3.0+, v2 on 2026-10-15) **[V]**:
  - `gnugo.wasm` is 6,159,472 B, which is **932 KB gzipped** **[V meas.]**. `gnugo.mjs` is 81 KB.
  - The release ships the source tarball and licence.
  - GTP over stdin/stdout. `callMain` can run only once per instance, so create a fresh instance per run, replaying the game as GTP `play` commands **[V]**.
  - Two patches: a UB fix, and a faster `dragon_stones_without_owl` **[V]**.
  - Works in Node and the browser. No threads, so no COOP/COEP.
- Older ports: TristanCacqueray/wasm-gnugo (GPL-3, 2024, demo on Pages) and dna2ai/gnugo.js (2021, emscripten, custom API) **[V]**.
- **Strength:** about 5–7k on 9×9 (Wikipedia), and roughly 5–10k KGS on 19×19 at level 10 (forum reports) **[C]**.
- **Use:**
  - The ideal Node **calibration anchor**: KaTrain calibrated its rank bot against GNU Go and Pachi **[V KaTrain README]**.
  - Optional no-NN opponent.
  - GNU Go's `final_status_list` / `dragon_status` can serve as an alternative dead-stone checker.

**Pachi**
- **saigo-online/pachi-web** (GPL-2.0, 0★, 2026-07) **[V]**.
- The `nodcnn` build compiles to WASM unpatched, with about 1 MB of assets **[C]**.
- Built with pthreads, so it **needs COOP/COEP** **[V]**.
- No ownership or score estimate **[V capability table]**.
- Native strength is KGS 2k at 5k–10k playouts (MCTS only) **[V pasky/pachi README]**. On a phone in single-thread WASM it would be weaker **[E]**.

**Fuego.** No WASM build found **[V search]**.

**Michi**
- MIT, about 540 lines of Python **[V]**.
- "Can often win against GNUGo on 9×9 … a fast implementation … around 4k KGS" **[C author]**.
- Only a 2013 toy JS port exists.
- A TS port would make an instructive pure-JS MCTS, but it is dominated by "small KataGo net + MCTS".

**Dark Forest.** Facebook's 2016 DCNN bot. Only reachable via Pachi's DCNN build (Caffe), which does not port to WASM **[C pachi-web]**.

### 1.5 Pure-JS bots

These are recent 0★ hobby repos: NakliTechie/KoLocal (MIT), brett-buskirk/go (MIT, Easy/Hard MCTS), gextam/go-web (MCTS in worker) **[V GitHub search]**. Not worth depending on.

Zigo should own its rules core: board, liberties, ko/superko, captures, area/territory scoring. That core is needed anyway for the UI, ownership-free fallbacks, and the TS search.

---

## 2. Engine features: Zhess → Zigo analogues

| Zhess feature | Zigo analogue | Engine source | Latency notes |
|---|---|---|---|
| **Hint (best move)** | Pulse the top move. Tap again to show the second-best, or the PV's next stone. | Low levels: root `policy` argmax of the small net, effectively instant from cache. High levels: MCTS top move by LCB. | One b6c96 eval is ≈30–250 ms on CPU **[E]**. Precompute it while the human thinks ("ponder"). |
| **Threat peek** (hold) | **Option A (recommended, deterministic, like chess.js attack data):** shade groups in **atari** (1 liberty) and groups with **2 liberties**, both colours, plus ladder-capturable stones. Pure TS, no engine. **Option B:** ownership/territory heatmap from the ownership head (root ownership of the cached eval). | A: rules core. B: KataGo `ownership` (Web KaTrain exposes root/tree ownership **[V]**). | A ≈ 0 ms. B is free if the cached eval exists. |
| **Blunder guard** (≥3 pawns, 150 ms) | Run **one** NN eval of the position after the player's stone. Compare its `scoreLead` (mover's view) with the cached eval of the position before. Flag if the drop is ≥ N points **and** the winrate drop is ≥ X. Suggested starting values **[E]**: N = 6 / 8 / 12 for 9×9 / 13×13 / 19×19, X = 15 points. Add rules-only checks: self-atari of a group of ≥ 3 stones, or not saving a capturable group in atari (the "mate-in-1" analogue). | b6c96 raw net, average 2 symmetries if time allows. Web KaTrain notes a single view of b6c96 can be off by up to 0.25 ownership per point **[V]**. | b6c96 fits 150 ms on mid/flagship phones **[E]**; low-end may need ~250 ms, so let the move through on timeout, as Zhess does. A raw net misses deep reading (semeai, long ladders are partly covered by ladder input features). |
| **Draw offer / acceptance** | No draws in Go; use half-point komi so jigo is impossible. The analogues: (1) **pass handling**: when the human passes, the engine passes back if its search's best move is pass, or if every empty point has \|ownership\| ≥ 0.9 or is dame; otherwise it plays on. (2) **resignation**: KataGo default is winLoss < −0.90 (winrate < 5%) for 3 consecutive turns **[V gtp_example.cfg]**, with `resignMinMovesPerBoardArea` (e.g. 0.4) and `resignMinScoreDifference` **[V]**. Low levels should resign late or never, like humans. (3) **"Count?" request**: the player proposes the end; the engine accepts if its own pass is best. | KataGo value / score / ownership, pass policy. | — |
| **End of game: dead stones** | Propose dead stones from ownership, using OGS `autoscore.ts` (Apache-2.0): remove when ownership crosses ±**0.7**, seal threshold ±0.3 **[V]**. The player taps groups to toggle, then confirms. | Ownership after a short search (e.g. 50–100 visits) for stability. | Under area scoring with passes, Web KaTrain scores terminal nodes exactly instead of asking the net **[V]**. |
| **Score / count display** | **goscorer** (lightvector, MIT, JS + Python, area *and* territory scoring with seki detection and false-eye handling) **[V]**. Area (Chinese / Tromp-Taylor-like) scoring is the most robust default. | Pure JS | ≈ instant |
| **Score estimate mid-game** ("who's ahead") | `scoreLead` from the cached eval. Offline fallback with no net: OGS's `score-estimator` (MIT, C++ → Emscripten, random-playout estimator) **[V]**, or a simple influence heuristic. | KataGo | — |
| Computer never resigns, never offers draws (Zhess) | In Go, a resigning bot is expected at higher levels; use the KataGo rules above. | — | — |

---

## 3. Recommended architecture

### 3.1 Runtime

```
main thread ──postMessage──► engine.worker.js  (classic or module worker; one instance, like useZhessEngine)
                              ├─ rules core (TS): board, superko, liberties, ladders, area features
                              ├─ features v7 (22×N×N planes, 19 globals)            ← port from Web KaTrain (MIT)
                              ├─ NN runtime: TF.js 4.22 — webgpu backend if navigator.gpu
                              │              adapter OK and warm-up passes, else wasm-simd (single-thread)
                              ├─ MCTS (PUCT, LCB, ownership aggregation)            ← port from Web KaTrain (MIT)
                              └─ level policy (pure, injected rng — mirrors levels.ts)
nets: /engine/nets/b6c96.bin(.gz|fp16)   /engine/nets/b10c128.bin(.gz|fp16)   [optional] b18c384nbt
```

- **API** (mirrors `EngineApi`):
  - `genmove(position, level)`
  - `evaluate(position, {visits|timeMs})` → winrate, scoreLead, ownership, policy
  - `analyze(position, n)`
  - `stop()`
- Keep the Zhess driver rules: lazy load, one search at a time, queue, AbortError on stop, `evaluate(…, timeoutMs)` → null.
- **Offline:** CacheFirst for the runtime WASM and nets, as Zhess does. Request `navigator.storage.persist()`. Show download progress (fetch with a stream reader).
- **Backend selection:**
  - Probe WebGPU in the worker.
  - Run a warm-up eval and compare it to the WASM result on a fixed position. Web KaTrain and katago-webgpu both validate.
  - Fall back on any error.
  - Remember the choice per device.
- **Plan B (if TF.js becomes a problem):** ORT Web 1.31 (WASM EP single-thread, plus the WebGPU EP). Convert nets with `katago dumponnx` (v1.18+) or a PyTorch export. Downloads +3.8 MB (CPU) / +6.9 MB (WebGPU).
- **Plan C:** own WGSL + WASM-SIMD conv kernels; saigo katago-webgpu shows the kernel set.

### 3.2 Twelve levels (starting values, to be calibrated)

Targets are for 19×19. 9×9 and 13×13 use the same methods, with visit counts scaled by area. The kyu targets are **[E]**, anchored on these:
- b6c96 bare ≈ 5k, b10c128 bare ≈ 1d **[C maksimKorzh]**
- policy-only with a 2020 KataGo net ≈ OGS 4d **[C KaTrain author, 2020]**
- KaTrain's `rank` formula is calibrated for about 18k…2d **[V constants/ai.py]**

| # | Name | Target | Method |
|---|---|---|---|
| 1 | Beginner | ~30–25k | b6c96 policy sampled at high temperature (T≈2–3) among legal non-eye-filling moves. 30% of moves uniformly random among "reasonable" (policy > 0.1%). Captures a group in atari only 50% of the time (Zhess's "hanging queen" analogue). Never resigns. |
| 2 | Novice | ~22k | KaTrain `rank` pick (n_moves from rank formula, kyu_rank = 22, extrapolated), b6c96 |
| 3 | Easy | ~18k | `rank` 18, b6c96. From here on, never self-ataris a ≥ 4-stone group (rules check). |
| 4 | Casual | ~15k | `rank` 15, b6c96 |
| 5 | Medium (default) | ~12k | `rank` 12, b6c96 |
| 6 | Moderate | ~9k | `rank` 9, b6c96 |
| 7 | Tricky | ~6k | `rank` 6, b6c96, or b6c96 policy-weighted (p^1.5) |
| 8 | Hard | ~3k | b10c128 `rank` 3 |
| 9 | Tough | ~1k–1d | b10c128 raw policy, low temperature (T≈0.3 early, 0 later) |
| 10 | Expert | ~2–3d | b10c128 + MCTS 16–32 visits (CPU ≈ 2–3 s on flagship) |
| 11 | Master | ~4–5d | b10c128 + MCTS 64–200 visits (WebGPU), or as many as fit in 3 s on CPU |
| 12 | Insane | WebGPU + b18: pro-level and beyond; CPU: ~5d | b18c384nbt + 100–400 visits if the optional pack is installed and WebGPU works; otherwise b10c128 at max visits in 3 s, or 1/30 of the clock |

- Levels 1–7 cost one NN eval per move: tens to hundreds of ms on any phone.
- Minimum reply time stays 400 ms.
- Resign rule from level 6 up. Pass logic from the engine at all levels, so weak levels don't pass too early.
- **Alternative for levels 2–9:** Zhess-style humanizing. Search a few visits, then sample among moves within a point-loss budget (KaTrain `scoreloss`: P ∝ exp(−k·pointsLost)). It costs more compute, and the error budget is in points rather than centipawns.
- **Later (M-next):** a "Human style" toggle that swaps levels 1–9 for Human-SL sampling at `rank_20k…rank_1d` on WebGPU devices with the optional 99 MB pack.

### 3.3 Download size

| Part | Size (gz) | When |
|---|---|---|
| Engine worker + TF.js core + wasm/webgpu backends + SIMD WASM | ≈0.4 MB (TF.js parts 0.33 MB **[V meas.]** + own code **[E]**) | First launch (like Zhess) |
| b6c96 | 3.83 MB **[V]** (≈2 MB as fp16 repack **[E]**) | First launch |
| b10c128 | 11.14 MB **[V]** (≈6 MB fp16 **[E]**) | Background after the first game, or on choosing level ≥ 8 |
| **Core total** | **≈15.4 MB** (≈8.4 MB with fp16) | vs Zhess's ≈1.9 MB |
| Optional b18c384nbt | ≈96 MB fp32, ≈48–58 MB fp16 | Opt-in, WebGPU only |
| Optional Human-SL | 99 MB (≈50 MB fp16) | Opt-in, later |
| Optional GNU Go WASM | 0.93 MB **[V meas.]** | Only if used as a fallback bot |

- If ORT Web replaces TF.js, add 3.8 MB (CPU) or 6.9 MB (WebGPU).
- GitHub Pages: 1 GB site limit, **100 GB/month soft bandwidth** **[V]**. Keep large nets opt-in; if they become popular, consider hosting them on Hugging Face or R2 with CORS and SRI.

### 3.4 Precedents: how others do bots on the web

- **Web KaTrain:** fully client-side KataGo in a PWA on GitHub Pages; b6c96 by default, b18 and Human-SL optional **[V]**. The best template; its author also builds web-chess with Stockfish.
- **maksimKorzh/go:** offline PWA, bare b6c96/b10c128 policy, no search **[V]**.
- **Kaya (kayago.app):** ONNX Runtime Web (WebGPU/WebNN/WASM) and Tauri desktop, MCTS in a worker, model "quality tiers" **[V/C]**. AGPL.
- **OGS:**
  - Bots are external processes connected through **gtp2ogs** (MIT) **[V]**, so they are server-side.
  - The client-side score estimator was a WASM random-playout program (`OGSScoreEstimator`, MIT repo from 2019) **[V goban source]**.
  - `goban` also has a remote estimator hook and `autoscore.ts` that turns ownership into dead stones and seals **[V]**.
- **KaTrain (desktop):** runs native KataGo. Its "Calibrated Rank" bot is calibrated against GNU Go and Pachi, and it has Human-like and Historical-Pro bots via Human-SL **[V]**.
- **Native mobile:**
  - *A Master of Go* (iOS, KataGo via CoreML) **[C]**
  - BadukPop: AI characters from beginner to pro; engine not disclosed **[C]**
  - Kifubara: 32 server-side "persona bots", 18k–6d **[C, Web KaTrain competitor notes]**
  - AI Sensei: cloud KataGo analysis (from general knowledge; not checked here)
  - "Go Quest": not researched; no claim made.

---

## 4. Node-side self-play and strength test

- **Same engine in Node: yes.**
  - TF.js runs in Node with `@tensorflow/tfjs-backend-wasm`, the same WASM file, or `tfjs-node` for speed.
  - Web KaTrain runs its real b6c96 model inside Vitest under Node (golden and accuracy tests, `npm run bench`) **[V]**.
  - ORT has `onnxruntime-node`, and `onnxruntime-web`'s WASM build also loads in Node.
  - WebGPU in Node is possible via Dawn bindings but unnecessary: use the CPU path for deterministic tests with a seeded rng, as Zhess's `selfplay.mjs` does.
- **Anchors:**
  - GNU Go WASM runs in Node (its README example is Node-friendly; tests use `test/smoke.mts`) **[V]**.
  - pachi-web has a headless `npm run smoke` **[V]**.
  - toyoshi's KataGo WASM runs as a Node CLI (`NODERAWFS`) **[V]**. It needs pthreads, which Node supports, so it is a reference oracle for checking our TS search against real KataGo.
- **Suggested `scripts/selfplay.mjs` for Zigo:**
  1. Level 12 vs level 1, expecting a win by resignation or score.
  2. A calibration ladder: each level vs **GNU Go level 10** (≈5–8k **[C]**) on 9×9 and 19×19, N games each, to fit the kyu targets. This is the KaTrain method.
  3. Optionally, levels vs real KataGo at fixed visits through the WASM CLI.
- **Runtime:** 19×19 self-play at levels 1–7 costs about 200–300 NN evals per game, a few seconds on a desktop CPU **[E]**. Search levels cost visits × moves.

---

## 5. Risks and open questions

1. **TF.js maintenance.** No release since 2024-10-21 **[V]**. Pin 4.22.0 and self-host. Keep Plan B/C.
2. **WebGPU on iOS home-screen PWAs and in workers.** Supported per caniuse (Safari 26+) **[C]**. **Verify on a device**, and verify the WASM fallback on iOS < 26.
3. **Low-end Android.** b10c128 on CPU (≈0.5–0.8 s/eval **[E]**) makes levels 10–12 slow. Cap by time, not visits, and document that strength depends on the device (as Pachi does).
4. **Blunder guard accuracy.** A raw b6c96 eval is noisy (single-view ownership error up to 0.25 **[V]**). Tune the thresholds by self-play. Prefer missing a blunder to a false bounce.
5. **Calibration below 18k.** KaTrain's formula is calibrated for about 18k–2d **[V]**. Levels 1–2 need Zigo's own humanizing and real-beginner play-testing.
6. **Rules choice.** Area scoring makes passes, dead stones and counting simpler, and Web KaTrain scores terminal nodes exactly under area rules **[V]**. Japanese/territory needs encore or dead-stone agreement; goscorer handles counting, including seki **[V]**.
7. **Storage eviction.** Request persistent storage. Re-download the nets transparently if they are evicted (Zhess's offline-state UI pattern).

---

## Sources

KataGo:
- KataGo repo, licence, releases: https://github.com/lightvector/KataGo · https://github.com/lightvector/KataGo/blob/master/LICENSE · https://github.com/lightvector/KataGo/releases (v1.15.0 Human-SL, v1.17.0 transformers, v1.18.0 ONNX backend, v1.18.2 latest)
- KataGo training history (g170 small nets, Elo): https://github.com/lightvector/KataGo/blob/master/TrainingHistory.md
- g170 net archive: https://katagoarchive.org/g170/neuralnets/index.html
- Network licence: https://katagotraining.org/network_license/
- Current nets: https://katagotraining.org/networks/
- Human SL guide: https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md#human-sl-analysis-guide
- GTP extensions: https://github.com/lightvector/KataGo/blob/master/docs/GTP_Extensions.md
- Resign config: https://github.com/lightvector/KataGo/blob/master/cpp/configs/gtp_example.cfg

Browser KataGo projects:
- Web KaTrain: https://github.com/Sir-Teo/web-katrain (README, docs/engine.md, docs/deployment.md, docs/continuous-audit.md, docs/competitor-analysis.md) · https://sir-teo.github.io/web-katrain/
- Web KaTrain forum thread: https://forums.online-go.com/t/web-katrain-browser-based-katrain-clone-with-in-browser-katago-analysis-webgpu-wasm/59096
- katago-web: https://github.com/JuneKim0712/katago-web
- katago-webgpu: https://github.com/saigo-online/katago-webgpu (WEBGPU_STATUS.md)
- KataGo WASM spike: https://github.com/toyoshi/katago-wasm (BENCHMARK.md)
- Kaya: https://github.com/kaya-go/kaya · https://github.com/kaya-go/katago-onnx · https://huggingface.co/kaya-go/kaya
- yagoo feasibility study: https://github.com/yet-another-ai/yagoo/issues/5
- Bare-net PWAs: https://github.com/maksimKorzh/go · https://github.com/maksimKorzh/kata-model-js

KaTrain:
- https://github.com/sanderland/katrain (README, katrain/core/constants.py, katrain/core/ai.py)
- Weak-AI development thread (2020): https://lifein19x19.com/viewtopic.php?p=256542

Human-SL strength discussion:
- https://forums.online-go.com/t/human-like-katago-v1-15-x-models-real-strength/58843

Classical engines:
- GNU Go WASM: https://github.com/marinahane/gnugo-wasm (release v2 assets) · https://github.com/TristanCacqueray/wasm-gnugo · https://github.com/dna2ai/gnugo.js
- GNU Go: https://en.wikipedia.org/wiki/GNU_Go
- Pachi: https://github.com/saigo-online/pachi-web · https://github.com/pasky/pachi
- Michi: https://github.com/pasky/michi

Scoring:
- goscorer: https://github.com/lightvector/goscorer
- OGS: https://github.com/online-go/score-estimator · https://github.com/online-go/goban (src/engine/autoscore.ts, ownership_estimators/*) · https://github.com/online-go/gtp2ogs

Runtimes:
- ONNX Runtime Web 1.31.1: npm `onnxruntime-web` (sizes measured from the tarball)
- TF.js 4.22.0: npm `@tensorflow/tfjs-core`, `-backend-wasm`, `-backend-webgpu` (sizes measured)

Platform:
- Safari 26 WebGPU: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebGPU in workers: https://caniuse.com/mdn-api_workernavigator_gpu
- Android WebGPU: https://developer.chrome.com/blog/new-in-webgpu-121
- JSPI status: https://caniuse.com/wf-wasm-jspi · https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- coi-serviceworker caveats: https://dev.to/stefnotch/enabling-coop-coep-without-touching-the-server-2d3n
- A Master of Go (native iOS KataGo claim): https://apps.apple.com/app/id1442035374

Zhess context read: `~/Workspace/zhess/DESIGN.md` §7, §10 · `src/lib/levels.ts` · `src/lib/engine/{driver,node}.ts` · `public/engine/README.md` · `scripts/selfplay.mjs`
