namespace Prism.Infrastructure.Databases.Models;

/// <summary>
/// RN-SQL-017: o valor completo de uma célula que a grade recebeu cortada (RN-SQL-011), como veio do banco: o texto inteiro, ou os bytes
/// do binário, guardados como vieram (um byte por byte) e escritos em hexadecimal só quando alguém os pede. Fica só na memória da API.
/// Não é um record: o valor é dado do usuário e não se imprime.
/// </summary>
public sealed class FullCellValue
{
    private readonly string? _text;
    private readonly byte[]? _bytes;

    private FullCellValue(string? text, byte[]? bytes)
    {
        _text = text;
        _bytes = bytes;
    }

    /// <summary>O que o valor ocupa na memória: 2 bytes por caractere do texto (o UTF-16 do .NET) e 1 por byte do binário.</summary>
    public long Bytes => _text is null ? _bytes!.LongLength : 2L * _text.Length;

    public static FullCellValue Text(string text)
        => new(text, null);

    public static FullCellValue Binary(byte[] bytes)
        => new(null, bytes);

    /// <summary>O texto, como veio; o binário, como a grade escreve o começo dele: `0x` e os dígitos hexadecimais em maiúsculas, todos.</summary>
    public string Write()
        => _text ?? "0x" + Convert.ToHexString(_bytes!);

    public override string ToString()
        => nameof(FullCellValue);
}
