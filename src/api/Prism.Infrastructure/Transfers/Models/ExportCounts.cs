namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-022: o que do dado não saiu inteiro, contado pelo escritor do formato enquanto escreve: os valores cortados (a largura máxima do TXT, o
/// limite da célula do Excel), os caracteres que o formato não aceita e foram tirados (HTML, XML, DbUnit, Código fonte), as linhas que não viraram
/// comando (SQL) e as planilhas (XLSX; nulo nos outros formatos).
/// </summary>
public sealed class ExportCounts
{
    public long CutValues { get; set; }

    public long RemovedCharacters { get; set; }

    public long SkippedRows { get; set; }

    public int? Sheets { get; set; }
}
