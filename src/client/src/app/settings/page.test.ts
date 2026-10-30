import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import { driversQuery } from "@/app/drivers/_lib/drivers.service";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { navItem } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";

import type { AppZoom } from "../../../electron/zoom";
import { appZoomQuery } from "./_lib/app-zoom";
import { dataFolderQuery } from "./_lib/data-folder";
import { preferencesStore, type PreferencesPatch } from "./_lib/preferences";
import { settingsSections, type SettingsSectionId } from "./_lib/sections";
import { updatePreferencesQuery, type UpdatePreferences } from "./_lib/update-preferences";
import { SettingsPage } from "./page";

// O `ToastProvider` desenha num portal em `document.body`, que o renderizador de servidor não tem; e o reinício dos drivers vem do `ApiGate`, que
// não está montado aqui: os dois entram como falsos.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));
vi.mock("@/app/_components/api-gate", () => ({ useApiRestart: () => async () => {} }));

/** Cada teste usa um usuário só seu: as preferências moram num armazenamento do módulo, que sobrevive de um teste ao outro. */
let counter = 0;
type Extras = { updates?: UpdatePreferences; version?: string; dataFolder?: string | null; drivers?: Driver[]; entry?: string; zoom?: AppZoom | null };
function render(section: SettingsSectionId, preferences: PreferencesPatch = {}, { updates, version, dataFolder, drivers, entry = `/settings/${section}`, zoom }: Extras = {}) {
  const userName = `page.${++counter}`;
  preferencesStore.set(userName, preferences);
  if (version !== undefined) vi.stubGlobal("window", { prism: { version } });

  const client = new QueryClient();
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName });
  if (updates !== undefined) client.setQueryData(updatePreferencesQuery.queryKey, updates);
  if (dataFolder !== undefined) client.setQueryData(dataFolderQuery.queryKey, dataFolder);
  if (drivers !== undefined) client.setQueryData(driversQuery.queryKey, drivers);
  if (zoom !== undefined) client.setQueryData(appZoomQuery.queryKey, zoom);

  // As rotas de verdade: a página lê a seção do endereço (`pathsConfig.settingsSection`).
  const page = createElement(Routes, null, createElement(Route, { path: pathsConfig.settingsSection, element: createElement(SettingsPage) }));
  return { userName, markup: renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [entry] }, page))) };
}

afterEach(() => vi.unstubAllGlobals());

/** Cada <section> de seção, com o id. */
const sectionsOf = (markup: string) => [...markup.matchAll(/<section id="([^"]+)"[\s\S]*?<\/section>/g)].map((match) => ({ id: match[1], html: match[0] }));

describe("a tela de Configurações", () => {
  it("tem o cabeçalho do canvas: título, o usuário do cofre e 'Fechar · Esc', que volta à área de trabalho", () => {
    const { markup, userName } = render("account");

    expect(markup).toMatch(/<h1[^>]*>Configurações<\/h1>/);
    // O foco vai ao título ao abrir a tela (o efeito não roda aqui, mas o título tem de poder recebê-lo).
    expect(markup).toMatch(/<h1 tabindex="-1"[^>]*>Configurações<\/h1>/);
    // RN-JANELA-001: o cabeçalho é a barra da janela, numa linha só: o nome longo encolhe com reticências, e a dica tem o nome inteiro.
    expect(markup).toMatch(/<header class="window-bar [^"]*"/);
    expect(markup).not.toMatch(/<header[^>]*\bflex-wrap\b/);
    expect(markup).toContain(`<span title="${userName}" class="truncate">${userName}</span>`);
    expect(markup).toMatch(/<a [^>]*href="\/workbench"[^>]*>.*<span>Fechar<\/span><kbd[^>]*>Esc<\/kbd><\/a>/);
  });

  /** A navegação, e cada entrada dela: o texto (com "|" entre as partes), o endereço, a classe e se é a página aberta. */
  const navOf = (markup: string) => {
    const nav = /<nav aria-label="Seções das configurações"[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? "";
    return [...nav.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, content]) => ({
      text: content.replace(/<[^>]*>/g, "|").replace(/\|+/g, "|").replace(/^\||\|$/g, ""),
      href: /href="([^"]*)"/.exec(attributes)?.[1],
      className: /class="([^"]*)"/.exec(attributes)?.[1] ?? "",
      current: /aria-current="page"/.test(attributes),
      icon: /^<svg [^>]*>[\s\S]*?<\/svg>/.exec(content)?.[0] ?? "",
    }));
  };

  it("a navegação lista as seções na ordem, cada uma com o endereço da página dela, e as 'em breve' dizem que são", () => {
    const links = navOf(render("account").markup);

    expect(links.map((link) => link.text)).toEqual(settingsSections.map((section) => (section.soon ? `${section.label}|em breve` : section.label)));
    expect(links.map((link) => link.href)).toEqual(settingsSections.map((section) => `/settings/${section.id}`));
    // A primeira é a Conta, como no canvas (o que ainda é "em breve" vai para o fim).
    expect(links[0].text).toBe("Conta");
  });

  it("cada entrada começa com o ícone da seção, só para os olhos (o nome é o texto), e nenhuma repete o de outra", () => {
    const icons = navOf(render("account").markup).map((link) => link.icon);

    expect(icons).toHaveLength(settingsSections.length);
    for (const icon of icons) expect(icon).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it.each(settingsSections.map((section) => [section.id, section] as const))("a página de %s mostra só a seção dela, ligada ao próprio título, e marca só a entrada dela na navegação", (id, section) => {
    const { markup } = render(id);

    expect([...markup.matchAll(/<section id="(cfg-[a-z]+)"/g)].map((match) => match[1])).toEqual([section.anchor]);
    expect(markup).toMatch(new RegExp(`<section id="${section.anchor}" aria-labelledby="${section.anchor}-title"`));
    expect(markup).toMatch(new RegExp(`<h2 id="${section.anchor}-title" tabindex="-1"`));
    expect(navOf(markup).filter((link) => link.current).map((link) => link.href)).toEqual([`/settings/${id}`]);
  });

  it("a entrada marcada e as outras da navegação têm o estilo comum das listas (`navItem`), que a lista de seções da Estrutura também usa, sem o sublinhado dos links", () => {
    const links = navOf(render("account").markup);

    expect(links.find((link) => link.current)?.className).toBe(`${navItem({ active: true })} no-underline`);
    expect(links.filter((link) => !link.current).every((link) => link.className === `${navItem({ active: false })} no-underline`)).toBe(true);
  });

  it("uma seção que não existe não desenha página nenhuma: leva à primeira", () => {
    expect(render("nada" as SettingsSectionId).markup).not.toContain("<h1");
  });
});

