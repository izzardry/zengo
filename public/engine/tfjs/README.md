# TensorFlow.js WebAssembly backends

The `.wasm` binaries of `@tensorflow/tfjs-backend-wasm` **4.22.0**, copied unmodified from `node_modules/@tensorflow/tfjs-backend-wasm/dist/`. The engine worker points TF.js at this folder (`setWasmPaths`) when WebGPU is unavailable (DESIGN.md section 10.1).

| File | Bytes | SHA-256 |
|------|------:|---------|
| `tfjs-backend-wasm.wasm` | 311,123 | `70a5d516060464e5269f01c74bac1772d6b8ab6cb612acf16b5cdaf61f78d892` |
| `tfjs-backend-wasm-simd.wasm` | 424,594 | `77ebb28a6d34f371dbbf2086b7f2de8994acd8ea5a3cf1fa24d2c26c840cac7b` |
| `tfjs-backend-wasm-threaded-simd.wasm` | 435,643 | `c052228d4bef185c27bbe59a9e029570c78bbb9f08b3cb46b597851650373de2` |

The threaded build needs `SharedArrayBuffer` (cross-origin isolation), which GitHub Pages cannot provide; TF.js only picks it when the page is isolated, so on Pages the SIMD or plain build runs.

**Source:** <https://github.com/tensorflow/tfjs> (npm `@tensorflow/tfjs-backend-wasm@4.22.0`).

**Licence:** Apache License 2.0, Copyright Google LLC: see `LICENSE` in this folder (the unmodified licence text; upstream <https://github.com/tensorflow/tfjs/blob/master/LICENSE>). Not covered by Zigo's MIT licence.
