import { describe, expect, it } from "vitest";

import { navKey } from "./navigator-model";
import { revealOf } from "./navigator-reveal";

const folders = [
  { id: "raiz", parentID: null },
  { id: "fabrica", parentID: "raiz" },
  { id: "extrusao", parentID: "fabrica" },
  { id: "outra", parentID: null },
];
const folderKey = (id: string) => navKey({ type: "folder", id });

describe("revealOf: o que a árvore abre para mostrar a conexão que acabou de ser salva (RN-NAV-004)", () => {
  it("a linha da conexão e as pastas acima dela, da mais próxima à raiz", () => {
    expect(revealOf({ id: "c1", folderID: "extrusao" }, folders)).toEqual({ key: navKey({ type: "connection", connectionId: "c1" }), folderKeys: [folderKey("extrusao"), folderKey("fabrica"), folderKey("raiz")] });
  });

  it("na raiz: nenhuma pasta", () => {
    expect(revealOf({ id: "c1", folderID: null }, folders).folderKeys).toEqual([]);
  });

  it("uma pasta que não existe mais acaba a subida (a árvore põe a conexão na raiz, `buildConnectionTree`)", () => {
    expect(revealOf({ id: "c1", folderID: "sumiu" }, folders).folderKeys).toEqual([]);
    expect(revealOf({ id: "c1", folderID: "x" }, [{ id: "x", parentID: "sumiu" }]).folderKeys).toEqual([folderKey("x")]);
  });

  it("pastas em ciclo (a API não deixa, RN-PASTA-003) não prendem a subida", () => {
    expect(revealOf({ id: "c1", folderID: "a" }, [{ id: "a", parentID: "b" }, { id: "b", parentID: "a" }]).folderKeys).toEqual([folderKey("a"), folderKey("b")]);
  });
});
