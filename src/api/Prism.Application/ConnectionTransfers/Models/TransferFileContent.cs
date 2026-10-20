using System.Text.Json.Serialization;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-007: o conteúdo do arquivo da exportação antes de cifrado, um JSON em camelCase com `folders` e `connections`, na ordem dos campos abaixo. É o
/// que a exportação escreve; a leitura da importação é à parte (`ImportedFile`), campo a campo, porque um arquivo editado ou de um Prism mais novo pode ter
/// o tipo errado num campo, e isso só tira aquele item. As chaves (`f1`, `c1`…) só ligam cada item à pasta dele: os IDs do cofre não vão.
/// RN-LOG-001: todos sobrescrevem o `ToString()`, que imprimiria hosts, usuários e senhas.
/// </summary>
internal sealed record TransferFileContent(IReadOnlyList<TransferFileFolder> Folders, IReadOnlyList<TransferFileConnection> Connections)
{
    public override string ToString()
        => nameof(TransferFileContent);
}

/// <summary>
/// RN-TRANSF-006 e 007: a pasta, com o nome, a cor, o ambiente dela e as proteções dela, e as que valem nela (`effective`). `ParentKey` nulo é a raiz do
/// arquivo. A confirmação nula é "Não"; o somente leitura vai escrito.
/// </summary>
internal sealed record TransferFileFolder(string Key, string? ParentKey, string Name, string? Color, string? EnvironmentName, string? EnvironmentColor, string? ConfirmCommands, bool ReadOnly, TransferFolderEffective Effective)
{
    public override string ToString()
        => nameof(TransferFileFolder);
}

/// <summary>RN-PROT-004: as proteções que valiam na pasta na origem, a dela e as das pastas acima.</summary>
internal sealed record TransferFolderEffective(bool ReadOnly, string? ConfirmCommands);

/// <summary>
/// RN-TRANSF-006 e 007: a conexão. O banco vai pelo nome (`PostgreSql`, `Db2` ou `Informix`), e não pelo número da API. O usuário e a senha vão conforme a
/// escolha (RN-TRANSF-003): o que não vai não aparece no arquivo, nem vazio, e a senha só vem com o usuário. A verificação vai como vale (ligada ou não, o
/// intervalo, e a consulta, nula quando é a do banco). `effective` é o que valia na origem (RN-PROT-004 e RN-PASTA-005), para a importação não a deixar mais
/// fraca (RN-TRANSF-013).
/// </summary>
internal sealed record TransferFileConnection(
    string Key,
    string? FolderKey,
    string Name,
    string Engine,
    string Host,
    int Port,
    string Database,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? UserName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Password,
    string? EnvironmentName,
    string? EnvironmentColor,
    string? ConfirmCommands,
    bool ReadOnly,
    bool VerificationEnabled,
    int VerificationInterval,
    string? VerificationQuery,
    TransferConnectionEffective Effective)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o host, o usuário, a senha do banco e a consulta de verificação.</summary>
    public override string ToString()
        => nameof(TransferFileConnection);
}

/// <summary>O que valia na conexão na origem: o somente leitura e a confirmação (RN-PROT-004) e o ambiente que ela mostrava, próprio ou herdado, com a cor (RN-PASTA-005).</summary>
internal sealed record TransferConnectionEffective(bool ReadOnly, string? ConfirmCommands, string? EnvironmentName, string? EnvironmentColor)
{
    public override string ToString()
        => nameof(TransferConnectionEffective);
}

/// <summary>RN-TRANSF-003: o que vai de cada conexão. `none` é o padrão, o mais seguro.</summary>
internal enum ETransferCredentials
{
    None,
    User,
    UserAndPassword
}
