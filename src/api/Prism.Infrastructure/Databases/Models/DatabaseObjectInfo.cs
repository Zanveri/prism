namespace Prism.Infrastructure.Databases.Models;

/// <param name="Kind">`table`, `view`, `procedure` ou `function`.</param>
/// <param name="EstimatedRows">
/// RN-CAT-009: a estimativa de linhas que o banco guarda nas estatísticas da tabela, sem contar nada; nula quando ele não tem
/// estatística para ela, e em tudo o que não é tabela.
/// </param>
/// <param name="Comment">RN-CAT-009: o comentário da tabela ou da visão, ou nulo (também nas rotinas).</param>
public sealed record DatabaseObjectInfo(string Name, string Kind, long? EstimatedRows, string? Comment);
