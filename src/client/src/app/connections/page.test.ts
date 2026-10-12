import { isValidElement } from "react";
import { Navigate } from "react-router";
import { describe, expect, it } from "vitest";

import { LegacyConnectionsRedirect } from "./page";

describe("o endereço da tela de Conexões (RN-NAV-001 e 004: a tela deixou de existir)", () => {
  it("leva à área de trabalho, trocando a entrada do histórico", () => {
    const element = LegacyConnectionsRedirect();

    expect(isValidElement(element) && element.type === Navigate).toBe(true);
    expect(isValidElement<{ to: unknown; replace?: boolean }>(element) ? element.props : null).toEqual({ to: "/workbench", replace: true });
  });
});
