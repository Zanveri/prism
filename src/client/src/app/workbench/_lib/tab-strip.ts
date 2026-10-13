import { scriptsCopy } from "./scripts.copy";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.tabs;

/**
 * A faixa de abas (D2): uma linha só que rola na horizontal. Aqui fica tudo o que ela decide sem tocar a página, em funções puras:
 * quando há o que rolar, para onde rolar para trazer a aba ativa à vista, o que a roda faz, as teclas, o que cada fechamento fecha e
 * o menu de botão direito de uma aba.
 */

/** As medidas da área que rola: onde está, o que cabe e o tamanho de tudo. */
export type StripMetrics = { scrollLeft: number; clientWidth: number; scrollWidth: number };

/** Meio pixel de folga: a rolagem de uma tela de densidade fracionária não para num número inteiro. */
const tolerance = 1;

/**
 * Há aba escondida de cada lado? É o que acende os botões de rolar das pontas. Uma faixa sem largura (a área de trabalho
 * escondida por baixo de outra tela) não tem o que rolar.
 */
export function overflowOf({ scrollLeft, clientWidth, scrollWidth }: StripMetrics): { left: boolean; right: boolean } {
  if (clientWidth <= 0) return { left: false, right: false };
  return { left: scrollLeft > tolerance, right: scrollLeft + clientWidth < scrollWidth - tolerance };
}

/**
 * Para onde rolar para trazer uma aba (a ativa) à vista, com uma folga em volta, ou `null` se ela já está à vista (ou se a faixa não
 * tem largura para medir). A aba mais larga que a faixa fica com o começo à mostra.
 */
export function revealOffset({ scrollLeft, clientWidth, scrollWidth }: StripMetrics, item: { left: number; width: number }, margin = 12): number | null {
  if (clientWidth <= 0) return null;

  const farthest = Math.max(0, scrollWidth - clientWidth);
  const clamp = (offset: number) => Math.min(farthest, Math.max(0, offset));
  const start = item.left - margin;
  const end = item.left + item.width + margin;

  const target = start < scrollLeft || end - start > clientWidth ? clamp(start) : end > scrollLeft + clientWidth ? clamp(end - clientWidth) : scrollLeft;
  return Math.abs(target - scrollLeft) < tolerance ? null : target;
}

/** A parte da roda que vira rolagem horizontal. A roda comum (vertical) rola as abas; o gesto horizontal o navegador já trata, e não se soma. */
export function wheelScroll({ deltaX, deltaY, deltaMode }: { deltaX: number; deltaY: number; deltaMode: number }): number {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return 0;
  // `deltaMode` 1 conta em linhas (a roda de alguns mouses): 16 px cada.
  return deltaMode === 1 ? deltaY * 16 : deltaY;
}

/** Quanto os botões das pontas rolam por clique: boa parte da faixa, e o resto das abas continua à vista. */
export function scrollStep(clientWidth: number): number {
  return Math.max(120, Math.round(clientWidth * 0.7));
}

/** A aba que a seta leva o foco (dão a volta), ou Home e End: o índice, ou `null` para outra tecla. */
export function stripKeyTarget(key: string, current: number, count: number): number | null {
  if (count === 0) return null;

  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** O atalho de fechar a aba como a plataforma o escreve: Cmd+W no macOS, Ctrl+W nas outras (`navigator.platform`). */
export function closeShortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? copy.closeShortcutMac : copy.closeShortcut;
}

/** Ctrl+W (ou Cmd+W) fecha a aba ativa. Com Shift ou Alt junto é outro atalho. */
export function isCloseShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w";
}

/** O que cada item do menu de uma aba fecha: ela, as outras, as da direita ou todas. */
export type CloseScope = "one" | "others" | "right" | "all";

/** Os ids das abas que o fechamento fecha, na ordem da faixa. Sem a aba (já fechada), nada. */
export function tabsToClose(scope: CloseScope, tabs: readonly { id: string }[], targetId: string): string[] {
  const position = tabs.findIndex((tab) => tab.id === targetId);
  if (position < 0) return [];

  switch (scope) {
    case "one":
      return [targetId];
    case "others":
      return tabs.filter((tab) => tab.id !== targetId).map((tab) => tab.id);
    case "right":
      return tabs.slice(position + 1).map((tab) => tab.id);
    case "all":
      return tabs.map((tab) => tab.id);
  }
}

export type TabMenuItem = { scope: CloseScope; label: string; disabled: boolean; shortcut?: string };

/**
 * O menu de botão direito de uma aba, em grupos: fechar a aba; e fechar as outras, as da direita ou todas. O item que não se aplica
 * (as outras, com uma aba só; as da direita, na última) fica à vista, apagado. O atalho vem escrito no item da aba ativa, que é a que ele fecha.
 */
export function tabMenu(tabs: readonly { id: string }[], targetId: string, activeTabId: string | null, shortcut: string = copy.closeShortcut): TabMenuItem[][] {
  return [
    [{ scope: "one", label: copy.closeOne, disabled: false, shortcut: targetId === activeTabId ? shortcut : undefined }],
    [
      { scope: "others", label: copy.closeOthers, disabled: tabsToClose("others", tabs, targetId).length === 0 },
      { scope: "right", label: copy.closeRight, disabled: tabsToClose("right", tabs, targetId).length === 0 },
      { scope: "all", label: copy.closeAll, disabled: false },
    ],
  ];
}

