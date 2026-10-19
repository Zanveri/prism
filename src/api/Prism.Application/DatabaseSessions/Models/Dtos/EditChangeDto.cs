using System.Text.Json;

namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>
/// RN-EDIT-004: uma alteração pendente, como a tela a manda (seção 22, "Rotas e respostas"): `kind` é `update`, `delete` ou `insert`;
/// `table` é a posição em `tables` do `edit-target`; `key`, os textos que a grade leu nas colunas da chave; `set` (na alteração) e
/// `values` (na linha nova), as colunas pela posição no resultado, com o texto ou nulo.
///
/// RN-EDIT-023: `updateAll` é a coluna inteira, com `set` (uma ou mais colunas) e `rows`, o número de linhas que a pessoa confirmou, obrigatório só em
/// `queries/edits`. `rows` chega como `JsonElement?`, como o `pageSize`, para o texto e o número com casas virarem 422 `EDIT_INVALID` com o `change`, e
/// não o 400 do MVC.
/// </summary>
public sealed record EditChangeDto
{
    public string Kind { get; init; } = string.Empty;
    public int Table { get; init; }
    public IReadOnlyList<string?>? Key { get; init; }
    public IReadOnlyList<EditValueDto>? Set { get; init; }
    public IReadOnlyList<EditValueDto>? Values { get; init; }
    public JsonElement? Rows { get; init; }
}

public sealed record EditValueDto(int Column, string? Value);
