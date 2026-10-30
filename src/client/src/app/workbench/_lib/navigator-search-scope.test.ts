import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { databaseSessionKey, objectNamesKey, treeKey } from "./database-sessions.service";
import type { ObjectNames } from "./database-sessions.schema";
import { navKey } from "./navigator-model";
import type { CachedNames } from "./navigator-search";
import { cachedTreeSessions, indexesInScope, nothingFoundShown, searchScope, searchStatusOf, type IndexReport, type ScopeConnection, type SearchDatabase, type TreeSession } from "./navigator-search-scope";

const conn = (id: string, name: string, extra: Partial<ScopeConnection> = {}): ScopeConnection => ({ id, name, database: "erp", userName: "prism", hasPassword: true, ...extra });
const dev = conn("c1", "Dev");
const hml = conn("c2", "Hml");
const prod = conn("c3", "Prod");
const base = (connectionId: string, databaseName = "erp"): TreeSession => ({ connectionId, databaseName });
const other = (connectionId: string, database: string): TreeSession => ({ connectionId, database, databaseName: database });
const ids = (...values: string[]) => new Set(values);
const none = new Set<string>();

const names = (scope: ReturnType<typeof searchScope>) => scope.databases.map((database) => database.name);

describe("searchScope: os bancos de que a busca pede o índice (RN-BUSCA-002)", () => {
  it("o banco de cada conexão conectada, com o nome que a sessão dá, na ordem das conexões à vista", () => {
    const scope = searchScope({ connections: [prod, dev, hml], connected: ids("c1", "c2", "c3"), connecting: none, sessions: [base("c1", "loja_dev"), base("c2", "loja_hml"), base("c3", "loja_prod")] });

    expect(names(scope)).toEqual(["Prod › loja_prod", "Dev › loja_dev", "Hml › loja_hml"]);
    expect(scope.databases[0]).toEqual({ key: navKey({ type: "database", connectionId: "c3" }), connectionId: "c3", name: "Prod › loja_prod" });
    expect(scope.openable).toEqual([]);
    expect(scope.withoutCredentials).toEqual([]);
    expect(scope.connecting).toEqual([]);
  });

  it("a conexão conectada só por uma aba (sem sessão da árvore) entra com o banco que a conexão guarda: a busca abre a sessão, sem abrir o nó", () => {
    const scope = searchScope({ connections: [conn("c1", "Dev", { database: "loja_dev" })], connected: ids("c1"), connecting: none, sessions: [] });

    expect(names(scope)).toEqual(["Dev › loja_dev"]);
    expect(scope.databases[0].database).toBeUndefined();
  });

  it("cada outro banco do servidor que já tem sessão da árvore entra, depois do da conexão e por nome; o que ninguém abriu não entra", () => {
    const scope = searchScope({ connections: [dev], connected: ids("c1"), connecting: none, sessions: [other("c1", "zeta"), base("c1"), other("c1", "arquivo")] });

    expect(names(scope)).toEqual(["Dev › erp", "Dev › arquivo", "Dev › zeta"]);
    expect(scope.databases.map((database) => database.database)).toEqual([undefined, "arquivo", "zeta"]);
    expect(scope.databases.map((database) => database.key)).toEqual([navKey({ type: "database", connectionId: "c1" }), navKey({ type: "database", connectionId: "c1", database: "arquivo" }), navKey({ type: "database", connectionId: "c1", database: "zeta" })]);
  });

  it("a conexão que o filtro escondeu (fora da lista) não entra, mesmo conectada e com sessão", () => {
    const scope = searchScope({ connections: [dev], connected: ids("c1", "c2"), connecting: none, sessions: [base("c1"), base("c2")] });

    expect(names(scope)).toEqual(["Dev › erp"]);
    expect(scope.openable).toEqual([]);
  });

  it("a conexão que não está conectada fica de fora, com as sessões que o cache ainda guardar dela; as com usuário e senha gravados o botão abre", () => {
    const scope = searchScope({ connections: [dev, hml], connected: ids("c1"), connecting: none, sessions: [base("c1"), base("c2"), other("c2", "arquivo")] });

    expect(names(scope)).toEqual(["Dev › erp"]);
    expect(scope.openable).toEqual([hml]);
  });

  it.each([
    ["sem usuário", { userName: "" }],
    ["sem senha gravada", { hasPassword: false }],
    ["sem usuário nem senha", { userName: "", hasPassword: false }],
  ])("a de fora %s o botão pula (abri-la chamaria o 'Editar conexão'), e a conta a separa", (_name, missing) => {
    const lacking = conn("c9", "Sem credencial", missing);
    const scope = searchScope({ connections: [dev, lacking, hml], connected: ids("c1"), connecting: none, sessions: [base("c1")] });

    expect(scope.openable).toEqual([hml]);
    expect(scope.withoutCredentials).toEqual([lacking]);
  });

  it("a conexão que está conectando agora não é de fora: conta à parte e entra quando a sessão abrir", () => {
    const scope = searchScope({ connections: [dev, hml, prod], connected: ids("c1"), connecting: ids("c2"), sessions: [base("c1")] });

    expect(scope.connecting).toEqual([hml]);
    expect(scope.openable).toEqual([prod]);
    expect(names(scope)).toEqual(["Dev › erp"]);
  });

  it("conectada vale mais que conectando (a conexão de uma aba que a busca abre na árvore)", () => {
    const scope = searchScope({ connections: [dev], connected: ids("c1"), connecting: ids("c1"), sessions: [] });

    expect(names(scope)).toEqual(["Dev › erp"]);
    expect(scope.connecting).toEqual([]);
  });

  it("a conexão conectada só por uma aba, sem sessão da árvore e sem usuário ou senha gravados, fica sem índice: abrir a sessão chamaria o 'Editar conexão'", () => {
    const lacking = conn("c9", "Sem senha", { hasPassword: false });

    expect(searchScope({ connections: [lacking], connected: ids("c9"), connecting: none, sessions: [] })).toEqual({ databases: [], openable: [], withoutCredentials: [], connecting: [] });
    // Com a sessão da árvore já aberta, não há o que abrir: entra.
    expect(names(searchScope({ connections: [lacking], connected: ids("c9"), connecting: none, sessions: [base("c9", "loja")] }))).toEqual(["Sem senha › loja"]);
  });

  it("três conexões com as mesmas tabelas dão três bancos, cada um com a chave da sua conexão", () => {
    const scope = searchScope({ connections: [dev, hml, prod], connected: ids("c1", "c2", "c3"), connecting: none, sessions: [base("c1"), base("c2"), base("c3")] });

    expect(new Set(scope.databases.map((database) => database.key)).size).toBe(3);
  });

  it("sem conexão, ou sem nenhuma conectada, o escopo é vazio e as de fora são todas", () => {
    expect(searchScope({ connections: [], connected: none, connecting: none, sessions: [] })).toEqual({ databases: [], openable: [], withoutCredentials: [], connecting: [] });
    expect(searchScope({ connections: [dev, hml], connected: none, connecting: none, sessions: [] })).toEqual({ databases: [], openable: [dev, hml], withoutCredentials: [], connecting: [] });
  });

  it("o nome do banco com seta ou espaço sai inteiro, e a chave do banco com a marca não confunde com a do esquema", () => {
    const scope = searchScope({ connections: [dev], connected: ids("c1"), connecting: none, sessions: [base("c1"), other("c1", "arquivo morto › 2020")] });

    expect(names(scope)).toEqual(["Dev › erp", "Dev › arquivo morto › 2020"]);
  });
});

