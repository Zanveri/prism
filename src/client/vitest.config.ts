import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@assets` é a pasta da marca na raiz do repositório, como em `electron.vite.config.ts`.
  resolve: { alias: { "@": resolve("src"), "@assets": resolve("../../assets") } },
  test: { include: ["electron/**/*.test.ts", "scripts/**/*.test.ts", "src/**/*.test.ts"] },
});
