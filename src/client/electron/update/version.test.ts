import { describe, expect, it } from "vitest";

import { compareVersions, isNewerThan, isReleaseVersion, isStableVersion, releaseOfTag } from "./version";

describe("releaseOfTag (RN-ATUALIZA-002, RN-VERSAO-001: vX.Y.Z e vX.Y.Z-beta.N)", () => {
  it("a tag de uma versão estável vira a versão, sem o v, e não é pré-lançamento", () => {
    expect(releaseOfTag("v0.1.0")).toEqual({ version: "0.1.0", prerelease: false });
    expect(releaseOfTag("v10.20.30")).toEqual({ version: "10.20.30", prerelease: false });
  });

  it("a tag de um beta (ou de um rc, que o formato aceita) vira a versão inteira, e é pré-lançamento", () => {
    expect(releaseOfTag("v0.2.0-beta.1")).toEqual({ version: "0.2.0-beta.1", prerelease: true });
    expect(releaseOfTag("v0.2.0-beta.10")).toEqual({ version: "0.2.0-beta.10", prerelease: true });
    expect(releaseOfTag("v1.0.0-rc.2")).toEqual({ version: "1.0.0-rc.2", prerelease: true });
    expect(releaseOfTag("v1.0.0-beta.0")).toEqual({ version: "1.0.0-beta.0", prerelease: true });
  });

  it("outro pré-lançamento, ou o beta fora do formato, fica de fora", () => {
    for (const tag of ["v1.2.3-beta", "v1.2.3-beta.", "v1.2.3-beta.01", "v1.2.3-beta.1.2", "v1.2.3-BETA.1", "v1.2.3-alpha.1", "v1.2.3-0", "v1.2.3-rc", "v1.2.3+build.5", "v1.2.3-beta.1+build.5", "v1.2.3-beta.-1", "v1.2.3-beta.1x", "v1.2.3-beta.9999999999"]) {
      expect(releaseOfTag(tag), tag).toBeNull();
    }
  });

  it("tag malformada é ignorada: nunca chega a um caminho nem a um endereço", () => {
    const malformed = ["v1", "v1.2", "vNext", "v1.2.3; rm -rf", "v1.2.3 ", " v1.2.3", "v1.2.3\n", "v1.2.3\nv9.9.9", "v1.2.3\r", "v1 .2.3", "1.2.3", "V1.2.3", "v01.2.3", "v1.02.3", "v1.2.3.4", "v1.2.-3", "v1..3", "v1.2.3/../x", "v1.2.3\\x", "v1.2.3%2F", "v99999999999.0.0", "", "v", "v1.2.3-beta.1/../x", "v1.2.3-beta.1\n", "v1.2.3-beta.1 ", "v1.2.3-beta.1;x"];
    for (const tag of malformed) expect(releaseOfTag(tag), JSON.stringify(tag)).toBeNull();
  });

  it("o que não é texto é ignorado", () => {
    for (const tag of [123, null, undefined, {}, ["v1.2.3"], true]) expect(releaseOfTag(tag)).toBeNull();
  });
});

describe("isStableVersion e isReleaseVersion", () => {
  it("a estável é só X.Y.Z, sem o v e sem sufixo", () => {
    expect(isStableVersion("0.2.0")).toBe(true);
    for (const value of ["v0.2.0", "0.2", "0.2.0-beta.1", "0.2.0 ", "0.2.0\n", "../0.2.0", "", 2, null, undefined, {}]) expect(isStableVersion(value)).toBe(false);
  });

  it("a versão de uma release é a estável ou a do beta (ou do rc), e nada mais: é o que vira pasta e pedaço de endereço", () => {
    for (const value of ["0.2.0", "0.2.0-beta.1", "0.2.0-beta.12", "1.0.0-rc.1"]) expect(isReleaseVersion(value), value).toBe(true);
    for (const value of ["v0.2.0", "0.2", "0.2.0-beta", "0.2.0-alpha.1", "0.2.0-beta.1/../x", "0.2.0-beta.1 ", "0.2.0+x", "", 2, null, undefined, {}]) expect(isReleaseVersion(value), JSON.stringify(value)).toBe(false);
  });
});

