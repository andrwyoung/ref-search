import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 54999,
    strictPort: true, // fail instead of picking another if it's taken
  },
});
