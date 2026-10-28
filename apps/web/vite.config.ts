import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const api = "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": api, "/graphql": api, "/graphiql": api, "/ruru-static": api },
  },
});
