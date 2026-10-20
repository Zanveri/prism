import { describe, expect, it } from "vitest";

import { checkStates, toggle } from "./check-tree";
import {
  allImportable,
  conflictCount,
  connectionLine,
  connectionTags,
  engineLabelOf,
  fileSizeLabel,
  folderTags,
  importCounter,
  importFileMaxBytes,
  importItems,
  importToast,
  invalidReason,
  ownQueryCount,
  previewIndex,
  previewSummary,
  previewTree,
  readRefusal,
  rowDescription,
} from "./import-model";
import { transferCopy } from "./transfer.copy";
import { importPreviewSchema, type ImportPreview } from "./transfer.schema";

const copy = transferCopy.import;
const tags = copy.preview.tags;

// A prévia de um arquivo com o exemplo do dono (seção 34): Estoque › Production PRD, com a DATA FIX (o usuário que o time divide, com a senha) e a NOMINAL
// (só o usuário); a API_USER sem usuário e senha; a pasta de outro sistema que não pode ser importada, com o que tem dentro; e uma pasta vazia.
const raw = {
  folders: [
    { key: "f1", parentKey: null, name: "Estoque", color: "#4C8DFF", environmentName: null, environmentColor: null, confirmCommands: "none", readOnly: true, existing: true, strengthened: null, invalid: null },
    { key: "f2", parentKey: "f1", name: "Production PRD", color: null, environmentName: "Production", environmentColor: "#FF8A7A", confirmCommands: "all", readOnly: false, existing: false, strengthened: { readOnly: true, confirmCommands: "all" }, invalid: null },
    { key: "f3", parentKey: null, name: "Faturamento‮", color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: null, existing: false, strengthened: null, invalid: "O nome da pasta não pode ter caractere de controle nem de direção do texto." },
    { key: "f4", parentKey: null, name: "Arquivo morto", color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, existing: false, strengthened: null, invalid: null },
  ],
  connections: [
    {
      key: "c1",
      folderKey: "f2",
      name: "DATA FIX",
      engine: 3,
      host: "informix-prd.exemplo.invalid",
      port: 9089,
      database: "estoque",
      userName: "datafix",
      hasPassword: true,
      verificationEnabled: true,
      verificationInterval: 60,
      verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1",
      effective: { readOnly: true, confirmCommands: "all", environmentName: "Production", environmentColor: "#FF8A7A" },
      conflict: true,
      copyName: "DATA FIX (cópia)",
      strengthened: { readOnly: true, confirmCommands: null, environmentName: "Production", environmentColor: "#FF8A7A" },
      invalid: null,
    },
    { key: "c2", folderKey: "f2", name: "NOMINAL", engine: 3, host: "informix-prd.exemplo.invalid", port: 9089, database: "estoque", userName: "nominal", hasPassword: false, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, effective: { readOnly: true, confirmCommands: "all" }, conflict: false, copyName: "NOMINAL (cópia)", strengthened: null, invalid: null },
    { key: "c3", folderKey: null, name: "API_USER", engine: 1, host: "pg.exemplo.invalid", port: 5432, database: "api", userName: "", hasPassword: false, verificationEnabled: false, verificationInterval: 30, verificationQuery: "SELECT count(*) FROM pedidos", effective: null, conflict: false, copyName: "API_USER (cópia)", strengthened: null, invalid: null },
    { key: "c4", folderKey: "f3", name: "Faturamento", engine: 2, host: "db2.exemplo.invalid", port: 50000, database: "fat", userName: "fat", hasPassword: true, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, effective: null, conflict: false, copyName: null, strengthened: null, invalid: null },
    { key: "c5", folderKey: null, name: "MySql", engine: null, host: "mysql.exemplo.invalid", port: 3306, database: "x", userName: "x", hasPassword: false, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, effective: null, conflict: false, copyName: null, strengthened: null, invalid: "Este Prism não conhece o banco MySql." },
  ],
};
const preview: ImportPreview = importPreviewSchema.parse(raw);
const tree = previewTree(preview);
const index = previewIndex(preview);
const folder = (key: string) => index.folders.get(key)!;
const connection = (key: string) => index.connections.get(key)!;
const labels = (list: readonly { label: string }[]) => list.map((tag) => tag.label);

