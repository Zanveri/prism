import { autocompletion, type Completion, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { keywordCompletionSource, schemaCompletionSource, type SQLDialect, type SQLNamespace } from "@codemirror/lang-sql";
import { EditorState, type Extension } from "@codemirror/state";
import type { QueryClient } from "@tanstack/react-query";

import type { Engine } from "@/components/ui";

import { databaseOfKey } from "./database-sessions.service";
import type { NavNode } from "./navigator-model";
import { levelPathOf, type CachedLevel } from "./navigator-search";
import { completionCopy as copy } from "./sql-completion.copy";
import { uppercaseWords } from "./sql-keyword-case";
import { quoteIdentifier } from "./table-sql";

const postgres: Engine = 1;
const db2: Engine = 2;

/** O nome simples que o PostgreSQL e o Informix leem como está escrito, porque dobram o nome sem aspas para minúsculas: letras, números, `_` e o cifrão, sem começar por número. */
const simpleLower = /^[a-z_][a-z0-9_$]*$/;
/** O mesmo para o Db2, que dobra o nome sem aspas para MAIÚSCULAS: `CLIENTES` cru acha a tabela CLIENTES, e `clientes` cru acharia outra. */
const simpleUpper = /^[A-Z_][A-Z0-9_$]*$/;

/**
 * As palavras reservadas, em minúsculas: as da conversão para maiúsculas (`uppercaseWords`) mais as reservadas do PostgreSQL que ela não tem de propósito (nome
 * comum de coluna fica fora dela), `user` à frente, que o servidor lê como função e não como nome. Com as duas, estão aqui TODAS as que o PostgreSQL reserva: as
 * "reservadas" e as "reservadas, podem ser função ou tipo" da tabela "SQL Key Words" da documentação (o teste as confere contra o que um PostgreSQL 18 devolve em
 * `pg_get_keywords()`). Uma lista fixa e a mesma nos três bancos: a palavra que só o Db2 ou o Informix reservam e que não está aqui vai como está, e o servidor
 * responde com a mensagem dele.
 */
const reservedWords: ReadonlySet<string> = new Set([
  ...uppercaseWords,
  // reservadas
  ..."analyse array asymmetric both collate current_catalog current_role deferrable do initially leading localtime localtimestamp placing session_user symmetric system_user trailing user variadic window".split(" "),
  // reservadas, podem ser função ou tipo: `select verbose from t` não é um nome de coluna para o servidor
  ..."authorization binary collation concurrently current_schema freeze isnull notnull overlaps similar tablesample verbose".split(" "),
]);

/** A palavra que o servidor não lê como nome sem aspas (`select`, `user`, `order`): a lista é a de `reservedWords`. */
export function isReservedWord(word: string): boolean {
  return reservedWords.has(word.toLowerCase());
}

/**
 * O nome como vai ao SQL (RN-TABELA-002): cru só quando o banco o lê como está escrito, e por `quoteIdentifier`, a função que o resto do app já usa, em todo outro
 * caso. O PostgreSQL e o Informix dobram o nome sem aspas para minúsculas, então vai cru o nome simples em minúsculas; o Db2 dobra para MAIÚSCULAS, então vai cru o
 * simples em maiúsculas. Em qualquer dos três, a palavra reservada entra entre aspas (`user`, `order` e `select` não são nomes para o servidor), e o nome comum que o
 * dialeto só marca como palavra-chave (`id`, `name`, `type`, `count`, `public`) vai como está.
 *
 * O Informix não é exceção: o driver abre a sessão com identificadores delimitados (sonda de 2026-10-09), então as aspas duplas são identificador, `Clientes` cru viraria
 * `clientes`, e um nome com `;` ou `--` cru viraria outro comando ou um comentário que engole o resto. Fora das duas formas simples o nome sempre passa por
 * `quoteIdentifier`, e é isso que o impede de mudar o comando.
 */
export function sqlName(name: string, engine: Engine | undefined): string {
  const simple = engine === db2 ? simpleUpper : simpleLower;
  return simple.test(name) && !reservedWords.has(name.toLowerCase()) ? name : quoteIdentifier(name);
}

/**
 * O que a árvore já carregou de um banco da conexão (esquemas, tabelas, visões, colunas): só lê o cache, e só o que já chegou. É a regra de "nunca
 * dispara consulta ao banco": `getQueriesData` não busca nada, e o que ainda não foi aberto na árvore simplesmente não existe aqui. `database` é o
 * outro banco do servidor da aba (RN-ARVORE-006): cada banco completa com os nomes dele, e a lista dos bancos não é nome de nada.
 */
export function cachedLevels(queryClient: QueryClient, connectionId: string, database?: string): CachedLevel[] {
  return queryClient
    .getQueriesData<NavNode[]>({ queryKey: ["tree", connectionId], predicate: (query) => databaseOfKey(query.queryKey) === database && levelPathOf(query.queryKey)?.type !== "connection" })
    .flatMap(([key, nodes]) => (nodes === undefined ? [] : [{ key, nodes }]));
}

type Item = { name: string; view: boolean };

const tableKey = (schema: string, table: string) => JSON.stringify([schema, table]);

/** O `lang-sql` abre um nível a cada ponto do nome: o ponto que faz parte do nome leva a barra. */
const escapeDots = (name: string) => name.replaceAll(".", "\\.");

/**
 * A estrutura que o `lang-sql` completa (`esquema.tabela.coluna`) a partir dos níveis da árvore: cada esquema com as tabelas e visões dele, e
 * cada tabela com as colunas que já foram carregadas. Rotinas e índices não entram. Além disso, as tabelas e visões de TODOS os esquemas
 * carregados entram também no nível de cima, para `from cli` achar `clientes` sem o esquema: o nome do esquema padrão (`public`, no
 * PostgreSQL) entra como está, e o de qualquer outro entra com o esquema na frente (`erp.produtos`), que vale em qualquer banco. Se o mesmo nome
 * está em dois esquemas, vale o primeiro (o padrão, e depois a ordem da árvore).
 */
export function completionNamespace(levels: readonly CachedLevel[], engine: Engine | undefined): SQLNamespace {
  const written = (name: string) => sqlName(name, engine);
  const schemas: string[] = [];
  const known = new Set<string>();
  const see = (schema: string) => {
    if (known.has(schema)) return;
    known.add(schema);
    schemas.push(schema);
  };
  const objects = new Map<string, Item[]>();
  const columns = new Map<string, Completion[]>();

  // A lista de esquemas primeiro: ela traz a ordem da árvore (os comuns antes dos de sistema).
  for (const { key, nodes } of levels) if (levelPathOf(key)?.type === "database") for (const node of nodes) if (node.kind === "schema") see(node.label);

  for (const { key, nodes } of levels) {
    const path = levelPathOf(key);
    if (path?.type === "objects" && path.objects !== "routines") {
      see(path.schema);
      objects.set(path.schema, [...(objects.get(path.schema) ?? []), ...nodes.map((node) => ({ name: node.label, view: path.objects === "views" }))]);
    }
    if (path?.type === "tableLevel" && path.level === "columns") {
      columns.set(tableKey(path.schema, path.table), nodes.filter((node) => node.kind === "column").map((node) => named({ label: node.label, type: "property", ...(node.detail === undefined ? {} : { detail: node.detail }) }, written(node.label))));
    }
  }

  const defaultSchema = engine === postgres && known.has("public") ? "public" : null;
  const kind = (item: Item) => (item.view ? copy.view : copy.table);
  const table = (schema: string, item: Item, completion: Completion): SQLNamespace => ({ self: completion, children: columns.get(tableKey(schema, item.name)) ?? [] });
  const nested = (schema: string, item: Item) => table(schema, item, named({ label: item.name, type: item.view ? "interface" : "class", detail: kind(item) }, written(item.name)));
  const topLevel = (schema: string, item: Item) => {
    const prefix = schema === defaultSchema ? "" : `${written(schema)}.`;
    return table(schema, item, named({ label: item.name, type: item.view ? "interface" : "class", detail: copy.inSchema(schema, kind(item)) }, prefix + written(item.name), prefix));
  };

  const namespace = new Map<string, SQLNamespace>();
  for (const schema of schemas) {
    const children = Object.fromEntries((objects.get(schema) ?? []).map((item) => [escapeDots(item.name), nested(schema, item)]));
    namespace.set(escapeDots(schema), { self: named({ label: schema, type: "namespace", detail: copy.schema }, written(schema)), children });
  }

  const order = defaultSchema === null ? schemas : [defaultSchema, ...schemas.filter((schema) => schema !== defaultSchema)];
  for (const schema of order) {
    for (const item of objects.get(schema) ?? []) {
      const key = escapeDots(item.name);
      if (!namespace.has(key)) namespace.set(key, topLevel(schema, item));
    }
  }

  return Object.fromEntries(namespace);
}

/**
 * A sugestão de um nome do catálogo. `raw` é o nome como o catálogo o devolve (o rótulo) e `prefix`, o que vai antes dele no texto (o esquema, no nível de
 * cima); ficam na sugestão para a pessoa que já abriu as aspas receber a mesma coisa bem escrita (`namesSource`).
 */
type NameCompletion = Completion & { raw: string; prefix: string };

/** A sugestão de um nome, com o que ela insere (`apply`) quando é outra coisa que o nome dela: o nome entre aspas, ou com o esquema na frente. */
function named(completion: Completion, apply: string, prefix = ""): NameCompletion {
  return { ...(apply === completion.label ? completion : { ...completion, apply }), raw: completion.label, prefix };
}

const sameLevels = (a: readonly CachedLevel[], b: readonly CachedLevel[]) => a.length === b.length && a.every((level, index) => level.key === b[index].key && level.nodes === b[index].nodes);

/**
 * Os nomes da árvore, na hora de pedir a sugestão: lê o cache a cada pedido (o usuário abre nós da árvore enquanto escreve) e só refaz a
 * estrutura quando algum nível mudou. O TanStack guarda a MESMA lista enquanto o dado não muda, então comparar as listas por identidade basta.
 */
export function namesSource(read: () => readonly CachedLevel[], dialect: SQLDialect, engine: Engine | undefined): CompletionSource {
  let built: { levels: readonly CachedLevel[]; source: CompletionSource } | null = null;

  return (context) => {
    const levels = read();
    if (built === null || !sameLevels(built.levels, levels)) built = { levels, source: schemaCompletionSource({ dialect, schema: completionNamespace(levels, engine) }) };

    // A fonte do `lang-sql` é síncrona.
    const result = built.source(context) as CompletionResult | null;
    if (result === null || context.state.sliceDoc(result.from, result.from + 1) !== '"') return result;

    // A pessoa já abriu as aspas: a biblioteca troca o rótulo por `"` + nome + `"` sem dobrar a aspa de dentro (`a"b` viraria `"a"b"`, e um nome com `;`
    // sairia do nome) e deixa de lado o esquema do nível de cima. Cada sugestão volta a ser o nome como `quoteIdentifier` o escreve, com o esquema na frente.
    return { ...result, options: result.options.map(requoted) };
  };
}

function requoted(option: Completion): Completion {
  const { raw, prefix } = option as Partial<NameCompletion>;
  if (raw === undefined || prefix === undefined) return option;

  const label = quoteIdentifier(raw);
  return { ...option, label, apply: prefix === "" ? undefined : prefix + label };
}

type SqlCompletionOptions = {
  dialect: SQLDialect;
  engine: Engine | undefined;
  /** Os níveis da árvore da conexão da aba, lidos a cada pedido. */
  levels: () => readonly CachedLevel[];
};

/** A palavra em que o cursor está: letras (com acento ou não), números, `_` e `$`. Vazia logo depois de um ponto ou de um espaço. */
const wordBeforeCursor = /[\p{L}\p{N}_$]*/u;

/**
 * As palavras-chave do dialeto, menos depois de um ponto (E3). Depois de `tabela.`, `apelido.` ou `esquema.` só valem os nomes daquele objeto, e esses são da
 * fonte de nomes: a do `lang-sql` só se cala com o cursor encostado no ponto, e bastava uma letra (`pedidos.i`) para a lista misturar as colunas com `if`,
 * `ignore`, `identity`… e repetir `id`, que o dialeto do PostgreSQL também conta como palavra-chave. O ponto que conta é o que encosta na palavra em que o cursor
 * está: em `tabela.coluna f` a palavra seguinte volta a ter palavras-chave.
 */
function keywordsSource(dialect: SQLDialect): CompletionSource {
  const keywords = keywordCompletionSource(dialect);

  return (context) => {
    const start = context.matchBefore(wordBeforeCursor)?.from ?? context.pos;
    return start > 0 && context.state.sliceDoc(start - 1, start) === "." ? null : keywords(context);
  };
}

/**
 * Autocompletar ao digitar (RN-CONFIG-004): palavras-chave do banco da aba e os nomes que a árvore já carregou, nada mais. Nenhuma tecla muda
 * de significado: a lista abre sem nada escolhido (`selectOnOpen: false`), então Enter continua pulando linha e Tab, recuando, até a
 * pessoa descer com as setas até uma sugestão; Esc fecha a lista, e Ctrl+Espaço a abre. Sem ícones: o texto da sugestão (esquema, tabela, tipo
 * da coluna) já diz o que é, e o leitor de tela o lê.
 */
export function sqlCompletion({ dialect, engine, levels }: SqlCompletionOptions): Extension {
  return [
    autocompletion({
      // As palavras-chave do dialeto da aba (`lang-sql`, por baixo dos nomes: `boost` negativo; nenhuma depois de um ponto) e os nomes da árvore. Aceitar `select`
      // escreve em minúsculas; com a conversão para maiúsculas ligada, a palavra vira `SELECT` quando a pessoa digita o que vem depois (`sql-keyword-case.ts`).
      override: [keywordsSource(dialect), namesSource(levels, dialect, engine)],
      selectOnOpen: false,
      // Só o que começa com o que foi digitado: a busca aproximada traria `var_pop` e `snapshot` para `apo`, e ruído demais para quem sabe o que escreve.
      filterStrict: true,
      icons: false,
      optionClass: (completion) => (completion.type === "keyword" || completion.type === "type" ? "cm-completion-keyword" : ""),
      // O espaço entre o nome e o que vem ao lado (o tipo da coluna, o esquema): a margem só separa o desenho, e o leitor de tela leria `idbigint`.
      addToOptions: [{ position: 79, render: (completion) => (completion.detail === undefined ? null : document.createTextNode(" ")) }],
    }),
    EditorState.phrases.of({ Completions: copy.listLabel }),
  ];
}
