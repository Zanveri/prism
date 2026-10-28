import { z } from "zod";

/**
 * O que passa entre as janelas pelo processo principal (RN-ABAS-002 a 005), com o mesmo schema dos dois lados: o processo principal confere o que a
 * tela manda antes de repassar, e a tela que recebe confere de novo antes de usar (a ponte é a fronteira de confiança, RN-SHELL-001). Nenhuma janela
 * fala com outra: o processo principal é quem cria a janela e entrega a aba.
 *
 * As enumerações repetem as da tela (`result-layout.ts`, `structure-sections.ts`, `table-sql.ts`, `query.schema.ts`): este arquivo não importa nada de
 * `src/`. Quem as mantém juntas é o TypeScript, em `tab-transfer.ts` da área de trabalho: a leitura da passagem devolve os tipos da tela, e uma
 * enumeração que divergir não compila.
 */

const id = z.string().min(1).max(200);
const name = z.string().max(10_000);
const count = z.number().int().min(0);
/** O texto do editor que passa: 32 MB de texto é mais do que um editor aguenta. */
const maxSqlLength = 32 * 1024 * 1024;

/** RN-VAR-032: o tipo de um parâmetro. */
const parameterTypeSchema = z.enum(["text", "number", "boolean", "date", "timestamp"]);

/**
 * RN-VAR-033: o comando com variáveis, trocado pelos marcadores: o texto enviado, os parâmetros (com `variable` e `item`, que ficam na tela para o "SQL
 * enviado") e o mapa das posições entre o texto do editor e o enviado (RN-SQL-009). Um campo que o schema não conhecesse sumiria na passagem, e o resultado
 * perderia os valores. Os limites são os da RN-VAR-013: 10.000 parâmetros, 1.000.000 de caracteres por valor.
 */
const sentCommandSchema = z.object({
  sql: z.string().max(maxSqlLength),
  params: z.array(z.object({ type: parameterTypeSchema, value: z.string().max(1_000_000).nullable(), variable: z.string().max(200), item: count.nullable() })).max(10_000),
  replacements: z
    .array(
      z.object({
        name: z.string().max(200),
        kind: z.enum(["parameter", "list", "sql"]),
        start: count,
        end: count,
        sentStart: count,
        sentEnd: count,
        firstParameter: count,
        parameterCount: count,
        text: z.string().max(maxSqlLength).optional(),
      }),
    )
    .max(1_000_000),
});

/**
 * RN-GRADE-011: `filter` é o texto do campo de filtro do resultado, que viaja com o comando para "Executar de novo" o repetir na outra janela. RN-VAR-033: `sent`
 * leva o comando trocado pelos marcadores, para ele também repetir os mesmos valores (o texto do editor, o enviado, os parâmetros e o mapa, os quatro).
 */
const runTargetSchema = z.object({ sql: z.string().max(maxSqlLength), offset: count, engine: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), filter: z.string().max(maxSqlLength).optional(), sent: sentCommandSchema.optional() });

/**
 * RN-VAR-023: os valores da aba (as variáveis avaliadas) vão com ela para a outra janela, como dados puros (`wire.ts` da linguagem: cada valor e cada tipo é um
 * registro tagueado, e quem recebe os reconstrói pelos construtores da linguagem, que conferem a forma de novo). Aqui só se confere a forma e o tamanho.
 */
const wireDate = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]);
type WireValueShape =
  | { k: "number"; v: number; e?: string }
  | { k: "string"; v: string }
  | { k: "boolean"; v: boolean }
  | { k: "null" }
  | { k: "date"; f: z.infer<typeof wireDate>; p: "day" | "instant"; e?: string }
  | { k: "list"; i: WireValueShape[] }
  | { k: "object"; f: [string, WireValueShape][] }
  | { k: "sql"; t: string };
