import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ReadOnlyMark } from "@/app/connections/_components/read-only-mark";
import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { EngineTag } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import { connectionChoices } from "../_lib/tab-connection";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CheckDot } from "./connection-check";
import { ConnectionButtonView, ConnectionListView } from "./connection-picker";

const copy = workbenchCopy.editor.connection;

function connection(id: string, name: string, over: Partial<Connection> = {}): Connection {
  return { id, folderID: null, name, engine: 3, host: "ifx.zanveri.local", port: 9089, database: "erp", userName: "informix", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: "", updatedAt: "", ...over };
}

const erp = connection("c1", "ERP Produção", { folderID: "f1", environmentName: "Produção", environmentColor: "#FF8A7A" });
const mes = connection("c2", "MES", { engine: 1, host: "pg.zanveri.local", port: 5432, userName: "mes" });
const folders = [{ id: "f1", parentID: null, name: "Clientes", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: "", updatedAt: "" }];
const environments = environmentLookup(folders);
const shortcut = { label: "Ctrl+9", aria: "Control+9" };

describe("ConnectionButtonView: a conexão da aba na barra do editor (RN-ARVORE-008)", () => {
  const view = (over: Partial<ComponentProps<typeof ConnectionButtonView>> = {}) => {
    const props = { connection: erp, environment: environments.connection(erp), shortcut, open: false, panelId: "lista", onToggle: vi.fn(), ...over };
    return { props, tree: ConnectionButtonView(props), found: elementsOf(ConnectionButtonView(props)) };
  };

  it("mostra a sigla do banco, o nome e a etiqueta do ambiente; a dica traz o servidor, o usuário e o atalho", () => {
    const { tree, found } = view();

    expect(found.find((element) => element.type === EngineTag)?.props.engine).toBe(3);
    expect(found.some((element) => element.props.children === "ERP Produção")).toBe(true);
    expect(found.find((element) => element.type === ShownEnvironmentPill)?.props.environment).toMatchObject({ name: "Produção" });
    expect(tree.props).toMatchObject({ "aria-label": copy.label("IFX", "ERP Produção", "Produção"), title: copy.title("ifx.zanveri.local", 9089, "informix", "Ctrl+9"), "aria-keyshortcuts": "Control+9", "aria-haspopup": "dialog", "aria-expanded": false });
    expect(copy.title("ifx.zanveri.local", 9089, "informix", "Ctrl+9")).toContain("ifx.zanveri.local:9089");
  });

  it("o nome acessível começa pelo que o botão mostra, na ordem da tela (a sigla, o nome e o ambiente, o próprio ou o herdado da pasta), e diz depois o que ele é", () => {
    const informix = connection("c3", "ERP Informix", { environmentName: "Produção", environmentColor: "#FF8A7A" });
    const inherited = connection("c4", "ERP Filial", { folderID: "f2" });
    const lookup = environmentLookup([...folders, { ...folders[0], id: "f2", name: "Homologação", environmentName: "Homologação", environmentColor: "#7CC4FF" }]);

    expect(view({ connection: informix, environment: lookup.connection(informix) }).tree.props["aria-label"]).toBe("IFX ERP Informix Produção, conexão desta aba");
    expect(view({ connection: inherited, environment: lookup.connection(inherited) }).tree.props["aria-label"]).toBe("IFX ERP Filial Homologação, conexão desta aba");
    expect(view({ connection: mes, environment: null }).tree.props["aria-label"]).toBe("PG MES, conexão desta aba");
    expect(view({ connection: null, environment: null }).tree.props["aria-label"]).toMatch(new RegExp(`^${copy.none}`));
    expect(view({ connection: undefined, environment: null }).tree.props["aria-label"]).toBe(copy.loadingLabel);
  });

  it("RN-VERIF-003: com a verificação, o indicador vai na ponta (como na árvore), o estado entra no nome acessível e a dica ganha a última verificação", () => {
    const failed = { kind: "failed", checkedAt: "2026-10-15T14:32:35Z", elapsedMs: 12, message: "FATAL: terminating connection", sqlState: null, busy: false } as const;
    const { tree, found } = view({ check: failed });
    const dot = found.find((element) => element.type === CheckDot);

    expect(dot?.props.view).toMatchObject({ tone: "failed", label: "Não respondeu" });
    expect(tree.props["aria-label"]).toBe("IFX ERP Produção Produção, não respondeu, conexão desta aba");
    expect(tree.props.title).toMatch(/troca a conexão desta aba\nNão respondeu às \d{2}:\d{2}:35:\nFATAL: terminating connection$/);
    // Sem verificação (desligada, ou a conexão desconectada), nada muda.
    expect(view({ check: null }).found.some((element) => element.type === CheckDot)).toBe(false);
  });

  it("o clique abre (e fecha) a lista; aberta, o botão aponta para ela", () => {
    const { props, tree } = view({ open: true });
    (tree.props.onClick as () => void)();

    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(tree.props).toMatchObject({ "aria-expanded": true, "aria-controls": "lista" });
    expect(view().tree.props["aria-controls"]).toBeUndefined();
  });

  it("a aba sem conexão diz \"Sem conexão\", e a lista vai dar uma a ela", () => {
    const { tree, found } = view({ connection: null, environment: null });

    expect(found.some((element) => element.props.children === copy.none)).toBe(true);
    expect(found.some((element) => element.type === EngineTag)).toBe(false);
    expect(tree.props).toMatchObject({ "aria-label": copy.noneLabel, title: copy.noneTitle("Ctrl+9") });
  });
});

