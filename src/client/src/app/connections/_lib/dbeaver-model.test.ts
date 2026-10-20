import { describe, expect, it } from "vitest";

import { checkTree } from "./check-tree";
import { allImportable, previewIndex, previewTree } from "./import-model";
import {
  apiSourceRefusal,
  cardButtons,
  cardSentence,
  cardState,
  connectedCount,
  connectionLine,
  dbeaverConnectionTags,
  dbeaverCounter,
  dbeaverFolderTags,
  dbeaverToast,
  drdaKey,
  drdaPortFor,
  drdaPortsOf,
  drdaRows,
  drdaSignature,
  existingMarked,
  marksAfterScopeChange,
  hasAnyPassword,
  importableTotal,
  importedItems,
  lastImportSentence,
  originLabel,
  overwriteChanges,
  parseDrdaInput,
  previewNotices,
  previewSummary,
  projectNameOf,
  projectOptions,
  showsProjects,
  sourceRefusal,
  validProject,
} from "./dbeaver-model";
import { dbeaverImportResultSchema, dbeaverPreviewSchema, dbeaverScanSchema, type DbeaverPreviewConnection } from "./dbeaver.schema";

/** Tudo sintético: os hosts são do domínio reservado `.invalid`, e os nomes são inventados. */
const project = (name: string, extra: Record<string, unknown> = {}) => ({ name, connections: 4, importable: 3, withPassword: 1, protected: false, nameInvalid: false, credentialsUnreadable: false, credentialsProtected: false, ...extra });
const scanOf = (...projects: ReturnType<typeof project>[]) => dbeaverScanSchema.parse({ where: "standard", projects });

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  folderKey: null,
  name: `CONEXAO ${key}`,
  engine: 1,
  host: "pg-dev.exemplo.invalid",
  port: 5432,
  database: "pedidos",
  userName: "fulano",
  hasPassword: true,
  verificationQuery: null,
  effective: null,
  conflict: false,
  copyName: null,
  strengthened: null,
  invalid: null,
  server: null,
  dbeaverType: "dev",
  existing: null,
  overwrite: null,
  leftOut: [],
  ...extra,
});
const informixRow = (key: string, extra: Record<string, unknown> = {}) =>
  row(key, { engine: 3, host: "ifx-dev.exemplo.invalid", port: 55080, dbeaverPort: 55080, drdaPort: null, database: "estoque", server: "ifx_dev_tcp", ...extra });
const previewOf = (connections: Record<string, unknown>[], folders: Record<string, unknown>[] = [], notes: Record<string, unknown> | null = null) =>
  dbeaverPreviewSchema.parse({ folders, connections, notes });
const folderRow = (key: string, extra: Record<string, unknown> = {}) => ({ key, parentKey: null, name: key, existing: false, strengthened: null, invalid: null, nameCut: false, ...extra });

const treeOf = (preview: ReturnType<typeof previewOf>) => {
  const tree = previewTree(preview);
  return { tree, index: previewIndex(preview), marked: allImportable(tree) };
};

describe("a origem e as recusas do processo principal (RN-DBEAVER-006 e 014)", () => {
  it("cada recusa tem a frase dela, e só o notFound e o notDbeaver não deixam tentar de novo", () => {
    expect(sourceRefusal({ status: "notFound" })).toEqual({ message: "Não encontramos o DBeaver nos lugares de sempre.", retry: false });
    expect(sourceRefusal({ status: "notDbeaver" })?.message).toContain("Escolha a pasta DBeaverData, o workspace ou um projeto.");
    expect(sourceRefusal({ status: "tooLarge" })).toMatchObject({ retry: true });
    expect(sourceRefusal({ status: "tooLarge" })?.message).toContain("até 50 projetos, 5 MB por arquivo e 32 MB de configuração");
    expect(sourceRefusal({ status: "notWritable" })?.message).toBe("Não foi possível gravar na pasta de dados do Prism para ler o DBeaver.");
    expect(sourceRefusal({ status: "noSpace" })?.message).toBe("Não há espaço na pasta de dados do Prism para copiar as conexões do DBeaver.");
    expect(sourceRefusal({ status: "unreadable", message: "Não foi possível ler os arquivos do DBeaver: o disco deu erro de leitura." })).toEqual({ message: "Não foi possível ler os arquivos do DBeaver: o disco deu erro de leitura.", retry: true });
    expect(sourceRefusal({ status: "error" })).toMatchObject({ retry: true });
  });

  it("desistir e achar não são recusa", () => {
    expect(sourceRefusal({ status: "canceled" })).toBeNull();
    expect(sourceRefusal({ status: "found", sourceId: "0f8fad5b-d9cb-469f-a165-70867728950e", where: "standard", projects: 1 })).toBeNull();
  });

  it("a recusa da API: a cópia que sumiu pede outra origem, e a que não se lê tem a frase da contagem", () => {
    const error = (code: string) => ({ status: 404, code, title: "", detail: null, errors: null, extensions: {} });
    expect(apiSourceRefusal(error("DBEAVER_SOURCE_MISSING"))).toEqual({ message: "A cópia do DBeaver não existe mais. Procure o DBeaver de novo.", missing: true });
    expect(apiSourceRefusal(error("DBEAVER_SOURCE_INVALID"))).toEqual({ message: "O Prism não conseguiu ler as conexões deste DBeaver.", missing: false });
    expect(apiSourceRefusal(error("OUTRA")).missing).toBe(false);
  });

  it("o campo Origem escreve o lugar", () => {
    expect(originLabel("standard")).toBe("DBeaver neste computador");
    expect(originLabel("flatpak")).toBe("DBeaver (Flatpak) neste computador");
    expect(originLabel("snap")).toBe("DBeaver (Snap) neste computador");
    expect(originLabel("env")).toBe("DBeaver da pasta de DBEAVER_DATA");
    expect(originLabel("chosen")).toBe("Pasta escolhida");
  });
});