const wireValueSchema: z.ZodType<WireValueShape> = z.lazy(() =>
  z.discriminatedUnion("k", [
    z.object({ k: z.literal("number"), v: z.number().finite(), e: z.string().max(1000).optional() }),
    z.object({ k: z.literal("string"), v: z.string().max(1_000_000) }),
    z.object({ k: z.literal("boolean"), v: z.boolean() }),
    z.object({ k: z.literal("null") }),
    z.object({ k: z.literal("date"), f: wireDate, p: z.enum(["day", "instant"]), e: z.string().max(100).optional() }),
    z.object({ k: z.literal("list"), i: z.array(wireValueSchema).max(10_000) }),
    z.object({ k: z.literal("object"), f: z.array(z.tuple([z.string().max(1000), wireValueSchema])).max(100) }),
    z.object({ k: z.literal("sql"), t: z.string().max(10_000) }),
  ]),
);
type WireTypeShape = { t: "number" | "string" | "boolean" | "sql" | "null" | "never" } | { t: "date"; p?: "day" | "instant" } | { t: "list"; i: WireTypeShape } | { t: "object"; f: [string, WireTypeShape][] } | { t: "nullable"; o: WireTypeShape };
const wireTypeSchema: z.ZodType<WireTypeShape> = z.lazy(() =>
  z.discriminatedUnion("t", [
    z.object({ t: z.enum(["number", "string", "boolean", "sql", "null", "never"]) }),
    z.object({ t: z.literal("date"), p: z.enum(["day", "instant"]).optional() }),
    z.object({ t: z.literal("list"), i: wireTypeSchema }),
    z.object({ t: z.literal("object"), f: z.array(z.tuple([z.string().max(1000), wireTypeSchema])).max(100) }),
    z.object({ t: z.literal("nullable"), o: wireTypeSchema }),
  ]),
);
const storedValueSchema = z.object({
  name: z.string().min(1).max(200),
  value: wireValueSchema,
  type: wireTypeSchema,
  declared: wireTypeSchema,
  origin: z.enum(["literal", "expressão", "random", "consulta", "pergunta", "diálogo"]),
  at: z.number(),
  ms: z.number(),
  text: z.string().max(maxSqlLength),
  order: count,
  earlier: z.array(z.object({ text: z.string().max(maxSqlLength), order: count })).max(500).optional(),
});

const columnSchema = z.object({ name, type: name, kind: z.enum(["text", "number", "datetime", "boolean", "binary"]) });

/**
 * O resultado na tela (RN-ABAS-002): o da aba parada, que é a única que muda de janela. "Carregar mais" continua de onde parou, no cursor que a
 * sessão da aba tem aberto na API; nada é executado de novo.
 */
const resultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("rows"),
    id: count,
    target: runTargetSchema,
    columns: z.array(columnSchema),
    rows: z.array(z.array(z.string().nullable())),
    /** As células cortadas (RN-SQL-011): a linha e as colunas dela. */
    truncated: z.array(z.tuple([count, z.array(count)])),
    hasMore: z.boolean(),
    totalRows: count.nullable(),
    elapsedMs: z.number().min(0),
    pages: count,
    cursorClosed: z.boolean(),
    total: count.nullable(),
    resultId: id.nullable().optional(),
    readOnly: name.nullable().optional(),
    /** RN-GRADE-011: como o filtro do resultado entrou no comando. */
    filterApplied: z.enum(["merged", "wrapped"]).optional(),
    /** RN-EXPORT-002: o comando do resultado é só leitura e não gravou: o "Exportar…" vale na janela que recebe. */
    read: z.boolean().optional(),
    /** RN-EDIT-009: as colunas que o banco preencheu nas linhas novas que a aba de consulta salvou, como `truncated`. */
    generated: z.array(z.tuple([count, z.array(count)])).optional(),
    /** RN-SQL-017: a linha do resultado na API de cada linha da grade, depois de um Salvar que tirou linhas; nula na linha nova. */
    sourceRows: z.array(count.nullable()).optional(),
  }),
  z.object({ status: z.literal("affected"), rowsAffected: z.number().int(), elapsedMs: z.number().min(0) }),
  z.object({ status: z.literal("cancelled") }),
  z.object({ status: z.literal("notice"), message: name }),
  z.object({
    status: z.literal("error"),
    source: z.enum(["database", "connection", "api", "driver"]),
    title: name,
    message: z.string().max(1_000_000).nullable(),
    sqlState: name.nullable(),
    errorAt: count.nullable(),
    driverID: id.optional(),
    executed: z.literal(true).optional(),
  }),
]);