describe("a árvore da prévia (RN-TRANSF-011)", () => {
  it("começa com tudo o que pode ser importado marcado; o que não pode, e o que está dentro de uma pasta que não pode, fica sem caixa que se marque", () => {
    expect([...allImportable(tree)].sort()).toEqual(["c1", "c2", "c3", "f4"]);
    expect(tree.byKey.get("c4")?.selectable).toBe(false);
    expect(tree.byKey.get("c5")?.selectable).toBe(false);

    // Marcar a pasta que não pode ser importada não marca nada.
    expect(toggle(tree, "f3", new Set())).toEqual(new Set());
    expect(checkStates(tree, allImportable(tree)).get("f3")).toBe("unchecked");
  });

  it("o motivo do item que não pode ser importado: o dele, ou o da pasta de cima (“A pasta … não pode ser importada.”)", () => {
    expect(invalidReason(tree, index, "c5")).toBe("Este Prism não conhece o banco MySql.");
    expect(invalidReason(tree, index, "c4")).toBe(copy.preview.invalidFolder("Faturamento‮"));
    expect(invalidReason(tree, index, "c1")).toBeNull();
  });

  it("a pasta que pode ser importada e só tem dentro o que não pode começa marcada e vai sozinha, como a API a conta na prévia", () => {
    const onlyInvalid = importPreviewSchema.parse({
      folders: [{ key: "f1", parentKey: null, name: "Faturamento", color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, existing: false, strengthened: null, invalid: null }],
      connections: [{ key: "c1", folderKey: "f1", name: "MySql", engine: null, host: "mysql.exemplo.invalid", port: 3306, database: "x", userName: "", hasPassword: false, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, effective: null, conflict: false, copyName: null, strengthened: null, invalid: "Este Prism não conhece o banco MySql." }],
    });
    const onlyInvalidTree = previewTree(onlyInvalid);

    expect([...allImportable(onlyInvalidTree)]).toEqual(["f1"]);
    expect(importItems(onlyInvalidTree, allImportable(onlyInvalidTree))).toEqual(["f1"]);
    expect(importCounter(onlyInvalidTree, allImportable(onlyInvalidTree))).toBe("1 pasta marcada");
  });

  it("as chaves que vão são as folhas marcadas (as pastas do caminho vão sozinhas), nunca a do que não pode ser importado", () => {
    expect(importItems(tree, new Set(["c1", "c4", "c5", "f2"]))).toEqual(["c1"]);
    expect(importItems(tree, allImportable(tree))).toEqual(["f4", "c1", "c2", "c3"]);
  });

  it("a conta do rodapé, com as pastas que vão como caminho", () => {
    expect(importCounter(tree, allImportable(tree))).toBe("3 conexões e 3 pastas marcadas");
    expect(importCounter(tree, new Set(["c1"]))).toBe("1 conexão e 2 pastas marcadas");
    expect(importCounter(tree, new Set(["c3"]))).toBe("1 conexão marcada");
    expect(importCounter(tree, new Set(["f4"]))).toBe("1 pasta marcada");
    expect(importCounter(tree, new Set())).toBe("Nada marcado");
  });
});

describe("o resumo e as linhas (RN-TRANSF-011)", () => {
  it("o resumo diz o que o arquivo traz, sem as partes que são zero", () => {
    expect(previewSummary(preview)).toBe("O arquivo tem 5 conexões em 4 pastas: 4 com usuário, 2 com a senha.");
    expect(copy.preview.summary({ connections: 12, folders: 6, withUser: 9, withPassword: 3 })).toBe("O arquivo tem 12 conexões em 6 pastas: 9 com usuário, 3 com a senha.");
    expect(copy.preview.summary({ connections: 12, folders: 6, withUser: 0, withPassword: 0 })).toBe("O arquivo tem 12 conexões em 6 pastas, sem usuário nem senha.");
    expect(copy.preview.summary({ connections: 0, folders: 2, withUser: 0, withPassword: 0 })).toBe("O arquivo tem 2 pastas, sem conexões.");
    expect(copy.preview.summary({ connections: 0, folders: 0, withUser: 0, withPassword: 0 })).toBe("O arquivo não tem pastas nem conexões.");
    expect(copy.preview.summary({ connections: 1, folders: 1, withUser: 1, withPassword: 0 })).toBe("O arquivo tem 1 conexão em 1 pasta: 1 com usuário.");
  });

  it("a segunda linha da conexão: o servidor e as credenciais, e a senha nunca", () => {
    expect(connectionLine(connection("c1"))).toBe("informix-prd.exemplo.invalid:9089 / estoque · usuário datafix · com senha");
    expect(connectionLine(connection("c2"))).toBe("informix-prd.exemplo.invalid:9089 / estoque · usuário nominal · sem senha");
    expect(connectionLine(connection("c3"))).toBe("pg.exemplo.invalid:5432 / api · sem usuário e senha");
  });

  it("o que o leitor de tela ouve na caixa: o caminho, a segunda linha, o motivo e cada marca com a explicação, que na tela só está na dica do mouse", () => {
    const query = { label: tags.ownQuery, hint: "O Prism executa esta consulta sozinho: SELECT 1. Confira antes de importar.", tone: "attention" as const };
    const reason = "Este Prism não conhece o banco MySql.";

    expect(rowDescription({ path: "Estoque / Production PRD", line: connectionLine(connection("c1")), reason: null, tags: [query] })).toBe(
      "Na pasta Estoque / Production PRD. informix-prd.exemplo.invalid:9089 / estoque · usuário datafix · com senha. consulta própria: O Prism executa esta consulta sozinho: SELECT 1. Confira antes de importar.",
    );
    // O motivo vem na marca "não pode ser importada", que o tem por dica, e não se repete.
    expect(rowDescription({ path: null, line: null, reason, tags: [{ label: tags.invalid, hint: reason, tone: "danger" }] })).toBe("não pode ser importada: Este Prism não conhece o banco MySql.");
    expect(rowDescription({ path: null, line: null, reason, tags: [] })).toBe(reason);
    expect(rowDescription({ path: null, line: null, reason: null, tags: [] })).toBe("");
  });

  it("a etiqueta do banco, ou nada quando este Prism não o conhece", () => {
    expect(engineLabelOf(connection("c1"))).toBe("Informix");
    expect(engineLabelOf(connection("c5"))).toBeNull();
  });

  it("o servidor que a prévia manda conferir sempre aparece", () => {
    expect(copy.preview.servers).toBe("Confira os servidores antes de importar. A senha que você digitar numa destas conexões vai para o servidor que o arquivo indica.");
  });
});