/**
 * Fechar várias abas é uma fila (`closeTab` parte da lista que viu quando foi criado, então chamado várias vezes no mesmo instante só a última remoção
 * vale): a primeira fecha na hora, e as demais esperam a lista mudar. Um segundo fechamento no meio do primeiro se junta à fila, e não a substitui: o que já
 * estava lá fica na frente, e nada se repete.
 */
export function mergeCloseQueue(queue: readonly string[], ids: readonly string[]): string[] {
  return [...queue, ...ids.filter((id) => !queue.includes(id))];
}

/**
 * O próximo a fechar: o primeiro da fila que ainda está aberto, e o resto que vem depois dele. Um id que já saiu (a pessoa fechou aquela aba por outro
 * caminho) é pulado: a fila não fica parada nele.
 */
export function nextToClose(queue: readonly string[], open: ReadonlySet<string>): { next: string | null; rest: string[] } {
  const index = queue.findIndex((id) => open.has(id));
  return index < 0 ? { next: null, rest: [] } : { next: queue[index], rest: queue.slice(index + 1) };
}

/**
 * Os rótulos da lista de todas as abas, na ordem das abas. O mesmo título em conexões diferentes (a tabela `producao.pedido` de dois bancos) mostra a
 * conexão de cada uma, `título (conexão)`, e só nelas; sem o nome da conexão (a lista de conexões ainda não chegou), o título fica como é.
 */
export function tabListLabels(tabs: readonly { title: string; connectionId: string | null }[], connectionName: (connectionId: string) => string | undefined): string[] {
  const count = new Map<string, number>();
  for (const tab of tabs) count.set(tab.title, (count.get(tab.title) ?? 0) + 1);

  return tabs.map((tab) => {
    const name = (count.get(tab.title) ?? 0) > 1 && tab.connectionId !== null ? connectionName(tab.connectionId) : undefined;
    return name === undefined ? tab.title : `${tab.title} (${name})`;
  });
}

/**
 * RN-ABAS-007: o que o fechamento pergunta depois das alterações não salvas da grade, que perguntam sempre (não voltam na próxima entrada). Fechar o app (a
 * última janela) não pergunta pelos scripts com mudança não salva nem pelo SQL digitado: as abas voltam na próxima entrada (RN-ABAS-006), com o texto e a
 * marca. Fechar abas, ou uma janela que não é a última, pergunta como antes: o que fecha não volta.
 */
export type CloseAsks = { scripts: boolean; sql: boolean };

export function closeAsks({ closesTheApp }: { closesTheApp: boolean }): CloseAsks {
  return closesTheApp ? { scripts: false, sql: false } : { scripts: true, sql: true };
}

/**
 * A pergunta de "Fechar todas", "Fechar as outras" e "Fechar as da direita": quantas abas fecham e quantas delas são consultas com SQL digitado, cujo texto
 * não volta na próxima entrada (fechar uma aba a tira do que volta, RN-ABAS-006). `null` (sem pergunta) para o fechamento de uma aba só, que segue como sempre, e quando nenhuma das que fecham tem SQL
 * digitado (consulta vazia, só espaço, ou aba de tabela). O SQL da aba que FICA não conta.
 */
export function closeConfirmation(scope: CloseScope, tabs: readonly { id: string; sql: string; table?: unknown; script?: unknown }[], targetId: string): { total: number; withSql: number } | null {
  if (scope === "one") return null;

  const closing = new Set(tabsToClose(scope, tabs, targetId));
  // A aba de um script não perde o texto: ele está salvo, e a mudança desde a gravação já teve a pergunta dela (RN-SCRIPT-001).
  const withSql = tabs.filter((tab) => closing.has(tab.id) && tab.table === undefined && tab.script === undefined && tab.sql.trim() !== "").length;
  return withSql === 0 ? null : { total: closing.size, withSql };
}

/** O texto da pergunta, para o diálogo de confirmação. */
export function closeConfirmationText(total: number, withSql: number): { title: string; description: string; confirm: string } {
  return { title: copy.confirmClose.title(total), description: copy.confirmClose.description(withSql), confirm: copy.confirmClose.confirm };
}

export type MoveMenuItem = { action: "newWindow" | "toWindow"; label: string; disabled: boolean };

/**
 * O grupo de mover a aba para outra janela no menu dela (RN-ABAS-002 e 003): "Mover para nova janela" e "Mover para a janela…", que lista as outras e
 * fica apagado quando não há outra. Fora do Electron não há outra janela possível, e o grupo não aparece.
 */
export function moveMenu(otherWindows: number, available: boolean): MoveMenuItem[] {
  if (!available) return [];
  return [
    { action: "newWindow", label: copy.moveToNewWindow, disabled: false },
    { action: "toWindow", label: copy.moveToWindow, disabled: otherWindows === 0 },
  ];
}

/**
 * O que a aba diz de si na faixa (RN-SCRIPT-001): o título (o nome do script, na aba de um script), e, com mudança não salva, o ponto e o nome acessível que
 * diz isso (o ponto é só desenho).
 */
export function tabTitleOf(tab: { title: string; script?: { dirty: boolean } }): { title: string; label: string; unsaved: boolean } {
  const unsaved = tab.script?.dirty === true;
  return { title: tab.title, label: unsaved ? scriptsCopy.tab.titleUnsaved(tab.title) : tab.title, unsaved };
}