/** O que a tela da aba lembrava (`tab-memory.ts`), menos as alterações não salvas dos Registros: essas não mudam de janela. */
const memorySchema = z.object({
  layout: z.object({ mode: z.enum(["split", "collapsed", "maximized"]), resultPercent: z.number().min(0).max(100) }).optional(),
  diagram: z.object({ zoom: z.number().positive().max(100), left: z.number().finite(), top: z.number().finite() }).optional(),
  records: z.object({ draft: z.string().max(1_000_000), query: z.object({ where: z.string().max(1_000_000), sort: z.object({ column: name, direction: z.enum(["asc", "desc"]) }).nullable() }) }).optional(),
  structure: z.enum(["columns", "foreignKeys", "indexes", "ddl"]).optional(),
  grid: z.object({ key: z.string().max(1_000_000), widths: z.record(z.string().regex(/^\d{1,6}$/), z.number().positive().max(100_000)) }).optional(),
});

/** Uma aba como ela estava, para outra janela (RN-ABAS-002 e 003): o texto, o cursor do editor, o resultado e a sessão com o banco. */
export const tabTransferSchema = z.object({
  version: z.literal(1),
  tab: z.object({
    id: z.uuid(),
    title: z.string().min(1).max(10_000),
    /** Nula na aba de um script cuja conexão não existe mais (RN-SCRIPT-003). */
    connectionId: id.nullable(),
    database: z.string().min(1).max(10_000).optional(),
    /** A sessão da aba na API: é a mesma API, então ela continua aberta e passa a ser da janela que recebe. */
    sessionId: id.nullable(),
    sql: z.string().max(maxSqlLength),
    table: z.object({ schema: name, name, view: z.enum(["data", "structure", "diagram"]) }).optional(),
    schemaTarget: z.object({ schema: name, view: z.enum(["tables", "views", "routines", "diagram"]) }).optional(),
    databaseTarget: z.object({ name, view: z.enum(["schemas", "diagram", "properties"]) }).optional(),
    /** RN-ABAS-016: o lugar do resultado da aba de consulta vai com ela (a aba do resultado logo depois dela, na janela que a recebe). */
    resultPlace: z.enum(["panel", "tab", "window"]).optional(),
    /**
     * RN-SCRIPT-001: a aba é um script salvo. Vai o SQL como foi salvo e o lugar em que foi salvo: a conexão e o banco (sem ele, o da conexão), ou o genérico
     * (RN-SCRIPT-005); a mudança não salva, a janela que recebe a refaz pelo texto e pelo lugar da aba (RN-SCRIPT-003). E a pasta de scripts que a aba lembra
     * (RN-SCRIPT-010), sem ela quando não a sabe.
     */
    script: z
      .object({
        id: z.uuid(),
        name: z.string().min(1).max(200),
        savedSql: z.string().max(maxSqlLength),
        generic: z.literal(true).optional(),
        savedConnectionId: id.optional(),
        savedDatabase: z.string().min(1).max(10_000).optional(),
        folderId: z.uuid().optional(),
      })
      .optional(),
  }),
  /** A seleção do editor (o cursor é a seleção vazia), em posições do texto. */
  editor: z.object({ anchor: count, head: count }).nullable(),
  result: resultSchema.nullable(),
  /** RN-VAR-023: as variáveis avaliadas da aba e o contador de avaliações dela; a aba as leva para a outra janela. Nunca vão às abas que voltam na próxima entrada. */
  values: z.object({ counter: count, entries: z.array(storedValueSchema).max(500) }).optional(),
  memory: memorySchema,
  /**
   * RN-ABAS-016: a janela do resultado da aba não fechou a tempo (o processo principal não confirmou em 3 segundos), e a aba vai com o resultado no painel; a
   * janela que a recebe avisa que a janela do resultado não pôde ser reaberta.
   */
  resultWindowLost: z.boolean().optional(),
});

export type TabTransfer = z.infer<typeof tabTransferSchema>;

