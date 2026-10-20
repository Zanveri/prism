import { z } from "zod";

import { transferIdSchema } from "./transfer-messages";

/**
 * O que passa entre a tela e o processo principal na procura e na cópia do DBeaver (RN-DBEAVER-004 a 006), com o mesmo schema dos dois lados: o processo
 * principal confere o pedido, e a tela confere a resposta (a ponte é a fronteira de confiança, RN-SHELL-001). **Nenhum pedido leva um caminho, uma pasta ou
 * um nome de arquivo, e nenhuma resposta devolve um**: a tela recebe o identificador da cópia (`sourceId`, a forma de um da API), onde ela achou o DBeaver
 * e quantos projetos copiou.
 */

/** `find`: a procura nos lugares de sempre (RN-DBEAVER-004); `choose`: o diálogo de pasta do sistema (RN-DBEAVER-005). */
export const dbeaverModes = ["find", "choose"] as const;

export type DbeaverMode = (typeof dbeaverModes)[number];

/** `prism:dbeaver-source`: só o modo. O título, a pasta inicial e as opções do diálogo são do processo principal. */
export const dbeaverSourceRequestSchema = z.object({ mode: z.enum(dbeaverModes) }).strict();

export type DbeaverSourceRequest = z.infer<typeof dbeaverSourceRequestSchema>;

/** Onde o DBeaver foi achado (RN-DBEAVER-006): o de sempre, o do Flatpak, o do Snap, o da variável `DBEAVER_DATA` ou a pasta que a pessoa escolheu. */
export const dbeaverWheres = ["standard", "flatpak", "snap", "env", "chosen"] as const;

export type DbeaverWhere = (typeof dbeaverWheres)[number];

export const dbeaverSourceReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), sourceId: transferIdSchema, where: z.enum(dbeaverWheres), projects: z.number().int().min(1).max(50) }),
  z.object({ status: z.literal("notFound") }),
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("notDbeaver") }),
  z.object({ status: z.literal("tooLarge") }),
  z.object({ status: z.literal("notWritable") }),
  z.object({ status: z.literal("noSpace") }),
  /** `message`: a frase inteira do motivo, escolhida pelo código do sistema ou a do atalho, nunca o texto do sistema, que traz o caminho. */
  z.object({ status: z.literal("unreadable"), message: z.string().max(1000) }),
]);

export type DbeaverSourceReply = z.infer<typeof dbeaverSourceReplySchema>;

/** `prism:dbeaver-source-release`: a cópia, pelo identificador que o processo principal deu. */
export const dbeaverReleaseRequestSchema = z.object({ sourceId: transferIdSchema }).strict();

export type DbeaverReleaseRequest = z.infer<typeof dbeaverReleaseRequestSchema>;

/** Os limites da cópia (RN-DBEAVER-006): projetos, arquivos por projeto, bytes por arquivo e bytes no total. */
export const dbeaverLimits = { projects: 50, filesPerProject: 41, fileBytes: 5 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, entries: 1000, spareBytes: 64 * 1024 * 1024 } as const;