describe("o cartão do \"Comece por aqui\" (RN-DBEAVER-001)", () => {
  const ready = (scan: ReturnType<typeof scanOf>, where: "standard" | "flatpak" = "standard") => ({ kind: "ready" as const, sourceId: "x", where, scan });

  it("a conta é a das conexões importáveis de todos os projetos que se leem", () => {
    const scan = scanOf(project("General", { importable: 18 }), project("Vendas", { importable: 4 }), project("Protegido", { importable: 9, protected: true }), project("Ruim", { importable: 5, nameInvalid: true }));
    expect(importableTotal(scan)).toBe(22);
    expect(cardSentence(cardState(ready(scan)))).toBe("Encontramos o DBeaver neste computador: 22 conexões.");
    expect(cardSentence(cardState(ready(scanOf(project("General", { importable: 1 })))))).toBe("Encontramos o DBeaver neste computador: 1 conexão.");
    expect(cardSentence(cardState(ready(scanOf(project("General", { importable: 1 })), "flatpak")))).toBe("Encontramos o DBeaver (Flatpak) neste computador: 1 conexão.");
  });

  it("achou sem nenhuma que o Prism importe: a frase diz, e o botão é o da pasta", () => {
    const state = cardState(ready(scanOf(project("General", { importable: 0 }))));
    expect(cardSentence(state)).toBe("Encontramos o DBeaver neste computador, mas sem conexões de PostgreSQL, Db2 ou Informix.");
    expect(cardButtons(state)).toEqual({ primary: "choose", retry: false, link: false });
  });

  it("não achou, procurando e recusado", () => {
    expect(cardSentence(cardState({ kind: "searching" }))).toBe("Procurando o DBeaver neste computador…");
    expect(cardButtons(cardState({ kind: "searching" }))).toEqual({ primary: null, retry: false, link: false });
    expect(cardSentence(cardState({ kind: "notFound" }))).toBe("Não encontramos o DBeaver nos lugares de sempre. Se ele guarda o workspace noutro lugar, escolha a pasta.");
    expect(cardButtons(cardState({ kind: "notFound" })).primary).toBe("choose");

    const refused = cardState({ kind: "refused", message: "A frase da recusa.", retry: true });
    expect(cardSentence(refused)).toBe("A frase da recusa.");
    expect(cardButtons(refused)).toEqual({ primary: "choose", retry: true, link: false });
  });

  it("achou o que importar: \"Importar do DBeaver…\" e o link da pasta", () => {
    expect(cardButtons(cardState(ready(scanOf(project("General")))))).toEqual({ primary: "import", retry: false, link: true });
  });
});