describe("as marcas de cada linha (RN-TRANSF-011 a 013)", () => {
  it("a pasta que já existe no lugar: “já existe”, com a explicação", () => {
    expect(folderTags(tree, index, folder("f1"))).toEqual([{ label: tags.existing, hint: tags.existingFolder, tone: "neutral" }]);
  });

  it("a pasta que a importação cria e protege, para não ficar mais fraca", () => {
    expect(labels(folderTags(tree, index, folder("f2")))).toEqual([tags.readOnly, tags.all]);
    // O somente leitura vinha da pasta Estoque, de cima; a confirmação, dela mesma.
    expect(folderTags(tree, index, folder("f2"))[0].hint).toBe(copy.preview.why.readOnly(" pela pasta Estoque"));
    expect(folderTags(tree, index, folder("f2"))[1].hint).toBe(copy.preview.why.all(""));
  });

  it("a conexão cujo nome está tomado: “já existe” e o que a escolha dos conflitos faz com ela", () => {
    expect(labels(connectionTags(tree, index, connection("c1"), "rename", false))).toEqual([tags.existing, "entra como DATA FIX (cópia)", tags.readOnly, "ambiente Production", tags.ownQueryDropped]);
    // Com “Não importar”, o que a importação gravaria nela não acontece.
    expect(labels(connectionTags(tree, index, connection("c1"), "skip", false))).toEqual([tags.existing, tags.skipped]);
  });

  it("o porquê do que a importação grava na conexão: a pasta do arquivo que dava a proteção ou o ambiente", () => {
    const [, , readOnly, environment] = connectionTags(tree, index, connection("c1"), "rename", false);
    expect(readOnly.hint).toBe("No arquivo ela era somente leitura pela pasta Estoque. No lugar escolhido nada a protegeria: a importação grava o somente leitura nela mesma.");
    expect(environment.hint).toBe("No arquivo ela mostrava o ambiente Production pela pasta Production PRD. No lugar escolhido ela mostraria outro, ou nenhum: a importação grava o ambiente Production nela mesma.");
  });

  it("a consulta de verificação própria: inteira na dica, “não mantida” com a caixa desmarcada; o aviso da função que grava só no Db2 e no Informix", () => {
    const informix = connectionTags(tree, index, connection("c1"), "rename", true).at(-1)!;
    expect(informix.label).toBe(tags.ownQuery);
    expect(informix.hint).toBe(
      "O Prism executa esta consulta sozinho, a cada 60 segundos, enquanto a conexão estiver conectada, e também no “Testar conexão”: SELECT 1 FROM systables WHERE tabid = 1. O Prism só confere o texto: uma função chamada dentro de um SELECT pode gravar sem que o texto mostre. Confira antes de importar.",
    );

    // No PostgreSQL a consulta roda numa transação só de leitura; com a verificação desligada no arquivo, a frase muda.
    const postgres = connectionTags(tree, index, connection("c3"), "rename", false).at(-1)!;
    expect(postgres.label).toBe(tags.ownQueryDropped);
    expect(postgres.hint).toBe("O Prism executa esta consulta no “Testar conexão”, e sozinho, a cada 30 segundos, se a verificação for ligada: SELECT count(*) FROM pedidos. Confira antes de importar.");
  });

  it("o que não pode ser importado: só “não pode ser importada”, com o motivo", () => {
    expect(connectionTags(tree, index, connection("c5"), "rename", false)).toEqual([{ label: tags.invalid, hint: "Este Prism não conhece o banco MySql.", tone: "danger" }]);
    expect(connectionTags(tree, index, connection("c4"), "rename", false)).toEqual([{ label: tags.invalid, hint: copy.preview.invalidFolder("Faturamento‮"), tone: "danger" }]);
    expect(labels(folderTags(tree, index, folder("f3")))).toEqual([tags.invalid]);
  });

  it("a escolha dos conflitos e a caixa das consultas só aparecem com o que pode ser importado", () => {
    expect(conflictCount(tree, preview)).toBe(1);
    expect(ownQueryCount(tree, preview)).toBe(2);
    expect(copy.conflicts.count(2)).toBe("2 conexões já existem no lugar escolhido.");
    expect(copy.conflicts.count(1)).toBe("1 conexão já existe no lugar escolhido.");
    expect(copy.queries.hint(3)).toBe("3 conexões trazem uma consulta de verificação própria, que o Prism executa sozinho. Desmarcada, elas entram com a consulta do banco.");
    expect(copy.queries.hint(1)).toBe("1 conexão traz uma consulta de verificação própria, que o Prism executa sozinho. Desmarcada, ela entra com a consulta do banco.");
  });
});

