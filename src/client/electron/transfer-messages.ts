import { z } from "zod";

import { exportExtensions } from "./file-name";
import { resultWindowNameSchema } from "./result-window-messages";

/**
 * O que passa entre a tela e o processo principal no destino e na entrega de uma exportação de dados (RN-EXPORT-019 e 020), com o mesmo schema dos
 * dois lados: o processo principal confere o pedido antes de agir, e a tela confere a resposta (a ponte é a fronteira de confiança, RN-SHELL-001).
 * **Nenhum pedido leva um caminho, uma pasta ou um nome de arquivo para abrir, e nenhuma resposta devolve um caminho**: o nome proposto vai sem
 * extensão e é conferido de novo (`exportFileName`), a extensão é uma da lista fixa, e o arquivo pronto é achado só pelo identificador do trabalho.
 */

/** O identificador de um trabalho da API (`Guid`, como o .NET o escreve): 36 caracteres, em minúsculas, com os hifens. É conferido antes de virar nome de arquivo. */
export const transferIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** O identificador de um destino ou de uma entrega: do processo principal, aleatório; a tela só o devolve. */
const handleSchema = z.string().min(1).max(100);

/**
 * RN-ABAS-017: o pedido que nasce na janela do resultado leva o nome dela (`resultWindow`), e o processo principal prende o diálogo do sistema a ela; com nome
 * desconhecido ou de outra janela da aba, o diálogo fica sobre a janela da aba.
 */
const resultWindow = resultWindowNameSchema.optional();

/** `prism:transfer-destination`: o nome proposto no diálogo de salvar, sem a extensão, e a extensão, de uma lista fixa. */
export const destinationRequestSchema = z.object({ suggestedName: z.string().min(1).max(200), extension: z.enum(exportExtensions), resultWindow }).strict();

export type DestinationRequest = z.infer<typeof destinationRequestSchema>;

/** A resposta: o destino escolhido (com o nome do arquivo, sem a pasta), a desistência, a pasta que não aceita gravação ou o arquivo que outra exportação vai gravar. */
export const destinationReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("chosen"), destinationId: handleSchema, fileName: z.string().min(1).max(1000) }),
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("notWritable") }),
  z.object({ status: z.literal("inUse") }),
]);

export type DestinationReply = z.infer<typeof destinationReplySchema>;

/** `prism:transfer-deliver`: o trabalho que terminou, o destino e se o gerenciador de arquivos abre depois ("Mostrar na pasta ao terminar"). */
export const deliverRequestSchema = z.object({ transferId: transferIdSchema, destinationId: handleSchema, reveal: z.boolean() }).strict();

export type DeliverRequest = z.infer<typeof deliverRequestSchema>;

/** Por que a entrega falhou (RN-EXPORT-020); a mensagem é a frase da tela, sem caminho. */
export const deliveryFailureReasons = ["diskFull", "notWritable", "folderMissing", "inUse", "other"] as const;

export type DeliveryFailureReason = (typeof deliveryFailureReasons)[number];

export const deliverReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("delivered"), deliveryId: handleSchema, fileName: z.string().min(1).max(1000) }),
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("failed"), reason: z.enum(deliveryFailureReasons), message: z.string().max(1000) }),
]);

export type DeliverReply = z.infer<typeof deliverReplySchema>;

/** `prism:transfer-copy`: o texto de um trabalho pronto vai para a área de transferência (RN-EXPORT-014), até 10 MiB. */
export const copyRequestSchema = z.object({ transferId: transferIdSchema }).strict();

export type CopyRequest = z.infer<typeof copyRequestSchema>;

export const copyReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("copied") }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("tooLarge") }),
  z.object({ status: z.literal("failed"), message: z.string().max(1000) }),
]);

export type CopyReply = z.infer<typeof copyReplySchema>;

/** `prism:transfer-reveal`: "Mostrar na pasta" do aviso de sucesso, pela entrega que o processo principal guarda. */
export const revealRequestSchema = z.object({ deliveryId: handleSchema, resultWindow }).strict();

export type RevealRequest = z.infer<typeof revealRequestSchema>;

/** `prism:transfer-release`: o destino deixa de ser desta exportação (falhou, foi cancelada, recusada, "Salvar como…"); a entrega em andamento para. */
export const releaseRequestSchema = z.object({ destinationId: handleSchema }).strict();

export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

/** O limite da área de transferência (RN-EXPORT-014): 10 MiB de texto em UTF-8. */
export const clipboardLimitBytes = 10 * 1024 * 1024;

/**
 * O arquivo de uma importação de dados (RN-IMPORT-018), com o mesmo schema dos dois lados. `prism:transfer-source` não recebe nada: o título, os filtros e
 * a pasta inicial do diálogo de abrir são do processo principal. A resposta leva só o identificador da cópia (`fileId`, a forma de um identificador da API,
 * conferida antes de virar nome de arquivo), o nome do arquivo sem a pasta, para a tela mostrar, e o tamanho em bytes. **Nenhuma resposta devolve um
 * caminho**, e os pedidos seguintes levam só o `fileId`.
 */

/** O maior arquivo que se importa (RN-IMPORT-008): 2 GiB, que a tela escreve "2 GB", como o Windows. */
export const maxImportBytes = 2 * 1024 * 1024 * 1024;

const byteCount = z.number().int().min(0);

export const sourceReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("chosen"), fileId: transferIdSchema, fileName: z.string().min(1).max(1000), size: byteCount }),
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("notAFile") }),
  z.object({ status: z.literal("tooLarge"), size: byteCount }),
  z.object({ status: z.literal("notWritable") }),
  z.object({ status: z.literal("noSpace"), needed: byteCount }),
  /** `message`: a frase do motivo, escolhida pelo código do sistema ("o sistema não dá permissão para ler o arquivo"), nunca o texto dele, que traz o caminho. */
  z.object({ status: z.literal("unreadable"), message: z.string().max(1000) }),
]);

export type SourceReply = z.infer<typeof sourceReplySchema>;

/** `prism:transfer-source`: a escolha do arquivo não recebe nada da tela, a não ser a janela do resultado de onde o pedido nasceu (RN-ABAS-017). */
export const chooseSourceRequestSchema = z.object({ resultWindow }).strict();

export type ChooseSourceRequest = z.infer<typeof chooseSourceRequestSchema>;

/** `prism:transfer-source-status` e `prism:transfer-source-release`: o arquivo, pelo identificador que o processo principal deu. */
export const sourceRequestSchema = z.object({ fileId: transferIdSchema }).strict();

export type SourceRequest = z.infer<typeof sourceRequestSchema>;

/** Por que a cópia falhou (RN-IMPORT-018); a mensagem é a frase inteira da tela, sem caminho. */
export const sourceFailureReasons = ["diskFull", "tooLarge", "unreadable", "other"] as const;

export type SourceFailureReason = (typeof sourceFailureReasons)[number];

export const sourceStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("copying"), copied: byteCount, size: byteCount }),
  z.object({ status: z.literal("ready") }),
  z.object({ status: z.literal("failed"), reason: z.enum(sourceFailureReasons), message: z.string().max(1000) }),
  z.object({ status: z.literal("missing") }),
]);

export type SourceStatus = z.infer<typeof sourceStatusSchema>;
