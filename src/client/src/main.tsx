// Primeiro de todos: precisa rodar antes de qualquer módulo que crie um schema.
import "@/lib/utils/zod-jitless";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// As fontes vão dentro do app (sem Google Fonts): os três pesos que o canvas usa.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import { App } from "@/app/app";
import { syncWindowBar } from "@/components/layout/window-bar";
import "@/styles/globals.css";

syncWindowBar();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
