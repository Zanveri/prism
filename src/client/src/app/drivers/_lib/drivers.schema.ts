import { z } from "zod";

/**
 * Os estados de um driver (RN-DRIVER-002): `bundled` vem no pacote; `available` pode ser baixado;
 * `installing`, `installed` e `failed` são o caminho da instalação; `unavailable` é plataforma que
 * o fabricante não atende; `comingSoon` é banco que o Prism ainda não conecta.
 */
export const driverStates = ["bundled", "available", "installing", "installed", "failed", "unavailable", "comingSoon"] as const;

export type DriverState = (typeof driverStates)[number];

const bytes = z.number().int().nonnegative();

/**
 * O endereço do texto oficial da licença é mostrado e copiado como texto, e é o que a pessoa lê antes de aceitar: só vale
 * `https://` e só com caracteres que se veem. Controle, direção de texto (`U+202E`), espaço de largura zero, hífen suave e
 * qualquer espaço (`\p{C}` e `\p{Z}`) fariam o que se copia ser outra coisa que o que se lê.
 */
export function isLicenseUrl(url: string): boolean {
  return /^https:\/\/[^\p{C}\p{Z}]+$/u.test(url);
}

/** Uma licença cujo endereço não passa em `isLicenseUrl` vale como licença ausente: o driver não pode ser instalado. */
const license = z.object({ name: z.string(), url: z.string() }).transform((value) => (isLicenseUrl(value.url) ? value : null));

/**
 * O item da lista de `GET api/user/drivers` (seção 16 da especificação). Toda chave vem sempre, com `null` quando não
 * se aplica (por isso nenhuma é opcional, e uma ausente é resposta inválida); `sizeBytes`, `license` e `platformNote` podem
 * ser nulos, e `license` nunca o é em `available`, `installing`, `failed` e `installed`.
 *
 * **Um estado que a tela não conhece vira `comingSoon`**: a API pode ser mais nova que a tela, e um estado novo (um texto
 * qualquer) não derruba a lista nem ganha botão. Estado ausente ou que não é texto é resposta inválida. `engines` guarda
 * qualquer número, e quem desenha as etiquetas fica só com os que conhece (`knownEngines`). O endereço da licença é só
 * texto: nada daqui vira link (RN-SHELL-002), e um endereço que não passa em `isLicenseUrl` faz a licença valer como ausente.
 */
export const driverSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  vendor: z.string(),
  engines: z.array(z.number().int()),
  state: z.string().transform((value): DriverState => driverStates.find((known) => known === value) ?? "comingSoon"),
  version: z.string().nullable(),
  sizeBytes: bytes.nullable(),
  license: license.nullable(),
  platformNote: z.string().nullable(),
  // O total é o tamanho do catálogo e nunca é zero (seção 16, "O que a lista garante").
  progress: z.object({ receivedBytes: bytes, totalBytes: z.number().int().positive() }).nullable(),
  error: z.object({ code: z.string(), detail: z.string().nullable() }).nullable(),
  restartRequired: z.boolean(),
});

export type Driver = z.infer<typeof driverSchema>;

export const driversSchema = z.array(driverSchema);
