import { elementOfTarget, mainHost, resultHostRegistry, type Host } from "@/lib/host/host";

/** O repouso antes da dica, e o tempo em que a seguinte aparece sem ele (o mouse que passa de um botão ao vizinho na mesma barra). */
const showDelay = 500;
const warmFor = 300;
/** A distância entre a dica e o elemento, e a margem até a borda da janela. */
const gap = 6;
const inset = 8;
/** Até esta largura o elemento é um botão de ícone, e a dica fica centrada nele; acima, ela segue o mouse (a linha da árvore, a célula). */
const narrow = 64;

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * Onde a dica fica: embaixo do elemento, ou em cima quando embaixo ela não cabe e em cima há mais lugar. Na horizontal, centrada no elemento estreito e no
 * mouse sobre o largo (pelo teclado, alinhada ao começo dele), e nunca além da margem da janela.
 */
export function placeTip(anchor: Box, tip: Size, view: Size, pointerX: number | null): { left: number; top: number; side: "top" | "bottom" } {
  const below = view.height - inset - anchor.bottom - gap;
  const above = anchor.top - gap - inset;
  const side = tip.height <= below || below >= above ? "bottom" : "top";
  const top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - tip.height;
  const center =
    anchor.width <= narrow ? anchor.left + anchor.width / 2 : pointerX === null ? anchor.left + tip.width / 2 : Math.min(Math.max(pointerX, anchor.left), anchor.right);
  const clamp = (value: number, size: number, room: number) => Math.max(inset, Math.min(value, room - inset - size));
  return { left: clamp(center - tip.width / 2, tip.width, view.width), top: clamp(top, tip.height, view.height), side };
}

/**
 * A dica de várias linhas é um nome e o que se diz dele (a conexão na árvore: o nome; o banco e o endereço; a última verificação): a primeira linha é o
 * título. O valor de uma célula da grade não tem título: vai inteiro, como veio do banco.
 */
export function tipParts(text: string, isValue: boolean): { head: string | null; body: string } {
  const lineBreak = text.indexOf("\n");
  if (isValue || lineBreak < 0) return { head: null, body: text };
  return { head: text.slice(0, lineBreak), body: text.slice(lineBreak + 1) };
}

/** A dica do app no lugar da do sistema, na janela da aba e em cada janela do resultado, das abertas e das que abrirem (RN-ABAS-017). Liga uma vez. */
export function installTooltips(): void {
  installTooltip(mainHost());
  resultHostRegistry.each(installTooltip);
}

/**
 * Toda dica do app é o `title` de um elemento, e esta é a que o mostra, numa página: quem a usa continua escrevendo `title`, e nada muda
 * para o leitor de tela, que o lê do atributo. Com o mouse em cima, o `title` fica vazio (o vazio cala a dica do sistema e ainda é `[title]` para a barra da
 * janela, que não arrasta o que tem dica) e volta quando o mouse sai. O React pode mudar o atributo nesse meio tempo (a célula reciclada da grade, a
 * verificação da conexão): o valor novo entra na dica, e o atributo removido não volta. Pelo teclado, a dica aparece no foco visível, e o `title` fica.
 */
