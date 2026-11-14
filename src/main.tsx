import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { firstChild, loadFonts, revealWhenSettled } from "./boot";
import "./fonts";
import "./index.css";

// The brand font starts loading before React renders; the page fades in once it is in (./boot.ts).
const fonts = loadFonts();

// Theme follows the system (Ztyle, color chapter: "Dark mode"). index.html sets it before the first
// paint; this keeps it following the system.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const root = document.getElementById("root")!;
createRoot(root).render(<App />);
void revealWhenSettled(fonts, firstChild(root));
