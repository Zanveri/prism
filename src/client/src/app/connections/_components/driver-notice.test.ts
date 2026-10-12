import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import { buttonLabeled, elementsOf } from "@/lib/testing/react-tree";

import { engineChoices, type EngineChoice } from "../_lib/engine-choices";
import { DriverNotice, type DriverNoticeActions } from "./driver-notice";

const license = { name: "Licença", url: "https://exemplo.local/licenca" };
const ibm: Driver = { id: "ibm-data-server", name: "IBM Data Server", vendor: "IBM", engines: [2, 3], state: "available", version: "12.1.3", sizeBytes: 1, license, platformNote: null, progress: null, error: null, restartRequired: false };
const postgres: Driver = { ...ibm, id: "postgresql", name: "PostgreSQL", engines: [1], state: "bundled", license: null };

/** A entrada do Db2 com o driver da IBM no estado dado. */
const db2 = (overrides: Partial<Driver> = {}): EngineChoice => engineChoices([postgres, { ...ibm, ...overrides }])[1];

const actions = (): DriverNoticeActions => ({ install: vi.fn(), cancel: vi.fn(), restart: vi.fn(), cancellingId: null });
const render = (choice: EngineChoice, given = actions()) => renderToStaticMarkup(createElement(DriverNotice, { choice, actions: given }));

describe("o aviso do driver no formulário de conexão (RN-NAV-005): o que falta, ali mesmo", () => {
  it("driver embutido ou instalado: nada a dizer", () => {
    expect(render(engineChoices([postgres, ibm])[0])).toBe("");
    expect(render(db2({ state: "installed" }))).toBe("");
  });

  it("não instalado: diz que falta, que a conexão pode ser salva assim, e oferece 'Instalar driver', que abre o mesmo diálogo de Configurações › Drivers", () => {
    const given = actions();
    const markup = render(db2(), given);

    expect(markup).toContain("O driver IBM Data Server, que atende este banco, não está instalado.");
    expect(markup).toContain("Dá para salvar a conexão agora");
    expect(markup).toMatch(/<button[^>]*>Instalar driver<\/button>/);

    (buttonLabeled(DriverNotice({ choice: db2(), actions: given }), "Instalar driver")?.props.onClick as () => void)();
    expect(given.install).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "ibm-data-server" }));
  });

  it("baixando: o progresso (a mesma barra da lista) e 'Cancelar'; com o cancelamento a caminho, o botão diz isso e não repete", () => {
    const choice = db2({ state: "installing", progress: { receivedBytes: 1048576, totalBytes: 4194304 } });
    const markup = render(choice);

    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuenow="25"/);
    expect(markup).toMatch(/<button[^>]*>Cancelar<\/button>/);

    const given = { ...actions(), cancellingId: "ibm-data-server" };
    expect(render(choice, given)).toMatch(/<button[^>]*disabled=""[^>]*>Cancelando…<\/button>/);

    const free = actions();
    (buttonLabeled(DriverNotice({ choice, actions: free }), "Cancelar")?.props.onClick as () => void)();
    expect(free.cancel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "ibm-data-server" }));
  });

  it("falhou: a causa, e 'Tentar de novo', que abre o diálogo de instalação", () => {
    const given = actions();
    const choice = db2({ state: "failed", error: { code: "DRIVER_DOWNLOAD_FAILED", detail: "A conexão caiu." } });

    expect(render(choice, given)).toContain("A conexão caiu.");
    (buttonLabeled(DriverNotice({ choice, actions: given }), "Tentar de novo")?.props.onClick as () => void)();
    expect(given.install).toHaveBeenCalledOnce();
  });

  it("instalado e esperando o reinício: o lembrete com 'Reiniciar agora' (RN-DRIVER-005)", () => {
    const given = actions();
    const choice = db2({ state: "installed", restartRequired: true });

    expect(render(choice, given)).toContain("O Prism precisa reiniciar o serviço");
    const restart = elementsOf(DriverNotice({ choice, actions: given })).find((element) => typeof element.props.onRestart === "function");
    (restart?.props.onRestart as () => void)();
    expect(given.restart).toHaveBeenCalledOnce();
  });

  it("sem driver para a plataforma (a conexão gravada de um banco que esta máquina não atende): o motivo, sem botão", () => {
    const markup = render(db2({ state: "unavailable", platformNote: "Só no Windows x64." }));

    expect(markup).toContain("Só no Windows x64.");
    expect(markup).not.toContain("<button");
  });

  it("sem a lista de drivers: nada (o formulário não inventa um estado que não sabe)", () => {
    expect(render(engineChoices(undefined)[1])).toBe("");
  });
});
