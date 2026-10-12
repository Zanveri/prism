import { z } from "zod";

/**
 * O erro da API: o `ApiErrorDto` do Prism.Core, um ProblemDetails em `application/problem+json`.
 * `type` é o código da seção 6 da especificação; `errors`, a extensão do filtro de validação,
 * com uma lista de mensagens por propriedade. Os demais campos do corpo passam como vieram
 * (`looseObject`): são as extensões de cada erro, como o `sqlState` e a `position` do
 * `SQL_EXECUTION_FAILED` (RN-SQL-009).
 */
export const apiErrorSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  detail: z.string().nullish(),
  errors: z.record(z.string(), z.array(z.string())).nullish(),
});
