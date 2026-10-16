import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  appearanceChanged,
  defaultScriptIcon,
  editedScriptInput,
  copyName,
  exceedsScriptLimit,
  isScriptDirty,
  maxScriptBytes,
  normalizeScriptName,
  refusalProblem,
  placeChanged,
  savedPlaceOfTab,
  saveShortcut,
  scriptIconOf,
  scriptIcons,
  scriptMenu,
  scriptFolderMenu,
  scriptNameProblem,
  scriptPlace,
  scriptsToAsk,
  suggestScriptName,
  withEditedSql,
  withSavedPlace,
} from "./saved-scripts";

const scripts = (...names: string[]) => names.map((name, index) => ({ id: `s${index + 1}`, name }));

describe("o nome do script (RN-SCRIPT-004, as regras da API)", () => {
  it("é gravado sem espaço nas pontas, sem espaço repetido e na forma composta do Unicode", () => {
    expect(normalizeScriptName("  Fechamento   do mês ")).toBe("Fechamento do mês");
    expect(normalizeScriptName("Fábrica")).toBe("Fábrica");
  });

  it("vazio, só espaços, com mais de 200 caracteres ou com caractere de controle é recusado", () => {
    expect(scriptNameProblem("", [])).toBe("empty");
    expect(scriptNameProblem("   ", [])).toBe("empty");
    expect(scriptNameProblem("a".repeat(201), [])).toBe("tooLong");
    expect(scriptNameProblem(` ${"a".repeat(200)} `, [])).toBeNull();
    for (const name of ["Fecha\tmento", "Fecha\nmento", "Fecha\rmento", "a\u0001", "\u007fa", "a\u0085"]) expect(scriptNameProblem(name, []), JSON.stringify(name)).toBe("control");
  });

  it("o nome de outro script, com outras maiúsculas e espaços, já existe; o do próprio script, não", () => {
    expect(scriptNameProblem(" fechamento  do MÊS ", scripts("Fechamento do mês"))).toBe("taken");
    expect(scriptNameProblem("FECHAMENTO DO MÊS", scripts("Fechamento do mês"), "s1")).toBeNull();
    expect(scriptNameProblem("Relatório", scripts("Fechamento do mês"))).toBeNull();
  });
});

describe("a sugestão de nome", () => {
  it("é o primeiro \"Script N\" livre, sem diferenciar maiúsculas", () => {
    expect(suggestScriptName([])).toBe("Script 1");
    expect(suggestScriptName(scripts("Script 1", "script 2", "Script 4"))).toBe("Script 3");
  });

  it("o \"Salvar como\" sugere o nome com o primeiro número livre entre parênteses, sem passar de 200 caracteres", () => {
    expect(copyName("Fechamento", scripts("Fechamento"))).toBe("Fechamento (2)");
    expect(copyName("Fechamento", scripts("Fechamento", "fechamento (2)"))).toBe("Fechamento (3)");
    const long = copyName("a".repeat(200), scripts("a".repeat(200)));
    expect(long).toHaveLength(200);
    expect(long.endsWith(" (2)")).toBe(true);
  });
});

describe("o tamanho do SQL (até 1 MB, em bytes de UTF-8, como a API conta)", () => {
  it("1 MB exato cabe, um byte a mais não; o acento conta dois bytes", () => {
    expect(maxScriptBytes).toBe(1024 * 1024);
    expect(exceedsScriptLimit("x".repeat(maxScriptBytes))).toBe(false);
    expect(exceedsScriptLimit("x".repeat(maxScriptBytes + 1))).toBe(true);
    expect(exceedsScriptLimit("é".repeat(maxScriptBytes / 2 + 1))).toBe(true);
  });
});

