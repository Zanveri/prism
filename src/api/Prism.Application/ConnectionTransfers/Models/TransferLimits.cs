namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-006, 010 e 014: os limites do arquivo da exportação de conexões, os mesmos na exportação e na importação: todo arquivo que o Prism gera passa
/// pelos limites da importação dele. Contra um arquivo hostil, eles vêm antes de qualquer caminho pela árvore, que custaria a profundidade a cada item.
/// </summary>
internal static class TransferLimits
{
    /// <summary>RN-TRANSF-010, etapa 1: o texto do arquivo tem até 5 MiB (5.242.880 bytes em UTF-8).</summary>
    public const int MaxFileBytes = 5 * 1024 * 1024;

    public const int MaxConnections = 2000;

    /// <summary>As pastas do caminho contam.</summary>
    public const int MaxFolders = 2000;

    /// <summary>
    /// Os níveis de pastas: na importação, a pasta da raiz do arquivo é o nível 1; na exportação contam da raiz do navegador, porque o caminho inteiro vai
    /// no arquivo (a conexão que está a mais de 32 níveis da raiz não sai nem sozinha). O cofre não limita a profundidade (RN-PASTA-001).
    /// </summary>
    public const int MaxDepth = 32;

    /// <summary>RN-TRANSF-014: as chaves marcadas de um pedido de importação, de pastas e de conexões.</summary>
    public const int MaxImportItems = 4000;

    /// <summary>RN-TRANSF-007: as chaves do arquivo têm de 1 a 64 caracteres (o Prism gera `f1`, `c1`…).</summary>
    public const int MaxKeyLength = 64;

    /// <summary>RN-TRANSF-011: cada texto do item que não pode ser importado volta cortado nisto, e o que o motivo cita dele também.</summary>
    public const int InvalidTextLength = 200;

    /// <summary>
    /// O corpo das rotas (`RequestSizeLimit`): a exportação leva só IDs e senhas, e a importação, o arquivo de até 5 MiB dentro de um texto JSON. Acima disso
    /// a resposta hoje é 500, e não 413 (o defeito conhecido de toda rota que lê corpo); a tela nunca manda tanto.
    /// </summary>
    public const int ExportRequestBytes = 1024 * 1024;
    public const int ImportRequestBytes = 6 * 1024 * 1024;

    /// <summary>
    /// Seção 40, rotas: o corpo das rotas do "Importar do DBeaver" é pequeno, porque o conteúdo vem da cópia, e não do pedido: o `sourceId`, o projeto, as
    /// chaves marcadas (até 4.000), as portas DRDA e as chaves de `overwrite` cabem em 1 MiB.
    /// </summary>
    public const int DbeaverRequestBytes = 1024 * 1024;
}