describe("a ordem do SemVer, com pré-lançamento", () => {
  it("compara número a número, e não como texto: 0.9.0 < 0.10.0", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.10")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("a estável vem depois dos pré-lançamentos dela: a 0.2.0 depois da 0.2.0-beta.3", () => {
    expect(compareVersions("0.2.0", "0.2.0-beta.3")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.3", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
  });

  it("o número do beta é número: a 0.2.0-beta.10 depois da 0.2.0-beta.9", () => {
    expect(compareVersions("0.2.0-beta.10", "0.2.0-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.9", "0.2.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.3", "0.2.0-beta.3")).toBe(0);
  });

  it("o rc vem depois do beta da mesma versão, e o beta da versão seguinte depois da estável anterior", () => {
    expect(compareVersions("0.2.0-rc.1", "0.2.0-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0-beta.1", "0.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0-beta.1", "0.2.9-beta.99")).toBeGreaterThan(0);
  });

  it("ordenar por ela põe cada versão no lugar", () => {
    const shuffled = ["0.2.0-beta.10", "0.1.0", "0.2.0", "0.2.0-beta.2", "0.3.0-beta.1", "0.2.0-rc.1", "0.2.0-beta.9", "0.10.0"];

    expect([...shuffled].sort(compareVersions)).toEqual(["0.1.0", "0.2.0-beta.2", "0.2.0-beta.9", "0.2.0-beta.10", "0.2.0-rc.1", "0.2.0", "0.3.0-beta.1", "0.10.0"]);
  });
});

describe("isNewerThan: a versão de uma release é mais nova que a instalada?", () => {
  it("só é mais nova a que vem depois da instalada", () => {
    expect(isNewerThan("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerThan("0.9.0", "0.10.0")).toBe(false);
    expect(isNewerThan("0.1.0", "0.1.0")).toBe(false);
  });

  it("com um beta instalado: a estável dele é mais nova, e o beta seguinte também; o mesmo beta e os anteriores, não", () => {
    expect(isNewerThan("0.2.0", "0.2.0-beta.3")).toBe(true);
    expect(isNewerThan("0.2.0-beta.4", "0.2.0-beta.3")).toBe(true);
    expect(isNewerThan("0.2.0-beta.10", "0.2.0-beta.9")).toBe(true);
    expect(isNewerThan("0.2.0-beta.3", "0.2.0-beta.3")).toBe(false);
    expect(isNewerThan("0.2.0-beta.2", "0.2.0-beta.3")).toBe(false);
    expect(isNewerThan("0.1.9", "0.2.0-beta.3")).toBe(false);
  });

  it("com uma estável instalada, o beta da versão seguinte é mais novo, e o da mesma versão não", () => {
    expect(isNewerThan("0.3.0-beta.1", "0.2.0")).toBe(true);
    expect(isNewerThan("0.2.0-beta.9", "0.2.0")).toBe(false);
    expect(isNewerThan("0.2.0", "0.3.0-beta.1")).toBe(false);
  });

  it("a instalada pode ter outro pré-lançamento ou metadados de build (o SemVer manda ignorar os metadados na ordem)", () => {
    expect(isNewerThan("0.2.0", "0.2.0-dev.5")).toBe(true);
    expect(isNewerThan("0.2.0-beta.4", "0.2.0-beta.3+build.7")).toBe(true);
    expect(isNewerThan("0.2.0-beta.3", "0.2.0-beta.3+build.7")).toBe(false);
  });

  it("com a versão instalada ilegível nada é mais novo: o app não oferece o que não sabe comparar", () => {
    for (const installed of ["", "dev", "1.2", "x.y.z", "1.2.3-", "1.2.3-beta..1", "01.2.3"]) expect(isNewerThan("9.9.9", installed), installed).toBe(false);
  });

  it("a candidata tem de ser a versão de uma release", () => {
    for (const candidate of ["9.9.9-alpha.1", "v9.9.9", "9.9", ""]) expect(isNewerThan(candidate, "0.1.0"), candidate).toBe(false);
  });
});
