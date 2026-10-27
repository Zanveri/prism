import { describe, expect, it } from "vitest";

import { allEnvironments, noEnvironment, type EnvironmentChoice } from "./navigator-environment";
import {
  collapsedAllInFilter,
  collapsedInFilter,
  filterViewOf,
  folderIdOfKey,
  folderIdsOfKeys,
  folderKeyOf,
  noFilterFolders,
  openTreeKeys,
  openedInFilter,
  toggledInFilter,
  type FilterFolders,
} from "./navigator-folders";
import { navKey } from "./navigator-model";

const connection = (connectionId: string) => navKey({ type: "connection", connectionId });
const database = (connectionId: string) => navKey({ type: "database", connectionId });
const [f1, f2, f3] = ["f1", "f2", "f3"].map(folderKeyOf);

describe("a chave da pasta e o identificador dela (RN-NAV-014)", () => {
  it("um é o inverso do outro; a chave de outra coisa, ou quebrada, não é de pasta", () => {
    expect(folderIdOfKey(folderKeyOf("f1"))).toBe("f1");
    expect(folderIdOfKey(connection("c1"))).toBeNull();
    expect(folderIdOfKey("não é JSON")).toBeNull();
    expect(folderIdsOfKeys([f1, connection("c1"), f2, "x"])).toEqual(["f1", "f2"]);
  });
});

describe("openTreeKeys: os nós abertos da árvore (RN-NAV-014)", () => {
  const folderKeys = [f1, f2, f3];
  const base = { expanded: new Set<string>(), lackingKeys: new Set<string>(), folderKeys, openFolderIds: new Set<string>(), filterCollapsed: null };

  it("sem nada lembrado nenhuma pasta abre, e as conexões abertas vêm de `expanded`", () => {
    expect(openTreeKeys(base)).toEqual(new Set());
    expect(openTreeKeys({ ...base, expanded: new Set([connection("c1"), database("c1")]) })).toEqual(new Set([connection("c1"), database("c1")]));
  });

  it("a pasta lembrada abre, e só ela", () => {
    expect(openTreeKeys({ ...base, openFolderIds: new Set(["f1", "f3"]) })).toEqual(new Set([f1, f3]));
  });

  it("a conexão a que faltam o usuário ou a senha sai dos abertos (RN-TRANSF-016); as pastas ficam como estavam", () => {
    const open = openTreeKeys({ ...base, expanded: new Set([connection("c1"), connection("c2")]), lackingKeys: new Set([connection("c1")]), openFolderIds: new Set(["f2"]) });

    expect(open).toEqual(new Set([connection("c2"), f2]));
  });

  it("o identificador desconhecido (pasta excluída, ou fora da árvore à vista) não tem efeito", () => {
    expect(openTreeKeys({ ...base, folderKeys: [f1], openFolderIds: new Set(["sumiu", "f2", "f1"]) })).toEqual(new Set([f1]));
  });

  it("na vista filtrada todas as pastas da árvore à vista abrem, menos as recolhidas nela; o lembrado não conta nem entra", () => {
    expect(openTreeKeys({ ...base, filterCollapsed: new Set() })).toEqual(new Set(folderKeys));
    expect(openTreeKeys({ ...base, filterCollapsed: new Set([f2]), openFolderIds: new Set(["f2"]) })).toEqual(new Set([f1, f3]));
    expect(openTreeKeys({ ...base, filterCollapsed: new Set(folderKeys), openFolderIds: new Set(["f1"]) })).toEqual(new Set());
  });

  it("na vista filtrada os outros nós abertos continuam os de `expanded`: só as pastas ganham a regra do filtro", () => {
    const open = openTreeKeys({ ...base, filterCollapsed: new Set([f3]), expanded: new Set([connection("c1")]) });

    expect(open).toEqual(new Set([connection("c1"), f1, f2]));
    expect(openTreeKeys({ ...base, filterCollapsed: new Set() }).has(connection("c1"))).toBe(false);
  });
});

describe("a vista filtrada: o seletor de ambiente e \"Só as conectadas\" (RN-NAV-010 e 013)", () => {
  const production: EnvironmentChoice = { type: "environment", key: "producao" };

  it("sem nenhum dos dois ligados não há vista; cada combinação ligada é a sua", () => {
    expect(filterViewOf(allEnvironments, false)).toBeNull();
    const views = [filterViewOf(allEnvironments, true), filterViewOf(noEnvironment, false), filterViewOf(production, false), filterViewOf(production, true), filterViewOf({ type: "environment", key: "teste" }, false)];

    expect(views.every((view) => view !== null)).toBe(true);
    expect(new Set(views).size).toBe(views.length);
  });

  it("as pastas recolhidas valem só na vista em que foram recolhidas; em outra vista, ou sem filtro, não", () => {
    const view = filterViewOf(production, false)!;
    const collapsed = toggledInFilter(noFilterFolders, view, f1, true);

    expect(collapsedInFilter(collapsed, view)).toEqual(new Set([f1]));
    expect(collapsedInFilter(collapsed, filterViewOf(production, true))).toEqual(new Set());
    expect(collapsedInFilter(collapsed, filterViewOf(noEnvironment, false))).toEqual(new Set());
    expect(collapsedInFilter(collapsed, null)).toBeNull();
  });

  it("abrir e fechar a pasta na vista: fechada entra nas recolhidas, aberta sai; as outras ficam", () => {
    const view = filterViewOf(allEnvironments, true)!;
    let state: FilterFolders = noFilterFolders;

    state = toggledInFilter(state, view, f1, true);
    state = toggledInFilter(state, view, f2, true);
    expect(collapsedInFilter(state, view)).toEqual(new Set([f1, f2]));

    state = toggledInFilter(state, view, f1, false);
    expect(collapsedInFilter(state, view)).toEqual(new Set([f2]));
  });

  it("ao trocar de vista, o que se recolheu na outra é esquecido na primeira mudança", () => {
    const one = filterViewOf(production, false)!;
    const other = filterViewOf(noEnvironment, false)!;
    const state = toggledInFilter(noFilterFolders, one, f1, true);

    expect(collapsedInFilter(toggledInFilter(state, other, f2, true), other)).toEqual(new Set([f2]));
  });

  it("\"Recolher tudo\" recolhe todas as pastas da árvore à vista, só na vista; sem filtro não guarda nada", () => {
    const view = filterViewOf(production, false)!;

    expect(collapsedInFilter(collapsedAllInFilter(view, [f1, f2, f3]), view)).toEqual(new Set([f1, f2, f3]));
    expect(collapsedAllInFilter(null, [f1])).toBe(noFilterFolders);
  });

  it("as pastas que abrem (criar dentro, revelar, mover) saem das recolhidas; o MESMO estado se nenhuma estava", () => {
    const view = filterViewOf(production, false)!;
    const state = collapsedAllInFilter(view, [f1, f2, f3]);

    expect(collapsedInFilter(openedInFilter(state, view, [f2]), view)).toEqual(new Set([f1, f3]));
    expect(collapsedInFilter(openedInFilter(state, view, [f1, f2, f3]), view)).toEqual(new Set());
    expect(openedInFilter(state, view, [connection("c1")])).toBe(state);
    expect(openedInFilter(noFilterFolders, view, [f1])).toBe(noFilterFolders);
    expect(openedInFilter(state, null, [f1])).toBe(state);
    expect(openedInFilter(state, filterViewOf(noEnvironment, false), [f1])).toBe(state);
  });
});
