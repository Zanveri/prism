using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.ConnectionTransfers.Models.Dtos;

/// <summary>
/// RN-TRANSF-011: a prévia da importação, a árvore do arquivo e o que a importação faria no lugar escolhido, calculada com tudo o que pode ser importado
/// marcado e com "Importar com outro nome". A senha de banco nunca vem (RN-CONN-001): só se a conexão tem uma. O texto do item que pode ser importado vem
/// inteiro (ele já cabe nos limites dos campos), normalizado como será gravado; o do item que não pode vem como estava no arquivo, cortado em 200 caracteres,
/// e o campo do tipo errado vem nulo. RN-LOG-001: a prévia não vai a log, e os `ToString()` escrevem só o nome do tipo.
/// </summary>
public sealed record ImportPreviewDto
{
    public IReadOnlyList<ImportPreviewFolderDto> Folders { get; init; } = [];
    public IReadOnlyList<ImportPreviewConnectionDto> Connections { get; init; } = [];

    public override string ToString()
        => nameof(ImportPreviewDto);
}

public sealed record ImportPreviewFolderDto
{
    public string Key { get; init; } = string.Empty;
    public string? ParentKey { get; init; }
    public string? Name { get; init; }
    public string? Color { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>`irreversible` ou `all`; nula é "Não".</summary>
    public string? ConfirmCommands { get; init; }
    public bool? ReadOnly { get; init; }

    /// <summary>Já existe uma pasta com este nome neste lugar: o que vem dentro entra nela, e ela fica como está, com a cor, o ambiente e as proteções dela.</summary>
    public bool Existing { get; init; }

    /// <summary>RN-TRANSF-013: o que a importação gravaria na pasta que ela cria, para ela não ficar mais fraca que na origem.</summary>
    public ImportStrengthenedDto Strengthened { get; init; } = new();

    /// <summary>RN-TRANSF-014: por que a pasta não pode ser importada; nulo quando pode.</summary>
    public string? Invalid { get; init; }

    public override string ToString()
        => nameof(ImportPreviewFolderDto);
}

public sealed record ImportPreviewConnectionDto
{
    public string Key { get; init; } = string.Empty;
    public string? FolderKey { get; init; }
    public string? Name { get; init; }

    /// <summary>O número de sempre (`PostgreSql` = 1, `Db2` = 2, `Informix` = 3); nulo quando este Prism não conhece o banco do arquivo.</summary>
    public EDatabaseEngine? Engine { get; init; }
    public string? Host { get; init; }
    public int? Port { get; init; }
    public string? Database { get; init; }

    /// <summary>Vazio quando o usuário não veio (RN-TRANSF-015).</summary>
    public string UserName { get; init; } = string.Empty;
    public bool HasPassword { get; init; }
    public bool? VerificationEnabled { get; init; }
    public int? VerificationInterval { get; init; }

    /// <summary>RN-TRANSF-011: a consulta de verificação do arquivo, inteira e como texto; nula quando é a do banco.</summary>
    public string? VerificationQuery { get; init; }

    /// <summary>O que valia na conexão na origem (RN-TRANSF-013); nulo na que não pode ser importada.</summary>
    public ImportEffectiveDto? Effective { get; init; }

    /// <summary>RN-TRANSF-012: o nome dela já está tomado no lugar, pelo que existe ou pelo que a mesma importação já pôs.</summary>
    public bool Conflict { get; init; }

    /// <summary>O nome que ela recebe com "Importar com outro nome"; nulo sem conflito.</summary>
    public string? CopyName { get; init; }

    public ImportStrengthenedDto Strengthened { get; init; } = new();
    public string? Invalid { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o host, o usuário e a consulta de verificação.</summary>
    public override string ToString()
        => nameof(ImportPreviewConnectionDto);
}

/// <summary>RN-PROT-004 e RN-PASTA-005: o que valia na conexão na origem, o somente leitura, a confirmação (nula é "Não") e o ambiente que ela mostrava.</summary>
public sealed record ImportEffectiveDto
{
    public bool ReadOnly { get; init; }
    public string? ConfirmCommands { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
}

/// <summary>RN-TRANSF-013: o que a importação grava no item para ele não ficar mais fraco que na origem, com os campos nulos quando nada muda.</summary>
public sealed record ImportStrengthenedDto
{
    public bool? ReadOnly { get; init; }
    public string? ConfirmCommands { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }
}
