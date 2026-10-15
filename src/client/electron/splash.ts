import { Buffer } from "node:buffer";
import { BrowserWindow } from "electron";

import prismLogo from "@assets/prism-logo.svg?raw";
import zanveriWordmark from "@assets/zanveri/zanveri-wordmark-paper.svg?raw";

import splashHtml from "./splash.html?raw";

export type SplashStep = "api" | "ui";

/** RN-MARCA-003: os dois passos da abertura, com o texto, a posição e quanto da barra está cheia. */
export const splashSteps: Record<SplashStep, { label: string; position: string; progress: number }> = {
  api: { label: "Iniciando o serviço local…", position: "1 de 2", progress: 45 },
  ui: { label: "Carregando a interface…", position: "2 de 2", progress: 85 },
};

/** Texto entre aspas de uma regra CSS: a barra invertida, a aspa e a quebra de linha não saem soltas. */
function cssString(text: string) {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ")}"`;
}

/**
 * O que muda de um passo para o outro. A página é estática e sem script (RN-MARCA-005), então o
 * texto, a posição e a largura da barra chegam como CSS que o processo principal insere. O segundo
 * parâmetro existe para o teste exercitar o escape com um texto que os passos de verdade não têm.
 */
export function splashCss(step: SplashStep, steps = splashSteps): string {
  const { label, position, progress } = steps[step];

  // `.bar > .bar-fill`: o CSS inserido entra antes do da página, então a regra precisa pesar mais
  // que o `.bar-fill { width: 0 }` dela.
  return [`.step-label::before { content: ${cssString(label)}; }`, `.step-position::before { content: ${cssString(position)}; }`, `.bar > .bar-fill { width: ${progress}%; }`].join("\n");
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * O logotipo de `assets/` (RN-MARCA-007) dentro da página: o mesmo desenho, sem o título e a descrição do arquivo avulso (o título viraria
 * dica sob o ponteiro), e com o texto alternativo que o splash sempre teve, que é a descrição do arquivo. O tamanho é do CSS da página.
 */
export function inlineLogo(svg: string): string {
  const description = /<desc>([^<]*)<\/desc>/.exec(svg)?.[1];
  if (description === undefined || !svg.startsWith("<svg ")) throw new Error("O logotipo de assets/ não tem a raiz <svg> com a descrição.");

  return svg
    .trim()
    .replace(/<title>[^<]*<\/title>\n?/, "")
    .replace(/<desc>[^<]*<\/desc>\n?/, "")
    .replace(/^<svg /, `<svg role="img" aria-label="${description.replaceAll('"', "&quot;")}" `);
}

/**
 * O wordmark claro da Zanveri (RN-MARCA-008), embutido como imagem `data:`, com os bytes do arquivo como a empresa o entregou: a página não
 * carrega nada de fora, e o estilo e os ids do arquivo ficam dentro da imagem, sem se misturar com os da página.
 */
const wordmarkSource = `data:image/svg+xml;base64,${Buffer.from(zanveriWordmark, "utf8").toString("base64")}`;
const logoMarkup = inlineLogo(prismLogo);

/**
 * A página do splash com a versão do app (RN-VERSAO-004), o logotipo e o selo: tudo é texto no HTML, antes de a página carregar, e não
 * script. Funções como substituto, porque `$&` e afins na versão (ou no desenho) não podem valer como padrão do `replace`.
 */
export function splashPage(version: string): string {
  return splashHtml
    .replace("{{prism-logo}}", () => logoMarkup)
    .replace("{{zanveri-wordmark}}", () => wordmarkSource)
    .replace("{{version}}", () => escapeHtml(version));
}

/** O tamanho do desenho do splash (`splash.html`), em 100%. */
export const splashBaseSize = { width: 640, height: 400 } as const;

/**
 * O splash no zoom do programa (RN-ZOOM-001): a janela cresce junto com o desenho, e o fator é o do zoom, até a janela caber na área útil da tela
 * (a 200%, 1280×800 não cabe num monitor de 1366×768, e o splash não tem moldura para ser arrastado). A página continua desenhada em 640×400.
 */
export function splashGeometry(factor: number, workArea: { width: number; height: number }): { width: number; height: number; zoomFactor: number } {
  const fit = Math.min(factor, workArea.width / splashBaseSize.width, workArea.height / splashBaseSize.height);
  const zoomFactor = Number.isFinite(fit) && fit > 0 ? fit : 1;
  return { width: Math.round(splashBaseSize.width * zoomFactor), height: Math.round(splashBaseSize.height * zoomFactor), zoomFactor };
}

/**
 * A janela de abertura (RN-MARCA-002): 640×400 no zoom do programa (`splashGeometry`), sem moldura, no centro, sem preload e sem acesso a
 * nada do app. Não aparece enquanto o primeiro passo não estiver desenhado, para nunca mostrar a
 * barra vazia e sem texto.
 */
export function createSplash(options: { iconPath: string | undefined; version: string; geometry: ReturnType<typeof splashGeometry> }): { setStep(step: SplashStep): void; close(): void } {
  const { width, height, zoomFactor } = options.geometry;
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    title: "Prism",
    icon: options.iconPath,
    backgroundColor: "#0E1114",
    // RN-ZOOM-001: o splash já aparece no zoom escolhido. A página é `data:`, sem origem, e o zoom dela não se mistura com o das janelas do app.
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, zoomFactor },
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // `insertCSS` antes de a página carregar se perde: toda mudança de passo espera nesta fila.
  let queue: Promise<unknown> = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashPage(options.version))}`);
  let inserted: string | undefined;

  window.once("ready-to-show", () => {
    void queue.then(() => {
      if (!window.isDestroyed()) window.show();
    });
  });

  return {
    setStep(step) {
      queue = queue
        .then(async () => {
          if (window.isDestroyed()) return;

          // O novo entra antes de o anterior sair: não há quadro sem texto no meio.
          const key = await window.webContents.insertCSS(splashCss(step));
          if (inserted !== undefined) await window.webContents.removeInsertedCSS(inserted);
          inserted = key;
        })
        .catch((error: unknown) => console.log(`[prism] splash: ${error instanceof Error ? error.message : String(error)}`));
    },
    close() {
      if (!window.isDestroyed()) window.close();
    },
  };
}