describe("as seções 'em breve' (RN-CONFIG-001: sem controle que finja funcionar)", () => {
  const soonIds = settingsSections.filter((section) => section.soon).map((section) => section.anchor);

  it("é só a que ainda depende da API: as transações (a troca de senha já tem rota)", () => {
    expect(soonIds).toEqual(["cfg-transacoes"]);
  });

  it("diz o que virá, traz a etiqueta e não tem campo, lista, caixa de marcar nem botão, nem desabilitados", () => {
    const sections = sectionsOf(render("transactions").markup).filter((section) => soonIds.includes(section.id));

    expect(sections).toHaveLength(1);
    for (const section of sections) {
      expect(section.html).toContain("Em breve");
      expect(section.html).toMatch(/<p /);
      expect(section.html).not.toMatch(/<(input|select|textarea|button)\b|role="(combobox|checkbox|switch|slider)"/);
    }
  });

  it("repete o que o canvas diz, sem prometer o que a tela não tem", () => {
    expect(render("transactions").markup).toContain("Aqui você vai escolher o modo padrão das novas abas");
  });
});

describe("Conta: trocar senha (RN-COFRE-013)", () => {
  const account = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-conta")?.html ?? "";
  const field = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";

  it("já não é 'em breve': é o cartão de verdade, com o título e a frase do canvas", () => {
    const html = account(render("account").markup);

    expect(html).toContain("Conta: trocar senha");
    expect(html).toContain("Ao trocar, o Prism recriptografa o seu cofre de conexões com a nova senha.");
    expect(html).not.toContain("Em breve");
  });

  it("tem os três campos do canvas, de senha, cada um com o rótulo dele e a dica certa do que é (senha atual, senha nova)", () => {
    const html = account(render("account").markup);

    for (const [id, name, autocomplete, label] of [
      ["cfg-senha-atual", "currentPassword", "current-password", "Senha atual"],
      ["cfg-senha-nova", "newPassword", "new-password", "Nova senha"],
      ["cfg-senha-confirma", "newPasswordConfirmation", "new-password", "Confirmar a nova senha"],
    ] as const) {
      const input = field(html, id);

      expect(input, id).toContain('type="password"');
      expect(input, id).toContain(`name="${name}"`);
      expect(input, id).toMatch(new RegExp(`autoComplete="${autocomplete}"`, "i"));
      expect(html, id).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>${label}</label>`));
    }
  });

  it("os campos vêm vazios, e o formulário não confia no navegador para validar: a tela confere e a API decide", () => {
    const html = account(render("account").markup);

    for (const id of ["cfg-senha-atual", "cfg-senha-nova", "cfg-senha-confirma"]) expect(field(html, id)).not.toMatch(/\bvalue=/);
    expect(html).toMatch(/<form [^>]*noValidate/i);
  });

  it("leva o usuário do cofre num campo escondido (a convenção dos formulários de senha: leitor de tela e gerenciador de senhas sabem de que conta é a senha), fora dos campos que a tela confere", () => {
    const { markup, userName } = render("account");
    const html = account(markup);
    const hidden = /<input[^>]*autoComplete="username"[^>]*>/i.exec(html)?.[0] ?? "";

    expect(hidden).toContain(`value="${userName}"`);
    expect(hidden).toMatch(/\bhidden\b/);
    expect(hidden).toMatch(/\breadOnly\b/i);
    expect(hidden).toContain('name="userName"');
    expect(html.match(/<input\b/g)).toHaveLength(4);
  });

  it("o botão 'Trocar senha' envia o formulário, e não está desabilitado antes de a pessoa tentar", () => {
    const html = account(render("account").markup);
    const button = /<button [^>]*>Trocar senha<\/button>/.exec(html)?.[0] ?? "";

    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/ disabled(=""| |\/|>)/);
  });
});

describe("Resultados (RN-CONFIG-005)", () => {
  const results = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-resultados")?.html ?? "";
  const valueOf = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0].match(/value="([^"]*)"/)?.[1];
  const autoLoad = (html: string) => /<input type="checkbox"([^>]*)\/?>(?:(?!<\/label>)[\s\S])*Buscar mais linhas ao rolar até o fim da grade/.exec(html)?.[1] ?? "";

  it("tem o texto do nulo (NULL, até 12 caracteres, na fonte da interface, como a grade o desenha) e 'buscar mais linhas ao rolar', desligado", () => {
    const html = results(render("results").markup);

    expect(html).toContain("Mostrar valores nulos como");
    expect(valueOf(html, "cfg-nulo")).toBe("NULL");
    const field = /<input[^>]*id="cfg-nulo"[^>]*>/.exec(html)?.[0] ?? "";
    expect(field).toMatch(/maxLength="12"/i);
    expect(field).not.toContain("font-mono");
    expect(autoLoad(html)).not.toContain("checked");
  });

  it("mostra o que o usuário escolheu", () => {
    const html = results(render("results", { results: { nullText: "∅", autoLoadMore: true } }).markup);

    expect(valueOf(html, "cfg-nulo")).toBe("∅");
    expect(autoLoad(html)).toContain("checked");
  });

  it("'Linhas por busca' continua em breve, até a API: tem a etiqueta e o motivo, e nenhum campo (os campos são o do nulo, as caixas e o lugar do resultado das abas novas, RN-CONFIG-010)", () => {
    const html = results(render("results").markup);

    expect(html).toMatch(/Linhas por busca<\/p><p[^>]*><span[^>]*>Em breve<\/span><span[^>]*>A página tem 200 linhas/);
    expect([...html.matchAll(/<input\b[^>]*>/g)].map((match) => /id="([^"]*)"/.exec(match[0])?.[1] ?? "(checkbox)")).toEqual(["cfg-nulo", "(checkbox)", "cfg-tipo-cabecalho", "(checkbox)", "(checkbox)"]);
  });
});

describe("Segurança (RN-SEG-001)", () => {
  const security = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-seguranca")?.html ?? "";
  const minutesField = (html: string) => /<input[^>]*id="cfg-bloquear-minutos"[^>]*>/.exec(html)?.[0] ?? "";

  it("tem o bloqueio ligado em 10 minutos por padrão, como o canvas, com o campo dos minutos e o texto do canvas", () => {
    const html = security(render("security").markup);

    expect(/<input id="cfg-bloquear" type="checkbox"([^>]*)\/?>/.exec(html)?.[1]).toContain("checked");
    expect(html).toContain("Bloquear o Prism após");
    expect(minutesField(html)).toMatch(/value="10"/);
    expect(minutesField(html)).toContain('aria-label="Minutos sem uso até bloquear"');
    expect(minutesField(html)).not.toMatch(/ disabled(=""| |\/|>)/);
    expect(html).toContain("minutos sem uso");
    expect(html).toContain("Com o Prism bloqueado, o cofre fecha e só a sua senha o reabre.");
  });

  it("não diz o que o app não faz: a opção 'Somente leitura' do texto do canvas ainda não existe, e a frase fica sem ela", () => {
    const html = security(render("security").markup);

    expect(html).not.toMatch(/Somente leitura/i);
    expect(html).toContain("Exibir a senha de uma conexão pede a sua senha sempre.");
  });

  it("desligado, os minutos ficam à vista e desabilitados", () => {
    const html = security(render("security", { security: { lockEnabled: false, lockAfterMinutes: 45 } }).markup);

    expect(/<input id="cfg-bloquear" type="checkbox"([^>]*)\/?>/.exec(html)?.[1]).not.toContain("checked");
    expect(minutesField(html)).toMatch(/value="45"/);
    expect(minutesField(html)).toMatch(/ disabled(=""| |\/|>)/);
  });
});

describe("Editor SQL", () => {
  const editor = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-editor")?.html ?? "";
  /** O valor de cada campo de texto, pelo id. */
  const valueOf = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0].match(/value="([^"]*)"/)?.[1];
  /** As caixas de marcar: a tag, se está marcada e se o rótulo é o texto dela. */
  const box = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";
  const checked = (tag: string) => / checked(=""| |\/|>)/.test(tag);
  const labelled = (html: string, id: string, text: string) => new RegExp(`<label[^>]*><input[^>]*id="${id}"[^>]*/><span>${text}</span></label>`).test(html);

  it("tem o tamanho da fonte e o da tabulação, com o padrão do canvas; a fonte fica em Aparência (RN-CONFIG-008)", () => {
    const html = editor(render("editor").markup);

    expect(html).not.toContain('role="combobox"');
    expect(html).toContain("A fonte do editor fica em Aparência");
    expect(valueOf(html, "cfg-tamanho")).toBe("13");
    expect(valueOf(html, "cfg-tab")).toBe("4");
    expect(html).toMatch(/<input[^>]*id="cfg-tamanho"[^>]*inputMode="numeric"/i);
  });

  it("mostra o que o usuário escolheu, e a prévia desenha o texto desse jeito", () => {
    const html = editor(render("editor", { editor: { fontFamily: "Consolas", fontSize: 18, tabSize: 2 } }).markup);

    expect(html).toContain("font-family:&quot;Consolas&quot;, var(--font-mono)");
    expect(valueOf(html, "cfg-tamanho")).toBe("18");
    expect(valueOf(html, "cfg-tab")).toBe("2");
    expect(html).toContain("font-size:18px");
    expect(html).toContain("line-height:30px");
    expect(html).toContain("tab-size:2");
  });

  describe("autocompletar e maiúsculas (RN-CONFIG-004)", () => {
    it("são duas caixas de marcar com os textos do canvas, não 'em breve': autocompletar ligado e maiúsculas desligado, como no canvas", () => {
      const html = editor(render("editor").markup);

      expect(box(html, "cfg-autocompletar")).toContain('type="checkbox"');
      expect(box(html, "cfg-maiusculas")).toContain('type="checkbox"');
      expect(labelled(html, "cfg-autocompletar", "Autocompletar ao digitar")).toBe(true);
      expect(labelled(html, "cfg-maiusculas", "Converter palavras-chave para maiúsculas")).toBe(true);
      expect(checked(box(html, "cfg-autocompletar"))).toBe(true);
      expect(checked(box(html, "cfg-maiusculas"))).toBe(false);
      expect(html).not.toContain("Em breve");
    });

    it("mostra o que o usuário escolheu", () => {
      const html = editor(render("editor", { editor: { autocomplete: false, uppercaseKeywords: true } }).markup);

      expect(checked(box(html, "cfg-autocompletar"))).toBe(false);
      expect(checked(box(html, "cfg-maiusculas"))).toBe(true);
    });

    it("diz o que cada uma faz, sem prometer o que o editor não faz: nomes da árvore, e só a coluna de tabela e a chave estrangeira buscadas no banco; só as reservadas, só ao digitar", () => {
      const html = editor(render("editor").markup);

      expect(html).toContain("também busca as colunas de uma tabela que você começa a escrever");
      expect(html).toContain("as chaves estrangeiras que completam o JOIN");
      expect(html).not.toContain("Nunca consulta o banco");
      expect(html).toContain("esquemas, tabelas, visões e colunas");
      expect(html).toContain("o que você cola ficam como estão");
    });
  });

  describe("a linha em branco separa os comandos (RN-SQL-018)", () => {
    it("é uma caixa de marcar depois das duas do RN-CONFIG-004, ligada por padrão, com a dica do que ela faz e do que acontece desligada", () => {
      const html = editor(render("editor").markup);

      expect(box(html, "cfg-linha-em-branco")).toContain('type="checkbox"');
      expect(labelled(html, "cfg-linha-em-branco", "A linha em branco separa os comandos")).toBe(true);
      expect(checked(box(html, "cfg-linha-em-branco"))).toBe(true);
      expect(html.indexOf('id="cfg-maiusculas"')).toBeLessThan(html.indexOf('id="cfg-linha-em-branco"'));
      expect(html).toContain("até o ponto e vírgula ou até uma linha em branco, como no DBeaver");
      expect(html).toContain("nunca dentro de texto, comentário ou rotina. Desligada, só o ponto e vírgula separa.");
    });

    it("mostra a escolha do usuário, sem mexer nas outras caixas", () => {
      const html = editor(render("editor", { editor: { blankLineSeparates: false } }).markup);

      expect(checked(box(html, "cfg-linha-em-branco"))).toBe(false);
      expect(checked(box(html, "cfg-autocompletar"))).toBe(true);
    });
  });

  describe("o valor das variáveis no fim da linha (RN-CONFIG-004 e RN-VAR-025)", () => {
    it("é uma caixa de marcar depois da linha em branco, ligada por padrão, com a dica de que não é texto do script", () => {
      const html = editor(render("editor").markup);

      expect(box(html, "cfg-valor-variaveis")).toContain('type="checkbox"');
      expect(labelled(html, "cfg-valor-variaveis", "Mostrar o valor das variáveis no fim da linha")).toBe(true);
      expect(checked(box(html, "cfg-valor-variaveis"))).toBe(true);
      expect(html.indexOf('id="cfg-linha-em-branco"')).toBeLessThan(html.indexOf('id="cfg-valor-variaveis"'));
      expect(html).toContain("Não é texto do script: não se seleciona, não se copia e não vai para o arquivo.");
    });

    it("mostra a escolha do usuário, sem mexer nas outras caixas", () => {
      const html = editor(render("editor", { editor: { showVariableValues: false } }).markup);

      expect(checked(box(html, "cfg-valor-variaveis"))).toBe(false);
      expect(checked(box(html, "cfg-autocompletar"))).toBe(true);
    });
  });

  describe("estilo de formatação (Ctrl+Shift+F)", () => {
    const radios = (html: string) =>
      [...html.matchAll(/(<input type="radio"[^>]*name="cfg-formatacao"[^>]*\/?>)<span>([^<]*)<\/span>/g)].map(([, input, label]) => [
        /value="([^"]*)"/.exec(input)?.[1],
        label,
        / checked=""/.test(input),
      ]);

    it("lista os 6 estilos de formatação com Expandido marcado por padrão e explica o atalho Ctrl+Shift+F", () => {
      const html = editor(render("editor").markup);

      expect(html).toMatch(/<fieldset aria-describedby="cfg-formatacao-dica"[^>]*><legend[^>]*>Estilo de formatação SQL<\/legend>/);
      expect(radios(html)).toEqual([
        ["river", "River (rio)", false],
        ["expanded", "Expandido", true],
        ["tabular", "Alinhado à esquerda (tabular)", false],
        ["leadingComma", "Vírgula à esquerda", false],
        ["compact", "Compacto", false],
        ["modern", "Moderno (dbt / analytics)", false],
      ]);
      expect(html).toContain("Ctrl+Shift+F");
    });

    it("mostra o estilo que o usuário escolheu e atualiza a prévia conforme o estilo e a caixa das palavras-chave", () => {
      const html = editor(render("editor", { editor: { formatStyle: "leadingComma", uppercaseKeywords: false } }).markup);

      expect(radios(html)).toContainEqual(["leadingComma", "Vírgula à esquerda", true]);
      expect(html).toContain(">select<");
      expect(html).toContain(", ");
    });
  });
});

describe("Atualizações (RN-ATUALIZA-007)", () => {
  const updates = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-atualizacoes")?.html ?? "";
  const checkbox = (html: string) => /<input type="checkbox"([^>]*)\/?>/.exec(html)?.[1] ?? "";
  const defaults: UpdatePreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null };

  it("enquanto a ponte não respondeu, diz que lê, e o botão de verificar já está lá", () => {
    const html = updates(render("updates").markup);

    expect(html).toContain("Lendo as preferências de atualização…");
    expect(html).toMatch(/<button[^>]*data-check-updates[^>]*>Verificar atualizações<\/button>/);
    expect(html).not.toContain('type="checkbox"');
  });

  it("mostra 'verificar ao abrir' ligado, sem versão pulada e sem verificação anterior", () => {
    const html = updates(render("updates", {}, { updates: defaults }).markup);

    expect(checkbox(html)).toContain("checked");
    expect(html).toContain("Verificar atualizações ao abrir o Prism");
    expect(html).toContain("O Prism ainda não verificou.");
    expect(html).toMatch(/Versão pulada<\/dt><dd>Nenhuma\.<\/dd>/);
    expect(html).not.toContain("oferece sempre");
  });

  it("mostra o que o processo principal guardou: desligado, a versão pulada e a hora da última verificação", () => {
    const html = updates(render("updates", {}, { updates: { checkOnStartup: false, skippedVersion: "1.2.0", lastCheckedAt: "2026-10-11T15:00:00.000Z" } }).markup);

    expect(checkbox(html)).not.toContain("checked");
    expect(html).toMatch(/Versão pulada<\/dt><dd><span class="font-mono">1\.2\.0<\/span><\/dd>/);
    expect(html).toMatch(/Última verificação<\/dt><dd>\d{2}\/10\/2026/);
    expect(html).toContain("A verificação ao abrir não oferece essa versão");
  });

  it("a versão pulada é só informação: não há botão de desfazer, porque a ponte não tem como; o único botão é o de verificar", () => {
    const html = updates(render("updates", {}, { updates: { checkOnStartup: true, skippedVersion: "1.2.0", lastCheckedAt: null } }).markup);

    expect([...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1])).toEqual(["Verificar atualizações"]);
  });

  it("diz o que a atualização garante: o que a tela de versão nova já diz (soma SHA-256, pacotes sem assinatura)", () => {
    expect(updates(render("updates", {}, { updates: defaults }).markup)).toContain("Os pacotes ainda não têm a assinatura de um desenvolvedor identificado.");
  });
});

describe("Drivers (RN-NAV-006: a lista que era a tela de Drivers)", () => {
  // Da seção de Drivers ao fim da página: a lista tem um <section> por grupo, e o `sectionsOf` pararia no primeiro </section>.
  const drivers = (markup: string) => /<section id="cfg-drivers"[\s\S]*?(?=<\/main>)/.exec(markup)?.[0] ?? "";
  const ibm: Driver = {
    id: "ibm-data-server",
    name: "IBM Data Server",
    vendor: "IBM",
    engines: [2, 3],
    state: "available",
    version: "12.1.3",
    sizeBytes: 115343360,
    license: { name: "Licença IBM", url: "https://exemplo.local/licenca" },
    platformNote: null,
    progress: null,
    error: null,
    restartRequired: false,
  };
  const pg: Driver = { ...ibm, id: "postgresql", name: "PostgreSQL", vendor: "Npgsql", engines: [1], state: "bundled", license: null };

  it("é a lista de verdade, com a explicação da tela de Drivers, os grupos e a ação de cada linha; o atalho para a tela antiga saiu", () => {
    const html = drivers(render("drivers", {}, { drivers: [pg, ibm] }).markup);

    expect(html).toContain("O Prism leva só o driver do PostgreSQL");
    expect([...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => match[1])).toEqual(["Instalados e embutidos", "Disponíveis para baixar"]);
    expect(html).toMatch(/<button[^>]*aria-label="Baixar o driver IBM Data Server"[^>]*>Baixar<\/button>/);
    expect(html).not.toContain("Abrir a tela de Drivers");
    expect(html).not.toMatch(/href="\/drivers/);
  });

  it("o lembrete de reinício pendente, com 'Reiniciar agora', fica no cartão", () => {
    expect(drivers(render("drivers", {}, { drivers: [{ ...ibm, state: "installed", restartRequired: true }] }).markup)).toContain("O Prism precisa reiniciar o serviço");
  });

  it("chegar pelo endereço dos drivers com o `driverID` (o 'Instalar driver' de uma conexão sem driver) destaca a linha dele", () => {
    const html = drivers(render("drivers", {}, { drivers: [pg, ibm], entry: "/settings/drivers?driver=ibm-data-server" }).markup);

    expect(html).toMatch(/<li[^>]*aria-current="true"[^>]*>.*IBM Data Server/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

describe("Sobre", () => {
  const about = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-sobre")?.html ?? "";

  it("mostra a versão do app, como a tela de login a mostra", () => {
    const html = about(render("about", {}, { version: "0.1.0" }).markup);

    expect(html).toMatch(/<span[^>]*\bdata-app-version\b[^>]*>versão 0\.1\.0<\/span>/);
    expect(html).toContain("Cliente de banco de dados para Informix, Db2 e PostgreSQL.");
  });

  it("sem a versão (a ponte não a trouxe), a tela não escreve versão nenhuma; e não inventa pasta de dados", () => {
    const html = about(render("about").markup);

    expect(html).not.toContain("data-app-version");
    expect(html).not.toMatch(/pasta de dados/i);
  });

  it("mostra a pasta de dados em uso, do jeito que o processo principal a diz, para ler e copiar (e nada para abri-la nem trocá-la)", () => {
    const folder = "C:\\Dados\\Zanveri\\Prism";
    const html = about(render("about", {}, { version: "0.1.0", dataFolder: folder }).markup);

    expect(html).toMatch(/<dt[^>]*>Pasta de dados<\/dt>/);
    expect(html).toContain(`>${folder}</dd>`);
    expect(html).toMatch(/<dd[^>]*\bdata-data-folder\b[^>]*>/);
    expect(html).toContain("Os cofres e o registro da API ficam aqui.");
    expect(html).not.toMatch(/<(button|a|input)\b/);
  });

  it("sem pasta (fora do Electron, ou a ponte não respondeu): a linha da pasta não aparece", () => {
    expect(about(render("about", {}, { version: "0.1.0", dataFolder: null }).markup)).not.toMatch(/pasta de dados/i);
  });
});

describe("Aparência: tema", () => {
  const cards = (markup: string) => [...markup.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(?:(?!<\/button>)[\s\S])*?<span class="font-semibold">([^<]*)<\/span>/g)].map((match) => [match[2], match[1]]);
  const followSystem = (markup: string) => /<input type="checkbox"([^>]*)\/?>[\s\S]*?Seguir o modo claro ou escuro do sistema/.exec(markup)?.[1] ?? "";
  const names = ["Prism Escuro", "Prism Claro", "Monokai", "Dracula", "Nord", "GitHub Claro", "Kanagawa", "AnuPpuccin", "Blue Topaz", "Obsidianite", "Atom", "Typewriter", "Willemstad", "Obsidian gruvbox", "Primary", "Catppuccin", "Prism"];
  /** Os cartões, com só o do tema dado marcado. */
  const only = (name: string) => names.map((candidate) => [candidate, String(candidate === name)]);

  it("por padrão o tema é o Escuro, seguido pelos temas disponíveis", () => {
    const { markup } = render("appearance");

    expect(cards(markup)).toEqual(only("Prism Escuro"));
    expect(followSystem(markup)).not.toContain("checked");
    expect(markup).toMatch(/Prévia<\/span><span class="font-semibold">Prism Escuro<\/span>/);
  });

  it.each([
    ["dark", "Prism Escuro"],
    ["light", "Prism Claro"],
    ["monokai", "Monokai"],
    ["dracula", "Dracula"],
    ["nord", "Nord"],
    ["github-light", "GitHub Claro"],
    ["kanagawa", "Kanagawa"],
  ] as const)("mostra o tema que o usuário escolheu (%s), e a prévia é a dele", (theme, name) => {
    const { markup } = render("appearance", { theme });

    expect(cards(markup)).toEqual(only(name));
    expect(markup).toContain(`Prévia</span><span class="font-semibold">${name}</span>`);
    expect(followSystem(markup)).not.toContain("checked");
  });

  it("'seguir o sistema' marca a caixa, e o cartão marcado é o do Prism no modo que o sistema usa (sem matchMedia, o escuro)", () => {
    const { markup } = render("appearance", { theme: "system" });

    expect(followSystem(markup)).toContain("checked");
    expect(cards(markup)).toEqual(only("Prism Escuro"));
    expect(markup).toContain("Seguindo o sistema, vale o Prism Escuro ou o Prism Claro.");
  });

  it("o botão do tema tem o nome do tema (a faixa de cores é só para os olhos), e a prévia de SQL, que rola, não entra na ordem do teclado", () => {
    const { markup } = render("appearance");
    const appearance = sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";

    const buttons = [...appearance.matchAll(/<button type="button" aria-pressed="(?:true|false)" aria-label="([^"]*)"[^>]*>(<span aria-hidden="true"[^>]*>)/g)].map((match) => match[1]);
    expect(buttons).toEqual(names);
    // A prévia (rolável, dentro de uma região escondida do leitor de tela) não pode ser um ponto de parada do Tab.
    expect(appearance).toMatch(/<div aria-hidden="true" tabindex="-1" class="overflow-auto[^"]*max-h-28/);
  });

  it("os cartões desenham as cores do próprio tema, e não as do que está aplicado", () => {
    const markup = render("appearance", { theme: "dark" }).markup;

    // O cartão do tema claro, mesmo com o escuro aplicado, tem o fundo e a palavra-chave do Prism Claro; os outros, os deles.
    expect(markup).toContain("background:#F7F8FA");
    expect(markup).toContain("color:#1D5FD1");
    expect(markup).toContain("background:#272822");
    expect(markup).toContain("color:#FB72A3");
    expect(markup).toContain("background:#282A36");
    expect(markup).toContain("background:#2E3440");
    expect(markup).toContain("background:#FFFFFF");
  });

  it("a prévia é a do tema escolhido: com o Nord, o fundo e o texto da prévia são os do Nord", () => {
    const markup = render("appearance", { theme: "nord" }).markup;
    const appearance = sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";

    expect(appearance).toContain('style="background:#2E3440;color:#D8DEE9;border-color:#434C5E"');
    expect(appearance).not.toContain('aria-label="Variante do tema"');
  });

  it("ao escolher um tema com variantes, exibe o seletor 'Variante do tema', destaca o cartão da família e mostra 'Tema · Variante' na prévia", () => {
    const markup = render("appearance", { theme: "anuppuccin-latte" as never }).markup;
    const appearance = sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";
    const variantGroup = /<div role="group" aria-label="Variante do tema"[^>]*>([\s\S]*?)<\/div>/.exec(appearance)?.[1] ?? "";
    const variantButtons = [...variantGroup.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map((match) => [match[2], match[1]]);

    expect(cards(markup)).toEqual(only("AnuPpuccin"));
    expect(variantButtons).toEqual([
      ["Mocha", "false"],
      ["Frappé", "false"],
      ["Macchiato", "false"],
      ["Latte", "true"],
      ["Rosé Pine", "false"],
    ]);
    expect(appearance).toContain('Prévia</span><span class="font-semibold">AnuPpuccin · Latte</span>');
  });

  it("o tema Prism (Obsidian) lista as dez variantes (cinco escuras e cinco claras) e marca a variante ativa", () => {
    const markup = render("appearance", { theme: "prism-cherry" as never }).markup;
    const appearance = sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";
    const variantGroup = /<div role="group" aria-label="Variante do tema"[^>]*>([\s\S]*?)<\/div>/.exec(appearance)?.[1] ?? "";
    const variantButtons = [...variantGroup.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^<]*)<\/button>/g)].map((match) => [match[2], match[1]]);

    expect(cards(markup)).toEqual(only("Prism"));
    expect(variantButtons).toEqual([
      ["Raven", "false"],
      ["Mocha", "false"],
      ["Indigo", "false"],
      ["Pine", "false"],
      ["Cherry", "true"],
      ["Swan", "false"],
      ["Latte", "false"],
      ["Periwinkle", "false"],
      ["Pistachio", "false"],
      ["Peach", "false"],
    ]);
    expect(appearance).toContain('Prévia</span><span class="font-semibold">Prism · Cherry</span>');
  });
});

describe("Aparência: fontes (RN-CONFIG-008)", () => {
  const appearance = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";
  const input = (html: string, id: string) => new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? "";

  it("tem a fonte da interface e a do editor SQL, cada uma com o rótulo dela, e a fonte do app como padrão", () => {
    const html = appearance(render("appearance").markup);

    expect(html).toMatch(/<label[^>]*for="cfg-fonte-interface"[^>]*>Fonte da interface<\/label>/);
    expect(html).toMatch(/<label[^>]*for="cfg-fonte-editor"[^>]*>Fonte do editor SQL<\/label>/);
    for (const [id, value] of [["cfg-fonte-interface", "IBM Plex Sans"], ["cfg-fonte-editor", "IBM Plex Mono"]]) {
      const field = input(html, id);
      expect(field).toContain('role="combobox"');
      expect(field).toContain('aria-autocomplete="list"');
      expect(field).toContain('aria-expanded="false"');
      expect(field).toContain(`value="${value}"`);
    }
  });

  it("mostra o que o usuário escolheu, e a prévia do editor desenha nessa fonte, com a do app atrás", () => {
    const html = appearance(render("appearance", { ui: { fontFamily: "Inter" }, editor: { fontFamily: "JetBrains Mono" } }).markup);

    expect(input(html, "cfg-fonte-interface")).toContain('value="Inter"');
    expect(input(html, "cfg-fonte-editor")).toContain('value="JetBrains Mono"');
    expect(html).toContain("font-family:&quot;JetBrains Mono&quot;, var(--font-mono)");
  });

  it("diz onde cada uma vale: a da interface fora do código, também no navegador e nas grades; a do editor nos campos de SQL (RN-CONFIG-008)", () => {
    const html = appearance(render("appearance").markup);

    expect(html).toContain("Vale para todo o texto do Prism fora do código, também para o navegador e para as grades do resultado e dos Registros.");
    expect(html).toContain("Vale para o editor SQL, o filtro dos Registros e o “Ver SQL”.");
    expect(html).not.toContain("fonte mono");
  });

  it("o título da seção já não é só o tema", () => {
    expect(appearance(render("appearance").markup)).toMatch(/<h2 id="cfg-aparencia-title"[^>]*>Aparência<\/h2>/);
  });
});

describe("Aparência: zoom do programa (RN-ZOOM-001)", () => {
  const appearance = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";

  it("mostra o zoom de agora, como o processo principal o diz, com diminuir, aumentar e \"Restaurar 100%\"", () => {
    const html = appearance(render("appearance", {}, { zoom: 125 }).markup);

    expect(html).toContain("Zoom do programa");
    expect(html).toMatch(/<output aria-live="polite"[^>]*>125%<\/output>/);
    expect(html).toContain('aria-label="Diminuir o zoom do programa"');
    expect(html).toContain('aria-label="Aumentar o zoom do programa"');
    expect(html).toMatch(/<button [^>]*>Restaurar 100%<\/button>/);
  });

  it("sem zoom do programa (fora do Electron, ou a ponte que não respondeu), o controle não aparece, e o resto da seção fica", () => {
    for (const zoom of [null, undefined]) {
      const html = appearance(render("appearance", {}, { zoom }).markup);

      expect(html).not.toContain("Zoom do programa");
      expect(html).toContain("Fonte da interface");
    }
  });
});

describe("Aparência: densidade do navegador (RN-NAV-011)", () => {
  const appearance = (markup: string) => sectionsOf(markup).find((section) => section.id === "cfg-aparencia")?.html ?? "";
  /** Os dois botões de opção, na ordem, com o rótulo e se está marcado. */
  const radios = (html: string) =>
    [...html.matchAll(/(<input type="radio"[^>]*name="cfg-densidade"[^>]*\/?>)<span>([^<]*)<\/span>/g)].map(([, input, label]) => [/value="([^"]*)"/.exec(input)?.[1], label, / checked=""/.test(input)]);

  it("um grupo com o nome e a dica, e as duas densidades; a confortável, a do canvas, é a padrão", () => {
    const html = appearance(render("appearance").markup);

    expect(html).toMatch(/<fieldset aria-describedby="cfg-densidade-dica"[^>]*><legend[^>]*>Densidade do navegador<\/legend>/);
    expect(radios(html)).toEqual([
      ["comfortable", "Confortável", true],
      ["compact", "Compacta", false],
    ]);
    expect(html).toContain('id="cfg-densidade-dica"');
    expect(html).toContain("A compacta tem linhas mais baixas e menos recuo a cada nível: cabem mais itens na árvore e na lista de scripts.");
  });

  it("mostra o que o usuário escolheu", () => {
    expect(radios(appearance(render("appearance", { ui: { navigatorDensity: "compact" } }).markup))).toEqual([
      ["comfortable", "Confortável", false],
      ["compact", "Compacta", true],
    ]);
  });

  it("aparece também fora do Electron: é preferência do usuário, e não do processo principal", () => {
    expect(radios(appearance(render("appearance", {}, { zoom: null }).markup))).toHaveLength(2);
  });
});