describe("o seletor do projeto (RN-DBEAVER-014)", () => {
  const scan = scanOf(project("General", { importable: 18 }), project("Vendas", { importable: 1 }), project("Legado", { importable: 0 }), project("Fechado", { protected: true }), project("Ru\u0007im", { nameInvalid: true }));

  it("só aparece com mais de um projeto", () => {
    expect(showsProjects(scan)).toBe(true);
    expect(showsProjects(scanOf(project("General")))).toBe(false);
  });

  it("\"Todos os projetos\", cada projeto com a conta, o protegido e o de nome inválido desabilitados com o motivo", () => {
    const options = projectOptions(scan.projects);
    expect(options.map((option) => option.label)).toEqual(["Todos os projetos", "General, 18 conexões", "Vendas, 1 conexão", "Legado, nenhuma conexão que o Prism importe", "Fechado", "Projeto 5"]);
    expect(options.map((option) => option.disabled === true)).toEqual([false, false, false, false, true, true]);
    expect(options[4].hint).toBe("protegido por senha de projeto");
    expect(options[5].hint).toBe("O nome deste projeto no DBeaver tem um caractere que o Prism não aceita.");
  });

  it("o valor volta ao nome do projeto; todos é nulo, e o de nome inválido nunca é mandado", () => {
    const options = projectOptions(scan.projects);
    expect(projectNameOf(scan, options[0].value)).toBeNull();
    expect(projectNameOf(scan, options[2].value)).toBe("Vendas");
    expect(projectNameOf(scan, options[5].value)).toBeNull();
    expect(projectNameOf(scan, options[4].value)).toBeNull();
    expect(validProject(scan, options[4].value)).toBe(false);
    expect(validProject(scan, options[0].value)).toBe(true);
    expect(validProject(scan, options[2].value)).toBe(true);
    expect(validProject(scan, options[5].value)).toBe(false);
    expect(validProject(scan, "project-9")).toBe(false);
  });

  it("\"Levar as senhas\" só aparece quando alguma conexão da origem tem senha", () => {
    expect(hasAnyPassword(scan)).toBe(true);
    expect(hasAnyPassword(scanOf(project("General", { withPassword: 0 })))).toBe(false);
    expect(hasAnyPassword(scanOf(project("General", { withPassword: 2, protected: true })))).toBe(false);
  });
});

describe("o resumo e os avisos da prévia (RN-DBEAVER-015)", () => {
  const preview = previewOf(
    [row("c1"), row("c2", { hasPassword: false }), row("c3", { userName: "", hasPassword: false }), row("c4", { invalid: "O Prism ainda não tem este banco (MySQL)." })],
    [folderRow("f1"), folderRow("f2")],
  );

  it("conta as conexões e as pastas do DBeaver, o que o Prism importa e o que tem usuário e senha", () => {
    expect(previewSummary(preview, null, true)).toBe("O DBeaver tem 4 conexões em 2 pastas; o Prism importa 3: 2 com usuário, 1 com a senha.");
    expect(previewSummary(preview, "General", true)).toBe("O projeto General tem 4 conexões em 2 pastas; o Prism importa 3: 2 com usuário, 1 com a senha.");
  });

  it("com \"Levar as senhas\" desligada, \"com a senha\" sai; as partes que são zero também", () => {
    expect(previewSummary(preview, null, false)).toBe("O DBeaver tem 4 conexões em 2 pastas; o Prism importa 3: 2 com usuário.");
    expect(previewSummary(previewOf([row("c1", { userName: "", hasPassword: false })]), null, true)).toBe("O DBeaver tem 1 conexão; o Prism importa 1, sem usuário nem senha.");
  });

  it("sem conexão que o Prism importe, e sem nada", () => {
    expect(previewSummary(previewOf([row("c1", { invalid: "x" })], [folderRow("f1")]), null, true)).toBe("O DBeaver não tem conexões que o Prism importe (PostgreSQL, Db2 ou Informix).");
    expect(previewSummary(previewOf([]), null, true)).toBe("O DBeaver não tem pastas nem conexões.");
  });

  it("os avisos, na ordem, com o tom de cada um", () => {
    const notes = previewOf([], [], {
      protectedProjects: ["Vendas"],
      unreadableFiles: ["Legado", "Antigo"],
      unreadableProjects: ["Antigo"],
      credentialsUnreadable: ["General", "Vendas"],
      credentialsProtected: ["Legado"],
      savedPasswordMissing: 3,
      withoutSavedPassword: 8,
    }).notes;

    const notices = previewNotices(notes, false);
    expect(notices.map((notice) => notice.tone)).toEqual(["warning", "warning", "warning", "warning", "warning", "warning", "warning", "info"]);
    expect(notices.map((notice) => notice.text)).toEqual([
      "O projeto Vendas está protegido por senha de projeto e não foi lido.",
      "Um arquivo de conexões do projeto Legado não pôde ser lido.",
      "Os arquivos de conexões do projeto Antigo não puderam ser lidos.",
      "No projeto General, as senhas não puderam ser lidas: o arquivo não está no formato que o Prism conhece (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). As conexões vêm só com o usuário.",
      "No projeto Vendas, as senhas não puderam ser lidas: o arquivo não está no formato que o Prism conhece (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). As conexões vêm só com o usuário.",
      "As senhas do projeto Legado estão protegidas por senha de projeto e não foram lidas. As conexões vêm sem senha.",
      "3 conexões têm “Salvar senha” no DBeaver, mas o arquivo não traz a senha (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). Elas vêm só com o usuário.",
      "8 conexões estão sem “Salvar senha” no DBeaver e vêm só com o usuário.",
    ]);
    expect(new Set(notices.map((notice) => notice.key)).size).toBe(notices.length);
  });

  it("um projeto só: a frase das senhas que não puderam ser lidas vem sem o nome, e o singular concorda", () => {
    const notes = previewOf([], [], { credentialsUnreadable: ["General"], savedPasswordMissing: 1, withoutSavedPassword: 1 }).notes;
    expect(previewNotices(notes, true).map((notice) => notice.text)).toEqual([
      "As senhas do DBeaver não puderam ser lidas: o arquivo não está no formato que o Prism conhece (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). As conexões vêm só com o usuário.",
      "1 conexão tem “Salvar senha” no DBeaver, mas o arquivo não traz a senha (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). Ela vem só com o usuário.",
      "1 conexão está sem “Salvar senha” no DBeaver e vem só com o usuário.",
    ]);
    expect(previewNotices(previewOf([]).notes, false)).toEqual([]);
  });

  it("vários projetos: com as senhas ilegíveis em só um deles, a frase leva o nome dele (RN-DBEAVER-008)", () => {
    const notes = previewOf([], [], { credentialsUnreadable: ["Vendas"] }).notes;
    expect(previewNotices(notes, false).map((notice) => notice.text)).toEqual([
      "No projeto Vendas, as senhas não puderam ser lidas: o arquivo não está no formato que o Prism conhece (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). As conexões vêm só com o usuário.",
    ]);
  });
});

