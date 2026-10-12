import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "release/**", "resources/**", ".api-dev/**", ".api-publish/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  // `scripts/*.mjs` roda no Electron: `console` existe, e o resto vem de `import`.
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { console: "readonly" } } },
  // `public/*.js` são scripts clássicos que o navegador roda como estão (hoje só o `theme-boot.js`): sem import, e com `document` e `localStorage`.
  { files: ["public/**/*.js"], languageOptions: { sourceType: "script", globals: { document: "readonly", localStorage: "readonly" } } },
);
