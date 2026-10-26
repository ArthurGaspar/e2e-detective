import { createReadStream, existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// In development, serve case documents from a local data directory (a checkout of
// the runs-data branch, or the output of a local patrol) and the trained model.
const dataDir = resolve(import.meta.dirname, process.env.CASE_DATA_DIR ?? "../.runs-data");
const modelPath = resolve(import.meta.dirname, "../model/model.json");

function localData(): Plugin {
  return {
    name: "local-case-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]);
        let file: string | null = null;
        if (url === "/model.json") file = modelPath;
        else if (url.startsWith("/data/")) file = normalize(join(dataDir, url.slice("/data/".length)));
        if (!file || !file.startsWith(file === modelPath ? modelPath : dataDir) || !existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "image/jpeg");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), localData()],
});
