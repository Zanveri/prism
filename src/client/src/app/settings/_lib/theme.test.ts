import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { themeModes } from "./preferences";
import { appliedTheme, applyTheme, currentScheme, resolveScheme, themeSchemes, themeStorageKey } from "./theme";

/** O script que o `index.html` roda antes da primeira pintura: um arquivo de verdade em `public/`, executado aqui como o navegador o faria. */
const bootSource = readFileSync(new URL("../../../../public/theme-boot.js", import.meta.url), "utf8");
const indexHtml = readFileSync(new URL("../../../../index.html", import.meta.url), "utf8");

type FakeRoot = { dataset: Record<string, string | undefined> };
const newRoot = (): FakeRoot => ({ dataset: {} });

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

/** Roda o script de abertura com este armazenamento (ou sem `localStorage`, ou com ele lançando) e devolve o que ele pôs no <html>. */
function boot(localStorage: unknown): string | undefined {
  const root = newRoot();
  runInNewContext(bootSource, { document: { documentElement: root }, ...(localStorage === undefined ? {} : { localStorage }) });
  return root.dataset.theme;
}

describe("aplicar o tema", () => {
  it("põe o modo no <html>, que é onde o CSS o lê (data-theme), e guarda o último modo para a próxima abertura", () => {
    const root = newRoot();
    const storage = memoryStorage();

    applyTheme("light", root, storage);

    expect(root.dataset.theme).toBe("light");
    expect(storage.items.get(themeStorageKey)).toBe("light");
  });

  it.each(themeModes)("aceita o modo %s", (mode) => {
    const root = newRoot();

    applyTheme(mode, root, memoryStorage());

    expect(root.dataset.theme).toBe(mode);
  });

  it("o tema vale mesmo sem armazenamento, ou com ele recusando a gravação", () => {
    const withoutStorage = newRoot();
    applyTheme("light", withoutStorage, null);
    expect(withoutStorage.dataset.theme).toBe("light");

    const refusing = newRoot();
    applyTheme("system", refusing, {
      setItem: () => {
        throw new Error("cota excedida");
      },
    });
    expect(refusing.dataset.theme).toBe("system");
  });

  it("a chave é a do dispositivo, e não a do usuário: o login acontece antes de se saber quem entrou", () => {
    expect(themeStorageKey).toBe("prism:theme");
  });
});

describe("o script de abertura (sem piscar o tema errado)", () => {
  it.each(themeModes)("aplica o último modo guardado (%s) antes de a página pintar", (mode) => {
    expect(boot(memoryStorage({ [themeStorageKey]: mode }))).toBe(mode);
  });

  it("lê a mesma chave e os mesmos valores que o aplicativo grava (ida e volta)", () => {
    for (const mode of themeModes) {
      const storage = memoryStorage();
      applyTheme(mode, newRoot(), storage);

      expect(boot(storage)).toBe(mode);
    }
  });

  it("sem nada guardado, ou com lixo, não mexe em nada: o CSS já é escuro por padrão", () => {
    expect(boot(memoryStorage())).toBeUndefined();
    expect(boot(memoryStorage({ [themeStorageKey]: "sepia" }))).toBeUndefined();
    expect(boot(memoryStorage({ [themeStorageKey]: "" }))).toBeUndefined();
    expect(boot(memoryStorage({ [themeStorageKey]: "<script>alert(1)</script>" }))).toBeUndefined();
  });

  it("sem localStorage, ou com o acesso recusado, a página abre mesmo assim", () => {
    expect(boot(undefined)).toBeUndefined();
    expect(
      boot({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBeUndefined();
  });

  it("é um script clássico, de um arquivo só: sem import, sem export e sem eval (a política de conteúdo só deixa scripts do próprio app)", () => {
    expect(bootSource).not.toMatch(/\b(import|export|eval)\b|new Function/);
  });

  it("o index.html o carrega no <head>, antes do app, e sem defer, async nem type=module: é o que faz a pintura esperar por ele", () => {
    const boot = indexHtml.indexOf('<script src="/theme-boot.js"></script>');

    expect(boot).toBeGreaterThan(indexHtml.indexOf("<head>"));
    expect(boot).toBeLessThan(indexHtml.indexOf("</head>"));
    // O Vite põe o <script type="module"> do app no fim do <head> ao construir; aqui ele ainda está no <body>.
    expect(boot).toBeLessThan(indexHtml.indexOf('type="module"'));
  });
});

describe("o esquema de cor que vale", () => {
  it("escuro e claro valem por si; 'system' vale o do sistema", () => {
    expect(resolveScheme("dark", true)).toBe("dark");
    expect(resolveScheme("light", false)).toBe("light");
    expect(resolveScheme("system", true)).toBe("light");
    expect(resolveScheme("system", false)).toBe("dark");
  });

  it("cada um dos outros quatro temas tem o esquema dele, seja qual for o do sistema: Monokai, Dracula e Nord são escuros, e o GitHub Claro é claro", () => {
    for (const prefersLight of [true, false]) {
      expect(resolveScheme("monokai", prefersLight)).toBe("dark");
      expect(resolveScheme("dracula", prefersLight)).toBe("dark");
      expect(resolveScheme("nord", prefersLight)).toBe("dark");
      expect(resolveScheme("github-light", prefersLight)).toBe("light");
      expect(resolveScheme("kanagawa", prefersLight)).toBe("dark");
    }
  });

  it("todo modo que não é 'system' tem esquema, e a tabela não tem mais nada", () => {
    expect(Object.keys(themeSchemes).sort()).toEqual(themeModes.filter((mode) => mode !== "system").sort());
  });

  it("o tema que está na tela: o escolhido, ou, seguindo o sistema, o Prism Escuro ou o Prism Claro", () => {
    expect(appliedTheme("dracula", true)).toBe("dracula");
    expect(appliedTheme("nord", false)).toBe("nord");
    expect(appliedTheme("system", true)).toBe("light");
    expect(appliedTheme("system", false)).toBe("dark");
  });

  it("lê do <html> o que está aplicado; sem nada aplicado é o escuro", () => {
    const withTheme = (theme?: string): FakeRoot => ({ dataset: theme === undefined ? {} : { theme } });

    expect(currentScheme(withTheme(), true)).toBe("dark");
    expect(currentScheme(withTheme("light"), false)).toBe("light");
    expect(currentScheme(withTheme("dark"), true)).toBe("dark");
    expect(currentScheme(withTheme("system"), true)).toBe("light");
    expect(currentScheme(withTheme("system"), false)).toBe("dark");
    expect(currentScheme(withTheme("github-light"), false)).toBe("light");
    expect(currentScheme(withTheme("monokai"), true)).toBe("dark");
    expect(currentScheme(withTheme("qualquer-coisa"), true)).toBe("dark");
  });
});
