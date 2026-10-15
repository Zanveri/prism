namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-EDIT-008: os comandos que o "Salvar" vai executar, na ordem, com os valores escritos como literais do banco para leitura.</summary>
/// <param name="OneAtATime">RN-EDIT-012: cada comando será gravado sozinho, sem tudo ou nada.</param>
public sealed record EditPreview(IReadOnlyList<EditStatement> Statements, bool OneAtATime);

/// <param name="Sql">O comando com os literais; o valor que não tem literal (caractere de controle) aparece como `?`.</param>
/// <param name="Values">Os valores dos `?`, na ordem em que aparecem.</param>
public sealed record EditStatement(string Sql, IReadOnlyList<string?> Values);
