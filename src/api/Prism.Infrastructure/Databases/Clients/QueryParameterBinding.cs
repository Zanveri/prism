using Prism.Infrastructure.Databases.Models;
using System.Data;
using System.Globalization;
using System.Text;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O tipo do driver da IBM (`DB2Type`) que o parâmetro leva, sem o driver: o assembly da IBM não existe em todo lugar (RN-DRIVER-001), e a conversão fica pura e
/// testável. A conexão da IBM traduz cada um para o `DB2Type`.
/// </summary>
internal enum EIbmParameterType
{
    /// <summary>Sem `DB2Type`: o do próprio valor (o `bool` do Db2).</summary>
    None,
    BigInt,

    /// <summary>O valor é o texto do número, e o driver o lê como `DB2Decimal` (até 31 dígitos, o que o `System.Decimal` não guarda).</summary>
    Decimal,
    Double,
    VarChar,
    LongVarChar,
    Clob,
    Date,
    Timestamp
}

/// <summary>Um parâmetro pronto para o driver: o valor, o `DbType` quando há, o tipo da IBM e, no PostgreSQL, o tipo desconhecido (o servidor resolve pelo lugar).</summary>
internal sealed record BoundQueryParameter(object? Value, DbType? DbType = null, EIbmParameterType Ibm = EIbmParameterType.None, bool Unknown = false)
{
    public override string ToString()
        => nameof(BoundQueryParameter);
}

/// <summary>
/// RN-VAR-017 e 032: a conversão de cada valor da tela para o parâmetro de cada banco, como a sonda S-VAR-1 provou (2026-10-20, `scratchpad/reports/p9-sondas.md`).
/// No PostgreSQL o texto vai sem tipo (`NpgsqlDbType.Unknown`), e o servidor lê pelo lugar onde está. No Db2 e no Informix o valor vai convertido, com o tipo:
/// o inteiro em `BIGINT` (o -2^63 do Informix, que o `INT8` não tem, como decimal), o decimal pelo texto exato (até 31 dígitos), o número com expoente em
/// `DOUBLE`, o texto em `VARCHAR` (no Db2, `CLOB` acima de 32.672 bytes; no Informix, `LONG VARCHAR` de 16.351 caracteres até 32.767 bytes e `CLOB` acima, como a
/// edição), o booleano como `bool` no Db2 (o `DB2Type.Boolean` lança) e como o texto `t` ou `f` no Informix, a data de dia e o instante como `DateTime`. O nulo leva
/// o tipo do valor. O que o banco não guarda (dígitos demais, infinidade) já foi recusado por <see cref="QueryParameterRules.EngineRefusal"/>.
/// </summary>
internal static class QueryParameterBinding
{
    /// <summary>O texto que o `VARCHAR` do Db2 guarda, em bytes (acima disso o texto é um `CLOB`).</summary>
    public const int Db2VarCharBytes = 32_672;

    /// <summary>O texto que o driver manda como `CLOB` quando o Informix recebe o parâmetro sem tipo, em caracteres, e o `LONG VARCHAR`, em bytes de UTF-8.</summary>
    public const int InformixVarCharCharacters = 16_350;
    public const int InformixLongVarCharBytes = 32_767;

    public static BoundQueryParameter Convert(ESqlDialect dialect, QueryParameter parameter)
    {
        if (dialect == ESqlDialect.PostgreSql)
            return new BoundQueryParameter(parameter.Value is null ? DBNull.Value : parameter.Value, Unknown: true);

        if (parameter.Value is not { } value)
            return new BoundQueryParameter(DBNull.Value, Ibm: NullType(dialect, parameter.Type), DbType: dialect == ESqlDialect.Db2 && parameter.Type == EQueryParameterType.Boolean ? System.Data.DbType.Boolean : null);

        return parameter.Type switch
        {
            EQueryParameterType.Number => Number(dialect, value),
            EQueryParameterType.Boolean => dialect == ESqlDialect.Db2
                ? new BoundQueryParameter(value == "true", System.Data.DbType.Boolean)
                : new BoundQueryParameter(value == "true" ? "t" : "f", Ibm: EIbmParameterType.VarChar),
            EQueryParameterType.Date => new BoundQueryParameter(DateTime.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture), Ibm: EIbmParameterType.Date),
            EQueryParameterType.Timestamp => new BoundQueryParameter(DateTime.ParseExact(value, "yyyy-MM-dd HH:mm:ss.FFFFFF", CultureInfo.InvariantCulture), Ibm: EIbmParameterType.Timestamp),
            _ => new BoundQueryParameter(value, Ibm: TextType(dialect, value))
        };
    }

    /// <summary>
    /// RN-EDIT-008: o literal do valor para o "Ver SQL" da coluna inteira, só para ler: o número como está, o booleano e o nulo, e o texto, a data e o instante entre
    /// aspas simples com a aspa dobrada (a barra invertida não escapa nada nos três bancos, com `standard_conforming_strings` ligado). Nulo quando o texto tem
    /// caractere de controle, que o literal não escreve: aí o "Ver SQL" põe `?` e o valor ao lado.
    /// </summary>
    public static string? Literal(ESqlDialect dialect, QueryParameter parameter)
    {
        if (parameter.Value is not { } value)
            return "NULL";

        return parameter.Type switch
        {
            EQueryParameterType.Number => value,
            EQueryParameterType.Boolean => dialect == ESqlDialect.Informix ? (value == "true" ? "'t'" : "'f'") : value.ToUpperInvariant(),
            _ => value.Any(char.IsControl) ? null : $"'{value.Replace("'", "''", StringComparison.Ordinal)}'"
        };
    }

    private static BoundQueryParameter Number(ESqlDialect dialect, string number)
        => QueryParameterRules.Classify(number) switch
        {
            // O `INT8` do Informix não guarda -2^63 (é o nulo dele): na comparação o decimal não acha linha, e no INSERT o banco diz que não cabe.
            QueryParameterRules.ENumberClass.Integer when dialect == ESqlDialect.Informix && number == "-9223372036854775808" => new BoundQueryParameter(number, Ibm: EIbmParameterType.Decimal),
            QueryParameterRules.ENumberClass.Integer => new BoundQueryParameter(long.Parse(number, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture), Ibm: EIbmParameterType.BigInt),
            QueryParameterRules.ENumberClass.Double => new BoundQueryParameter(double.Parse(number, NumberStyles.Float, CultureInfo.InvariantCulture), Ibm: EIbmParameterType.Double),
            _ => new BoundQueryParameter(number, Ibm: EIbmParameterType.Decimal)
        };

    private static EIbmParameterType TextType(ESqlDialect dialect, string text)
    {
        if (dialect == ESqlDialect.Db2)
            return Encoding.UTF8.GetByteCount(text) > Db2VarCharBytes ? EIbmParameterType.Clob : EIbmParameterType.VarChar;

        if (text.Length <= InformixVarCharCharacters)
            return EIbmParameterType.VarChar;

        return Encoding.UTF8.GetByteCount(text) <= InformixLongVarCharBytes ? EIbmParameterType.LongVarChar : EIbmParameterType.Clob;
    }

    private static EIbmParameterType NullType(ESqlDialect dialect, EQueryParameterType type)
        => type switch
        {
            EQueryParameterType.Number => EIbmParameterType.BigInt,
            EQueryParameterType.Boolean => dialect == ESqlDialect.Db2 ? EIbmParameterType.None : EIbmParameterType.VarChar,
            EQueryParameterType.Date => EIbmParameterType.Date,
            EQueryParameterType.Timestamp => EIbmParameterType.Timestamp,
            _ => EIbmParameterType.VarChar
        };
}
