using System.Text.Json.Serialization;

namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-EDIT-008: os comandos que o "Salvar" vai executar, na ordem, com os valores escritos como literais do banco para leitura.</summary>
/// <param name="OneAtATime">RN-EDIT-012: cada comando será gravado sozinho, sem tudo ou nada.</param>
public sealed record EditPreview(IReadOnlyList<EditStatement> Statements, bool OneAtATime);

/// <param name="Sql">O comando com os literais; o valor que não tem literal (caractere de controle) aparece como `?`.</param>
/// <param name="Values">Os valores dos `?`, na ordem em que aparecem.</param>
/// <param name="Note">
/// RN-EDIT-023: a frase que a tela mostra embaixo do comando, como veio (a contagem e o caminho por lotes da coluna inteira). Os comandos por linha não
/// têm: o campo nem vai no JSON.
/// </param>
public sealed record EditStatement(string Sql, IReadOnlyList<string?> Values, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null);
