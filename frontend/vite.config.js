import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// ระหว่าง `npm run dev` ให้ /data/real.json และ /data/synthetic.json อ่านตรงจาก ../outputs/<source>/dashboard.json
function outputsData() {
  const outputs = path.resolve(__dirname, "..", "outputs");
  return {
    name: "serve-pipeline-outputs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/data\/(real|synthetic)\.json/);
        if (!m) return next();
        const f = path.join(outputs, m[1], "dashboard.json");
        if (!fs.existsSync(f)) { res.statusCode = 404; return res.end("not found"); }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        fs.createReadStream(f).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), outputsData()],
  build: { outDir: "dist", emptyOutDir: true },
});
