import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buttonLabeled, elementsOf } from "@/lib/testing/react-tree";

import type { UpdateOffer, UpdateState } from "../../../electron/update/update-state";
import { focusIsElsewhere, installsRightAway, noticeToast, UpdateDialogView, type UpdateDialogViewProps } from "./update-dialog";

// O `Dialog` de verdade desenha num portal em `document.body`, que o renderizador de servidor não tem: aqui ele só
// devolve o que receberia, para o teste ler o conteúdo. (O `useToast` não é chamado pela vista.)
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  Dialog: ({ title, description, footer, children }: { title: string; description?: unknown; footer?: unknown; children?: unknown }) =>
    createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("div", null, description as never), createElement("div", null, children as never), createElement("footer", null, footer as never)),
}));

const sum = "a".repeat(64);
const offer: UpdateOffer = {
  checkId: 1,
  current: "0.1.0",
  format: "nsis",
  forAllUsers: false,
  omitted: 0,
  releases: [
    { version: "0.3.0", prerelease: false, date: "2026-10-10", notes: "### Adicionado\n\n- Árvore de objetos do **Db2**.", sums: [{ file: "Prism-0.3.0-win-x64.exe", sha256: sum }] },
    { version: "0.2.0", prerelease: false, date: "2026-10-05", notes: "### Corrigido\n\n- O cancelamento de um comando.", sums: [] },
  ],
};

const noop = () => {};
const handlers = { onUpdate: noop, onLater: noop, onSkip: noop, onCancel: noop, onInstall: noop, onNoStartupCheckChange: noop };
const render = (state: Exclude<UpdateState, { status: "none" }>, overrides: Partial<UpdateDialogViewProps> = {}) => renderToStaticMarkup(createElement(UpdateDialogView, { state, noStartupCheck: false, busy: false, ...handlers, ...overrides }));

/** A árvore que a vista monta, sem desenhar: serve para ler as propriedades dos botões (o foco inicial) e do cabeçalho. */
const treeOf = (state: Exclude<UpdateState, { status: "none" }>) => UpdateDialogView({ state, noStartupCheck: false, busy: false, ...handlers });

