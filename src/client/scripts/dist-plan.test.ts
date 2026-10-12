import { describe, expect, it } from "vitest";

import { parseHomepage, parseTarget, parseUpdateOrigin, planDist } from "./dist-plan.mjs";

describe("parseTarget", () => {
  it("Windows e Linux são x64; o macOS, sem arquitetura, é o da máquina", () => {
    expect(parseTarget(["win"], "linux", "arm64")).toMatchObject({ platform: "win", arch: "x64", nodePlatform: "win32" });
    expect(parseTarget(["linux"], "win32", "x64")).toMatchObject({ platform: "linux", arch: "x64", nodePlatform: "linux" });
    expect(parseTarget(["mac"], "win32", "arm64")).toMatchObject({ platform: "mac", arch: "arm64", nodePlatform: "darwin" });
    expect(parseTarget(["mac"], "darwin", "x64")).toMatchObject({ platform: "mac", arch: "x64" });
  });

  it("a arquitetura pedida vale no macOS, nas duas", () => {
    expect(parseTarget(["mac", "arm64"], "win32", "x64").arch).toBe("arm64");
    expect(parseTarget(["mac", "x64"], "darwin", "arm64").arch).toBe("x64");
  });

  it("sem argumento, a plataforma da máquina", () => {
    expect(parseTarget([], "win32", "x64").platform).toBe("win");
    expect(parseTarget([], "linux", "x64").platform).toBe("linux");
    expect(parseTarget([], "darwin", "arm64")).toMatchObject({ platform: "mac", arch: "arm64" });
  });

  it("o `--` que o pnpm deixa antes dos argumentos não é argumento", () => {
    expect(parseTarget(["--", "mac", "arm64"], "win32", "x64")).toMatchObject({ platform: "mac", arch: "arm64" });
  });

  it("plataforma desconhecida falha dizendo quais valem, e o nome de uma propriedade do objeto não é plataforma", () => {
    for (const name of ["solaris", "constructor", "toString", "__proto__", "hasOwnProperty"]) expect(() => parseTarget([name], "win32", "x64")).toThrow(/Plataforma desconhecida: ".*"\. Use win, linux, mac\./);
  });

  it("máquina sem plataforma do dist e sem pedido falha", () => {
    expect(() => parseTarget([], "freebsd", "x64")).toThrow(/Plataforma desconhecida: "freebsd"/);
  });

  it("arquitetura sem pacote para a plataforma falha, também com o nome de uma propriedade do objeto", () => {
    expect(() => parseTarget(["win", "arm64"], "win32", "x64")).toThrow(/Arquitetura sem pacote para win: "arm64"\. Use x64\./);
    expect(() => parseTarget(["mac", "ppc"], "darwin", "arm64")).toThrow(/Use arm64 ou x64/);
    expect(() => parseTarget(["mac", "constructor"], "darwin", "arm64")).toThrow(/Arquitetura sem pacote/);
  });

  it("macOS numa máquina de arquitetura sem pacote, sem pedido, falha em vez de adivinhar", () => {
    expect(() => parseTarget(["mac"], "linux", "ia32")).toThrow(/Arquitetura sem pacote para mac: "ia32"/);
  });
});

describe("parseHomepage", () => {
  it("ausente, vazia ou só espaços é não definida", () => {
    expect(parseHomepage(undefined)).toBeUndefined();
    expect(parseHomepage("")).toBeUndefined();
    expect(parseHomepage("  ")).toBeUndefined();
  });

  it("uma URL https bem formada vale, normalizada", () => {
    expect(parseHomepage("https://prism.example.invalid")).toBe("https://prism.example.invalid/");
    expect(parseHomepage(" https://prism.example.invalid/projeto ")).toBe("https://prism.example.invalid/projeto");
  });

  it("o que não é URL, não é https ou leva usuário e senha falha, sem repetir o valor", () => {
    for (const value of ["prism.example.invalid", "https://", "http://prism.example.invalid", "ftp://prism.example.invalid", "javascript:alert(1)", "https://usuario:segredo@prism.example.invalid/"]) {
      expect(() => parseHomepage(value)).toThrow(/PRISM_HOMEPAGE/);
      expect(() => parseHomepage(value)).not.toThrow(/segredo/);
    }
  });

  it("caracteres de shell ficam como dado: a URL é codificada e segue como um argumento só", () => {
    const homepage = parseHomepage("https://prism.example.invalid/a b;c$(x)");

    expect(homepage).not.toMatch(/\s/);
  });
});

