using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Transfers.Models;

/// <summary>RN-EXPORT-005 e 017: uma coluna marcada na Extração, pela posição no resultado (a partir de 0) e o nome que a tela viu.</summary>
public sealed record ExportColumnChoice(int Position, string Name)
{
    public override string ToString()
        => nameof(ExportColumnChoice);
}

/// <summary>
/// RN-EXPORT-016: o que a exportação faz, já conferido por quem a começa: a conexão (com as credenciais lidas do cofre e a geração dele, lida antes) e o
/// banco de dados; o comando que roda (o `SELECT` da tabela montado pela API, ou o dos Registros e do resultado com o filtro); as colunas, conferidas pela
/// posição e pelo nome (`CheckColumns`, nos Registros e no resultado) ou todas as do resultado, na ordem (na tabela, cujo `SELECT` já as escolhe); a
/// contagem; o formato com as opções e o nome da origem; e a saída (BOM, o nome do arquivo dentro do .zip, a área de transferência).
///
/// `Parameters` (RN-VAR-033) são os valores dos marcadores do comando, na ordem do texto: a contagem e a leitura os levam, na conexão à parte.
///
/// Leva a senha do banco, o comando e os valores: o `ToString()` não os imprime (RN-LOG-001).
/// </summary>
public sealed record ExportJob(
    Guid ConnectionID,
    ConnectionSettings Settings,
    long VaultGeneration,
    long WindowID,
    string Sql,
    IReadOnlyList<ExportColumnChoice> Columns,
    bool CheckColumns,
    bool Count,
    string Format,
    ExportFormatOptions Options,
    string SourceName,
    bool Bom,
    string? ZipEntryName,
    bool Clipboard,
    IReadOnlyList<QueryParameter>? Parameters = null)
{
    public override string ToString()
        => nameof(ExportJob);
}