describe("a segunda linha da conexão (RN-DBEAVER-015)", () => {
  it("PostgreSQL: o endereço, o usuário e a senha", () => {
    const [connection] = previewOf([row("c1")]).connections;
    expect(connectionLine(connection, null)).toBe("pg-dev.exemplo.invalid:5432 / pedidos · usuário fulano · com senha");
    expect(connectionLine({ ...connection, hasPassword: false }, null)).toBe("pg-dev.exemplo.invalid:5432 / pedidos · usuário fulano · sem senha");
    expect(connectionLine({ ...connection, userName: "", hasPassword: false }, null)).toBe("pg-dev.exemplo.invalid:5432 / pedidos · sem usuário e senha");
  });

  it("Informix: o servidor depois do banco, e a porta DRDA digitada no lugar da do DBeaver", () => {
    const [connection] = previewOf([informixRow("c1")]).connections;
    expect(connectionLine(connection, null)).toBe("ifx-dev.exemplo.invalid:55080 / estoque · servidor ifx_dev_tcp · usuário fulano · com senha");
    expect(connectionLine(connection, 9089)).toBe("ifx-dev.exemplo.invalid:9089 / estoque · servidor ifx_dev_tcp · usuário fulano · com senha");
  });
});

describe("as marcas da conexão e da pasta (RN-DBEAVER-011, 012, 013 e 015)", () => {
  const labelsOf = (preview: ReturnType<typeof previewOf>, key: string, drda: number | null = null, onConflict: "rename" | "skip" = "rename") => {
    const { tree, index } = treeOf(preview);
    const connection = index.connections.get(key) as DbeaverPreviewConnection;
    return dbeaverConnectionTags(tree, index, connection, onConflict, drda);
  };

  it("a conexão simples não tem marca; a que já existe no Prism diz onde está, e não é conflito de nome", () => {
    expect(labelsOf(previewOf([row("c1")]), "c1")).toEqual([]);

    const tags = labelsOf(previewOf([row("c1", { existing: { connectionID: "0199e0a2-0000-7000-8000-000000000001", name: "DATA FIX", path: "Estoque / Production PRD", connected: false } })]), "c1");
    expect(tags.map((tag) => tag.label)).toEqual(["já existe no Prism"]);
    expect(tags[0].hint).toBe("Esta conexão já foi importada do DBeaver: ela está em Estoque / Production PRD, com o nome DATA FIX. Se ficar marcada, você escolhe ao importar se ela é sobrescrita.");
  });

  it("o Informix leva \"porta do DBeaver\" com a porta dela na dica, e a marca sai quando a DRDA foi digitada", () => {
    const tags = labelsOf(previewOf([informixRow("c1")]), "c1");
    expect(tags.map((tag) => tag.label)).toEqual(["porta do DBeaver"]);
    expect(tags[0].hint).toContain("a sugerida é 9089");
    expect(tags[0].hint).toContain("a do DBeaver era 55080.");
    expect(labelsOf(previewOf([informixRow("c1")]), "c1", 9089)).toEqual([]);
  });

  it("\"ficou de fora\" lista o que ficou, na ordem, com o aviso do túnel e do proxy", () => {
    const tags = labelsOf(previewOf([informixRow("c1", { leftOut: ["informixServer", "sshTunnel", "proxy", "driverProperties", "bootstrap", "autocommitOff", "events", "authModel", "confirmDataChange", "permissions", "navigatorFilters"] })]), "c1", 9089);
    expect(tags.map((tag) => tag.label)).toEqual(["ficou de fora"]);
    expect(tags[0].hint).toBe(
      "Ficou de fora: o servidor Informix (ifx_dev_tcp); o túnel SSH; o proxy; as propriedades do driver; os comandos de inicialização, o banco e o esquema padrão; o auto-commit desligado (as abas novas seguem Configurações › Transações); os comandos antes e depois de conectar; o login do DBeaver; a confirmação antes de salvar as edições; as restrições de permissão (viraram somente leitura); os filtros do navegador. Sem o túnel ou o proxy, a conexão pode não alcançar o servidor.",
    );
    // Sem túnel nem proxy, a frase não aparece.
    expect(labelsOf(previewOf([row("c1", { leftOut: ["driverProperties"] })]), "c1")[0].hint).toBe("Ficou de fora: as propriedades do driver.");
  });

  it("o modelo de login do DBeaver vai entre parênteses em \"ficou de fora\"", () => {
    expect(labelsOf(previewOf([row("c1", { leftOut: ["authModel"], authModel: "pgpass" })]), "c1")[0].hint).toBe("Ficou de fora: o login do DBeaver (pgpass).");
    expect(labelsOf(previewOf([row("c1", { leftOut: ["authModel"] })]), "c1")[0].hint).toBe("Ficou de fora: o login do DBeaver.");
  });

  it("os dois avisos do ambiente têm marca própria, e não entram em \"ficou de fora\"", () => {
    const tags = labelsOf(previewOf([row("c1", { leftOut: ["environmentCut", "environmentInvalid"] })]), "c1");
    expect(tags.map((tag) => [tag.label, tag.hint])).toEqual([
      ["nome do tipo cortado", "O nome do tipo de conexão foi cortado em 30 caracteres."],
      ["sem ambiente", "O tipo de conexão tem um caractere que o Prism não aceita: a conexão vem sem ambiente."],
    ]);
  });

  it("\"confirma todos os comandos\" leva a dica do DBeaver, com o nome do tipo; sem o nome, \"o tipo desta conexão\"", () => {
    const strengthened = { readOnly: false, confirmCommands: "all", environmentName: null, environmentColor: null };
    const [tag] = labelsOf(previewOf([row("c1", { strengthened, dbeaverType: "Production" })]), "c1");
    expect(tag.label).toBe("confirma todos os comandos");
    expect(tag.hint).toContain("No DBeaver, o tipo Production pergunta antes de todo comando que não é SELECT.");
    expect(tag.hint).toContain("Mude em Editar conexão se achar demais.");
    expect(labelsOf(previewOf([row("c1", { strengthened, dbeaverType: null })]), "c1")[0].hint).toContain("No DBeaver, o tipo desta conexão pergunta");
  });

  it("o conflito de nome e a recusa seguem a seção 34: a conexão não importável só leva a marca do motivo", () => {
    const conflict = labelsOf(previewOf([row("c1", { conflict: true, copyName: "CONEXAO c1 (cópia)" })]), "c1");
    expect(conflict.map((tag) => tag.label)).toEqual(["já existe", "entra como CONEXAO c1 (cópia)"]);
    // Não importada pelo "Não importar": o que a importação gravaria nela não acontece.
    expect(labelsOf(previewOf([informixRow("c1", { conflict: true, leftOut: ["sshTunnel"] })]), "c1", null, "skip").map((tag) => tag.label)).toEqual(["já existe", "não será importada"]);
    expect(labelsOf(previewOf([informixRow("c1", { invalid: "O Prism ainda não tem este banco (MySQL).", leftOut: ["sshTunnel"] })]), "c1").map((tag) => tag.label)).toEqual(["não pode ser importada"]);
  });

  it("a pasta de nome cortado leva a marca; a não importável, só o motivo", () => {
    const preview = previewOf([], [folderRow("f1", { nameCut: true }), folderRow("f2", { nameCut: true, invalid: "Nome inválido." })]);
    const { tree, index } = treeOf(preview);
    expect(dbeaverFolderTags(tree, index, preview.folders[0]).map((tag) => tag.label)).toEqual(["nome cortado"]);
    expect(dbeaverFolderTags(tree, index, preview.folders[1]).map((tag) => tag.label)).toEqual(["não pode ser importada"]);
  });
});