describe("planDist", () => {
  const plan = (args: string[], env: Record<string, string | undefined> = {}) => planDist(args, env, "linux", "x64");

  it("Linux sem PRISM_HOMEPAGE gera só o que não precisa dela e diz o que ficou de fora", () => {
    const { builderArgs, skipped } = plan(["linux"]);

    expect(builderArgs.slice(builderArgs.indexOf("--linux"), builderArgs.indexOf("--x64"))).toEqual(["--linux", "AppImage", "tar.gz"]);
    expect(skipped).toEqual(["deb", "rpm"]);
    expect(builderArgs.some((argument) => argument.startsWith("-c."))).toBe(false);
  });

  it("Linux com PRISM_HOMEPAGE gera os quatro do yml e passa a URL em extraMetadata.homepage", () => {
    const { builderArgs, skipped } = plan(["linux"], { PRISM_HOMEPAGE: "https://prism.example.invalid" });

    expect(builderArgs[builderArgs.indexOf("--linux") + 1]).toBe("--x64");
    expect(skipped).toEqual([]);
    expect(builderArgs).toContain("-c.extraMetadata.homepage=https://prism.example.invalid/");
  });

  it("Linux com PRISM_HOMEPAGE inválida falha antes de qualquer coisa", () => {
    expect(() => plan(["linux"], { PRISM_HOMEPAGE: "http://prism.example.invalid" })).toThrow(/PRISM_HOMEPAGE/);
  });

  it("Windows e macOS usam os alvos do yml, não levam o homepage e ignoram a variável, até a inválida", () => {
    for (const args of [["win"], ["mac", "arm64"]]) {
      const { builderArgs, skipped } = plan(args, { PRISM_HOMEPAGE: "isto não é uma URL" });

      expect(skipped).toEqual([]);
      expect(builderArgs).toEqual(["--config", "electron-builder.yml", `--${args[0]}`, `--${args[1] ?? "x64"}`, "--publish", "never"]);
    }
  });

  it("nunca publica", () => {
    for (const args of [["win"], ["linux"], ["mac", "x64"]]) {
      const { builderArgs } = plan(args);

      expect(builderArgs[builderArgs.indexOf("--publish") + 1]).toBe("never");
    }
  });
});

