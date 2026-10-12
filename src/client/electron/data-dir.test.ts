import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { userDataDir } from "./data-dir";

// Absoluto em qualquer sistema: `app.setPath` só aceita caminho absoluto.
const appData = resolve("roaming");

describe("userDataDir", () => {
  it("empacotado, usa Zanveri/Prism dentro de appData", () => {
    expect(userDataDir({ isPackaged: true, userDataSwitch: "", appData })).toBe(join(appData, "Zanveri", "Prism"));
  });

  it("em desenvolvimento, usa Zanveri/Prism-dev dentro de appData", () => {
    expect(userDataDir({ isPackaged: false, userDataSwitch: "", appData })).toBe(join(appData, "Zanveri", "Prism-dev"));
  });

  it("--user-data-dir vence, nos dois modos", () => {
    const chosen = join(appData, "pasta-de-teste");
    expect(userDataDir({ isPackaged: true, userDataSwitch: chosen, appData })).toBe(chosen);
    expect(userDataDir({ isPackaged: false, userDataSwitch: chosen, appData })).toBe(chosen);
  });

  it("--user-data-dir relativo vira absoluto", () => {
    expect(userDataDir({ isPackaged: true, userDataSwitch: "relativa", appData })).toBe(resolve("relativa"));
  });
});