describe("a conta do rodapé (RN-DBEAVER-015)", () => {
  it("é a da seção 34, com \", 3 já existem no Prism\" no fim quando há", () => {
    const { tree, marked } = treeOf(previewOf([row("c1"), row("c2")], [folderRow("f1")]));
    expect(dbeaverCounter(tree, marked, 0)).toMatch(/^2 conexões/);
    expect(dbeaverCounter(tree, marked, 0)).not.toContain("já exist");
    expect(dbeaverCounter(tree, marked, 1)).toMatch(/, 1 já existe no Prism$/);
    expect(dbeaverCounter(tree, marked, 3)).toMatch(/, 3 já existem no Prism$/);
  });
});

describe("as portas DRDA do Informix (RN-DBEAVER-010 e 015)", () => {
  const preview = previewOf([
    informixRow("c1"),
    informixRow("c2", { name: "OUTRA", database: "compras" }),
    informixRow("c3", { host: "IFX-DEV.exemplo.invalid" }),
    informixRow("c4", { server: "ifx_hml_tcp", host: "ifx-hml.exemplo.invalid" }),
    informixRow("c5", { port: 55081, dbeaverPort: 55081 }),
    informixRow("c6", { invalid: "x", host: "ifx-prd.exemplo.invalid" }),
    row("c7"),
  ]);

  it("uma linha por servidor do DBeaver (host, porta SQLI e INFORMIXSERVER, como a prévia os dá), só das marcadas que se importam", () => {
    const { tree, marked } = treeOf(preview);
    const rows = drdaRows(tree, preview, marked);
    expect(rows.map((item) => [item.host, item.port, item.server, item.connections])).toEqual([
      ["ifx-dev.exemplo.invalid", 55080, "ifx_dev_tcp", 2],
      ["IFX-DEV.exemplo.invalid", 55080, "ifx_dev_tcp", 1],
      ["ifx-hml.exemplo.invalid", 55080, "ifx_hml_tcp", 1],
      ["ifx-dev.exemplo.invalid", 55081, "ifx_dev_tcp", 1],
    ]);

    // Desmarcadas, as linhas somem; sem Informix marcado, a tabela nem aparece.
    expect(drdaRows(tree, preview, new Set(["c2", "c7"])).map((item) => item.connections)).toEqual([1]);
    expect(drdaRows(tree, preview, new Set(["c7"]))).toEqual([]);
    expect(drdaRows(tree, preview, new Set())).toEqual([]);
  });

  it("o que se digita: vazio, uma porta de 1 a 65535, ou inválido", () => {
    expect(parseDrdaInput("")).toEqual({ kind: "empty" });
    expect(parseDrdaInput("  ")).toEqual({ kind: "empty" });
    expect(parseDrdaInput(" 9089 ")).toEqual({ kind: "port", port: 9089 });
    expect(parseDrdaInput("65535")).toEqual({ kind: "port", port: 65535 });
    for (const bad of ["0", "65536", "-1", "9089.5", "abc", "90 89", "009089x"]) expect(parseDrdaInput(bad)).toEqual({ kind: "invalid" });
  });

  it("as portas que vão à API são só as preenchidas e válidas, com o servidor como a prévia o deu", () => {
    const { tree, marked } = treeOf(preview);
    const rows = drdaRows(tree, preview, marked);
    const values = { [rows[0].key]: "9089", [rows[1].key]: "", [rows[2].key]: "abc" };

    expect(drdaPortsOf(rows, values)).toEqual([{ host: "ifx-dev.exemplo.invalid", port: 55080, server: "ifx_dev_tcp", drdaPort: 9089 }]);
    expect(drdaSignature(drdaPortsOf(rows, values))).toBe("ifx-dev.exemplo.invalid|55080|ifx_dev_tcp=9089");
    expect(drdaSignature([])).toBe("");
  });

  it("a porta DRDA de uma conexão é a do servidor dela; a do PostgreSQL e a do campo vazio são nulas", () => {
    const { tree, marked } = treeOf(preview);
    const rows = drdaRows(tree, preview, marked);
    const values = { [rows[0].key]: "9089" };
    const byKey = new Map(preview.connections.map((connection) => [connection.key, connection]));

    expect(drdaPortFor(byKey.get("c1")!, values)).toBe(9089);
    expect(drdaPortFor(byKey.get("c2")!, values)).toBe(9089);
    // A API compara o host como vem: o que difere só na caixa é outro servidor, com a linha dele.
    expect(drdaPortFor(byKey.get("c3")!, values)).toBeNull();
    expect(drdaPortFor(byKey.get("c4")!, values)).toBeNull();
    expect(drdaPortFor(byKey.get("c7")!, values)).toBeNull();
    expect(drdaKey(" IFX.exemplo.invalid ", 1, null)).toBe("IFX.exemplo.invalid|1|");
  });

  it("com a DRDA já aplicada pela prévia, `port` é a DRDA e o servidor continua a ser o da porta SQLI (`dbeaverPort`)", () => {
    const applied = previewOf([informixRow("c1", { port: 9089, dbeaverPort: 55080, drdaPort: 9089 })]);
    const { tree, index, marked } = treeOf(applied);
    const rows = drdaRows(tree, applied, marked);

    expect(rows.map((item) => [item.host, item.port, item.server])).toEqual([["ifx-dev.exemplo.invalid", 55080, "ifx_dev_tcp"]]);
    expect(drdaPortsOf(rows, { [rows[0].key]: "9089" })).toEqual([{ host: "ifx-dev.exemplo.invalid", port: 55080, server: "ifx_dev_tcp", drdaPort: 9089 }]);
    expect(drdaPortFor(applied.connections[0], { [rows[0].key]: "9089" })).toBe(9089);
    expect(connectionLine(applied.connections[0], null)).toContain(":9089");
    // Digitada e depois apagada, a marca volta com a porta do DBeaver na dica, não com a DRDA que a prévia ainda tem.
    expect(dbeaverConnectionTags(tree, index, applied.connections[0], "rename", null)[0].hint).toContain("a do DBeaver era 55080.");
  });
});

