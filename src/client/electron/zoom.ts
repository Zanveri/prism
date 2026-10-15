/**
 * O zoom do programa inteiro (RN-ZOOM-001), em funções puras: os passos, o passo seguinte, a leitura tolerante do que está gravado e a tecla. Não importa
 * nada do Electron nem do Node, porque a tela também o usa (os passos e a conferência do que a ponte responde). Quem grava é o `zoom-file.ts`, e quem
 * aplica nas janelas é o `main.ts` (`webContents.setZoomFactor`).
 */

/** Os passos, em porcentagem: os mesmos do zoom da grade (RN-GRADE-010). 100% é o tamanho do canvas (RN-CONFIG-009). */
export const appZoomSteps = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

export type AppZoom = (typeof appZoomSteps)[number];

export const defaultAppZoom: AppZoom = 100;

const smallest = appZoomSteps[0];
const largest = appZoomSteps[appZoomSteps.length - 1];

/** O que se pede: aumentar (`Ctrl +`), diminuir (`Ctrl −`) ou voltar a 100% (`Ctrl 0`, "Restaurar 100%"). */
export type ZoomStep = "in" | "out" | "reset";

/** Um dos passos, e nada mais: 100 e 110 servem; 105, "110", 1.1 e `null`, não. */
export function isAppZoom(value: unknown): value is AppZoom {
  return typeof value === "number" && (appZoomSteps as readonly number[]).includes(value);
}

/** O zoom depois do pedido. Nos limites o passo que não anda mais fica onde está. */
export function nextAppZoom(zoom: AppZoom, step: ZoomStep): AppZoom {
  if (step === "reset") return defaultAppZoom;
  if (step === "in") return appZoomSteps.find((candidate) => candidate > zoom) ?? largest;
  return appZoomSteps.findLast((candidate) => candidate < zoom) ?? smallest;
}

/** O fator do Chromium (`setZoomFactor`, `webPreferences.zoomFactor`): 1,1 para 110%. */
export const zoomFactor = (zoom: AppZoom): number => zoom / 100;

/**
 * O arquivo do zoom (`zoom.json`, na pasta de dados): `{ "zoom": 110 }`. Pode estar ilegível ou ter sido mexido à mão: o que não é JSON, não é um objeto ou
 * não traz um dos passos vale 100%. Nunca lança.
 */
export function parseAppZoom(text: string): AppZoom {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return defaultAppZoom;

    const { zoom } = value as { zoom?: unknown };
    return isAppZoom(zoom) ? zoom : defaultAppZoom;
  } catch {
    return defaultAppZoom;
  }
}

/** A tecla como o `before-input-event` do Electron a entrega (`Input`), só com o que a conta usa. */
export type ZoomKeyInput = { type: string; key: string; code: string; control: boolean; meta: boolean; alt: boolean };

/**
 * A tecla é um atalho do zoom (RN-ZOOM-001)? Com Ctrl (Cmd no macOS, e o Ctrl de lá não conta), sem Alt:
 *
 * - aumentar: `+` ou `=` (no teclado americano o `+` é Shift+=, e Ctrl+= é como o VS Code e o Chrome aumentam), e o `+` do teclado numérico;
 * - diminuir: `-` e o `-` do teclado numérico;
 * - voltar a 100%: `0`, também o do teclado numérico com o Num Lock ligado.
 *
 * A tecla é a do caractere (`key`), e não a posição, para valer em qualquer layout (no ABNT2 e no americano o `-` e o `=` estão no mesmo lugar; no
 * alemão o `+` tem tecla própria); só o `+` e o `-` do teclado numérico vão pela posição (`code`). O `0` não: com o Num Lock desligado aquela tecla é o
 * `Insert`, e Ctrl+Insert é o copiar do Windows e do Linux, que a página, o editor e a grade têm de receber (o Chrome também só volta a 100% com o Num
 * Lock ligado). Sem Alt porque Ctrl+Alt é o AltGr do Windows, que escreve caracteres.
 * Só o aperto (`keyDown`), com a repetição de quem segura a tecla: segurar Ctrl+= anda passo a passo, como no navegador.
 */
export function zoomShortcut(input: ZoomKeyInput, platform: string): ZoomStep | null {
  if (input.type !== "keyDown" || input.alt) return null;
  const primary = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;
  if (!primary) return null;

  if (input.code === "NumpadAdd" || input.key === "+" || input.key === "=") return "in";
  if (input.code === "NumpadSubtract" || input.key === "-") return "out";
  if (input.key === "0") return "reset";
  return null;
}
