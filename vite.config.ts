import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

/**
 * Serves the `.gz` files under `engine/` (the KataGo networks) as plain bytes: `application/gzip`, no
 * `Content-Encoding`. Vite's static server (sirv) labels every `.gz` file `Content-Encoding: gzip`,
 * so a browser fetch would inflate it on the way and the engine would get the raw `.bin`, while a
 * static host such as GitHub Pages sends the gzip bytes unchanged. This keeps dev and preview
 * faithful to the deployed site (DESIGN.md section 14: the networks are cached as downloaded).
 */
function engineGzipAsBytes(): Plugin {
  const middleware = (root: () => string): Connect.NextHandleFunction => (req, res, next) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return next();
    }
    const match = /\/engine\/(.+\.gz)$/.exec(pathname);
    if (!match || (req.method !== "GET" && req.method !== "HEAD")) return next();
    const dir = path.join(root(), "engine");
    const file = path.resolve(dir, match[1]);
    if (!file.startsWith(dir + path.sep)) return next();
    fs.stat(file, (err, stats) => {
      if (err || !stats.isFile()) return next();
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Length": stats.size,
        "Cache-Control": "no-cache",
      });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  };
  return {
    name: "zigo-engine-gzip-as-bytes",
    configureServer(server) {
      server.middlewares.use(middleware(() => server.config.publicDir));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(() => path.resolve(server.config.root, server.config.build.outDir)));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => {
  const gitHash = (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return "dev";
    }
  })();
  const gitDate = (() => {
    try {
      return execSync("git log -1 --format=%ci").toString().trim().slice(0, 19).replace("T", " ");
    } catch {
      return "";
    }
  })();

  return {
    // Relative paths so the build works at any path (GitHub Pages project sites).
    base: "./",
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      engineGzipAsBytes(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "robots.txt"],
        manifest: {
          name: "Zigo - Zero Distractions. Just Go.",
          short_name: "Zigo",
          description: "Zero Distractions. Just Go.",
          theme_color: "#0d0d0d",
          background_color: "#0d0d0d",
          display: "standalone",
          orientation: "any",
          start_url: "./",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "pwa-512x512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          // The engine files under public/engine/ (TF.js backend wasm, KataGo networks, about 4 MB
          // for stage 1 and 11 MB for stage 2) are not precached: the app downloads them into the
          // runtime cache below, with progress on the start screen (DESIGN.md section 14).
          globIgnores: ["engine/**"],
          // Network-first HTML (Ztyle 12, DESIGN 14). index.html stays in the precache so the app
          // works offline from the first load, but navigations must not be answered from it:
          // precacheAndRoute is registered before the runtime routes and would otherwise serve
          // every navigation ("./", the only one under HashRouter) cache-first through its
          // directory index. Without one, navigations reach the NetworkFirst route below, which
          // falls back to the precached shell when the network and html-cache both fail.
          directoryIndex: null,
          navigateFallback: undefined,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "html-cache",
                expiration: { maxEntries: 10 },
                networkTimeoutSeconds: 3,
                precacheFallback: { fallbackURL: "index.html" },
              },
            },
            {
              // Everything under engine/ (scripts, TF.js wasm, the .bin.gz networks): cache-first, so
              // computer games work offline. The app fills this cache itself (DESIGN.md section 14).
              // The networks are stored as downloaded (gzip bytes) and inflated in the worker.
              urlPattern: ({ url }) => /\/engine\/.+\.(?:js|wasm|gz)$/.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "engine-cache",
                expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
    define: {
      __GIT_HASH__: JSON.stringify(gitHash),
      __GIT_DATE__: JSON.stringify(gitDate),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
