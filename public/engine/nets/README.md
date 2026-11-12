# KataGo networks

The two neural networks the computer opponent runs (DESIGN.md sections 10 and 14). They are downloaded by the app into `engine-cache` (stage 1: the 6-block net on the first launch; stage 2: the 10-block net on demand) and are never precached by the service worker. The files are kept exactly as published (gzip), and the engine inflates them itself.

| File | Bytes | SHA-256 | Role |
|------|------:|---------|------|
| `g170-b6c96-s175395328-d26788732.bin.gz` | 3,827,339 | `f57fddf4672364d385d6ab177364ab819810d1123e229cb2649c4f337a2160b1` | stage 1, levels 1–7, blunder guard |
| `g170e-b10c128-s1141046784-d204142634.bin.gz` | 11,138,361 | `1a8e05a4ea3fca20dab79410cbb566c760767fcdd2fa0b701cfe259a84cc8b04` | stage 2, levels 8–12 |

Both are KataGo model version 8, from the g170 training run.

**Source:** <https://katagoarchive.org/g170/neuralnets/index.html> (downloaded 2026-11-12 from `https://katagoarchive.org/g170/neuralnets/<file>`).

**Licence:** CC0 1.0 (public domain dedication) by Jane Street and David J. Wu ("lightvector"), see [`LICENSE.txt`](LICENSE.txt), copied from <https://katagoarchive.org/g170/LICENSE.txt>. They are not covered by Zigo's MIT licence.

The 6-block net decompresses to the same bytes as Web KaTrain's `public/models/katago-small.bin.gz` (SHA-256 of the inflated file `2bcc7c4daac6e33e9b9f5f8a427e1536b50aa705cfdb7fe21bffacbcdbfc7242`); the gzip files differ only in the header timestamp.