describe("sobrescrever (RN-DBEAVER-017)", () => {
  const existing = (extra: Record<string, unknown> = {}) => ({ connectionID: "0199e0a2-0000-7000-8000-000000000001", name: "DATA FIX", path: "Estoque", connected: false, ...extra });
  const flags = (extra: Record<string, unknown> = {}) => ({ name: false, engine: false, host: false, port: false, database: false, userName: false, password: false, environment: false, keepsName: false, dropsPassword: false, ...extra });
  const connectionOf = (extra: Record<string, unknown>) => previewOf([row("c1", extra)]).connections[0];

  it("as marcadas que já existem e se importam", () => {
    const preview = previewOf([
      row("c1", { existing: existing() }),
      row("c2"),
      row("c3", { existing: existing({ connectionID: "0199e0a2-0000-7000-8000-000000000003" }), invalid: "x" }),
      row("c4", { existing: existing({ connectionID: "0199e0a2-0000-7000-8000-000000000004", connected: true }) }),
    ]);
    const { tree } = treeOf(preview);

    expect(existingMarked(tree, preview, new Set(["c1", "c2", "c4"])).map((connection) => connection.key)).toEqual(["c1", "c4"]);
    expect(existingMarked(tree, preview, new Set(["c2"]))).toEqual([]);
    expect(connectedCount(existingMarked(tree, preview, new Set(["c1", "c4"])))).toBe(1);
  });

  it("o que muda, campo a campo, com os valores quando a prévia os traz", () => {
    const withValues = connectionOf({
      host: "ifx-hml.exemplo.invalid",
      existing: existing({ host: "ifx-dev.exemplo.invalid", environmentName: "Teste" }),
      effective: { readOnly: false, confirmCommands: null, environmentName: "Produção", environmentColor: null },
      overwrite: flags({ host: true, userName: true, password: true, environment: true }),
    });
    expect(overwriteChanges(withValues, null)).toEqual(["host ifx-dev.exemplo.invalid → ifx-hml.exemplo.invalid", "usuário", "senha", "ambiente Teste → Produção"]);

    // Sem os valores de antes, só o campo.
    const bare = connectionOf({ existing: existing(), overwrite: flags({ host: true, port: true, database: true, name: true, engine: true }) });
    expect(overwriteChanges(bare, null)).toEqual(["nome", "banco", "host", "porta", "banco de dados"]);
  });

  it("nada muda, o nome que fica e a senha que cai", () => {
    expect(overwriteChanges(connectionOf({ existing: existing(), overwrite: flags() }), null)).toEqual(["nada muda"]);
    expect(overwriteChanges(connectionOf({ existing: existing(), overwrite: flags({ keepsName: true }) }), null)).toEqual(["o nome fica: já há uma CONEXAO c1 nesta pasta"]);
    expect(overwriteChanges(connectionOf({ existing: existing(), overwrite: flags({ host: true, dropsPassword: true }) }), null)).toEqual(["host", "o host muda e a senha não vem: ela fica sem senha"]);
    expect(overwriteChanges(connectionOf({ existing: existing(), overwrite: flags({ userName: true, dropsPassword: true }) }), null).at(-1)).toBe("o usuário muda e a senha não vem: ela fica sem senha");
    expect(overwriteChanges(connectionOf({ existing: existing(), overwrite: flags({ port: true, dropsPassword: true }) }), null).at(-1)).toBe("a porta muda e a senha não vem: ela fica sem senha");
  });

  it("a porta DRDA digitada aparece como a porta nova do Informix", () => {
    const informix = previewOf([informixRow("c1", { existing: existing({ port: 9088 }), overwrite: flags({ port: true }) })]).connections[0];
    expect(overwriteChanges(informix, 9089)).toEqual(["porta 9088 → 9089"]);
  });
});

