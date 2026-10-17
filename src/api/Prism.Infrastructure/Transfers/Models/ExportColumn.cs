namespace Prism.Infrastructure.Transfers.Models;

/// <summary>
/// RN-EXPORT-005 e 017: uma coluna que o arquivo escreve, como o resultado a deu: o nome, o tipo do banco e o tipo da grade (`text`, `number`,
/// `datetime`, `boolean` ou `binary`), que decide o número sem aspas, o alinhamento e o binário. O nome é texto do banco: não vai ao log.
/// </summary>
public sealed record ExportColumn(string Name, string Type, string Kind)
{
    public override string ToString()
        => nameof(ExportColumn);
}
