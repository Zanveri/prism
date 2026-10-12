import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import { searchForWorkspaceRoot } from "vite";

// `assets/`, na raiz do repositório: a única cópia dos desenhos da marca (RN-MARCA-007). O splash (processo principal) e a tela a
// importam por `@assets/...`; o servidor do Vite só serve o que está na pasta do projeto, e a pasta da marca entra na lista dele.
const brandAssets = resolve("../../assets");

// O layout é o da seção 3.3 da especificação (`electron/` e `src/`), não o padrão do electron-vite
// (`src/main`, `src/preload`, `src/renderer`): por isso as três entradas são declaradas aqui.
export default defineConfig({
  main: { resolve: { alias: { "@assets": brandAssets } }, build: { rollupOptions: { input: { main: resolve("electron/main.ts") } } } },
  preload: { build: { rollupOptions: { input: { preload: resolve("electron/preload.ts") } } } },
  renderer: {
    root: ".",
    plugins: [tailwindcss()],
    resolve: { alias: { "@": resolve("src"), "@assets": brandAssets } },
    server: { fs: { allow: [searchForWorkspaceRoot(resolve(".")), brandAssets] } },
    build: {
      rollupOptions: {
        input: resolve("index.html"),
        // O `"use client"` que o react-router e o react-query trazem não quer dizer nada aqui; o
        // aviso de que ele foi ignorado, um por arquivo, esconderia os avisos que importam.
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  },
});
