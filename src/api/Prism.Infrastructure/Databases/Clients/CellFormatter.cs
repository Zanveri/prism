using Prism.Infrastructure.Databases.Models;
using System.Globalization;
using System.Numerics;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// RN-SQL-011: cada célula viaja como texto ou nulo, formatada aqui a partir do valor que o driver entrega. Nada depende da cultura da
/// máquina: números e datas saem sempre no mesmo formato, e a tela só os desenha. O PostgreSQL já manda o texto pronto (ver
/// `PostgresConnection`), e daqui ele só leva o corte, o booleano e o binário. O corte é só do que a grade mostra: o valor completo da
/// célula cortada sai por <see cref="Full"/> (RN-SQL-017).
/// </summary>
internal static class CellFormatter
{
    /// <summary>RN-SQL-011: binário chega cortado. Os primeiros 32 bytes são 64 dígitos hexadecimais, o bastante para reconhecer o conteúdo.</summary>
    public const int MaxBinaryBytes = 32;

    private const string DateTimeFormat = "yyyy-MM-dd HH:mm:ss.ffffff";

    /// <param name="truncated">A célula foi cortada, e a tela precisa avisar (RN-SQL-011).</param>
    public static string? Format(object? value, out bool truncated)
    {
        truncated = false;

        if (value is null or DBNull)
            return null;

        if (value is byte[] bytes)
        {
            truncated = bytes.Length > MaxBinaryBytes;

            return "0x" + Convert.ToHexString(bytes, 0, Math.Min(bytes.Length, MaxBinaryBytes));
        }

        var text = ToText(value);
        if (text.Length <= QueryPaging.MaxTextLength)
            return text;

        truncated = true;

        // Um caractere fora do plano básico (um emoji) ocupa dois `char`: o corte não o deixa pela metade.
        return text[..(char.IsHighSurrogate(text[QueryPaging.MaxTextLength - 1]) ? QueryPaging.MaxTextLength - 1 : QueryPaging.MaxTextLength)];
    }

    /// <summary>
    /// RN-SQL-017: o valor completo de uma célula que <see cref="Format"/> cortou, para copiar e exportar: o texto inteiro, no mesmo
    /// formato, ou os bytes inteiros do binário. Quem o guarda é o registro de sessões.
    /// </summary>
    public static FullCellValue Full(object value)
        => value is byte[] bytes ? FullCellValue.Binary(bytes) : FullCellValue.Text(ToText(value));

    /// <summary>RN-EXPORT-002 e 017: a célula da exportação, inteira e sem o corte da grade: o texto no mesmo formato, ou os bytes do binário.</summary>
    public static ExportCell ForExport(object value)
        => value is byte[] bytes ? ExportCell.FromBytes(bytes) : ExportCell.FromText(ToText(value));

    /// <summary>`text`, `number`, `datetime`, `boolean` ou `binary`, pelo tipo que o driver diz que a coluna entrega.</summary>
    public static string KindOf(Type type)
    {
        if (type == typeof(bool))
            return "boolean";

        if (type == typeof(byte[]))
            return "binary";

        if (type == typeof(DateTime) || type == typeof(DateTimeOffset) || type == typeof(DateOnly) || type == typeof(TimeOnly))
            return "datetime";

        return Type.GetTypeCode(type) is >= TypeCode.SByte and <= TypeCode.Decimal || type == typeof(BigInteger) ? "number" : "text";
    }

    private static string ToText(object value)
        => value switch
        {
            string text => text,
            bool flag => flag ? "true" : "false",
            DateTime dateTime => dateTime.ToString(DateTimeFormat, CultureInfo.InvariantCulture),
            DateTimeOffset dateTimeOffset => dateTimeOffset.ToString(DateTimeFormat + "zzz", CultureInfo.InvariantCulture),
            DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            TimeOnly time => time.ToString("HH:mm:ss.ffffff", CultureInfo.InvariantCulture),

            // Números (o `decimal` sai com todos os dígitos e a escala, sem expoente), `Guid`, `TimeSpan` e o que mais souber se escrever sem cultura.
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty
        };
}
