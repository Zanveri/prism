import { isValidElement, type ReactNode } from "react";
import { Navigate, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import { RemountOnLock } from "@/app/_components/remount-on-lock";
import { TabHistory } from "@/app/_components/tab-history";
import { VaultGuard } from "@/app/_components/vault-guard";
import { KeepAliveSlot } from "@/app/_components/workbench-slot";
import { BuildPage } from "@/app/build/page";
import { LegacyConnectionsRedirect } from "@/app/connections/page";
import { DriversRedirect } from "@/app/drivers/page";
import { FontSync } from "@/app/settings/_components/font-sync";
import { SettingsShortcut } from "@/app/settings/_components/settings-shortcut";
import { ThemeSync } from "@/app/settings/_components/theme-sync";
import { WorkbenchProvider } from "@/app/workbench/_lib/workbench-state";
import { WorkbenchPage } from "@/app/workbench/page";
import { pathsConfig } from "@/config/paths.config";
import { elementsOf } from "@/lib/testing/react-tree";

import { routes } from "./routes";

type Placed = { route: RouteObject; ancestors: RouteObject[] };

/** Todas as rotas da tabela, cada uma com as que a envolvem, de fora para dentro. */
function walk(list: RouteObject[], ancestors: RouteObject[] = []): Placed[] {
  return list.flatMap((route) => [{ route, ancestors }, ...walk(route.children ?? [], [...ancestors, route])]);
}

const rendersA = (node: ReactNode, component: unknown) => isValidElement(node) && node.type === component;

describe("rotas: onde o estado da área de trabalho e do Construir é montado", () => {
  const placed = walk(routes);
  const providers = placed.filter(({ route }) => rendersA(route.element, WorkbenchProvider));
  const childAt = (path: string) => (providers[0].route.children ?? []).find((route) => route.path === path);

  it("o provedor é um só e fica dentro do guard do cofre: com o cofre fechado ele não existe e nada chama api/user", () => {
    expect(providers).toHaveLength(1);
    expect(providers[0].ancestors.some((route) => rendersA(route.element, VaultGuard))).toBe(true);
  });

  it("o formulário de conexão não é rota (RN-NAV-004: é um diálogo sobre a área de trabalho): nenhum caminho de Conexões mostra tela", () => {
    const paths = (providers[0].route.children ?? []).map((route) => route.path ?? "");

    expect(paths.filter((path) => path.startsWith(pathsConfig.connections))).toEqual([pathsConfig.connections]);
  });

  it("os endereços das telas de antes continuam e levam a quem ficou com o que elas faziam (RN-NAV-001 e 006): Conexões à área de trabalho, Drivers a Configurações › Drivers", () => {
    expect(rendersA(childAt(pathsConfig.connections)?.element, LegacyConnectionsRedirect)).toBe(true);
    // Drivers: o "Instalar driver" de uma conexão sem driver e o lembrete de reinício da barra levam para lá, e as abas de SQL abertas têm de estar ao voltar.
    expect(rendersA(childAt(pathsConfig.drivers)?.element, DriversRedirect)).toBe(true);
  });

  it("a área de trabalho e o Construir são montados dentro do provedor, em KeepAliveSlot fora do RemountOnLock, e nenhuma rota os tem como elemento", () => {
    const slots = elementsOf(providers[0].route.element).filter((element) => element.type === KeepAliveSlot);
    const workbenchSlot = slots.find((slot) => (slot.props.path ?? pathsConfig.workbench) === pathsConfig.workbench);
    const buildSlot = slots.find((slot) => slot.props.path === pathsConfig.build);
    const [remount] = elementsOf(providers[0].route.element).filter((element) => element.type === RemountOnLock);
    const underRemount = elementsOf(remount.props.children as ReactNode);

    expect(workbenchSlot).toBeDefined();
    expect(elementsOf(workbenchSlot?.props.children as never).some((element) => element.type === WorkbenchPage)).toBe(true);
    expect(buildSlot).toBeDefined();
    expect(buildSlot?.props.mountOnFirstVisit).toBe(true);
    expect(elementsOf(buildSlot?.props.children as never).some((element) => element.type === BuildPage)).toBe(true);
    expect(underRemount.some((element) => element.type === KeepAliveSlot || element.type === WorkbenchPage || element.type === BuildPage)).toBe(false);
    expect(placed.filter(({ route }) => rendersA(route.element, WorkbenchPage) || rendersA(route.element, BuildPage))).toHaveLength(0);
  });

  it("os caminhos da área de trabalho e do Construir são rotas sem elemento: quem os mostra é o KeepAliveSlot", () => {
    const workbenchRoute = (providers[0].route.children ?? []).find((child) => child.path === pathsConfig.workbench);
    const buildRoute = (providers[0].route.children ?? []).find((child) => child.path === pathsConfig.build);

    expect(workbenchRoute).toBeDefined();
    expect(workbenchRoute?.element).toBeUndefined();
    expect(buildRoute).toBeDefined();
    expect(buildRoute?.element).toBeUndefined();
  });

  it("Configurações (RN-CONFIG-001) fica sob o mesmo provedor: abrir a tela e voltar não apaga as abas", () => {
    const paths = (providers[0].route.children ?? []).map((route) => route.path);

    expect(paths).toContain(pathsConfig.settings);
    expect(paths).toContain(pathsConfig.settingsSection);
  });

  it("cada seção das Configurações é uma página, e o endereço sem seção leva à primeira, trocando a entrada do histórico", () => {
    const bare = (providers[0].route.children ?? []).find((route) => route.path === pathsConfig.settings);

    expect(isValidElement<{ to: unknown; replace?: boolean }>(bare?.element) && bare.element.type === Navigate ? bare.element.props : null).toEqual({ to: { pathname: "/settings/account", search: "" }, replace: true });
  });

  it("o tema e as fontes do usuário (RN-CONFIG-008), o atalho Ctrl+, e o Voltar e Avançar das abas (RN-ABAS-018) são montados dentro do provedor, portanto do guard: sem o cofre aberto não há usuário nem cofre", () => {
    for (const component of [ThemeSync, FontSync, SettingsShortcut, TabHistory]) {
      expect(elementsOf(providers[0].route.element).some((element) => element.type === component)).toBe(true);
      expect(placed.filter(({ route }) => elementsOf(route.element).some((element) => element.type === component))).toHaveLength(1);
    }
  });

  it("o login fica fora do guard e do provedor: sair do cofre desmonta os dois", () => {
    const signIn = placed.find(({ route }) => route.path === pathsConfig.signIn);

    expect(signIn?.ancestors).toEqual([]);
  });
});