describe("parseUpdateOrigin (RN-ATUALIZA-001, RN-GITHUB-005): a origem das atualizações, gravada no pacote", () => {
  const api = "https://api.github.com";
  const site = "https://github.com";
  const repository = "Zanveri/prism";

  it("sem as três (ausentes, vazias ou só espaços), não há origem", () => {
    expect(parseUpdateOrigin(undefined, undefined, undefined)).toBeUndefined();
    expect(parseUpdateOrigin("", "  ", "\t")).toBeUndefined();
  });

  it("as três válidas: os endereços sem a barra do fim, e o repositório como veio", () => {
    expect(parseUpdateOrigin(api, site, repository)).toEqual({ api, site, repository });
    expect(parseUpdateOrigin(` ${api}/ `, ` ${site}// `, ` ${repository} `)).toEqual({ api, site, repository });
    // O GitHub Enterprise Server tem a API num caminho (`https://<servidor>/api/v3`).
    expect(parseUpdateOrigin("https://ghe.example.invalid/api/v3/", "https://ghe.example.invalid/", "equipe/prism")).toEqual({ api: "https://ghe.example.invalid/api/v3", site: "https://ghe.example.invalid", repository: "equipe/prism" });
  });

  it("só uma ou duas das três falha, dizendo que são as três ou nenhuma", () => {
    for (const values of [[api, undefined, undefined], [undefined, site, undefined], [undefined, undefined, repository], [api, site, ""], [api, " ", repository], ["", site, repository]]) {
      expect(() => parseUpdateOrigin(values[0], values[1], values[2]), JSON.stringify(values)).toThrow(/PRISM_UPDATE_API, PRISM_UPDATE_SITE e PRISM_UPDATE_REPOSITORY andam juntas/);
    }
  });

  it("cada endereço tem de ser https, sem usuário, senha, consulta nem fragmento; a mensagem diz qual é e não repete o valor", () => {
    const hostile = ["api.github.com", "https://", "http://api.github.com", "http://127.0.0.1:8123", "ftp://api.github.com", "javascript:alert(1)", "https://usuario:segredo@api.github.com", "https://segredo@api.github.com", `${api}?token=segredo`, `${api}?`, `${api}#segredo`, `${api}#`, 42, {}, null];
    for (const value of hostile) {
      expect(() => parseUpdateOrigin(value, site, repository), `API ${String(value)}`).toThrow(/PRISM_UPDATE_API/);
      expect(() => parseUpdateOrigin(site, value, repository), `site ${String(value)}`).toThrow(/PRISM_UPDATE_SITE/);
      expect(() => parseUpdateOrigin(value, site, repository)).not.toThrow(/segredo/);
      expect(() => parseUpdateOrigin(api, value, repository)).not.toThrow(/segredo/);
    }
  });

  it("o repositório é `dono/repositório` no formato do GitHub", () => {
    for (const value of ["Zanveri/prism", "a/b", "dono-1/repo.nome_x-2", "dono/.github", "D0N0/Prism.Docs", `${"d".repeat(39)}/${"r".repeat(100)}`]) expect(parseUpdateOrigin(api, site, value)?.repository, value).toBe(value);
  });

  it("repositório fora do formato do GitHub falha: sem barra a mais, sem `..`, sem caractere que o GitHub não aceita; a mensagem não repete o valor", () => {
    const hostile = [
      "prism", "Zanveri/", "/prism", "Zanveri/prism/", "Zanveri//prism", "Zanveri/prism/releases", "Zanveri/prism/../../x",
      "../prism", "Zanveri/..", "Zanveri/.", "Zanveri/a..b", "..", ".", "-dono/prism", "dono-/prism", "dono_x/prism", "dono.x/prism",
      "dono/pr ism", "dono/prism?x=1", "dono/prism#x", "dono/prism%2F..", "dono\\prism", "dono/pri\nsm", "dono/prism;rm -rf /", "dono/$(segredo)",
      "dono/prism\u202e", "dono/ação", "dono/prism\u0000", "https://github.com/Zanveri/prism", "github.com/Zanveri/prism", `${"d".repeat(40)}/prism`, `dono/${"r".repeat(101)}`,
      42, {}, null, ["Zanveri/prism"],
    ];
    for (const value of hostile) {
      expect(() => parseUpdateOrigin(api, site, value), JSON.stringify(value)).toThrow(/PRISM_UPDATE_REPOSITORY/);
      expect(() => parseUpdateOrigin(api, site, value)).not.toThrow(/segredo/);
    }
  });

  it("http em 127.0.0.1 só vale quando quem chama diz que é desenvolvimento, e só nesse endereço, nos dois endereços", () => {
    expect(parseUpdateOrigin("http://127.0.0.1:8123", "http://127.0.0.1:8124/", repository, { allowLoopbackHttp: true })).toEqual({ api: "http://127.0.0.1:8123", site: "http://127.0.0.1:8124", repository });
    for (const value of ["http://localhost:8123", "http://api.github.com", "http://127.0.0.1.example.invalid"]) {
      expect(() => parseUpdateOrigin(value, site, repository, { allowLoopbackHttp: true }), value).toThrow(/PRISM_UPDATE_API/);
      expect(() => parseUpdateOrigin(api, value, repository, { allowLoopbackHttp: true }), value).toThrow(/PRISM_UPDATE_SITE/);
    }
  });
});

