import { describe, expect, it } from "vitest";
import {
  readBuildLayout,
  readBuildTabs,
  writeBuildLayout,
  writeBuildTabs,
} from "@/app/build/_lib/build-tabs";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("build-tabs", () => {
  it("grava e lê as abas abertas na chave prism:build-tabs:<usuário>", () => {
    const storage = createMemoryStorage();
    writeBuildTabs(
      "Marina.Costa",
      { open: ["id-1", "id-2"], active: "id-2" },
      storage,
    );

    expect(storage.getItem("prism:build-tabs:marina.costa")).toBeTruthy();
    expect(readBuildTabs("marina.costa", storage)).toEqual({
      open: ["id-1", "id-2"],
      active: "id-2",
    });
  });

  it("devolve { open: [], active: null } quando o valor gravado é inválido", () => {
    const storage = createMemoryStorage();
    storage.setItem("prism:build-tabs:marina.costa", "{invalido");
    expect(readBuildTabs("marina.costa", storage)).toEqual({
      open: [],
      active: null,
    });

    storage.setItem(
      "prism:build-tabs:marina.costa",
      JSON.stringify({ open: "nao-array", active: 123 }),
    );
    expect(readBuildTabs("marina.costa", storage)).toEqual({
      open: [],
      active: null,
    });
  });

  it("grava e lê sidebarHidden na chave prism:build-layout:<usuário>", () => {
    const storage = createMemoryStorage();
    expect(readBuildLayout("marina.costa", storage)).toEqual({
      sidebarHidden: false,
    });

    writeBuildLayout("Marina.Costa", { sidebarHidden: true }, storage);
    expect(storage.getItem("prism:build-layout:marina.costa")).toBeTruthy();
    expect(readBuildLayout("marina.costa", storage)).toEqual({
      sidebarHidden: true,
    });
  });
});