describe("a mudança não salva (RN-SCRIPT-001 e 003)", () => {
  /** A aba na conexão c1, no banco da conexão. */
  const inC1 = { connectionId: "c1" };
  const savedInC1 = { savedSql: "SELECT 1", savedConnectionId: "c1" };

  it("é o texto diferente do que foi salvo", () => {
    expect(isScriptDirty(savedInC1, "SELECT 1", inC1)).toBe(false);
    expect(isScriptDirty(savedInC1, "SELECT 1 ", inC1)).toBe(true);
  });

  it("o texto novo da aba recalcula o ponto: desfazer até o salvo o apaga", () => {
    const tab = { id: "t1", sql: "SELECT 1", connectionId: "c1", script: { id: "s1", name: "a", ...savedInC1, dirty: true } };
    expect(withEditedSql(tab, "SELECT 1").script?.dirty).toBe(false);
    expect(withEditedSql(tab, "SELECT 2").script?.dirty).toBe(true);
    expect(withEditedSql({ id: "t2", sql: "", connectionId: "c1" }, "SELECT 2")).toEqual({ id: "t2", sql: "SELECT 2", connectionId: "c1" });
  });

  it("é também o banco da aba diferente do banco em que foi salvo (RN-ARVORE-007); sem banco, é o da conexão", () => {
    expect(isScriptDirty(savedInC1, "SELECT 1", { ...inC1, database: "vendas" })).toBe(true);
    expect(isScriptDirty({ ...savedInC1, savedDatabase: "vendas" }, "SELECT 1", { ...inC1, database: "vendas" })).toBe(false);
    expect(isScriptDirty({ ...savedInC1, savedDatabase: "vendas" }, "SELECT 1", inC1)).toBe(true);
  });

  it("é também a conexão da aba diferente da conexão em que foi salvo (RN-ARVORE-008), e voltar a ela apaga o ponto", () => {
    expect(isScriptDirty(savedInC1, "SELECT 1", { connectionId: "c2" })).toBe(true);
    expect(isScriptDirty(savedInC1, "SELECT 1", { connectionId: null })).toBe(true);
    expect(placeChanged(savedInC1, inC1)).toBe(false);
    expect(placeChanged(savedInC1, { connectionId: "c2" })).toBe(true);
  });

  it("o script salvo numa conexão que não existe mais abre sem conexão sem ponto; dar uma conexão à aba é mudança que o Ctrl+S grava", () => {
    const missing = { savedSql: "SELECT 1" };
    expect(isScriptDirty(missing, "SELECT 1", { connectionId: null })).toBe(false);
    expect(isScriptDirty(missing, "SELECT 1", { connectionId: "c2" })).toBe(true);
  });

  it("no script genérico só o texto conta: trocar a conexão ou o banco da aba não é mudança (RN-SCRIPT-005)", () => {
    const generic = { savedSql: "SELECT 1", generic: true as const };
    expect(isScriptDirty(generic, "SELECT 1", { connectionId: "c2", database: "vendas" })).toBe(false);
    expect(isScriptDirty(generic, "SELECT 1", { connectionId: null })).toBe(false);
    expect(isScriptDirty(generic, "SELECT 2", inC1)).toBe(true);
  });

  it("com a aba noutro banco, desfazer o texto até o salvo não apaga o ponto", () => {
    const tab = { id: "t1", sql: "SELECT 2", connectionId: "c1", database: "vendas", script: { id: "s1", name: "a", ...savedInC1, dirty: true } };
    expect(withEditedSql(tab, "SELECT 1").script?.dirty).toBe(true);
    expect(withEditedSql({ ...tab, script: { ...tab.script, savedDatabase: "vendas" } }, "SELECT 1").script?.dirty).toBe(false);
  });

  it("o lugar que o Ctrl+S grava é o da aba, ou nenhum no genérico", () => {
    expect(savedPlaceOfTab({ connectionId: "c1", database: "vendas" }, false)).toEqual({ savedConnectionId: "c1", savedDatabase: "vendas" });
    expect(savedPlaceOfTab({ connectionId: "c1" }, false)).toEqual({ savedConnectionId: "c1" });
    expect(savedPlaceOfTab({ connectionId: null }, false)).toEqual({});
    expect(savedPlaceOfTab({ connectionId: "c1", database: "vendas" }, true)).toEqual({ generic: true });
  });

  it("o lugar salvo novo (tornar genérico, vincular) troca o de antes e refaz o ponto pelo texto e pela aba", () => {
    const tab = { id: "t1", sql: "SELECT 1", connectionId: "c2", script: { id: "s1", name: "a", ...savedInC1, savedDatabase: "vendas", dirty: true } };

    const generic = withSavedPlace(tab, { generic: true });
    expect(generic.script).toEqual({ id: "s1", name: "a", savedSql: "SELECT 1", generic: true, dirty: false });

    const bound = withSavedPlace({ ...tab, script: generic.script }, { savedConnectionId: "c2" });
    expect(bound.script).toEqual({ id: "s1", name: "a", savedSql: "SELECT 1", savedConnectionId: "c2", dirty: false });
    expect(withSavedPlace(tab, { savedConnectionId: "c2" }, "SELECT 9").script?.dirty).toBe(true);
    expect(withSavedPlace({ id: "t2", sql: "", connectionId: null }, { generic: true })).toEqual({ id: "t2", sql: "", connectionId: null });
  });

  it("fechar pergunta só pelas abas que são scripts com mudança, na ordem da faixa", () => {
    const tabs = [
      { id: "t1", script: { id: "s1", name: "a", savedSql: "", dirty: true } },
      { id: "t2" },
      { id: "t3", script: { id: "s3", name: "c", savedSql: "", dirty: false } },
      { id: "t4", script: { id: "s4", name: "d", savedSql: "", dirty: true } },
    ];
    expect(scriptsToAsk(["t4", "t2", "t3", "t1"], tabs).map((tab) => tab.id)).toEqual(["t1", "t4"]);
    expect(scriptsToAsk(["t2", "t3"], tabs)).toEqual([]);
  });
});

