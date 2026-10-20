import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createResultWindowSaver, parseResultWindow, readResultWindow, resultWindowFileName, saveEveryMs, writeResultWindow, type SavedResultWindow } from "./result-window-file";

const saved: SavedResultWindow = { x: 120, y: 80, width: 1000, height: 640, maximized: false };

describe("o arquivo do lugar da janela do resultado (RN-ABAS-013): desta instalação, na pasta de dados, fora do cofre", () => {
  const dir = mkdtempSync(join(tmpdir(), "prism-result-window-"));
  const file = join(dir, "dados", resultWindowFileName);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("grava de uma vez e lê de volta; a pasta é criada, e nada fica pela metade ao lado", () => {
    writeResultWindow(file, saved);

    expect(readResultWindow(file)).toEqual(saved);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(saved);
    expect(readdirSync(join(dir, "dados"))).toEqual([resultWindowFileName]);

    writeResultWindow(file, { ...saved, maximized: true });
    expect(readResultWindow(file)).toEqual({ ...saved, maximized: true });
  });

  it("arquivo que não existe, que é uma pasta, cortado ou adulterado é como se não existisse", () => {
    expect(readResultWindow(file)).toBeNull();

    mkdirSync(file, { recursive: true });
    expect(readResultWindow(file)).toBeNull();
  });

  it.each([
    ["texto cortado", '{"x": 12'],
    ["outra forma", '{"zoom": 125}'],
    ["não é objeto", "[1,2,3]"],
    ["largura abaixo do mínimo", JSON.stringify({ ...saved, width: 100 })],
    ["altura abaixo do mínimo", JSON.stringify({ ...saved, height: 100 })],
    ["coordenada que não é inteira", JSON.stringify({ ...saved, x: 1.5 })],
    ["campo a mais", JSON.stringify({ ...saved, extra: true })],
    ["maximizada que não é verdadeiro ou falso", JSON.stringify({ ...saved, maximized: "sim" })],
    ["tamanho absurdo", JSON.stringify({ ...saved, width: 10_000_000 })],
  ])("%s: não vale", (_name, text) => {
    expect(parseResultWindow(text)).toBeNull();
  });
});

describe("a gravação do lugar: no máximo uma a cada 500 ms, e mais uma ao fechar", () => {
  function harness() {
    let clock = 10_000;
    const written: SavedResultWindow[] = [];
    const timers: { run: () => void; at: number; canceled: boolean }[] = [];
    const logs: string[] = [];
    const saver = createResultWindowSaver({
      write: (value) => void written.push(value),
      now: () => clock,
      schedule(run, ms) {
        const timer = { run, at: clock + ms, canceled: false };
        timers.push(timer);
        return () => {
          timer.canceled = true;
        };
      },
      log: (message) => void logs.push(message),
    });
    const advance = (ms: number) => {
      clock += ms;
      for (const timer of timers) if (!timer.canceled && timer.at <= clock) {
        timer.canceled = true;
        timer.run();
      }
    };
    return { saver, written, advance, logs, timers };
  }

  it("a primeira mudança grava na hora; as seguintes dentro de 500 ms viram uma só, no fim do intervalo, com o lugar mais novo", () => {
    const { saver, written, advance } = harness();

    saver.change({ ...saved, x: 1 });
    expect(written).toEqual([{ ...saved, x: 1 }]);

    advance(100);
    saver.change({ ...saved, x: 2 });
    advance(100);
    saver.change({ ...saved, x: 3 });
    expect(written).toHaveLength(1);

    advance(saveEveryMs - 200);
    expect(written).toEqual([{ ...saved, x: 1 }, { ...saved, x: 3 }]);
  });

  it("ao fechar grava o lugar final já, cancela a gravação marcada e não grava de novo", () => {
    const { saver, written, advance } = harness();

    saver.change({ ...saved, x: 1 });
    advance(50);
    saver.change({ ...saved, x: 2 });
    saver.close({ ...saved, x: 9, maximized: true });
    advance(1000);

    expect(written).toEqual([{ ...saved, x: 1 }, { ...saved, x: 9, maximized: true }]);
  });

  it("gravar que falha só vai para o log, e a próxima mudança tenta de novo", () => {
    let fail = true;
    const logs: string[] = [];
    const written: SavedResultWindow[] = [];
    const saver = createResultWindowSaver({
      write(value) {
        if (fail) throw new Error("disco cheio");
        written.push(value);
      },
      now: () => 1_000_000,
      schedule: () => () => {},
      log: (message) => void logs.push(message),
    });

    saver.change(saved);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("disco cheio");

    fail = false;
    saver.close(saved);
    expect(written).toEqual([saved]);
  });
});
