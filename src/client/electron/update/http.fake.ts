import type { HttpGet, HttpResponse } from "./download";

/** O que um endereço responde no transporte de mentira dos testes. */
export type FakeStep = { status?: number; headers?: Record<string, string>; chunks?: Uint8Array[]; redirect?: string; hang?: boolean; failAfter?: number };

/**
 * Um transporte de mentira para os testes: cada endereço tem a resposta que o caso pede, e todo endereço pedido fica
 * anotado (`requested`), com os cabeçalhos a mais que o pedido levou (`requests`). Faz o que o de verdade (`net-transport.ts`)
 * faz com um redirecionamento (pergunta antes de seguir, e recusado ele falha) e com o cancelamento (o corpo para). Endereço sem
 * resposta é servidor fora do ar.
 */
export function fakeHttp(routes: Record<string, FakeStep>) {
  const requested: string[] = [];
  const requests: { url: string; headers: Record<string, string> }[] = [];

  const http: HttpGet = async (url, { signal, allowRedirect, headers: requestHeaders = {} }) => {
    let current = url;
    for (;;) {
      requested.push(current);
      requests.push({ url: current, headers: { ...requestHeaders } });
      const step = routes[current];
      if (step === undefined) throw new Error(`net::ERR_CONNECTION_REFUSED ${current}`);
      if (step.redirect !== undefined) {
        if (!allowRedirect(step.redirect)) throw new Error("Redirect was cancelled");
        current = step.redirect;
        continue;
      }

      const { status = 200, headers = {}, chunks = [], hang = false, failAfter } = step;
      const response: HttpResponse = {
        status,
        header: (name) => headers[name.toLowerCase()] ?? null,
        body: (async function* () {
          let sent = 0;
          for (const chunk of chunks) {
            if (signal.aborted) throw new Error("aborted");
            if (failAfter !== undefined && sent >= failAfter) throw new Error("net::ERR_CONNECTION_RESET");
            sent += 1;
            yield chunk;
          }
          if (hang) await new Promise((_, reject) => (signal.aborted ? reject(new Error("aborted")) : signal.addEventListener("abort", () => reject(new Error("aborted")))));
        })(),
      };
      return response;
    }
  };

  return { http, requested, requests, routes };
}
