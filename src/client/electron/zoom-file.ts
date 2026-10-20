import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { defaultAppZoom, parseAppZoom, type AppZoom } from "./zoom";

/**
 * Onde o zoom do programa fica (RN-ZOOM-001): `zoom.json`, na pasta de dados, fora do cofre, gravado só pelo processo principal. É desta instalação, e não
 * de um usuário: o splash e o login já abrem nele, antes de se saber quem entra. Mesma forma das preferências de atualização (`update/preferences.ts`).
 */
export const zoomFileName = "zoom.json";

/** Arquivo que não existe, que é uma pasta ou que não se deixa ler: 100%, sem derrubar o app. */
export function readAppZoom(file: string): AppZoom {
  try {
    return parseAppZoom(readFileSync(file, "utf8"));
  } catch {
    return defaultAppZoom;
  }
}

/** Grava num arquivo ao lado e troca: um app fechado no meio não deixa o arquivo pela metade. */
export function writeAppZoom(file: string, zoom: AppZoom): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ zoom }, null, 2));
  renameSync(`${file}.tmp`, file);
}