const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
const button = (markup: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(markup)?.[0] ?? "";
const isDisabled = (tag: string) => / disabled(?:=""|[\s>])/.test(tag);

describe("o diálogo de versão nova (RN-ATUALIZA-003)", () => {
  const markup = render({ status: "available", ...offer });

  it("mostra a versão instalada, a nova e a data", () => {
    expect(markup).toContain("Nova versão do Prism");
    expect(markup).toMatch(/Versão instalada: <span[^>]*>0\.1\.0<\/span>/);
    expect(markup).toMatch(/Nova versão: <span[^>]*>0\.3\.0<\/span> de 10\/10\/2026/);
  });

  it("traz as notas de TODAS as versões mais novas, da mais recente para a mais antiga", () => {
    expect([...markup.matchAll(/data-update-release="([^"]*)"/g)].map((match) => match[1])).toEqual(["0.3.0", "0.2.0"]);
    expect(markup.indexOf("Árvore de objetos do")).toBeLessThan(markup.indexOf("O cancelamento de um comando."));
    expect(markup).toContain("<strong");
    expect(markup).toContain("05/10/2026");
  });

  it("quando há mais versões do que as mostradas, diz quantas ficaram de fora", () => {
    expect(render({ status: "available", ...offer, omitted: 40 })).toContain("Mais 40 versões anteriores não aparecem nesta lista.");
    expect(render({ status: "available", ...offer, omitted: 1 })).toContain("Mais 1 versão anterior não aparece nesta lista.");
    expect(markup).not.toContain("não aparece");
  });

  it("as ações: Atualizar agora, Depois, Pular esta versão e a caixa Não verificar ao abrir", () => {
    expect(buttons(markup)).toEqual(["Pular esta versão", "Depois", "Atualizar agora"]);
    expect(markup).toMatch(/<input type="checkbox"[^>]*\/><span>Não verificar ao abrir<\/span>/);
    expect(render({ status: "available", ...offer }, { noStartupCheck: true })).toMatch(/<input type="checkbox"[^>]* checked=""/);
  });

  it("diz de onde vem a atualização, como é conferida e que os pacotes não são assinados (RN-ATUALIZA-009)", () => {
    expect(markup).toContain("A atualização é baixada das releases do projeto no GitHub e conferida por duas somas SHA-256, e uma release publicada não pode ser trocada. Os pacotes ainda não são assinados.");
    expect(markup).not.toContain("GitLab");
  });

  it("as somas ficam recolhidas, num detalhe, e não no meio das notas", () => {
    expect(markup).toMatch(/<details[^>]*><summary[^>]*>Somas de verificação<\/summary>/);
    expect(markup).toContain(sum);
    expect(markup).toContain("Prism-0.3.0-win-x64.exe");
  });

  it("antes de baixar, diz o que 'Atualizar agora' vai fazer nesta instalação", () => {
    expect(markup).toContain("o Prism fecha, instala a versão nova e abre de novo");
    expect(markup).not.toContain("administrador");
    expect(render({ status: "available", ...offer, format: "deb" })).toContain("deixa-o na sua pasta de downloads");
  });

  it("instalado para todos os usuários: avisa que o Windows vai pedir a permissão de administrador, e o que acontece sem ela (RN-INSTALA-003)", () => {
    const forAll = render({ status: "available", ...offer, forAllUsers: true });

    expect(forAll).toContain("o Windows pede a permissão de administrador");
    expect(forAll).toContain("Sem ela, nada muda");
    expect(render({ status: "installing", ...offer, forAllUsers: true })).toContain("o Windows pede a permissão de administrador");
    expect(render({ status: "installing", ...offer })).not.toContain("administrador");
  });

  it("sem pacote para este sistema, 'Atualizar agora' fica desligado e a tela diz por quê", () => {
    const unavailable = render({ status: "available", ...offer, format: null });

    expect(isDisabled(button(unavailable, "Atualizar agora"))).toBe(true);
    expect(unavailable).toContain("Não há pacote desta versão para o sistema e a arquitetura deste computador.");
    expect(isDisabled(button(markup, "Atualizar agora"))).toBe(false);
  });

  it("notas hostis não viram tag, link nem imagem dentro do diálogo", () => {
    const hostile = render({ status: "available", ...offer, releases: [{ ...offer.releases[0], notes: '<img src=x onerror=alert(1)>\n\n[clique](javascript:alert(1))\n\n<a href="https://evil.example.invalid">x</a>' }] });

    expect(hostile).not.toMatch(/<(img|a|script|iframe)\b/i);
    for (const tag of hostile.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/\s(href|src|on[a-z]+)=/i);
    expect(hostile).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("versão sem notas diz isso, em vez de um espaço vazio", () => {
    expect(render({ status: "available", ...offer, releases: [{ ...offer.releases[0], notes: "" }] })).toContain("Esta versão não traz notas.");
  });
});

describe("o diálogo com uma versão beta (RN-ATUALIZA-010)", () => {
  const beta: UpdateOffer = {
    ...offer,
    releases: [
      { version: "0.4.0-beta.2", prerelease: true, date: "2026-10-12", notes: "- Coisa nova, em teste.", sums: [{ file: "Prism-0.4.0-beta.2-win-x64.exe", sha256: sum }] },
      { version: "0.4.0-beta.1", prerelease: true, date: "2026-10-11", notes: "- O primeiro beta.", sums: [] },
      ...offer.releases,
    ],
  };
  const markup = render({ status: "available", ...beta });

  it("diz que a versão oferecida é beta, junto da versão, e avisa que pode ter defeitos", () => {
    expect(markup).toMatch(/Nova versão: <span[^>]*>0\.4\.0-beta\.2<\/span> \(beta\) de 12\/10\/2026/);
    expect(markup).toMatch(/data-update-beta[^>]*>.*Versão beta: chega antes da estável e pode ter defeitos\./);
    expect(markup).toContain("Receber versões beta");
  });

  it("o aviso fica no cabeçalho, que não rola, antes das notas, também na falha e com o download pronto", () => {
    const [dialog] = elementsOf(treeOf({ status: "available", ...beta }));
    expect(elementsOf(dialog.props.description as never).some((element) => "data-update-beta" in element.props)).toBe(true);
    expect(markup.indexOf("data-update-beta")).toBeLessThan(markup.indexOf("data-update-release"));

    for (const state of [{ status: "failed", reason: "x", ...beta }, { status: "ready", ...beta }, { status: "downloading", receivedBytes: 1, totalBytes: 2, ...beta }] as const) expect(render(state), state.status).toContain("data-update-beta");
  });

  it("cada versão beta das notas tem a marca 'beta' ao lado do número; as estáveis, não", () => {
    const headings = [...markup.matchAll(/<section data-update-release="([^"]*)"[^>]*><h3[^>]*>([\s\S]*?)<\/h3>/g)].map((match) => [match[1], /beta<\/span>/.test(match[2])]);

    expect(headings).toEqual([
      ["0.4.0-beta.2", true],
      ["0.4.0-beta.1", true],
      ["0.3.0", false],
      ["0.2.0", false],
    ]);
  });

  it("uma estável oferecida não tem aviso de beta, nem com betas mais antigos nas notas", () => {
    const stableFirst = render({ status: "available", ...offer, releases: [offer.releases[0], { ...offer.releases[1], version: "0.3.0-beta.1", prerelease: true }] });

    expect(stableFirst).not.toContain("data-update-beta");
    expect(stableFirst).toMatch(/Nova versão: <span[^>]*>0\.3\.0<\/span> de/);
    expect(render({ status: "available", ...offer })).not.toContain("(beta)");
  });
});

describe("o diálogo abre sozinho: nada nele age sem a pessoa escolher", () => {
  it("o foco inicial é de 'Depois', e não de 'Atualizar agora': um Enter ou Espaço que ia para a senha não baixa nem instala nada", () => {
    const tree = treeOf({ status: "available", ...offer });

    expect(buttonLabeled(tree, "Depois")?.props.autoFocus).toBe(true);
    expect(buttonLabeled(tree, "Atualizar agora")?.props.autoFocus).toBeFalsy();
    expect(buttonLabeled(tree, "Pular esta versão")?.props.autoFocus).toBeFalsy();
  });

  it("também depois de uma falha e com a atualização pronta: o foco é de 'Depois'", () => {
    const failed = treeOf({ status: "failed", reason: "x", ...offer });
    expect(buttonLabeled(failed, "Depois")?.props.autoFocus).toBe(true);
    expect(buttonLabeled(failed, "Tentar de novo")?.props.autoFocus).toBeFalsy();

    const ready = treeOf({ status: "ready", ...offer, format: "deb" });
    expect(buttonLabeled(ready, "Depois")?.props.autoFocus).toBe(true);
    expect(buttonLabeled(ready, "Mostrar na pasta de downloads")?.props.autoFocus).toBeFalsy();
  });

  it("a linha de confiança e o aviso do que vai acontecer ficam no cabeçalho, que não rola: sempre à vista, acima das notas", () => {
    const [dialog] = elementsOf(treeOf({ status: "available", ...offer }));
    const header = elementsOf(dialog.props.description as never);

    expect(header.some((element) => "data-update-trust" in element.props)).toBe(true);
    expect(header.some((element) => "data-update-next" in element.props)).toBe(true);

    const markup = render({ status: "available", ...offer });
    const firstNotes = markup.indexOf("data-update-release");
    expect(markup.indexOf("Os pacotes ainda não são assinados.")).toBeLessThan(firstNotes);
    expect(markup.indexOf("O texto das abas de SQL abertas não é salvo.")).toBeLessThan(firstNotes);
    expect(markup.split("Os pacotes ainda não são assinados.")).toHaveLength(2);
  });

  it("com notas muito longas as duas linhas continuam antes delas", () => {
    const long = render({ status: "available", ...offer, releases: [{ ...offer.releases[0], notes: "- linha de nota\n".repeat(2000) }] });

    expect(long.indexOf("data-update-trust")).toBeLessThan(long.indexOf("linha de nota"));
    expect(long.indexOf("data-update-next")).toBeLessThan(long.indexOf("linha de nota"));
  });
});

describe("o diálogo durante e depois do download (RN-ATUALIZA-005 e 006)", () => {
  it("baixando: a barra de progresso com a porcentagem, o que chegou, e só Cancelar", () => {
    const markup = render({ status: "downloading", receivedBytes: 52_428_800, totalBytes: 131_072_000, ...offer });

    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuenow="40"/);
    expect(markup).toContain("50,0 MB de 125,0 MB");
    expect(buttons(markup)).toEqual(["Cancelar"]);
  });

  it("baixando sem o total: não inventa porcentagem", () => {
    const markup = render({ status: "downloading", receivedBytes: 1_048_576, totalBytes: null, ...offer });

    expect(markup).not.toContain("aria-valuenow");
    expect(markup).toContain("1,0 MB recebidos");
  });

  it("recusada: a causa aparece, e dá para tentar de novo", () => {
    const markup = render({ status: "failed", reason: "O arquivo baixado (Prism-0.3.0-win-x64.exe) não confere com a soma SHA-256 das notas da versão. Ele foi apagado.", ...offer });

    expect(markup).toMatch(/role="alert"/);
    expect(markup).toContain("A atualização não foi concluída.");
    expect(markup).toContain("não confere com a soma SHA-256 das notas da versão");
    expect(buttons(markup)).toEqual(["Depois", "Tentar de novo"]);
  });

  it("a causa de uma falha é texto, mesmo que traga marcação", () => {
    const markup = render({ status: "failed", reason: "<img src=x onerror=alert(1)>", ...offer });

    expect(markup).not.toMatch(/<img\b/i);
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("pronta no Windows: instalar; no Linux e no macOS: mostrar na pasta de downloads", () => {
    expect(buttons(render({ status: "ready", ...offer }))).toEqual(["Depois", "Instalar agora"]);
    expect(buttons(render({ status: "ready", ...offer, format: "AppImage" }))).toEqual(["Depois", "Mostrar na pasta de downloads"]);
    expect(render({ status: "ready", ...offer })).toContain("Atualização baixada e conferida.");
  });

  it("entregue: o nome do pacote na pasta de downloads e o que fazer com ele, por formato", () => {
    const deb = render({ status: "delivered", fileName: "Prism-0.3.0-linux-amd64.deb", ...offer, format: "deb" });

    expect(deb).toContain("O pacote conferido está na sua pasta de downloads: Prism-0.3.0-linux-amd64.deb");
    expect(deb).toContain("sudo apt install");
    expect(buttons(deb)).toEqual(["Fechar"]);
    expect(render({ status: "delivered", fileName: "Prism-0.3.0-mac-arm64.dmg", ...offer, format: "dmg" })).toContain("arraste o Prism para a pasta Aplicativos");
    expect(render({ status: "delivered", fileName: "Prism-0.3.0-linux-x86_64.AppImage", ...offer, format: "AppImage" })).toContain("permissão de execução");
  });

  it("zip portátil do Windows: o texto é o de quem instala à mão, e não o de fechar e instalar", () => {
    const zip = render({ status: "available", ...offer, format: "zip" });

    expect(zip).toContain("deixa-o na sua pasta de downloads");
    expect(zip).not.toContain("fecha, instala a versão nova e abre de novo");
    expect(buttons(render({ status: "ready", ...offer, format: "zip" }))).toEqual(["Depois", "Mostrar na pasta de downloads"]);
    expect(render({ status: "delivered", fileName: "Prism-0.3.0-win-x64.zip", ...offer, format: "zip" })).toContain("extraia o arquivo por cima da pasta onde o Prism está");
  });

  it("só o instalador do Windows segue sozinho do download para a instalação; o resto espera o clique", () => {
    expect(installsRightAway({ status: "ready", ...offer, format: "nsis" })).toBe(true);
    for (const format of ["zip", "AppImage", "deb", "rpm", "tar.gz", "dmg"] as const) expect(installsRightAway({ status: "ready", ...offer, format })).toBe(false);
    expect(installsRightAway({ status: "failed", reason: "x", ...offer })).toBe(false);
    expect(installsRightAway({ status: "available", ...offer })).toBe(false);
  });

  it("instalando: nenhum botão, e a tela diz que o Prism vai fechar", () => {
    const markup = render({ status: "installing", ...offer });

    expect(buttons(markup)).toEqual([]);
    expect(markup).toContain("O Prism vai fechar");
    expect(markup).toMatch(/role="status"/);
  });

  it("com um pedido a caminho, os botões esperam", () => {
    const markup = render({ status: "available", ...offer }, { busy: true });

    for (const label of ["Pular esta versão", "Depois", "Atualizar agora"]) expect(isDisabled(button(markup, label)), label).toBe(true);
  });
});

describe("o foco que está em outro diálogo, ou num aviso, não é deste diálogo", () => {
  // Sem DOM: do painel basta o `contains`, e de quem tem o foco, o `closest`.
  type Owner = "o painel" | "outro diálogo" | "a tela de trás";
  const closest = vi.fn<(selector: string) => object | null>();
  const element = (owner: Owner) => ({ owner, closest: (selector: string) => (closest(selector), owner === "a tela de trás" ? null : {}) }) as unknown as Element;
  const panel = { contains: (each: { owner?: Owner }) => each.owner === "o painel" } as unknown as Element;

  it("em outro diálogo (empilhado por cima) ou na pilha de avisos: é de lá", () => {
    expect(focusIsElsewhere(element("outro diálogo"), panel)).toBe(true);
    expect(closest).toHaveBeenLastCalledWith("[role=dialog], [role=alertdialog], [aria-live]");
  });

  it("no próprio painel (que também é um diálogo), na tela de trás, ou em ninguém: não", () => {
    expect(focusIsElsewhere(element("o painel"), panel)).toBe(false);
    expect(focusIsElsewhere(element("a tela de trás"), panel)).toBe(false);
    expect(focusIsElsewhere(null, panel)).toBe(false);
  });

  it("com este diálogo já fora da tela (sem painel), o foco em outro diálogo continua sendo de lá", () => {
    expect(focusIsElsewhere(element("outro diálogo"), null)).toBe(true);
    expect(focusIsElsewhere(element("a tela de trás"), null)).toBe(false);
  });
});

describe("o aviso da atualização que não foi instalada (RN-INSTALA-003)", () => {
  it("instalado para todos: diz a versão que não entrou, a de agora, e que a permissão de administrador faltou", () => {
    const { title, description } = noticeToast({ version: "0.3.1", current: "0.3.0", forAllUsers: true });

    expect(title).toBe("A versão 0.3.1 não foi instalada.");
    expect(description).toContain("O Prism continua na versão 0.3.0.");
    expect(description).toContain("permissão de administrador");
    expect(description).toContain("Verificar atualizações");
  });

  it("só do usuário: diz que o instalador terminou sem atualizar, sem falar de administrador", () => {
    const { title, description } = noticeToast({ version: "0.3.1", current: "0.3.0", forAllUsers: false });

    expect(title).toBe("A versão 0.3.1 não foi instalada.");
    expect(description).toContain("O Prism continua na versão 0.3.0.");
    expect(description).not.toContain("administrador");
    expect(description).toContain("Verificar atualizações");
  });
});
