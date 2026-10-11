import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";

// 端口从环境变量读：WEB_PORT（网页，默认 5297）、SERVER_PORT（服务器，默认 3026）。
const webPort = Number(process.env.WEB_PORT ?? 5297);
const serverTarget = `http://localhost:${process.env.SERVER_PORT ?? 3026}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/kaiju/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette)],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: serverTarget, ws: true },
      "/health": serverTarget
    }
  }
});
