# Engine assets

Static files the computer opponent downloads into `engine-cache` (DESIGN.md section 14). Nothing here is precached by the service worker; it serves this folder `CacheFirst`.

- [`nets/`](nets/README.md): the KataGo networks `g170-b6c96` and `g170e-b10c128` (CC0).
- [`tfjs/`](tfjs/README.md): the TensorFlow.js 4.22.0 WebAssembly backends (Apache-2.0).

None of these files is covered by Zengo's MIT licence.