describe("cachedTreeSessions: as sessões da árvore abertas, lidas do cache", () => {
  const client = () => new QueryClient();

  it("sem sessão nenhuma, devolve sempre a mesma lista vazia", () => {
    const empty = client();

    expect(cachedTreeSessions(empty)).toEqual([]);
    expect(cachedTreeSessions(empty)).toBe(cachedTreeSessions(client()));
  });

  it("lê o banco da conexão (com o nome da sessão) e cada outro banco (com a marca), e só as que têm dado", () => {
    const queryClient = client();
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s1", database: "loja_dev" });
    queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s2", database: "arquivo" });
    queryClient.setQueryData(databaseSessionKey("c2"), { id: "s3", database: "loja_hml" });
    // Uma consulta de sessão que ainda não tem dado (o observador do nó fechado): não é sessão.
    void queryClient.getQueryCache().build(queryClient, { queryKey: databaseSessionKey("c3") });
    // O que não é sessão não entra: nem o índice, nem os níveis, nem a estrutura.
    queryClient.setQueryData(objectNamesKey("c1"), { schemas: [], truncated: false });
    queryClient.setQueryData(treeKey({ type: "connection", connectionId: "c1" }), []);

    const sessions = cachedTreeSessions(queryClient);

    expect(sessions).toHaveLength(3);
    expect(sessions).toEqual(expect.arrayContaining([base("c1", "loja_dev"), other("c1", "arquivo"), base("c2", "loja_hml")]));
  });

  it("devolve o MESMO objeto enquanto nenhuma sessão entrou, saiu ou mudou de nome, e outro quando uma delas muda", () => {
    const queryClient = client();
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s1", database: "loja_dev" });
    const first = cachedTreeSessions(queryClient);

    // Outras consultas chegando, ou a mesma sessão com outro id (reaberta) e o mesmo nome: a lista é a mesma.
    queryClient.setQueryData(objectNamesKey("c1"), { schemas: [], truncated: false });
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s9", database: "loja_dev" });
    expect(cachedTreeSessions(queryClient)).toBe(first);

    queryClient.setQueryData(databaseSessionKey("c2"), { id: "s2", database: "loja_hml" });
    const second = cachedTreeSessions(queryClient);
    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);

    queryClient.removeQueries({ queryKey: databaseSessionKey("c2") });
    expect(cachedTreeSessions(queryClient)).toEqual(first);
  });

  it("o 'Desconectar' (remove a família da conexão) tira as sessões dela da lista", () => {
    const queryClient = client();
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s1", database: "loja_dev" });
    queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s2", database: "arquivo" });
    queryClient.setQueryData(databaseSessionKey("c2"), { id: "s3", database: "loja_hml" });

    queryClient.removeQueries({ queryKey: databaseSessionKey("c1") });

    expect(cachedTreeSessions(queryClient)).toEqual([base("c2", "loja_hml")]);
  });

  it("cada cliente tem a sua foto: um cliente não devolve a lista do outro", () => {
    const a = client();
    const b = client();
    a.setQueryData(databaseSessionKey("c1"), { id: "s1", database: "x" });

    expect(cachedTreeSessions(a)).toHaveLength(1);
    expect(cachedTreeSessions(b)).toHaveLength(0);
  });
});