describe("o arquivo escolhido (RN-TRANSF-009)", () => {
  it("o teto é de 5 MiB, e o tamanho aparece ao lado do nome", () => {
    expect(importFileMaxBytes).toBe(5_242_880);
    expect(fileSizeLabel(14 * 1024)).toBe("14 KB");
    expect(fileSizeLabel(300)).toBe("300 bytes");
    expect(fileSizeLabel(1)).toBe("1 byte");
    expect(fileSizeLabel(2.5 * 1024 * 1024)).toBe("2,5 MB");
    expect(copy.chosen("conexoes-prism-2026-10-16.prismconexoes", fileSizeLabel(14 * 1024))).toBe("conexoes-prism-2026-10-16.prismconexoes, 14 KB");
  });
});

describe("as recusas da leitura, no campo a que se referem (RN-TRANSF-009 e 010)", () => {
  it.each([
    ["IMPORT_LIMITS_EXCEEDED", "file", "Este arquivo passa dos limites da importação: até 5 MiB, 2.000 conexões, 2.000 pastas e 32 níveis de pastas."],
    ["IMPORT_FILE_INVALID", "file", "Este arquivo não é uma exportação de conexões do Prism, ou está danificado."],
    ["IMPORT_FILE_NEWER", "file", "Este arquivo foi exportado por uma versão mais nova do Prism. Atualize o Prism para importá-lo."],
    ["IMPORT_PASSPHRASE_WRONG", "passphrase", "A senha de exportação não confere, ou o arquivo foi alterado."],
    ["IMPORT_PASSPHRASE_INVALID", "passphrase", "Informe a senha de exportação."],
    ["FOLDER_NOT_FOUND", "destination", "A pasta escolhida não existe mais. Escolha outro lugar."],
  ])("%s vai a %s", (code, field, message) => {
    expect(readRefusal(code)).toEqual({ field, message });
  });

  it("as da gravação (que a tela não deixa acontecer) não são da leitura: vão ao aviso central", () => {
    expect(readRefusal("IMPORT_EMPTY")).toBeNull();
    expect(readRefusal("IMPORT_INVALID")).toBeNull();
  });
});

describe("importToast: o aviso diz o que aconteceu de fato (RN-TRANSF-014)", () => {
  const ids = (count: number) => Array.from({ length: count }, (_, at) => `0199e0a2-0000-7000-8000-${String(at).padStart(12, "0")}`);
  const result = (connections: number, folders: number, renamed = 0, skipped = 0) => ({ connectionIDs: ids(connections), folderIDs: ids(folders), mergedFolders: 0, renamed, skipped });

  it.each([
    [result(5, 2), "success", "5 conexões e 2 pastas importadas."],
    [result(1, 1), "success", "1 conexão e 1 pasta importadas."],
    [result(3, 0), "success", "3 conexões importadas."],
    [result(1, 0), "success", "1 conexão importada."],
    [result(0, 2), "success", "2 pastas importadas."],
    [result(3, 1, 1), "success", "3 conexões e 1 pasta importadas, 1 com outro nome."],
    [result(3, 0, 2), "success", "3 conexões importadas, 2 com outro nome."],
    [result(3, 0, 0, 2), "warning", "3 conexões importadas. 2 conexões não importadas: já existiam no lugar escolhido."],
    [result(1, 0, 0, 1), "warning", "1 conexão importada. 1 conexão não importada: já existia no lugar escolhido."],
    [result(0, 0, 0, 2), "warning", "Nada foi importado: tudo o que estava marcado já existia no lugar escolhido."],
  ])("%o", (imported, tone, message) => {
    expect(importToast(imported)).toEqual({ tone, message });
  });
});
