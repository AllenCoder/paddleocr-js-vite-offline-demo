import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

// 编写一个开发服务器插件，拦截 /public 下的 mjs/wasm 文件，防止 Vite 对其进行 transform
function onnxruntimeWebPlugin() {
  return {
    name: "onnxruntime-web-dev-handler",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split("?")[0] : "";
        // 匹配 onnxruntime-web 需要加载的 wasm/mjs 文件
        if (
          url.startsWith("/ort") &&
          (url.endsWith(".mjs") || url.endsWith(".wasm"))
        ) {
          const filePath = path.join(__dirname, "public", url.slice(1));
          if (fs.existsSync(filePath)) {
            const ext = path.extname(url);
            let contentType = "application/octet-stream";
            if (ext === ".mjs" || ext === ".js") {
              contentType = "application/javascript";
            } else if (ext === ".wasm") {
              contentType = "application/wasm";
            }
            res.setHeader("Content-Type", contentType);
            // 还需要设置 COOP/COEP 头，使得 WebAssembly 能够多线程
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
            // 读取并返回文件内容
            const content = fs.readFileSync(filePath);
            res.end(content);
            return;
          }
        }
        next();
      });
    }
  };
}

export default defineConfig(({ command }) => ({
  plugins: [onnxruntimeWebPlugin()],
  optimizeDeps: {
    exclude: ["onnxruntime-web"]
  },
  worker: {
    format: "es"
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  }
}));