describe("o aviso de sucesso (RN-DBEAVER-016)", () => {
  const id = (n: number) => `0199e0a2-0000-7000-8000-${String(n).padStart(12, "0")}`;
  const result = (created: number, folders: number, extra: { updated?: number; renamed?: number; skipped?: number } = {}) =>
    dbeaverImportResultSchema.parse({
      folderIDs: Array.from({ length: folders }, (_, n) => id(100 + n)),
      connectionIDs: Array.from({ length: created }, (_, n) => id(n + 1)),
      mergedFolders: 0,
      renamed: extra.renamed ?? 0,
      skipped: extra.skipped ?? 0,
      updatedIDs: Array.from({ length: extra.updated ?? 0 }, (_, n) => id(200 + n)),
    });

  it("diz o que entrou, com a parte que não é zero", () => {
    expect(dbeaverToast(result(12, 4))).toEqual({ tone: "success", message: "12 conexões e 4 pastas importadas do DBeaver." });
    expect(dbeaverToast(result(1, 1))).toEqual({ tone: "success", message: "1 conexão e 1 pasta importadas do DBeaver." });
    expect(dbeaverToast(result(1, 0))).toEqual({ tone: "success", message: "1 conexão importada do DBeaver." });
    expect(dbeaverToast(result(0, 2)).message).toBe("2 pastas importadas do DBeaver.");
  });

  it("\", 2 com outro nome\" e \", 3 atualizadas\" antes do ponto", () => {
    expect(dbeaverToast(result(12, 4, { renamed: 2, updated: 3 })).message).toBe("12 conexões e 4 pastas importadas do DBeaver, 2 com outro nome, 3 atualizadas.");
    expect(dbeaverToast(result(5, 0, { updated: 1 })).message).toBe("5 conexões importadas do DBeaver, 1 atualizada.");
  });

  it("só com atualizações, e sem nada", () => {
    expect(dbeaverToast(result(0, 0, { updated: 3 }))).toEqual({ tone: "success", message: "3 conexões atualizadas do DBeaver." });
    expect(dbeaverToast(result(0, 0, { updated: 1 })).message).toBe("1 conexão atualizada do DBeaver.");
    expect(dbeaverToast(result(0, 0))).toEqual({ tone: "warning", message: "Nada foi importado do DBeaver: tudo o que estava marcado já existia." });
  });

  it("o \"Não importar\" que deixou conexões de fora vira atenção, com a frase da seção 34", () => {
    expect(dbeaverToast(result(2, 0, { skipped: 1 }))).toEqual({ tone: "warning", message: "2 conexões importadas do DBeaver. 1 conexão não importada: já existia no lugar escolhido." });
  });

  it("o navegador mostra o que entrou, ou as atualizadas quando nada foi criado", () => {
    expect(importedItems(result(2, 1, { updated: 4 }), "f9")).toEqual({ folderIDs: [id(100)], connectionIDs: [id(1), id(2)], targetFolderID: "f9" });
    expect(importedItems(result(0, 0, { updated: 2 }), null)).toEqual({ folderIDs: [], connectionIDs: [id(200), id(201)], targetFolderID: null });
  });
});

describe("Configurações › Importar (RN-CONFIG-011)", () => {
  it("diz a data da última importação, na hora local, e a frase de quem nunca importou", () => {
    expect(lastImportSentence(null)).toBe("Você ainda não importou do DBeaver.");
    expect(lastImportSentence("não é uma data")).toBe("Você ainda não importou do DBeaver.");

    const sentence = lastImportSentence("2026-10-20T14:32:00", "pt-BR");
    expect(sentence).toBe("Última importação do DBeaver: 20/10/2026, 14:32.");
  });
});

describe("as marcas ao trocar o projeto (RN-DBEAVER-014)", () => {
  const item = (key: string, selectable = true) => ({ key, kind: "connection" as const, parentKey: null, name: key, selectable });

  it("continuam as que ainda valem, e o que a árvore de antes não tinha chega marcado", () => {
    const before = checkTree([item("c2_1"), item("c2_2")]);
    const tree = checkTree([item("c2_1"), item("c2_2"), item("c3_1"), item("c3_2", false)]);

    expect([...marksAfterScopeChange(tree, new Set(["c2_1", "c9_9"]), before)].sort()).toEqual(["c2_1", "c3_1"]);
  });
});