describe("onde o script abre (RN-SCRIPT-003)", () => {
  const connections = new Set(["c1", "c2"]);

  it("na conexão e no banco em que foi salvo, se a conexão ainda existe; a aba guarda esse lugar como o salvo", () => {
    expect(scriptPlace({ connectionID: "c1", database: "vendas" }, connections)).toEqual({ connectionId: "c1", database: "vendas", missing: false, saved: { savedConnectionId: "c1", savedDatabase: "vendas" } });
    expect(scriptPlace({ connectionID: "c2", database: null }, connections)).toEqual({ connectionId: "c2", database: undefined, missing: false, saved: { savedConnectionId: "c2" } });
  });

  it("sem conexão quando a dele não existe mais, e a aba mede a mudança contra \"sem conexão\"", () => {
    expect(scriptPlace({ connectionID: "c9", database: "vendas" }, connections)).toEqual({ connectionId: null, database: undefined, missing: true, saved: {} });
  });

  it("com a lista de conexões ainda sem chegar, não decide: abre na dele", () => {
    expect(scriptPlace({ connectionID: "c9", database: null }, null)).toEqual({ connectionId: "c9", database: undefined, missing: false, saved: { savedConnectionId: "c9" } });
  });
});

describe("onde o script genérico abre (RN-SCRIPT-005)", () => {
  const connections = new Set(["c1", "c2", "c3"]);
  const generic = { connectionID: null, database: null };

  it("com exatamente uma conexão conectada, na dela, no banco padrão", () => {
    expect(scriptPlace(generic, connections, ["c2"])).toEqual({ connectionId: "c2", database: undefined, missing: false, saved: { generic: true } });
  });

  it("com mais de uma conectada, sem conexão: a faixa pergunta qual", () => {
    expect(scriptPlace(generic, connections, ["c1", "c3"])).toEqual({ connectionId: null, database: undefined, missing: false, saved: { generic: true } });
  });

  it("sem nenhuma conectada (ou com a lista sem chegar), sem conexão, e nada \"sumiu\"", () => {
    expect(scriptPlace(generic, connections, [])).toEqual({ connectionId: null, database: undefined, missing: false, saved: { generic: true } });
    expect(scriptPlace(generic, null)).toEqual({ connectionId: null, database: undefined, missing: false, saved: { generic: true } });
  });
});