describe("ConnectionListView: a lista que troca a conexão da aba (RN-ARVORE-008)", () => {
  const view = (over: Partial<ComponentProps<typeof ConnectionListView>> = {}) => {
    const choices = over.choices ?? connectionChoices([erp, mes], folders, new Set(["c2"]));
    const props = { id: "lista", query: "", choices, total: 2, active: 0, current: "c1", environments, busy: false, onQuery: vi.fn(), onKeyDown: vi.fn(), onActive: vi.fn(), onChoose: vi.fn(), onReveal: vi.fn(), ...over };
    const found = elementsOf(ConnectionListView(props));
    const options = found.filter((element) => element.props.role === "option");
    const texts = found.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
    const reveal = found.find((element) => element.props.children === copy.reveal);
    const field = found.find((element) => element.props.role === "combobox")!;
    return { props, found, options, texts, reveal, field };
  };

  it("as conectadas primeiro, num grupo com título, e cada conexão com o caminho de pastas; a da aba vem marcada", () => {
    const { options, texts, found } = view();

    expect(options.map((option) => option.key)).toEqual(["c2", "c1"]);
    expect(texts).toEqual(expect.arrayContaining([copy.connected, copy.others, "Clientes", copy.root]));
    expect(options.map((option) => option.props["aria-selected"])).toEqual([false, true]);
    expect(found.filter((element) => element.props.role === "group")).toHaveLength(2);
  });

  it("sem nenhuma conectada, a lista não tem grupos", () => {
    const { found, texts } = view({ choices: connectionChoices([erp, mes], folders, new Set()) });

    expect(found.some((element) => element.props.role === "group")).toBe(false);
    expect(texts).not.toContain(copy.connected);
  });

  it("o campo de busca é o combobox da lista: digitar busca, as teclas vão a quem decide, e a opção marcada é a ativa", () => {
    const { field, props } = view({ active: 1 });

    expect(field.props).toMatchObject({ "aria-controls": "lista-lista", "aria-activedescendant": "lista-lista-1", "aria-label": copy.search, autoFocus: true });
    (field.props.onChange as (event: unknown) => void)({ target: { value: "mes" } });
    (field.props.onKeyDown as (event: unknown) => void)({ key: "ArrowDown" });

    expect(props.onQuery).toHaveBeenCalledWith("mes");
    expect(props.onKeyDown).toHaveBeenCalledOnce();
  });

  it("o clique numa conexão a escolhe; o mouse em cima a marca", () => {
    const { options, props } = view();
    (options[0].props.onClick as () => void)();
    (options[1].props.onPointerEnter as () => void)();

    expect(props.onChoose).toHaveBeenCalledWith(expect.objectContaining({ connection: mes }));
    expect(props.onActive).toHaveBeenCalledWith(1);
  });

  it("com comando em andamento, as conexões ficam desabilitadas e a lista diz por quê; \"Mostrar no navegador\" continua", () => {
    const { options, texts, field, reveal } = view({ busy: true });

    expect(options.every((option) => option.props["aria-disabled"] === true)).toBe(true);
    expect(texts).toContain(copy.busy);
    expect(field.props["aria-describedby"]).toBeDefined();
    expect(reveal?.props.disabled).toBe(false);
  });

  it("\"Mostrar no navegador\" revela a conexão da aba; sem conexão, fica apagado", () => {
    const { reveal, props } = view();
    (reveal!.props.onClick as () => void)();

    expect(props.onReveal).toHaveBeenCalledOnce();
    expect(view({ current: null }).reveal?.props.disabled).toBe(true);
  });

  it("sem conexão cadastrada diz para criar uma; com a busca sem achar, diz que nada combina", () => {
    expect(view({ choices: [], total: 0 }).texts).toContain(copy.empty);
    expect(view({ choices: [], query: " zzz " }).texts).toContain(copy.noMatch("zzz"));
  });
});

describe("o cadeado da conexão somente leitura no botão e na lista (RN-PROT-002)", () => {
  it("o botão mostra o cadeado depois do ambiente, com a dica de onde ele vem, e o nome acessível diz que ela é somente leitura", () => {
    const props = { connection: erp, environment: environments.connection(erp), readOnly: "Somente leitura, herdado da pasta Clientes", shortcut, open: false, panelId: "lista", onToggle: vi.fn() };
    const tree = ConnectionButtonView(props);
    const found = elementsOf(tree);

    expect(found.find((element) => element.type === ReadOnlyMark)?.props.hint).toBe("Somente leitura, herdado da pasta Clientes");
    expect(tree.props["aria-label"]).toBe("IFX ERP Produção Produção, somente leitura, herdado da pasta Clientes, conexão desta aba");
  });

  it("a lista marca só as conexões somente leitura, com a dica de cada uma", () => {
    const choices = connectionChoices([erp, mes], folders, new Set());
    const found = elementsOf(ConnectionListView({ id: "lista", query: "", choices, total: 2, active: 0, current: "c1", environments, readOnlyOf: (connection) => (connection.id === "c2" ? "Somente leitura" : null), busy: false, onQuery: vi.fn(), onKeyDown: vi.fn(), onActive: vi.fn(), onChoose: vi.fn(), onReveal: vi.fn() }));

    expect(found.filter((element) => element.type === ReadOnlyMark).map((element) => element.props.hint)).toEqual([null, "Somente leitura"]);
  });

  it("o cadeado desenha a dica no title e no nome acessível; sem dica, nada", () => {
    expect(ReadOnlyMark({ hint: "Somente leitura" })?.props).toMatchObject({ role: "img", "aria-label": "Somente leitura", title: "Somente leitura" });
    expect(ReadOnlyMark({ hint: null })).toBeNull();
  });
});
