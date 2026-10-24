using System.Text.Json;

namespace Prism.Application.Transfers.Models.Dtos;

/// <summary>
/// RN-EXPORT-002 e seção 6: a origem da exportação. `table`: a tabela ou a visão pelo navegador (`schema` e `table`). `query`: os Registros e o resultado
/// (`sql` como foi executado, `filter` do resultado, e `name`, o nome da origem nos Registros; ausente, `resultado`). `database` é o banco de dados da origem,
/// na regra da abertura de uma sessão; ausente, o da conexão. Leva o comando: o `ToString()` não o imprime (RN-LOG-001).
/// </summary>
public sealed record ExportSourceDto
{
    public string? Kind { get; init; }
    public Guid ConnectionID { get; init; }
    public string? Database { get; init; }
    public string? Schema { get; init; }
    public string? Table { get; init; }
    public string? Sql { get; init; }
    public string? Filter { get; init; }
    public string? Name { get; init; }

    /// <summary>
    /// RN-VAR-032 e 033: os valores dos marcadores do `sql` (`$n` ou `?`), na ordem do texto, cada um `{ type, value }`, só na origem `query`. Chega como o JSON que veio, como
    /// as opções, para a forma errada ser `EXPORT_OPTIONS_INVALID` (`IMPORT_OPTIONS_INVALID` na cópia) no campo `source.params[3].value`, e não o 400 do MVC.
    /// </summary>
    public JsonElement? Params { get; init; }

    public override string ToString()
        => nameof(ExportSourceDto);
}

/// <summary>RN-EXPORT-005: uma coluna marcada na Extração: a posição no resultado (ou no catálogo, na tabela), a partir de 0, e o nome.</summary>
public sealed record ExportColumnDto
{
    public int Position { get; init; }
    public string? Name { get; init; }

    public override string ToString()
        => nameof(ExportColumnDto);
}

/// <summary>RN-EXPORT-014: a saída: o BOM, o .zip com o nome do arquivo dentro dele, e a área de transferência.</summary>
public sealed record ExportOutputDto
{
    public bool Bom { get; init; }
    public bool Zip { get; init; }
    public string? EntryName { get; init; }
    public bool Clipboard { get; init; }

    public override string ToString()
        => nameof(ExportOutputDto);
}

/// <summary>O 202 do começo: o identificador do trabalho, que a tela consulta e o processo principal usa para achar o arquivo pronto.</summary>
public sealed record TransferStartedDto(Guid ID);
