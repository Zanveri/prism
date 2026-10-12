import { net, type Session } from "electron";

import type { HttpGet } from "./download";

/**
 * O pedido de rede de verdade (RN-ATUALIZA-008): o `net.request` do Electron, que usa a pilha de rede do Chromium (o proxy e
 * os certificados do sistema) numa sessão só do atualizador, em memória. A validação do certificado nunca é desligada: não há
 * `setCertificateVerifyProc` nem tratador de `certificate-error` no app.
 *
 * - `redirect: "manual"`: cada redirecionamento é perguntado a quem chamou ANTES de qualquer pedido ao endereço novo; recusado,
 *   o pedido é cancelado. (O `net.fetch` não serve: com `manual` ele falha sem mostrar para onde era o redirecionamento.)
 * - Nada que identifique o usuário ou a máquina: sem cookies (`useSessionCookies: false`), sem credenciais (`credentials:
 *   "omit"`, que também cala o pedido de senha de um proxy), sem cache, e o agente é só `Prism/<versão>`. O idioma do sistema,
 *   que o Chromium mandaria em `Accept-Language`, vira `*`.
 * - `Accept-Encoding: identity`: o corpo chega como o servidor o tem, e o tamanho declarado pode ser conferido com o recebido.
 * - Os cabeçalhos a mais de cada pedido (os da API do GitHub, na consulta) vão primeiro; os fixos acima vêm depois e valem sobre eles.
 *
 * Este arquivo é o único do atualizador que importa o Electron; por isso não tem teste de unidade. O que ele faz foi conferido
 * com um servidor local (redirecionamento seguido e recusado, cabeçalhos, cancelamento) e pela prova de ponta a ponta.
 */
export function createHttpGet(session: Session, userAgent: string): HttpGet {
  return (url, { signal, allowRedirect, headers = {} }) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));

      const request = net.request({ url, method: "GET", session, redirect: "manual", useSessionCookies: false, credentials: "omit", cache: "no-store" });
      for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
      request.setHeader("User-Agent", userAgent);
      request.setHeader("Accept-Language", "*");
      request.setHeader("Accept-Encoding", "identity");

      request.on("redirect", (_status, _method, redirectUrl) => {
        if (allowRedirect(redirectUrl)) request.followRedirect();
        else request.abort();
      });
      request.on("response", (response) => {
        resolve({
          status: response.statusCode,
          header(name) {
            const value = response.headers[name.toLowerCase()];
            return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
          },
          // A resposta do Electron é um stream do Node, que se lê com `for await`; a declaração de tipos dela não diz isso.
          body: response as unknown as AsyncIterable<Uint8Array>,
        });
      });
      request.on("error", reject);
      request.on("abort", () => reject(new Error("aborted")));
      signal.addEventListener("abort", () => request.abort(), { once: true });
      request.end();
    });
}