describe("Ctrl+S e Ctrl+Shift+S (RN-SCRIPT-001)", () => {
  const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

  it("Ctrl+S salva, Ctrl+Shift+S é o \"Salvar como\", e o Cmd do macOS vale o Ctrl", () => {
    expect(saveShortcut(key({ ctrlKey: true }))).toBe("save");
    expect(saveShortcut(key({ metaKey: true }))).toBe("save");
    expect(saveShortcut(key({ ctrlKey: true, shiftKey: true, key: "S" }))).toBe("saveAs");
  });

  it("sem o Ctrl, com o Alt ou com outra tecla, não é o atalho", () => {
    expect(saveShortcut(key({}))).toBeNull();
    expect(saveShortcut(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(saveShortcut(key({ ctrlKey: true, key: "d" }))).toBeNull();
  });
});

describe("a recusa da API, no campo do nome", () => {
  it("o nome repetido é \"já existe\", o SQL grande demais é o tamanho, e o nome inválido diz o problema do nome que foi enviado", () => {
    expect(refusalProblem("SCRIPT_ALREADY_EXISTS", "a")).toBe("taken");
    expect(refusalProblem("SCRIPT_TOO_LARGE", "a")).toBe("tooLarge");
    expect(refusalProblem("SCRIPT_NAME_INVALID", "a\tb")).toBe("control");
    expect(refusalProblem("SCRIPT_NAME_INVALID", "a")).toBe("empty");
    expect(refusalProblem("OUTRO", "a")).toBeNull();
  });
});

describe("o menu de um script e o de uma pasta de scripts (RN-SCRIPT-003 e 009)", () => {
  it("abrir primeiro; renomear, editar (RN-SCRIPT-006), mover para… (RN-SCRIPT-009), copiar o SQL e o lugar; excluir à parte, por último", () => {
    expect(scriptMenu({ generic: false, bindable: false }).map((group) => group.map((item) => item.action))).toEqual([["open"], ["rename", "edit", "move", "copySql", "makeGeneric"], ["delete"]]);
  });

  it("o script com conexão oferece \"Tornar genérico\"; o genérico, \"Vincular à conexão da aba\", apagado sem aba aberta com conexão (RN-SCRIPT-005)", () => {
    const placeItem = (script: { generic: boolean; bindable: boolean }) => scriptMenu(script)[1][4];

    expect(placeItem({ generic: false, bindable: true })).toEqual({ action: "makeGeneric" });
    expect(placeItem({ generic: true, bindable: true })).toEqual({ action: "bind" });
    expect(placeItem({ generic: true, bindable: false })).toEqual({ action: "bind", disabled: true });
  });

  it("a pasta: nova subpasta; renomear e mover para…; excluir à parte, desabilitado na pasta que tem alguma coisa dentro (RN-SCRIPT-007)", () => {
    expect(scriptFolderMenu({ empty: true })).toEqual([[{ action: "newSubfolder" }], [{ action: "rename" }, { action: "move" }], [{ action: "delete" }]]);
    expect(scriptFolderMenu({ empty: false })[2]).toEqual([{ action: "delete", disabled: true }]);
  });
});

/**
 * A lista dos ícones como a API a tem, lida do código dela (`src/api/Prism.Application/Scripts/Models/ScriptRules.cs`): o `Icons` e o `DefaultIcon`. Assim a
 * conferência é entre as duas pontas, e não contra uma cópia da lista escrita aqui.
 */
function apiScriptIcons(): { icons: string[]; defaultIcon: string } {
  const source = readFileSync(new URL("../../../../../api/Prism.Application/Scripts/Models/ScriptRules.cs", import.meta.url), "utf8");
  const defaultIcon = /\bDefaultIcon\s*=\s*"([^"]+)"/.exec(source)?.[1];
  const list = /\bIcons\s*=\s*\[([^\]]*)\]/.exec(source)?.[1];
  if (defaultIcon === undefined || list === undefined) throw new Error("ScriptRules.cs não tem mais o DefaultIcon ou o Icons como este teste os lê.");

  const icons = list.split(",").map((item) => {
    const entry = item.trim();
    if (entry === "DefaultIcon") return defaultIcon;
    const quoted = /^"([^"]*)"$/.exec(entry);
    if (quoted === null) throw new Error(`Item do ScriptRules.Icons que este teste não lê: ${entry}`);
    return quoted[1];
  });
  return { icons, defaultIcon };
}

describe("o ícone e a cor do script (RN-SCRIPT-006)", () => {
  it("a lista fechada é a da API (ScriptRules.Icons, lida do código dela), na mesma ordem, com o documento de antes como padrão", () => {
    const api = apiScriptIcons();

    expect(api.icons).toEqual([...scriptIcons]);
    expect(api.defaultIcon).toBe(defaultScriptIcon);
    expect(defaultScriptIcon).toBe("document");
  });

  it("o ícone nulo é o padrão, e o que esta versão não conhece também", () => {
    expect(scriptIconOf({ icon: null })).toBe("document");
    expect(scriptIconOf({ icon: "foguete" })).toBe("document");
    for (const icon of scriptIcons) expect(scriptIconOf({ icon })).toBe(icon);
  });

  it("o PATCH do Editar script… leva o nome normalizado, o ícone e a cor; sem cor vai vazio, para a API tirar a que havia", () => {
    expect(editedScriptInput("s1", { name: "  Fechamento   mensal ", icon: "chart", color: "#F2B644" })).toEqual({ id: "s1", name: "Fechamento mensal", icon: "chart", color: "#F2B644" });
    expect(editedScriptInput("s1", { name: "Fechamento", icon: "document", color: null })).toEqual({ id: "s1", name: "Fechamento", icon: "document", color: "" });
  });

  it("sem mudança nenhuma (o nome como a API o grava, o ícone padrão como nulo, a cor sem a caixa) o diálogo fecha sem chamar a API", () => {
    const plain = { name: "Fechamento", icon: null, color: null };
    const colored = { name: "Fechamento", icon: "star", color: "#7DB2FF" };

    expect(appearanceChanged(plain, { name: " Fechamento ", icon: "document", color: null })).toBe(false);
    expect(appearanceChanged(colored, { name: "Fechamento", icon: "star", color: "#7db2ff" })).toBe(false);
    expect(appearanceChanged(plain, { name: "Fechamento 2", icon: "document", color: null })).toBe(true);
    expect(appearanceChanged(plain, { name: "Fechamento", icon: "bug", color: null })).toBe(true);
    expect(appearanceChanged(plain, { name: "Fechamento", icon: "document", color: "#FF8A7A" })).toBe(true);
    expect(appearanceChanged(colored, { name: "Fechamento", icon: "star", color: null })).toBe(true);
  });
});
