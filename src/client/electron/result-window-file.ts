import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * Onde a janela do resultado lembra o tamanho e o lugar (RN-ABAS-013): `result-window.json`, ao lado do `zoom.json`, na pasta de dados, fora do cofre, gravado
 * só pelo processo principal. É desta instalação, e não de um usuário, e é contrato (RN-VERSAO-002): a forma abaixo não muda sem subir o número.
 */
export const resultWindowFileName = "result-window.json";

/** O mínimo da janela do resultado, e o tamanho da primeira (RN-ABAS-013). */
export const resultWindowMinimum = { width: 480, height: 320 };
export const resultWindowFirst = { width: 960, height: 600 };

/** No máximo uma gravação a cada tanto enquanto a janela se move ou muda de tamanho (RN-ABAS-013). */
export const saveEveryMs = 500;

const coordinate = z.number().int().min(-100_000).max(100_000);

/** O lugar lembrado: o tamanho de uma janela sem maximizar (`getNormalBounds()`), e se estava maximizada. */
export const savedResultWindowSchema = z
  .object({
    x: coordinate,
    y: coordinate,
    width: z.number().int().min(resultWindowMinimum.width).max(100_000),
    height: z.number().int().min(resultWindowMinimum.height).max(100_000),
    maximized: z.boolean(),
  })
  .strict();

export type SavedResultWindow = z.infer<typeof savedResultWindowSchema>;

/** O arquivo lido: o lugar lembrado, ou `null` quando ele não diz um (texto cortado, outra forma, tamanho que não cabe). */
export function parseResultWindow(text: string): SavedResultWindow | null {
  try {
    const parsed = savedResultWindowSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Arquivo que não existe, que é uma pasta ou que não se deixa ler é como se não existisse: vale o lugar da primeira, sem erro. */
export function readResultWindow(file: string): SavedResultWindow | null {
  try {
    return parseResultWindow(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Grava num arquivo ao lado e troca: um app fechado no meio não deixa o arquivo pela metade (como o `zoom.json`). */
export function writeResultWindow(file: string, saved: SavedResultWindow): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2));
  renameSync(`${file}.tmp`, file);
}

export type ResultWindowSaverDeps = {
  write(saved: SavedResultWindow): void;
  now(): number;
  schedule(run: () => void, ms: number): () => void;
  log(message: string): void;
};

/**
 * A gravação do lugar, no máximo uma vez a cada 500 ms enquanto a janela se move ou muda de tamanho, e mais uma ao fechar (RN-ABAS-013). `change` guarda o
 * lugar de agora e marca a gravação para o fim do intervalo (ou a faz na hora, se o último foi há mais que isso); `close` grava o lugar final já. Gravar que
 * falha só vai para o log: o lugar vale até fechar.
 */
export function createResultWindowSaver(deps: ResultWindowSaverDeps) {
  let pending: SavedResultWindow | null = null;
  let cancel: (() => void) | null = null;
  let lastWriteAt = Number.NEGATIVE_INFINITY;

  function flush(): void {
    cancel?.();
    cancel = null;
    if (pending === null) return;

    const saved = pending;
    pending = null;
    lastWriteAt = deps.now();
    try {
      deps.write(saved);
    } catch (error) {
      deps.log(`janela do resultado: o lugar não foi gravado: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    change(saved: SavedResultWindow): void {
      pending = saved;
      if (cancel !== null) return;

      const wait = saveEveryMs - (deps.now() - lastWriteAt);
      if (wait <= 0) return flush();
      cancel = deps.schedule(flush, wait);
    },
    close(saved: SavedResultWindow): void {
      pending = saved;
      flush();
    },
  };
}

export type ResultWindowSaver = ReturnType<typeof createResultWindowSaver>;
