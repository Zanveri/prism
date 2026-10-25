import { z } from "zod";

/**
 * O que passa entre a tela e o processo principal sobre a janela do resultado (RN-ABAS-013 e 017), com o mesmo schema dos dois lados: o processo principal
 * confere o que a tela manda antes de agir, e a tela confere o que ele conta (a ponte é a fronteira de confiança, RN-SHELL-001). A janela do resultado não
 * tem ponte (sem preload): tudo passa pela janela da aba que a abriu, e o nome (`prism-result-<id da aba>`) é o que diz de qual janela se trata.
 */

/** O nome que a tela dá à janela do resultado no `window.open`: `prism-result-` e o id da aba (um UUID em minúsculas). Âncora nas duas pontas. */
export const resultWindowNamePattern = /^prism-result-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const resultWindowNameSchema = z.string().regex(resultWindowNamePattern);

/** O nome da janela do resultado de uma aba, a partir do id dela (que é um UUID). */
export const resultWindowNameOf = (tabId: string) => `prism-result-${tabId}`;

/** O endereço e o texto das opções da única abertura que o processo principal aprova (RN-ABAS-017). */
export const resultWindowUrl = "about:blank";
export const resultWindowFeatures = "popup";

/** Quantas janelas do resultado uma janela da aba pode ter abertas, e quanto tempo dura a concessão de um pedido (RN-ABAS-013 e 017). */
export const maxResultWindows = 32;
export const grantTtlMs = 2_000;
/** Sem o aviso de pronta, o processo principal mostra a janela assim mesmo depois disto. */
export const readyTimeoutMs = 3_000;

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

/**
 * `prism:result-window-request`: o nome; `mode` `"focus"` quando a pessoa pediu a janela naquela hora (o botão, o menu, o arraste) e `"background"` quando não
 * (a volta das abas, a aba nova com a preferência, a aba levada de outra janela); `at`, só no arraste da aba do resultado: o ponto do `dragend`, que vale só
 * onde o processo principal não lê o ponteiro (o Wayland).
 */
export const resultWindowRequestSchema = z.object({ name: resultWindowNameSchema, mode: z.enum(["focus", "background"]), at: point.nullable() }).strict();

export type ResultWindowRequest = z.infer<typeof resultWindowRequestSchema>;

/** A resposta ao pedido: pode abrir (a concessão vale por 2 segundos) ou não. */
export const resultWindowReplySchema = z.object({ ok: z.boolean() }).strict();

export type ResultWindowReply = z.infer<typeof resultWindowReplySchema>;

/** `prism:result-window-ready` e `prism:result-window-close`: só o nome. */
export const resultWindowNamedSchema = z.object({ name: resultWindowNameSchema }).strict();

export type ResultWindowNamed = z.infer<typeof resultWindowNamedSchema>;

/**
 * `prism:result-window-focus`: traz uma janela à frente (`restore()` se minimizada, `show()` e `focus()`). `target` diz qual: a do resultado (o padrão) ou a da
 * aba que a abriu ("Voltar para o painel" e o F6 de dentro da janela do resultado, que não tem ponte para pedir por si).
 */
export const resultWindowFocusSchema = z.object({ name: resultWindowNameSchema, target: z.enum(["result", "opener"]).optional() }).strict();

export type ResultWindowFocus = z.infer<typeof resultWindowFocusSchema>;

/** `prism:result-window-title`: o título da barra da janela, na barra de tarefas e no Alt+Tab. */
export const resultWindowTitleSchema = z.object({ name: resultWindowNameSchema, title: z.string().min(1).max(500) }).strict();

export type ResultWindowTitle = z.infer<typeof resultWindowTitleSchema>;

/** Quem fechou a janela: a pessoa (o X da barra, Alt+F4, Cmd+W) ou o Prism (o bloqueio, o "Sair", levar a aba, o fim do app). Só `"user"` volta o resultado ao painel. */
export const closeReasonSchema = z.enum(["user", "host"]);

export type CloseReason = z.infer<typeof closeReasonSchema>;

/** `prism:result-window-closed`: o aviso do processo principal à janela que abriu a do resultado. */
export const resultWindowClosedSchema = z.object({ name: resultWindowNameSchema, reason: closeReasonSchema }).strict();

export type ResultWindowClosed = z.infer<typeof resultWindowClosedSchema>;

/** `prism:result-window-state`: a janela minimizou ou voltou (o resultado "à vista" é o da janela não minimizada, RN-ABAS-015). */
export const resultWindowStateSchema = z.object({ name: resultWindowNameSchema, minimized: z.boolean() }).strict();

export type ResultWindowState = z.infer<typeof resultWindowStateSchema>;
