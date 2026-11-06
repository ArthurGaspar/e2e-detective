import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const dataDir = resolve(import.meta.dirname, process.env.CASE_DATA_DIR ?? "../.runs-data");
const modelPath = resolve(import.meta.dirname, "../model/model.json");
const sceneDir = resolve(import.meta.dirname, "../crime-scene");
const types: Record<string, string> = { ".json": "application/json", ".jpg": "image/jpeg", ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function localData(): Plugin {
  return {
    name: "local-case-data",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "model.json", source: readFileSync(modelPath, "utf8") });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let url: string;
        try { url = decodeURIComponent((req.url ?? "").split("?")[0]); }
        catch { res.writeHead(400).end("Invalid URL"); return; }
        let file: string | null = null;
        if (url === "/model.json") file = modelPath;
        else {
          const root = url.startsWith("/data/") ? dataDir : url.startsWith("/crime-scene/") ? sceneDir : null;
          if (!root) return next();
          const prefix = root === dataDir ? "/data/" : "/crime-scene/";
          file = resolve(root, url.slice(prefix.length) || "index.html");
          const rel = relative(root, file);
          if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) { res.writeHead(403).end(); return; }
        }
        if (!file || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), localData()],
});
