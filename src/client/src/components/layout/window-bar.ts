import { paintWindowBar } from "@/lib/api/bridge";

/** `rgb(180, 188, 200)`, a cor calculada de uma ficha do tema (todas são hexadecimais), como `#b4bcc8`; `null` para o que não é `rgb()`. */
export function hexOf(color: string): string | null {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
  return match === null ? null : `#${match.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * RN-JANELA-001: os símbolos dos botões do sistema sobre a barra superior têm a cor `muted` do tema em uso, a mesma dos itens da barra em repouso. A cor vai
 * ao processo principal ao abrir a tela, antes de a janela aparecer, e de novo quando o tema muda: o `data-theme` do <html> (o `theme-boot.js` e o
 * `ThemeSync`) e, no tema do sistema, o claro e o escuro do sistema. Liga uma vez por janela.
 */
export function syncWindowBar(): void {
  const probe = document.createElement("span");
  probe.hidden = true;
  probe.style.color = "var(--color-muted)";
  document.body.append(probe);

  let sent: string | null = null;
  const paint = () => {
    const color = hexOf(getComputedStyle(probe).color);
    if (color === null || color === sent) return;
    sent = color;
    void paintWindowBar(color);
  };

  paint();
  new MutationObserver(paint).observe(document.documentElement, { attributes: true });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
}