function installTooltip({ document: page, view }: Host): () => void {
  const tip = page.createElement("div");
  tip.className = "app-tip";
  tip.popover = "manual";
  tip.setAttribute("aria-hidden", "true");
  const text = page.createElement("div");
  text.className = "app-tip-text";
  tip.append(text);
  page.body.append(tip);

  let anchor: Element | null = null;
  // O `title` do elemento com o mouse em cima, guardado enquanto o atributo está vazio; `null` quando a dica veio pelo foco.
  let held: string | null = null;
  let timer = 0;
  let warmUntil = 0;
  let pointerX: number | null = null;

  const isOpen = () => tip.matches(":popover-open");
  const textOf = () => held ?? anchor?.getAttribute("title") ?? "";

  const observer = new view.MutationObserver(() => {
    if (anchor === null) return;
    const value = anchor.getAttribute("title");
    if (value === null || (held === null && value.trim() === "")) return release();
    if (held === null || value === "") return fill();
    held = value;
    anchor.setAttribute("title", "");
    fill();
  });

  function fill() {
    if (anchor === null || !isOpen()) return;
    const { head, body } = tipParts(textOf(), anchor.closest('[role="gridcell"], [role="cell"]') !== null);
    tip.toggleAttribute("data-headed", head !== null);
    if (head === null) text.textContent = body;
    else {
      const title = page.createElement("span");
      title.className = "app-tip-head";
      title.textContent = head;
      text.replaceChildren(title, `\n${body}`);
    }
    // Medida no canto: a posição de antes encolheria a largura que ela tem para crescer.
    tip.style.left = "0px";
    tip.style.top = "0px";
    const { left, top, side } = placeTip(anchor.getBoundingClientRect(), tip.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight }, held === null ? null : pointerX);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.dataset.side = side;
  }

  function show() {
    if (anchor === null || !anchor.isConnected || textOf().trim() === "") return;
    const opening = !isOpen();
    if (opening) tip.showPopover();
    fill();
    // Nasce do elemento, a 3 px dele; quem pede menos movimento ao sistema a vê aparecer parada.
    if (opening && !view.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const from = tip.dataset.side === "top" ? "0 3px" : "0 -3px";
      tip.animate([{ opacity: 0, translate: from }, { opacity: 1, translate: "0 0" }], { duration: 140, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }
  }

  function close() {
    view.clearTimeout(timer);
    if (!isOpen()) return;
    tip.hidePopover();
    warmUntil = Date.now() + warmFor;
  }

  /** Solta o elemento: o `title` guardado volta, se o atributo ainda é o vazio que a dica deixou. */
  function drop() {
    view.clearTimeout(timer);
    observer.disconnect();
    if (anchor !== null && held !== null && anchor.getAttribute("title") === "") anchor.setAttribute("title", held);
    anchor = null;
    held = null;
  }

  function release() {
    close();
    drop();
  }

  /** Um clique, uma tecla ou a rolagem fecham a dica, e ela só volta quando o mouse sai do elemento (o `title` segue guardado até lá). */
  function dismiss() {
    if (anchor === null) return;
    close();
    warmUntil = 0;
  }

  function take(element: Element, byMouse: boolean) {
    anchor = element;
    if (byMouse) {
      held = element.getAttribute("title");
      element.setAttribute("title", "");
    }
    observer.observe(element, { attributes: true, attributeFilter: ["title"] });
  }

  function onMove(event: MouseEvent) {
    pointerX = event.clientX;
    const found = elementOfTarget(event.target)?.closest("[title]") ?? null;
    if (found !== null && found === anchor && held !== null) return;
    const wasOpen = isOpen();
    drop();
    // O `title` vazio cala a dica, também a de quem está em volta, como no sistema; com um botão apertado (arrastando, escolhendo células) não há dica.
    if (found === null || found.getAttribute("title")?.trim() === "" || event.buttons !== 0) return close();
    take(found, true);
    if (wasOpen) show();
    else timer = view.setTimeout(show, Date.now() < warmUntil ? 0 : showDelay);
  }

  function onFocusIn(event: FocusEvent) {
    const element = elementOfTarget(event.target);
    // Na árvore, as setas passam por uma linha atrás da outra, e a dica de cada uma cobriria as de baixo.
    if (held !== null || element === null || !element.getAttribute("title")?.trim() || !element.matches(":focus-visible") || element.closest('[role="tree"]') !== null) return;
    release();
    take(element, false);
    timer = view.setTimeout(show, showDelay);
  }

  const onFocusOut = (event: FocusEvent) => {
    if (held === null && event.target === anchor) release();
  };
  const onOut = (event: MouseEvent) => {
    if (event.relatedTarget === null && held !== null) release();
  };

  const capture = { capture: true, passive: true };
  page.addEventListener("mousemove", onMove, { passive: true });
  page.addEventListener("mouseout", onOut, { passive: true });
  page.addEventListener("focusin", onFocusIn);
  page.addEventListener("focusout", onFocusOut);
  for (const type of ["mousedown", "keydown", "wheel", "scroll"] as const) page.addEventListener(type, dismiss, capture);
  view.addEventListener("resize", dismiss);
  view.addEventListener("blur", release);

  return () => {
    release();
    page.removeEventListener("mousemove", onMove);
    page.removeEventListener("mouseout", onOut);
    page.removeEventListener("focusin", onFocusIn);
    page.removeEventListener("focusout", onFocusOut);
    for (const type of ["mousedown", "keydown", "wheel", "scroll"] as const) page.removeEventListener(type, dismiss, capture);
    view.removeEventListener("resize", dismiss);
    view.removeEventListener("blur", release);
    tip.remove();
  };
}
