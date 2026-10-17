import { z } from "zod";

import { exportExtensions } from "./file-name";

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

/** `prism:transfer-destination`: o nome proposto no diálogo de salvar, sem a extensão, e a extensão, de uma lista fixa. */
export const destinationRequestSchema = z.object({ suggestedName: z.string().min(1).max(200), extension: z.enum(exportExtensions) }).strict();

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
export const revealRequestSchema = z.object({ deliveryId: handleSchema }).strict();

export type RevealRequest = z.infer<typeof revealRequestSchema>;

/** `prism:transfer-release`: o destino deixa de ser desta exportação (falhou, foi cancelada, recusada, "Salvar como…"); a entrega em andamento para. */
export const releaseRequestSchema = z.object({ destinationId: handleSchema }).strict();

export type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

/** O limite da área de transferência (RN-EXPORT-014): 10 MiB de texto em UTF-8. */
export const clipboardLimitBytes = 10 * 1024 * 1024;
