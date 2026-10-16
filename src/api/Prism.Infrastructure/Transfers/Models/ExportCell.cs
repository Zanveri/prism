namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-002 e 017: uma célula lida para a exportação, inteira e sem o corte da grade: o texto como a grade o escreve (o número com ponto, a data
/// no formato do Prism ou no texto do servidor, o booleano `true` ou `false`), os bytes do binário, ou nulo. O binário com "Deixar vazio" nem é pedido
/// ao leitor, e chega aqui nulo. É dado do banco: o `ToString()` não o imprime (RN-LOG-001).
/// </summary>
public readonly record struct ExportCell(string? Text, byte[]? Bytes)
{
    public static ExportCell Null => default;

    public bool IsNull => Text is null && Bytes is null;

    public static ExportCell FromText(string text)
        => new(text, null);

    public static ExportCell FromBytes(byte[] bytes)
        => new(null, bytes);

    public override string ToString()
        => nameof(ExportCell);
}
