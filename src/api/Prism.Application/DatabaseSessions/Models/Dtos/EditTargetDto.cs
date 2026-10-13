namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>A resposta do `edit-target` (seção 22): o que se edita no resultado, sem o tipo de catálogo de cada coluna, que só a API usa.</summary>
public sealed record EditTargetDto(IReadOnlyList<EditTableDto> Tables, IReadOnlyList<EditColumnDto> Columns, bool RowOperations, bool OneAtATime);

/// <param name="Key">As colunas da chave, pela posição no resultado.</param>
public sealed record EditTableDto(string Schema, string Name, IReadOnlyList<int> Key, bool Editable, string? Reason);

/// <param name="Table">A posição da tabela em `tables`; nulo na coluna calculada.</param>
public sealed record EditColumnDto(int? Table, string? BaseColumn, bool Editable, string? Reason, bool Nullable, string? Generated);

/// <summary>A resposta do "Salvar": quantas alterações foram gravadas.</summary>
public sealed record EditsAppliedDto(int Applied);