const windowId = z.number().int().positive();
/** Um ponto da tela inteira (onde a aba foi solta). */
const pointSchema = z.object({ x: z.number().int().min(-100_000).max(100_000), y: z.number().int().min(-100_000).max(100_000) });

/**
 * Para onde a aba vai: uma janela nova (com o canto de cima à esquerda no ponto onde ela foi solta, que o processo principal leu no fim do arraste,
 * `tabDragEndReplySchema`; sem ele, pelo menu, um pouco abaixo e à direita da de origem) ou outra janela aberta, numa posição da faixa.
 */
export const tabMoveTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new"), at: pointSchema.optional() }),
  z.object({ kind: z.literal("window"), windowId, index: count.optional() }),
]);

export type TabMoveTarget = z.infer<typeof tabMoveTargetSchema>;

/** A tela pede ao processo principal para levar uma aba dela. */
export const tabMoveRequestSchema = z.object({ target: tabMoveTargetSchema, transfer: tabTransferSchema });

export type TabMoveRequest = z.infer<typeof tabMoveRequestSchema>;

/**
 * A resposta: a aba saiu (a janela que a mandou a tira da faixa SEM fechar a sessão), ou não saiu e fica onde está. Se a aba solta caiu sobre outra janela
 * do Prism, quem decide é ela (RN-ABAS-010): isso o fim do arraste já respondeu (`tabDragEndReplySchema`), e a janela nova nem é pedida.
 */
export const tabMoveReplySchema = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), reason: z.enum(["invalid", "noWindow"]) })]);

export type TabMoveReply = z.infer<typeof tabMoveReplySchema>;

/**
 * RN-ABAS-010: o fim do arraste de uma aba, que a janela de origem conta ao processo principal no `dragend`. Quem decide é quem recebeu a soltura, e não o
 * `dropEffect`: `dropped` diz se o véu DESTA janela a recebeu (`veil`: longe da faixa, dentro da janela) ou se ninguém nela a recebeu (`none`: fora da
 * janela, sobre outra janela do Prism, o Esc, a barra de título). A soltura na própria faixa não chega aqui: é a ordem da faixa (RN-ABAS-001).
 * - `kind`: a aba de consulta ou de tabela (`tab`) ou a aba do resultado (`result`, RN-ABAS-012), que nenhuma outra janela recebe (não há a espera da
 *   outra janela).
 * - `effect`: o `dropEffect` do `dragend`, que só diz alguma coisa onde a sonda S-ABAS-1 provou que distingue o Esc da soltura (o Linux com o X11).
 * - `at`: o ponto do `dragend`, em pixels da tela, quando é número, e `inPage`: ele cai dentro da página desta janela. Os dois só valem onde o processo
 *   principal não lê o ponteiro (o Wayland): o ponto, para a janela nova; `inPage`, para o Esc e a soltura dentro da janela não abrirem nada.
 */
export const tabDragEndSchema = z.object({
  tabId: z.uuid(),
  kind: z.enum(["tab", "result"]),
  dropped: z.enum(["veil", "none"]),
  effect: z.enum(["none", "copy", "link", "move"]),
  at: pointSchema.nullable(),
  inPage: z.boolean(),
});

export type TabDragEnd = z.infer<typeof tabDragEndSchema>;

/**
 * A resposta: nada a fazer (a outra janela do Prism decide; o Esc; a soltura dentro da janela de origem que ninguém recebeu), ou a janela nova, com o canto
 * de cima à esquerda em `at` (o ponteiro lido pelo processo principal; `null` onde não há ponto que sirva, e a janela abre um pouco abaixo e à direita da
 * de origem). A janela de origem pede então a janela nova pelo caminho de sempre (`tabMoveRequestSchema`), com as perguntas de antes.
 */
export const tabDragEndReplySchema = z.discriminatedUnion("action", [z.object({ action: z.literal("none") }), z.object({ action: z.literal("newWindow"), at: pointSchema.nullable() })]);

export type TabDragEndReply = z.infer<typeof tabDragEndReplySchema>;

/** O processo principal entrega a aba à janela que a recebe, na posição pedida (sem ela, no fim). */
export const tabDeliverySchema = z.object({ transfer: tabTransferSchema, index: count.optional() });

