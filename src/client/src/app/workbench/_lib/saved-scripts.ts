/**
 * O que a tela decide sobre os scripts salvos (seção 23 da especificação, RN-SCRIPT-001 a 005), sem tocar a página nem a API: as regras do nome (as
 * mesmas da API, para o diálogo dizer o problema antes de enviar; quem decide é a API), a sugestão de nome, o tamanho do SQL, a mudança não salva, onde
 * o script abre (e o genérico, seção 27), o ícone e a cor (seção 28) e o teclado da lista do navegador.
 */

export const maxScriptNameLength = 200;

/** RN-SCRIPT-004: 1 MB de SQL, em bytes de UTF-8 (1.048.576), a mesma conta da API (`ScriptRules.MaxSqlBytes`). */
export const maxScriptBytes = 1024 * 1024;

/**
 * O que a aba guarda do script dela: o id e o nome, o SQL como foi salvo, o lugar em que foi salvo e se o texto do editor, a conexão ou o banco da aba
 * mudaram desde então (RN-SCRIPT-003).
 *
 * O lugar: `generic` é o script genérico (RN-SCRIPT-005), que não guarda conexão nem banco, e cuja aba muda de conexão sem mudança não salva. Fora dele,
 * `savedConnectionId` é a conexão em que o script foi salvo e `savedDatabase` o banco (sem ele, o da conexão). Sem `savedConnectionId` e sem `generic`, o
 * script foi salvo numa conexão que não existe mais: a aba abriu sem conexão, e é contra "sem conexão" que a mudança se mede (dar uma conexão à aba é mudar
 * o lugar, e o Ctrl+S o grava).
 */
export type ScriptRef = { id: string; name: string; savedSql: string; generic?: true; savedConnectionId?: string; savedDatabase?: string; dirty: boolean };

/** O lugar salvo de um script, como a aba o guarda (`ScriptRef`): o genérico, ou a conexão e o banco. */
export type SavedPlace = Pick<ScriptRef, "generic" | "savedConnectionId" | "savedDatabase">;

/** Onde a aba roda: a conexão (nula na aba sem conexão) e o banco (sem ele, o da conexão). */
export type TabPlace = { connectionId: string | null; database?: string };

/** O lugar que o Ctrl+S grava (RN-SCRIPT-003): o da aba, ou nenhum, no script genérico (RN-SCRIPT-005). */
export function savedPlaceOfTab(tab: TabPlace, generic: boolean): SavedPlace {
  if (generic) return { generic: true };
  return { ...(tab.connectionId === null ? {} : { savedConnectionId: tab.connectionId }), ...(tab.database === undefined ? {} : { savedDatabase: tab.database }) };
}

/** O nome como a API o grava (`NormalizeName`): sem espaço nas pontas, sem espaço repetido no meio, na forma composta do Unicode. */
export function normalizeScriptName(name: string): string {
  return name.split(/\s+/u).filter(Boolean).join(" ").normalize("NFC");
}

/** Os caracteres de controle do C# (`char.IsControl`): U+0000 a U+001F e U+007F a U+009F, a tabulação e a quebra de linha entre eles. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

const sameName = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export type ScriptNameProblem = "empty" | "tooLong" | "control" | "taken";

/**
 * RN-SCRIPT-004: de 1 a 200 caracteres depois de normalizado, sem caractere de controle no que foi digitado (a tabulação não vira espaço) e único entre os
 * scripts do usuário, sem diferenciar maiúsculas. `ownId` é o script que está sendo renomeado: o nome dele não colide com ele mesmo.
 */
export function scriptNameProblem(name: string, scripts: readonly { id: string; name: string }[], ownId?: string): ScriptNameProblem | null {
  if (hasControlCharacter(name)) return "control";

  const normalized = normalizeScriptName(name);
  if (normalized.length === 0) return "empty";
  if (normalized.length > maxScriptNameLength) return "tooLong";
  return scripts.some((script) => script.id !== ownId && sameName(script.name, normalized)) ? "taken" : null;
}

/** RN-SCRIPT-001: a primeira vez sugere "Script 1", "Script 2"…: o primeiro número que nenhum script usa. */
export function suggestScriptName(scripts: readonly { name: string }[]): string {
  for (let number = 1; ; number++) {
    const name = `Script ${number}`;
    if (!scripts.some((script) => sameName(script.name, name))) return name;
  }
}

/** O "Salvar como" de um script: o nome dele com o primeiro número livre entre parênteses, cortando o nome para caber nos 200 caracteres. */
export function copyName(name: string, scripts: readonly { name: string }[]): string {
  for (let number = 2; ; number++) {
    const suffix = ` (${number})`;
    const candidate = `${name.slice(0, maxScriptNameLength - suffix.length).trimEnd()}${suffix}`;
    if (!scripts.some((script) => sameName(script.name, candidate))) return candidate;
  }
}

const encoder = new TextEncoder();