describe("indexesInScope: só os índices dos bancos do escopo, na ordem dele", () => {
  const answer: ObjectNames = { schemas: [], truncated: false };
  const index = (connectionId: string, database?: string): CachedNames => ({ connectionId, ...(database === undefined ? { databaseName: "erp" } : { database, databaseName: database }), names: answer });
  const target = (connectionId: string, database?: string): SearchDatabase => ({ key: navKey({ type: "database", connectionId, ...(database === undefined ? {} : { database }) }), connectionId, ...(database === undefined ? {} : { database }), name: "x" });

  it("o índice de uma conexão que o filtro escondeu, ou que desconectou, não entra; a ordem é a do escopo", () => {
    const all = [index("c3"), index("c1"), index("c1", "arquivo"), index("c2")];

    expect(indexesInScope(all, [target("c1"), target("c1", "arquivo"), target("c3")])).toEqual([index("c1"), index("c1", "arquivo"), index("c3")]);
  });

  it("o banco do escopo que ainda não tem índice é pulado, e o outro banco não responde pelo da conexão", () => {
    expect(indexesInScope([index("c1", "arquivo")], [target("c1"), target("c1", "arquivo")])).toEqual([index("c1", "arquivo")]);
    expect(indexesInScope([], [target("c1")])).toEqual([]);
    expect(indexesInScope([index("c1")], [])).toEqual([]);
  });

  it("devolve os mesmos objetos do cache (a identidade que a busca guarda)", () => {
    const cached = index("c1");

    expect(indexesInScope([cached], [target("c1")])[0]).toBe(cached);
  });
});