export type TabDelivery = z.infer<typeof tabDeliverySchema>;

/** Uma aba foi solta na faixa de outra janela: a janela que a recebe pede ao processo principal que a janela de origem a mande. */
export const tabRequestSchema = z.object({ fromWindowId: windowId, tabId: z.uuid(), index: count });

export type TabRequest = z.infer<typeof tabRequestSchema>;

/** O pedido que o processo principal faz à janela de origem: mande esta aba para aquela janela, naquela posição. */
export const tabGiveSchema = z.object({ tabId: z.uuid(), target: z.object({ kind: z.literal("window"), windowId, index: count }) });

export type TabGive = z.infer<typeof tabGiveSchema>;

/** O resumo que cada janela dá de si, para "Mover para a janela…" (RN-ABAS-003) dizer qual é qual. */
export const windowSummarySchema = z.object({ activeTitle: z.string().max(10_000).nullable(), tabCount: count });

export type WindowSummary = z.infer<typeof windowSummarySchema>;

/** As outras janelas abertas, na ordem em que abriram: o número delas ("Janela 2") e o resumo. */
export const windowListSchema = z.array(z.object({ id: windowId, number: windowId, activeTitle: z.string().max(10_000).nullable(), tabCount: count }));

export type WindowEntry = z.infer<typeof windowListSchema>[number];

/**
 * A pessoa fechou a janela (RN-ABAS-004): `last`, ela é a única aberta, e fechá-la fecha o app (RN-ABAS-007: só pergunta pelo que não volta na próxima entrada).
 */
export const windowCloseRequestSchema = z.object({ last: z.boolean() });

export type WindowCloseRequest = z.infer<typeof windowCloseRequestSchema>;

/**
 * O que uma janela conta às outras sobre o cofre (RN-ABAS-004): a pessoa mexeu (ou há comando em andamento), bloqueou, desbloqueou, saiu ou entrou.
 * Só o tipo: nada de usuário, senha ou dado.
 */
export const peerEventSchema = z.object({ kind: z.enum(["activity", "lock", "unlock", "signOut", "signIn"]) });

export type PeerEvent = z.infer<typeof peerEventSchema>;

/**
 * RN-VERIF-002: a verificação periódica de uma conexão conectada em mais de uma janela sai de uma só por intervalo, e a resposta vai às outras. Antes de
 * chamar a API, a janela pede a vez ao processo principal, com o intervalo da conexão: ele a dá se nenhuma outra está verificando a mesma conexão e se a
 * última verificação dela, feita por outra janela, não acabou há menos que o intervalo. Só o id da conexão e o intervalo: nada de nome, endereço ou SQL.
 */
export const verificationClaimSchema = z.object({ connectionId: id, intervalMs: z.number().int().min(1_000).max(3_600_000) });

export type VerificationClaim = z.infer<typeof verificationClaimSchema>;

/**
 * A resposta da verificação como a API a deu (`POST api/user/connections/{id}/verification`): `status`, o instante, o tempo da consulta e, quando o banco não
 * respondeu, a mensagem dele como veio e o SQLSTATE. É o que as outras janelas com a conexão conectada mostram no indicador (RN-VERIF-003).
 */
export const verificationResultSchema = z.object({
  status: z.enum(["ok", "failed", "busy", "notConnected"]),
  checkedAt: z.string().min(1).max(100),
  elapsedMs: z.number().min(0).nullable(),
  message: z.string().max(1_000_000).nullable(),
  sqlState: z.string().max(100).nullable(),
});

/** A janela terminou a verificação que pediu: com a resposta, que vai às outras, ou sem ela (`null`: a chamada falhou, ou a conexão desconectou no meio). */
export const verificationDoneSchema = z.object({ connectionId: id, result: verificationResultSchema.nullable() });

export type VerificationDone = z.infer<typeof verificationDoneSchema>;

/** O que chega às outras janelas: a resposta da verificação de uma conexão, feita por outra janela. */
export const verificationPeerSchema = z.object({ connectionId: id, result: verificationResultSchema });

export type VerificationPeer = z.infer<typeof verificationPeerSchema>;