describe("planDist: a origem das atualizações vai ao electron-builder (RN-ATUALIZA-001, RN-GITHUB-005)", () => {
  const api = "https://api.github.com";
  const site = "https://github.com";
  const origin = { PRISM_UPDATE_API: api, PRISM_UPDATE_SITE: site, PRISM_UPDATE_REPOSITORY: "Zanveri/prism" };
  const plan = (args: string[], env: Record<string, string | undefined> = {}) => planDist(args, env, "linux", "x64");
  const originArgs = (builderArgs: string[]) => builderArgs.filter((argument) => argument.startsWith("-c.extraMetadata.prismUpdate"));

  it("com as três variáveis, os três valores chegam como um argumento cada, nas três plataformas", () => {
    for (const args of [["win"], ["linux"], ["mac", "arm64"]]) {
      const { builderArgs, updateOrigin } = plan(args, origin);

      expect(originArgs(builderArgs)).toEqual([`-c.extraMetadata.prismUpdateApi=${api}`, `-c.extraMetadata.prismUpdateSite=${site}`, "-c.extraMetadata.prismUpdateRepository=Zanveri/prism"]);
      expect(updateOrigin).toBe(true);
    }
  });

  it("sem elas o pacote sai sem origem, e o plano diz isso", () => {
    const { builderArgs, updateOrigin } = plan(["win"]);

    expect(builderArgs.some((argument) => argument.includes("prismUpdate"))).toBe(false);
    expect(updateOrigin).toBe(false);
  });

  it("PRISM_UPDATE_PROJECT (a origem do GitLab) deixou de existir: sozinho não vira origem, e não vai ao pacote", () => {
    const { builderArgs, updateOrigin } = plan(["win"], { PRISM_UPDATE_PROJECT: "42" });

    expect(builderArgs.some((argument) => argument.includes("prismUpdate"))).toBe(false);
    expect(updateOrigin).toBe(false);
    expect(() => plan(["win"], { PRISM_UPDATE_API: api, PRISM_UPDATE_PROJECT: "42" })).toThrow(/andam juntas/);
  });

  it("caracteres de shell ficam como dado: o endereço é codificado e segue num argumento só", () => {
    const { builderArgs } = plan(["win"], { ...origin, PRISM_UPDATE_SITE: "https://ghe.example.invalid/a b;c$(x)" });
    const argument = builderArgs.find((each) => each.startsWith("-c.extraMetadata.prismUpdateSite="));

    expect(argument).toBeDefined();
    expect(argument).not.toMatch(/\s/);
  });

  it("valor inválido falha com mensagem clara, em qualquer plataforma, antes de qualquer coisa", () => {
    for (const args of [["win"], ["linux"], ["mac", "x64"]]) {
      expect(() => plan(args, { ...origin, PRISM_UPDATE_API: "http://api.github.com" })).toThrow(/PRISM_UPDATE_API tem de ser uma URL https/);
      expect(() => plan(args, { ...origin, PRISM_UPDATE_SITE: "http://github.com" })).toThrow(/PRISM_UPDATE_SITE tem de ser uma URL https/);
      expect(() => plan(args, { ...origin, PRISM_UPDATE_REPOSITORY: "Zanveri/prism/../x" })).toThrow(/PRISM_UPDATE_REPOSITORY/);
      expect(() => plan(args, { PRISM_UPDATE_API: api })).toThrow(/andam juntas/);
    }
  });

  it("a origem convive com o homepage do Linux", () => {
    const { builderArgs, skipped } = plan(["linux"], { ...origin, PRISM_HOMEPAGE: "https://prism.example.invalid" });

    expect(skipped).toEqual([]);
    expect(builderArgs.filter((argument) => argument.startsWith("-c."))).toEqual(["-c.extraMetadata.homepage=https://prism.example.invalid/", `-c.extraMetadata.prismUpdateApi=${api}`, `-c.extraMetadata.prismUpdateSite=${site}`, "-c.extraMetadata.prismUpdateRepository=Zanveri/prism"]);
  });
});
