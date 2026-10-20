using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;

namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-IMPORT-012: a carga: esvaziar a tabela antes (`DELETE` sem `WHERE`, na primeira transação), a cada quantas linhas confirmar (nulo é "Tudo numa
/// transação só"; no Informix sem log, ignorado) e, só na importação, conferir o arquivo inteiro antes de gravar.
/// </summary>
public sealed record LoadSettings(bool Empty, int? CommitEvery, bool Check)
{
    /// <summary>RN-IMPORT-012: o padrão do "A cada N linhas", como o DBeaver.</summary>
    public const int DefaultCommitEvery = 10000;

    /// <summary>RN-IMPORT-012: o N, no máximo.</summary>
    public const int MaxCommitEvery = 1_000_000;
}

/// <summary>
/// RN-IMPORT-014: a importação, já conferida por quem a começa: o arquivo (o `fileID` do processo principal, que a API toma ao registrar o trabalho), o
/// formato com as opções do leitor e os formatos dos valores; a conexão de destino (com as credenciais lidas do cofre e a geração dele, lida antes), a
/// tabela e o mapeamento; a carga; e como saber, antes de cada comando, se a carga para (`TargetStop`, pelo cofre daquele instante: a conexão que passou
/// a ser somente leitura, RN-PROT-006, ou que foi excluída, com o motivo; nulo, ela segue). Leva a senha do banco e os nomes: o `ToString()` não os
/// imprime (RN-LOG-001).
/// </summary>
public sealed record ImportJob(
    Guid FileID,
    Guid ConnectionID,
    ConnectionSettings Settings,
    long VaultGeneration,
    long WindowID,
    string Format,
    ImportReaderOptions Options,
    ImportValueFormats Formats,
    string Schema,
    string Table,
    IReadOnlyList<ImportMappingEntry> Mapping,
    LoadSettings Load,
    Func<CancellationToken, Task<ETransferCancelReason?>> TargetStop)
{
    public override string ToString()
        => nameof(ImportJob);
}

/// <summary>
/// RN-IMPORT-027: a cópia para outro banco, já conferida por quem a começa. A origem é a da exportação (a conexão, o comando, as colunas pedidas, na ordem
/// do pedido, conferidas pela posição e pelo nome nos Registros e no resultado, e a contagem, obrigatória quando `ForcedCount`, RN-IMPORT-023); o destino,
/// a carga e o somente leitura, os da importação. A posição do mapeamento (`Mapping[].Source`) é a da coluna em `Columns`. Leva as senhas e o comando: o
/// `ToString()` não os imprime (RN-LOG-001).
/// </summary>
public sealed record CopyJob(
    Guid SourceConnectionID,
    ConnectionSettings SourceSettings,
    string Sql,
    IReadOnlyList<ExportColumnChoice> Columns,
    bool CheckColumns,
    bool Count,
    bool ForcedCount,
    Guid TargetConnectionID,
    ConnectionSettings TargetSettings,
    string Schema,
    string Table,
    IReadOnlyList<ImportMappingEntry> Mapping,
    LoadSettings Load,
    long VaultGeneration,
    long WindowID,
    Func<CancellationToken, Task<ETransferCancelReason?>> TargetStop,
    IReadOnlyList<QueryParameter>? Parameters = null)
{
    public override string ToString()
        => nameof(CopyJob);
}

/// <summary>
/// RN-IMPORT-014 e 023: onde fica uma tabela, pela regra da própria origem: o mesmo servidor (sem diferenciar maiúsculas), a mesma porta e o mesmo banco de
/// dados, e o mesmo esquema e o mesmo nome, letra por letra. O Prism não resolve nomes: `localhost` e `127.0.0.1` são servidores diferentes.
/// </summary>
public static class TablePlaces
{
    /// <summary>As duas conexões apontam para o mesmo servidor, porta e banco de dados.</summary>
    public static bool SameServer(ConnectionSettings first, ConnectionSettings second)
        => string.Equals(first.Host, second.Host, StringComparison.OrdinalIgnoreCase) && first.Port == second.Port && string.Equals(first.Database, second.Database, StringComparison.Ordinal);

    /// <summary>As duas tabelas são a mesma: o mesmo servidor, porta e banco de dados, e o mesmo esquema e nome.</summary>
    public static bool SameTable(ConnectionSettings first, string firstSchema, string firstTable, ConnectionSettings second, string secondSchema, string secondTable)
        => SameServer(first, second) && string.Equals(firstSchema, secondSchema, StringComparison.Ordinal) && string.Equals(firstTable, secondTable, StringComparison.Ordinal);
}
