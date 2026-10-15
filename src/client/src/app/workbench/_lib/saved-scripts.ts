/**
 * O que a tela decide sobre os scripts salvos (seção 23 da especificação, RN-SCRIPT-001 a 004), sem tocar a página nem a API: as regras do nome (as
 * mesmas da API, para o diálogo dizer o problema antes de enviar; quem decide é a API), a sugestão de nome, o tamanho do SQL, a mudança não salva, onde
 * o script abre e o teclado da lista do navegador.
 */

export const maxScriptNameLength = 200;

/** RN-SCRIPT-004: 1 MB de SQL, em bytes de UTF-8 (1.048.576), a mesma conta da API (`ScriptRules.MaxSqlBytes`). */
export const maxScriptBytes = 1024 * 1024;

/**
 * O que a aba guarda do script dela: o id e o nome, o SQL como foi salvo, o banco em que foi salvo (`savedDatabase`; sem ele, o da conexão) e se o texto do
 * editor ou o banco da aba mudaram desde então.
 */
export type ScriptRef = { id: string; name: string; savedSql: string; savedDatabase?: string; dirty: boolean };

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

/**
 * RN-SCRIPT-001: há mudança não salva quando o texto do editor não é o que foi salvo, ou quando a aba roda noutro banco que não o salvo (RN-ARVORE-007: o Ctrl+S
 * grava o banco da aba). `database` é o banco da aba; sem ele, o da conexão.
 */
export function isScriptDirty(script: Pick<ScriptRef, "savedSql" | "savedDatabase">, sql: string, database?: string): boolean {
  return sql !== script.savedSql || database !== script.savedDatabase;
}

/**
 * O texto da aba chegou do editor (com o atraso de sempre): a aba de um script recalcula o ponto pelo texto e pelo banco dela. Uma tecla já o acendeu na hora;
 * desfazer até o texto salvo o apaga aqui, se a aba está no banco salvo.
 */
export function withEditedSql<T extends { sql: string; database?: string; script?: ScriptRef }>(tab: T, sql: string): T {
  if (tab.script === undefined) return { ...tab, sql };
  return { ...tab, sql, script: { ...tab.script, dirty: isScriptDirty(tab.script, sql, tab.database) } };
}

/** As abas, entre as que vão fechar, que são scripts com mudança não salva: as que fazem a pergunta "Salvar?". Na ordem da faixa. */
export function scriptsToAsk<T extends { id: string; script?: ScriptRef }>(closing: readonly string[], tabs: readonly T[]): T[] {
  const ids = new Set(closing);
  return tabs.filter((tab) => ids.has(tab.id) && tab.script?.dirty === true);
}

/**
 * RN-SCRIPT-003: o script abre na conexão e no banco em que foi salvo. Se a conexão não existe mais (`missing`), a aba abre sem conexão e pede uma; o script
 * que nunca teve conexão também abre sem, mas não "perdeu" nada. Com a lista de conexões ainda sem chegar (`null`), não se sabe o que sumiu: abre na dele.
 */
export function scriptPlace(script: { connectionID: string | null; database: string | null }, connections: ReadonlySet<string> | null): { connectionId: string | null; database: string | undefined; missing: boolean } {
  if (script.connectionID === null) return { connectionId: null, database: undefined, missing: false };
  if (connections !== null && !connections.has(script.connectionID)) return { connectionId: null, database: undefined, missing: true };
  return { connectionId: script.connectionID, database: script.database ?? undefined, missing: false };
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

export type ScriptAction = "open" | "rename" | "copySql" | "delete";

/** RN-SCRIPT-003: o menu de um script na seção "Scripts", em grupos (entre dois grupos, um separador). Quem dá o rótulo e executa é a seção. */
export function scriptMenu(): { action: ScriptAction }[][] {
  return [[{ action: "open" }], [{ action: "rename" }, { action: "copySql" }], [{ action: "delete" }]];
}

/** As teclas da linha de um script: Enter abre, F2 renomeia, Delete exclui (com a confirmação), Shift+F10 e a tecla de menu abrem o menu. */
export function scriptRowKey(event: { key: string; shiftKey: boolean }): ScriptAction | "menu" | null {
  if (event.key === "Enter") return "open";
  if (event.key === "F2") return "rename";
  if (event.key === "Delete") return "delete";
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) return "menu";
  return null;
}
