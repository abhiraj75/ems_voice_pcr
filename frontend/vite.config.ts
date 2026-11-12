import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The one-page pitch is a second static page, served at /pitch.
  build: { rollupOptions: { input: { main: "index.html", pitch: "pitch/index.html" } } },
});