/** RN-SCRIPT-004: o SQL passa de 1 MB em bytes de UTF-8. A tela não envia o que a API recusaria. */
export function exceedsScriptLimit(sql: string): boolean {
  // Cada unidade UTF-16 vale no máximo 3 bytes: o texto curto não precisa ser codificado.
  if (sql.length * 3 <= maxScriptBytes) return false;
  return encoder.encode(sql).length > maxScriptBytes;
}

/** O lugar da aba não é o salvo (RN-SCRIPT-003): outra conexão (RN-ARVORE-008) ou outro banco (RN-ARVORE-007). No script genérico, nunca (RN-SCRIPT-005). */
export function placeChanged(script: SavedPlace, tab: TabPlace): boolean {
  if (script.generic === true) return false;
  return tab.connectionId !== (script.savedConnectionId ?? null) || tab.database !== script.savedDatabase;
}

/**
 * RN-SCRIPT-003: há mudança não salva quando o texto do editor não é o que foi salvo, ou quando a aba roda noutra conexão ou noutro banco que não os salvos
 * (o Ctrl+S grava a conexão e o banco da aba). No script genérico só o texto conta (RN-SCRIPT-005).
 */
export function isScriptDirty(script: Pick<ScriptRef, "savedSql"> & SavedPlace, sql: string, tab: TabPlace): boolean {
  return sql !== script.savedSql || placeChanged(script, tab);
}

/**
 * O texto da aba chegou do editor (com o atraso de sempre): a aba de um script recalcula o ponto pelo texto e pelo lugar dela. Uma tecla já o acendeu na hora;
 * desfazer até o texto salvo o apaga aqui, se a aba está na conexão e no banco salvos.
 */
export function withEditedSql<T extends TabPlace & { sql: string; script?: ScriptRef }>(tab: T, sql: string): T {
  if (tab.script === undefined) return { ...tab, sql };
  return { ...tab, sql, script: { ...tab.script, dirty: isScriptDirty(tab.script, sql, tab) } };
}

/**
 * A aba ganhou outro lugar salvo: o Ctrl+S gravou (RN-SCRIPT-001), ou o menu do script o tornou genérico ou o vinculou à conexão da aba (RN-SCRIPT-005). O
 * ponto é refeito pelo texto do editor deste instante (`sql`) e pelo lugar da aba.
 */
export function withSavedPlace<T extends TabPlace & { sql: string; script?: ScriptRef }>(tab: T, saved: SavedPlace, sql: string = tab.sql): T {
  if (tab.script === undefined) return tab;
  const rest: ScriptRef = { ...tab.script };
  delete rest.generic;
  delete rest.savedConnectionId;
  delete rest.savedDatabase;
  const script: ScriptRef = { ...rest, ...saved };
  return { ...tab, script: { ...script, dirty: isScriptDirty(script, sql, tab) } };
}

/** As abas, entre as que vão fechar, que são scripts com mudança não salva: as que fazem a pergunta "Salvar?". Na ordem da faixa. */
export function scriptsToAsk<T extends { id: string; script?: ScriptRef }>(closing: readonly string[], tabs: readonly T[]): T[] {
  const ids = new Set(closing);
  return tabs.filter((tab) => ids.has(tab.id) && tab.script?.dirty === true);
}

/** Onde a aba de um script abre (`connectionId` e `database`), se a conexão dele sumiu (`missing`, a tela avisa) e o lugar salvo que a aba guarda (`saved`). */
export type ScriptPlace = { connectionId: string | null; database: string | undefined; missing: boolean; saved: SavedPlace };

/**
 * RN-SCRIPT-003: o script abre na conexão e no banco em que foi salvo. Se a conexão não existe mais (`missing`), a aba abre sem conexão e pede uma. Com a
 * lista de conexões ainda sem chegar (`null`), não se sabe o que sumiu: abre na dele.
 *
 * RN-SCRIPT-005: o script sem conexão é genérico. Com exatamente uma conexão conectada (`connected`), a aba abre nela; com mais de uma, ou nenhuma, abre sem
 * conexão, e a faixa pergunta. Nada executa: a aba só ganha o lugar.
 */
export function scriptPlace(script: { connectionID: string | null; database: string | null }, connections: ReadonlySet<string> | null, connected: readonly string[] = []): ScriptPlace {
  if (script.connectionID === null) return { connectionId: connected.length === 1 ? connected[0] : null, database: undefined, missing: false, saved: { generic: true } };
  if (connections !== null && !connections.has(script.connectionID)) return { connectionId: null, database: undefined, missing: true, saved: {} };

  const database = script.database ?? undefined;
  return { connectionId: script.connectionID, database, missing: false, saved: { savedConnectionId: script.connectionID, ...(database === undefined ? {} : { savedDatabase: database }) } };
}

