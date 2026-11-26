import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { defineConfig } from "vite";

// Static single-page app, a pure client of the Rigs API. In production the API is served on
// the same origin (rigs.openrms.dev/api); in development Vite proxies it.
const API = (globalThis as any).process?.env?.RIGS_API_URL ?? "http://localhost:8790";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit({ adapter: adapter({ fallback: "index.html" }) })],
  server: {
    port: 5174,
    proxy: { "/api": API, "/docs": API },
  },
});
