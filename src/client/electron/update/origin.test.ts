import { describe, expect, it } from "vitest";

import { githubApiHeaders, maxReleasePages, packageUrl, redirectAllowed, releasesUrl, resolveOrigin, updatesBlocked } from "./origin";

const api = "https://api.github.com";
const site = "https://github.com";
const repository = "Zanveri/prism";
const recorded = { prismUpdateApi: api, prismUpdateSite: site, prismUpdateRepository: repository };
const packaged = (metadata: Record<string, unknown>, env: Record<string, string | undefined> = {}) => resolveOrigin({ isPackaged: true, metadata, env }).origin;
const dev = (env: Record<string, string | undefined>, metadata: Record<string, unknown> = {}) => resolveOrigin({ isPackaged: false, metadata, env }).origin;

describe("a origem das atualizações (RN-ATUALIZA-001): o repositório do GitHub de onde o pacote saiu", () => {
  it("no app empacotado vem do package.json do pacote: a API, o site e o dono/repositório", () => {
    expect(packaged(recorded)).toEqual({ api, site, repository });
    expect(packaged({ prismUpdateApi: `${api}/`, prismUpdateSite: `${site}/`, prismUpdateRepository: repository })).toEqual({ api, site, repository });
  });

  it("pacote gerado sem os três valores não tem origem", () => {
    expect(packaged({})).toBeNull();
    expect(packaged({ prismUpdateApi: api })).toBeNull();
    expect(packaged({ prismUpdateApi: api, prismUpdateSite: site })).toBeNull();
    expect(packaged({ prismUpdateRepository: repository })).toBeNull();
  });

  it("a origem do GitLab (identificador numérico do projeto) não vale mais: sem origem", () => {
    expect(packaged({ prismUpdateApi: "https://gitlab.example.invalid/api/v4", prismUpdateProject: 42 })).toBeNull();
  });

  it("variável de ambiente em tempo de execução não muda a origem do app empacotado", () => {
    const env = { PRISM_UPDATE_API: "https://outro.example.invalid", PRISM_UPDATE_SITE: "https://outro.example.invalid", PRISM_UPDATE_REPOSITORY: "outro/repo" };

    expect(packaged({}, env)).toBeNull();
    expect(packaged(recorded, env)).toEqual({ api, site, repository });
  });

  it("no app empacotado os dois endereços são https: http não vale, nem em 127.0.0.1", () => {
    expect(packaged({ ...recorded, prismUpdateApi: "http://api.github.com" })).toBeNull();
    expect(packaged({ ...recorded, prismUpdateSite: "http://127.0.0.1:8123" })).toBeNull();
  });

  it("endereço inválido, com usuário e senha, com consulta ou com fragmento: sem origem", () => {
    for (const value of ["", "api.github.com", "https://", "ftp://api.github.com", "javascript:alert(1)", "https://usuario:segredo@api.github.com", "https://usuario@api.github.com", `${api}?x=1`, `${api}?`, `${api}#x`, 42, null, {}]) {
      expect(packaged({ ...recorded, prismUpdateApi: value }), `API ${JSON.stringify(value)}`).toBeNull();
      expect(packaged({ ...recorded, prismUpdateSite: value }), `site ${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("repositório fora do formato do GitHub: sem origem", () => {
    for (const value of ["", "prism", "Zanveri/", "Zanveri/prism/", "Zanveri//prism", "../prism", "Zanveri/..", "Zanveri/a..b", "dono/pr ism", "dono/prism?x=1", "dono/pri\nsm", "dono_x/prism", 42, null, {}]) {
      expect(packaged({ ...recorded, prismUpdateRepository: value }), JSON.stringify(value)).toBeNull();
    }
  });

  it("quando recusa, diz o motivo sem repetir o valor", () => {
    const { origin, problem } = resolveOrigin({ isPackaged: true, metadata: { ...recorded, prismUpdateSite: "https://usuario:segredo@github.com" }, env: {} });

    expect(origin).toBeNull();
    expect(problem).toMatch(/PRISM_UPDATE_SITE/);
    expect(problem).not.toMatch(/segredo/);
  });

  it("em desenvolvimento, e só nele, vem das variáveis de ambiente, e os endereços podem ser http em 127.0.0.1", () => {
    expect(dev({ PRISM_UPDATE_API: "http://127.0.0.1:8123", PRISM_UPDATE_SITE: "http://127.0.0.1:8124", PRISM_UPDATE_REPOSITORY: repository })).toEqual({ api: "http://127.0.0.1:8123", site: "http://127.0.0.1:8124", repository });
    expect(dev({ PRISM_UPDATE_API: api, PRISM_UPDATE_SITE: site, PRISM_UPDATE_REPOSITORY: repository })).toEqual({ api, site, repository });
    expect(dev({})).toBeNull();
    expect(dev({}, recorded)).toBeNull();
  });

  it("em desenvolvimento, http fora de 127.0.0.1 não vale", () => {
    for (const value of ["http://localhost:8123", "http://api.github.com", "http://127.0.0.1.example.invalid", "http://[::1]:8123"]) {
      expect(dev({ PRISM_UPDATE_API: value, PRISM_UPDATE_SITE: site, PRISM_UPDATE_REPOSITORY: repository }), value).toBeNull();
      expect(dev({ PRISM_UPDATE_API: api, PRISM_UPDATE_SITE: value, PRISM_UPDATE_REPOSITORY: repository }), value).toBeNull();
    }
  });
});

describe("a linha de comando que desliga o atualizador (RN-ATUALIZA-008: a conferência do certificado nunca é desligada)", () => {
  const withSwitches = (...present: string[]) => (name: string) => present.includes(name);

  it("no app empacotado, cada um dos quatro argumentos desliga as atualizações", () => {
    for (const name of ["ignore-certificate-errors", "ignore-certificate-errors-spki-list", "host-resolver-rules", "host-rules"]) {
      expect(updatesBlocked({ isPackaged: true, hasSwitch: withSwitches(name) }), name).toBe(true);
    }
    expect(updatesBlocked({ isPackaged: true, hasSwitch: withSwitches("user-data-dir", "host-rules") })).toBe(true);
  });

  it("sem nenhum deles, e com outros argumentos quaisquer, o atualizador funciona", () => {
    expect(updatesBlocked({ isPackaged: true, hasSwitch: withSwitches() })).toBe(false);
    expect(updatesBlocked({ isPackaged: true, hasSwitch: withSwitches("user-data-dir", "remote-debugging-port", "updated", "ignore-certificate-errors-not") })).toBe(false);
  });

  it("em desenvolvimento a regra não se aplica (a origem lá já é a de quem chamou)", () => {
    expect(updatesBlocked({ isPackaged: false, hasSwitch: withSwitches("ignore-certificate-errors", "host-resolver-rules") })).toBe(false);
  });
});

describe("os endereços (RN-ATUALIZA-002 e 005): montados só da origem, da versão validada e do nome da lista", () => {
  const origin = { api, site, repository };

  it("a lista de releases na API do GitHub, cem por página: a primeira sem número de página, as seguintes com ele", () => {
    expect(releasesUrl(origin)).toBe("https://api.github.com/repos/Zanveri/prism/releases?per_page=100");
    expect(releasesUrl(origin, 1)).toBe("https://api.github.com/repos/Zanveri/prism/releases?per_page=100");
    expect(releasesUrl(origin, 2)).toBe("https://api.github.com/repos/Zanveri/prism/releases?per_page=100&page=2");
    expect(releasesUrl({ ...origin, api: "https://ghe.example.invalid/api/v3" }, maxReleasePages)).toBe(`https://ghe.example.invalid/api/v3/repos/Zanveri/prism/releases?per_page=100&page=${maxReleasePages}`);
  });

  it("número de página fora do teto não vira endereço", () => {
    for (const page of [0, -1, 1.5, maxReleasePages + 1, Number.NaN]) expect(() => releasesUrl(origin, page), String(page)).toThrow();
  });

  it("os cabeçalhos que a API do GitHub pede: o tipo de resposta e a versão da API, e nada que identifique quem pergunta", () => {
    expect(githubApiHeaders).toEqual({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  });

  it("um pacote e o SHA256SUMS da versão, no endereço de download de um arquivo de release do site", () => {
    expect(packageUrl(origin, "0.2.0", "Prism-0.2.0-win-x64.exe")).toBe("https://github.com/Zanveri/prism/releases/download/v0.2.0/Prism-0.2.0-win-x64.exe");
    expect(packageUrl(origin, "0.2.0", "SHA256SUMS")).toBe("https://github.com/Zanveri/prism/releases/download/v0.2.0/SHA256SUMS");
  });

  it("um beta: a tag é a do pré-lançamento, e o nome do arquivo leva a versão inteira (RN-ATUALIZA-010)", () => {
    expect(packageUrl(origin, "0.3.0-beta.2", "Prism-0.3.0-beta.2-win-x64.exe")).toBe("https://github.com/Zanveri/prism/releases/download/v0.3.0-beta.2/Prism-0.3.0-beta.2-win-x64.exe");
    expect(packageUrl(origin, "0.3.0-beta.2", "SHA256SUMS")).toBe("https://github.com/Zanveri/prism/releases/download/v0.3.0-beta.2/SHA256SUMS");
    expect(() => packageUrl(origin, "0.3.0-beta.2", "Prism-0.3.0-win-x64.exe")).toThrow();
  });

  it("versão que não é a de uma release (X.Y.Z ou X.Y.Z-beta.N) não vira endereço", () => {
    for (const version of ["v0.2.0", "0.2", "0.2.0/../x", "../0.2.0", "0.2.0 ", "", "0.2.0?x=1", "0.2.0#x", "0.2.0-beta.1/../x", "0.2.0-alpha.1", "0.2.0-beta", "v0.2.0-beta.1"]) expect(() => packageUrl(origin, version, "SHA256SUMS"), version).toThrow();
  });

  it("nome de arquivo que não é o de um pacote daquela versão não vira endereço", () => {
    for (const file of ["../x", "a/b", "Prism-0.3.0-win-x64.exe", "evil.exe", "https://evil.example.invalid/x", "Prism-0.2.0-win-x64.exe/../../x", "Prism-0.2.0-win-x64.exe?x=1", "", "sha256sums"]) expect(() => packageUrl(origin, "0.2.0", file), file).toThrow();
  });

  it("dono e repositório hostis não viram endereço, nem numa origem montada à mão (a origem só nasce validada, e o endereço confere de novo)", () => {
    for (const hostile of ["Zanveri/prism/../../outro/repo", "../../x", "Zanveri/prism?x=1", "Zanveri/prism#x", "Zanveri", "evil.example.invalid/x/y", "a/b/c", "Zanveri/pri sm", "Zanveri/prism\n"]) {
      expect(() => releasesUrl({ ...origin, repository: hostile }), hostile).toThrow();
      expect(() => packageUrl({ ...origin, repository: hostile }, "0.2.0", "SHA256SUMS"), hostile).toThrow();
    }
  });
});

describe("redirecionamento do download (RN-ATUALIZA-008): só para https", () => {
  const origin = { api, site, repository };
  const loopback = { api: "http://127.0.0.1:8123", site: "http://127.0.0.1:8124", repository };

  it("https vale, para qualquer servidor (o GitHub manda o download de um arquivo de release para outro domínio)", () => {
    expect(redirectAllowed("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r&sig=x", origin)).toBe(true);
    expect(redirectAllowed("https://objects.githubusercontent.com/a/b", origin)).toBe(true);
  });

  it("http, outro esquema, usuário e senha, ou o que não é URL: não", () => {
    for (const target of ["http://objects.githubusercontent.com/a", "http://127.0.0.1:9/a", "file:///C:/x", "javascript:alert(1)", "data:text/plain,x", "ftp://x.example.invalid/a", "https://u:p@objects.githubusercontent.com/a", "//objects.githubusercontent.com/a", "/a/b", "", "nada"]) {
      expect(redirectAllowed(target, origin), target).toBe(false);
    }
  });

  it("com o site de desenvolvimento em http://127.0.0.1, o redirecionamento para 127.0.0.1 em http também vale, e só ele", () => {
    expect(redirectAllowed("http://127.0.0.1:9999/arquivo", loopback)).toBe(true);
    expect(redirectAllowed("https://objects.githubusercontent.com/a", loopback)).toBe(true);
    expect(redirectAllowed("http://objects.githubusercontent.com/a", loopback)).toBe(false);
    expect(redirectAllowed("http://localhost:9999/arquivo", loopback)).toBe(false);
  });
});
