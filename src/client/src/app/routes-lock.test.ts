import { isValidElement, type ReactNode } from "react";
import { Outlet, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import { RemountOnLock } from "@/app/_components/remount-on-lock";
import { WorkbenchSlot } from "@/app/_components/workbench-slot";
import { WorkbenchProvider } from "@/app/workbench/_lib/workbench-state";
import { WorkbenchPage } from "@/app/workbench/page";
import { elementsOf } from "@/lib/testing/react-tree";

import { routes } from "./routes";

function walk(list: RouteObject[]): RouteObject[] {
  return list.flatMap((route) => [route, ...walk(route.children ?? [])]);
}

const provider = walk(routes).find((route) => isValidElement(route.element) && route.element.type === WorkbenchProvider);
const inside = (node: ReactNode) => elementsOf(node);

describe("rotas: o bloqueio por inatividade remonta as outras telas, e só elas (RN-SEG-001)", () => {
  const remounted = inside(provider?.element).filter((element) => element.type === RemountOnLock);

  it("há um RemountOnLock só, dentro do provedor, em volta do Outlet (Conexões, Configurações e Drivers)", () => {
    expect(remounted).toHaveLength(1);
    expect(inside(remounted[0].props.children as ReactNode).some((element) => element.type === Outlet)).toBe(true);
  });

  it("a área de trabalho NÃO fica dentro dele: remontá-la apagaria o editor, o cursor e o histórico de desfazer que o bloqueio manda manter", () => {
    const underRemount = inside(remounted[0].props.children as ReactNode);

    expect(inside(provider?.element).some((element) => element.type === WorkbenchSlot)).toBe(true);
    expect(underRemount.some((element) => element.type === WorkbenchSlot || element.type === WorkbenchPage)).toBe(false);
  });
});
