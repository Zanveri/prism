namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>RN-IMPORT-007 e as notas da seção 36: os formatos dos valores: `decimal` em `point` ou `comma`, `thousandsDot` só com `comma`, e `dates` em `iso` ou `dayMonthYear`.</summary>
public sealed record ImportValuesDto
{
    public string? Decimal { get; init; }
    public bool ThousandsDot { get; init; }
    public string? Dates { get; init; }

    public override string ToString()
        => nameof(ImportValuesDto);
}

/// <summary>As notas da seção 36: a tabela de destino, com o esquema e o nome como estão no catálogo; `database` na regra da abertura de uma sessão.</summary>
public sealed record ImportTargetDto
{
    public Guid ConnectionID { get; init; }
    public string? Database { get; init; }
    public string? Schema { get; init; }
    public string? Table { get; init; }

    public override string ToString()
        => nameof(ImportTargetDto);
}

/// <summary>RN-IMPORT-009: uma coluna do arquivo, pela posição a partir de 0, para uma coluna da tabela, pelo nome. Também a resposta (o mapeamento pedido ou o sugerido).</summary>
public sealed record ImportMappingDto
{
    public int Source { get; init; }
    public string? Target { get; init; }

    public override string ToString()
        => nameof(ImportMappingDto);
}

/// <summary>RN-IMPORT-004: a codificação que a leitura usou (`name`, um dos nomes do pedido menos `auto`) e se o arquivo começa pelo BOM dela.</summary>
public sealed record ImportEncodingDto(string Name, bool Bom);

/// <summary>RN-IMPORT-006: uma planilha da pasta de trabalho, na ordem dela.</summary>
public sealed record ImportSheetDto(string Name, bool Hidden)
{
    public override string ToString()
        => nameof(ImportSheetDto);
}

/// <summary>RN-IMPORT-007: uma linha da prévia do arquivo: a linha do arquivo, os valores como foram lidos (texto ou nulo, cortados nos 1.000 caracteres) e se ela foi completada com nulo.</summary>
public sealed record ImportReadRowDto(long Line, IReadOnlyList<string?> Values, bool Short)
{
    public override string ToString()
        => nameof(ImportReadRowDto);
}

/// <summary>
/// RN-IMPORT-007, a resposta de `imports/read`: `encoding` (nulo fora do CSV e do TSV), `delimiter` (o caractere, ou nulo), `listKey` (no JSON, a chave da
/// lista, ou nulo), `sheets` e `sheet` (no XLSX; nulos fora dele), `columns` (os nomes, todos), `shownColumns` (quantas das primeiras colunas as linhas
/// trazem) e `rows` (até 20).
/// </summary>
public sealed record ImportReadDto(ImportEncodingDto? Encoding, string? Delimiter, string? ListKey, IReadOnlyList<ImportSheetDto>? Sheets, string? Sheet, IReadOnlyList<string> Columns, int ShownColumns, IReadOnlyList<ImportReadRowDto> Rows)
{
    public override string ToString()
        => nameof(ImportReadDto);
}

/// <summary>
/// RN-IMPORT-009 e 010: uma coluna da tabela de destino: `class` em `text`, `number`, `date`, `dateTime`, `time`, `boolean`, `binary` ou `other`;
/// `generated` em `always`, `byDefault` ou nulo; `reason` nulo quando a coluna recebe valores (`importable`).
/// </summary>
public sealed record ImportTableColumnDto(string Name, string Type, bool Nullable, string? DefaultValue, string? Generated, string Class, bool Importable, string? Reason)
{
    public override string ToString()
        => nameof(ImportTableColumnDto);
}

/// <summary>RN-IMPORT-012: uma chave estrangeira de outra tabela que aponta para a de destino: `onDelete` em `cascade`, `setNull`, `setDefault`, `restrict` ou `noAction`.</summary>
public sealed record ImportReferenceDto(string Schema, string Table, string OnDelete)
{
    public override string ToString()
        => nameof(ImportReferenceDto);
}

/// <summary>RN-IMPORT-009 e 012: a tabela de destino: `oneAtATime` no Informix sem log (RN-EDIT-012).</summary>
public sealed record ImportTableDto(string Schema, string Name, bool OneAtATime, IReadOnlyList<ImportTableColumnDto> Columns, IReadOnlyList<ImportReferenceDto> ReferencedBy)
{
    public override string ToString()
        => nameof(ImportTableDto);
}

/// <summary>RN-IMPORT-011: uma célula da prévia convertida: o valor como vai ao banco, ou nulo, e o motivo quando não converte.</summary>
public sealed record ImportPreviewCellDto(string? Value, string? Problem)
{
    public override string ToString()
        => nameof(ImportPreviewCellDto);
}

/// <summary>RN-IMPORT-011: uma linha da prévia convertida: o problema da linha inteira, ou nulo; `cells`, uma por coluna mapeada que cabe, na ordem do mapeamento.</summary>
public sealed record ImportPreviewRowDto(long Line, string? Problem, bool Short, IReadOnlyList<ImportPreviewCellDto> Cells)
{
    public override string ToString()
        => nameof(ImportPreviewRowDto);
}

/// <summary>RN-IMPORT-024, a resposta de `copies/preview`: a tabela de destino e o mapeamento (o mandado, ou o sugerido pelo nome). A origem não é lida.</summary>
public sealed record CopyPreviewDto(ImportTableDto Table, IReadOnlyList<ImportMappingDto> Mapping)
{
    public override string ToString()
        => nameof(CopyPreviewDto);
}

/// <summary>RN-IMPORT-009 a 011, a resposta de `imports/preview`: a tabela, as colunas do arquivo, o mapeamento (o mandado, ou o sugerido), `shownColumns` e as linhas.</summary>
public sealed record ImportPreviewDto(ImportTableDto Table, IReadOnlyList<string> Columns, IReadOnlyList<ImportMappingDto> Mapping, int ShownColumns, IReadOnlyList<ImportPreviewRowDto> Rows)
{
    public override string ToString()
        => nameof(ImportPreviewDto);
}