describe("searchStatusOf: o que a linha de estado diz em cada situação (RN-BUSCA-002)", () => {
  const database = (connectionId: string, database?: string): SearchDatabase => ({ key: navKey({ type: "database", connectionId, ...(database === undefined ? {} : { database }) }), connectionId, ...(database === undefined ? {} : { database }), name: `${connectionId} › ${database ?? "erp"}` });
  const loaded = (connectionId: string, truncated = false, db?: string): IndexReport => ({ database: database(connectionId, db), names: { schemas: [], truncated }, failure: null });
  const pending = (connectionId: string): IndexReport => ({ database: database(connectionId), names: undefined, failure: null });
  const failed = (connectionId: string, message: string, lost = false, names: ObjectNames | undefined = undefined): IndexReport => ({ database: database(connectionId), names, failure: { message, lost } });
  const scope = { openable: [] as ScopeConnection[], withoutCredentials: [] as ScopeConnection[], connecting: [] as ScopeConnection[] };
  const status = (input: Partial<Parameters<typeof searchStatusOf>[0]> = {}) => searchStatusOf({ reports: [], openFailures: [], cut: false, scope, ...input });

  it("nada a dizer: tudo zerado", () => {
    expect(status()).toEqual({ loading: 0, cut: false, truncated: [], failures: [], leftOut: 0, withoutCredentials: 0 });
    expect(status({ reports: [loaded("c1"), loaded("c2")] })).toEqual({ loading: 0, cut: false, truncated: [], failures: [], leftOut: 0, withoutCredentials: 0 });
  });

  it("carregando: conta os bancos que ainda esperam o índice, e as conexões que estão abrindo a sessão (vão ser buscadas)", () => {
    expect(status({ reports: [pending("c1"), loaded("c2"), pending("c3")] }).loading).toBe(2);
    expect(status({ reports: [pending("c1")], scope: { ...scope, connecting: [dev, hml] } }).loading).toBe(3);
    expect(status({ scope: { ...scope, connecting: [dev] } }).loading).toBe(1);
  });

  it("o banco que falhou não está carregando, e o que já tem resposta e está buscando de novo (o Atualizar) também não", () => {
    expect(status({ reports: [failed("c1", "x"), loaded("c2")] }).loading).toBe(0);
    // Resposta velha à vista e outra a caminho (o "Atualizar" buscando de novo): a busca segue com a que tem, sem dizer "Buscando…".
    expect(status({ reports: [loaded("c1")] }).loading).toBe(0);
  });

  it("o corte de 200 por banco passa como veio", () => {
    expect(status({ cut: true }).cut).toBe(true);
  });

  it("índice cortado na API: os bancos cuja resposta veio com 'truncated', com o nome e a chave", () => {
    const result = status({ reports: [loaded("c1"), loaded("c2", true), loaded("c3", true, "arquivo")] });

    expect(result.truncated).toEqual([
      { key: database("c2").key, name: "c2 › erp" },
      { key: database("c3", "arquivo").key, name: "c3 › arquivo" },
    ]);
  });

  it("falha de um índice: a mensagem do banco como veio, o que o 'Tentar de novo' refaz e se foi a sessão que caiu", () => {
    const result = status({ reports: [failed("c1", 'permission denied for table "pg_class"'), failed("c2", "Sessão não encontrada.", true)] });

    expect(result.failures).toEqual([
      { key: database("c1").key, name: "c1 › erp", message: 'permission denied for table "pg_class"', retry: { type: "index", database: database("c1"), lost: false } },
      { key: database("c2").key, name: "c2 › erp", message: "Sessão não encontrada.", retry: { type: "index", database: database("c2"), lost: true } },
    ]);
  });

  it("a falha do 'Atualizar' num índice que já tinha resposta também aparece, e o índice seguiu valendo", () => {
    const result = status({ reports: [failed("c1", "timeout", false, { schemas: [], truncated: true })] });

    expect(result.failures).toHaveLength(1);
    expect(result.loading).toBe(0);
    expect(result.truncated).toHaveLength(1);
  });

  it("a conexão de fora cuja sessão não abriu entra nas falhas, com o nome da conexão e a abertura como o que se refaz; depois dos índices", () => {
    const result = status({ reports: [failed("c1", "índice")], openFailures: [{ connection: prod, message: "connection refused" }] });

    expect(result.failures.map((failure) => [failure.name, failure.message, failure.retry.type])).toEqual([
      ["c1 › erp", "índice", "index"],
      ["Prod", "connection refused", "open"],
    ]);
    expect(result.failures[1]).toMatchObject({ key: "open:c3", retry: { type: "open", connectionId: "c3" } });
  });

  it("as conexões de fora: quantas são, e quantas o botão pula", () => {
    const lacking = conn("c9", "Sem senha", { hasPassword: false });

    expect(status({ scope: { ...scope, openable: [dev, hml] } })).toMatchObject({ leftOut: 2, withoutCredentials: 0 });
    expect(status({ scope: { ...scope, openable: [dev], withoutCredentials: [lacking] } })).toMatchObject({ leftOut: 2, withoutCredentials: 1 });
    expect(status({ scope: { ...scope, withoutCredentials: [lacking] } })).toMatchObject({ leftOut: 1, withoutCredentials: 1 });
  });

  it("todas as situações ao mesmo tempo não se atrapalham", () => {
    const result = status({
      reports: [pending("c1"), loaded("c2", true), failed("c3", "ruim")],
      openFailures: [{ connection: prod, message: "recusada" }],
      cut: true,
      scope: { openable: [dev], withoutCredentials: [conn("c9", "x", { userName: "" })], connecting: [hml] },
    });

    expect(result).toMatchObject({ loading: 2, cut: true, leftOut: 2, withoutCredentials: 1 });
    expect(result.truncated).toHaveLength(1);
    expect(result.failures).toHaveLength(2);
  });
});

describe("nothingFoundShown: o 'Nada encontrado' só aparece com a busca terminada e sem falha (RN-BUSCA-002)", () => {
  const failure = { key: "c2", name: "Hml › erp", message: "Name or service not known", retry: { type: "open", connectionId: "c2" } } as const;

  it.each([
    ["sem linha de estado (a busca não olha nada)", null, true],
    ["tudo respondido, nada a dizer", { loading: 0, failures: [] }, true],
    ["um índice a caminho: a linha de estado diz 'Buscando…' sozinha", { loading: 1, failures: [] }, false],
    ["um banco falhou: a linha de estado diz a falha sozinha", { loading: 0, failures: [failure] }, false],
    ["um a caminho e outro falhou", { loading: 2, failures: [failure] }, false],
  ] as const)("%s", (_name, status, expected) => {
    expect(nothingFoundShown(status === null ? null : { loading: status.loading, failures: [...status.failures] })).toBe(expected);
  });
});