/** As setas da lista de scripts do navegador, sem dar a volta, e Home e End. `null`: a tecla não é da lista. */
export function scriptKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(index + 1, count - 1);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** RN-SCRIPT-001: Ctrl+S salva e Ctrl+Shift+S é o "Salvar como" (o Cmd do macOS vale o Ctrl, como no Ctrl+W). `null`: não é o atalho. */
export function saveShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): "save" | "saveAs" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "s") return null;
  return event.shiftKey ? "saveAs" : "save";
}

/**
 * A recusa da API ao salvar ou renomear, como o problema que o campo do nome mostra. O nome inválido diz o problema que a conferência da tela acha no nome
 * enviado; se ela não achar nenhum (as duas regras divergiram), o campo diz o mais geral, o do nome vazio. `null`: não é recusa de nome nem de tamanho.
 */
export function refusalProblem(code: string, name: string): ScriptNameProblem | "tooLarge" | null {
  if (code === "SCRIPT_ALREADY_EXISTS") return "taken";
  if (code === "SCRIPT_TOO_LARGE") return "tooLarge";
  if (code === "SCRIPT_NAME_INVALID") return scriptNameProblem(name, []) ?? "empty";
  return null;
}

export type ScriptAction = "open" | "rename" | "edit" | "copySql" | "makeGeneric" | "bind" | "delete";

/**
 * RN-SCRIPT-003: o menu de um script na seção "Scripts", em grupos (entre dois grupos, um separador). Quem dá o rótulo e executa é a seção. RN-SCRIPT-005: o
 * script com conexão oferece "Tornar genérico"; o genérico, "Vincular à conexão da aba", que só vale com o script aberto numa aba que tenha conexão (`bindable`):
 * sem ela, o item fica apagado e diz por quê. RN-SCRIPT-006: "Editar script…", logo depois do "Renomear", muda o nome, o ícone e a cor.
 */
export function scriptMenu(script: { generic: boolean; bindable: boolean }): { action: ScriptAction; disabled?: true }[][] {
  const place = script.generic ? { action: "bind" as const, ...(script.bindable ? {} : { disabled: true as const }) } : { action: "makeGeneric" as const };
  return [[{ action: "open" }], [{ action: "rename" }, { action: "edit" }, { action: "copySql" }, place], [{ action: "delete" }]];
}

/**
 * RN-SCRIPT-006: a lista fechada dos ícones de um script, no traço dos ícones do app, na ordem em que o diálogo os mostra. É a mesma da API
 * (`ScriptRules.Icons`): o `saved-scripts.test.ts` lê o `ScriptRules.cs` e confere a lista e a ordem, então ícone novo entra nas duas. O primeiro é o padrão,
 * o documento de antes.
 */
export const scriptIcons = ["document", "code", "database", "table", "chart", "clock", "lightning", "bug", "wrench", "star", "flag"] as const;

export type ScriptIcon = (typeof scriptIcons)[number];

export const defaultScriptIcon: ScriptIcon = "document";

const isScriptIcon = (icon: string): icon is ScriptIcon => (scriptIcons as readonly string[]).includes(icon);

/** O ícone que o script mostra: o gravado (nulo é o padrão) ou, se esta versão da tela não o conhece, o padrão, em vez de nenhum. */
export function scriptIconOf(script: { icon: string | null }): ScriptIcon {
  return script.icon !== null && isScriptIcon(script.icon) ? script.icon : defaultScriptIcon;
}

/** O que o "Editar script…" (RN-SCRIPT-006) pergunta: o nome, o ícone e a cor (nula é sem cor). */
export type ScriptAppearance = { name: string; icon: ScriptIcon; color: string | null };

/**
 * O corpo do `PATCH` do "Editar script…": o nome normalizado, o ícone e a cor. O `PATCH` é parcial e o nulo fica, então "sem cor" vai como o texto vazio,
 * que a API grava como nulo; o ícone padrão vai como `document`, que a API também grava como nulo. O SQL e o lugar não vão: ficam como estão.
 */
export function editedScriptInput(id: string, edited: ScriptAppearance): { id: string; name: string; icon: ScriptIcon; color: string } {
  return { id, name: normalizeScriptName(edited.name), icon: edited.icon, color: edited.color ?? "" };
}

/** O "Editar script…" sem mudança nenhuma (o nome como a API o gravaria, o ícone e a cor sem diferenciar a caixa) não chama a API. */
export function appearanceChanged(script: { name: string; icon: string | null; color: string | null }, edited: ScriptAppearance): boolean {
  return normalizeScriptName(edited.name) !== script.name || edited.icon !== scriptIconOf(script) || (edited.color?.toUpperCase() ?? null) !== (script.color?.toUpperCase() ?? null);
}

/** As teclas da linha de um script: Enter abre, F2 renomeia, Delete exclui (com a confirmação), Shift+F10 e a tecla de menu abrem o menu. */
export function scriptRowKey(event: { key: string; shiftKey: boolean }): ScriptAction | "menu" | null {
  if (event.key === "Enter") return "open";
  if (event.key === "F2") return "rename";
  if (event.key === "Delete") return "delete";
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) return "menu";
  return null;
}
