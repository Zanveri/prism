using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Prism.Application.Scripts.Models;

/// <summary>
/// RN-VAR-028: o `declaresVariables` da lista dos scripts e a forma dos valores lembrados do "Executar com valores…" (`PUT api/user/scripts/{id}/run-values`), com
/// `SCRIPT_RUN_VALUES_INVALID` no campo. A API guarda o que recebeu sem interpretar os valores: confere só a forma, os nomes (RN-VAR-003) e os limites. Nenhuma
/// mensagem leva um nome ou um valor (RN-VAR-036).
/// </summary>
internal static class ScriptVariablesRules
{
    public const string InvalidCode = "SCRIPT_RUN_VALUES_INVALID";

    /// <summary>Até 500 nomes, e até 64 KiB no todo: os bytes de UTF-8 do texto JSON de `values` como veio no corpo, que é o `JSON.stringify` da tela.</summary>
    public const int MaxNames = 500;
    public const int MaxValuesBytes = 64 * 1024;

    /// <summary>RN-VAR-003: até 64 caracteres, contados por ponto de código, como a tela (`[...nome].length`).</summary>
    public const int MaxNameLength = 64;

    /// <summary>
    /// RN-VAR-003: os nomes que não podem ser nome, copiados da tela (`reservedWords`, `closedNames` e `environmentNames` em `variables/catalog.ts`, e
    /// `forbiddenMembers` em `variables/values.ts`). Fazem parte do contrato da linguagem (RN-VERSAO-002): nome novo entra nas duas listas.
    /// </summary>
    private static readonly HashSet<string> NotNames = new(StringComparer.Ordinal)
    {
        // As palavras reservadas do JavaScript, mais `undefined`, `NaN` e `Infinity`.
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
        "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while",
        "with", "yield", "await", "implements", "interface", "package", "private", "protected", "public", "static", "undefined", "NaN", "Infinity",

        // A lista fechada e o ambiente.
        "Math", "random", "date", "Date", "Number", "String",
        "window", "globalThis", "self", "document", "process", "require", "module", "eval", "Function", "Object", "Array", "JSON", "Reflect", "Proxy", "Symbol",

        // Os nomes vedados (RN-VAR-014): `__proto__` e `constructor` como chave do mapa dos valores lembrados também caem aqui.
        "constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "caller", "callee", "arguments", "toString",
        "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "call", "apply", "bind", "then",
    };

    /// <summary>RN-VAR-028 e seção 45: as palavras que abrem uma declaração no topo do script.</summary>
    private static readonly string[] Keywords = ["let", "const", "interface", "type"];

    /// <summary>RN-VAR-028: o `object` é o valor de uma interface ou de um type de objeto, com o texto escrito como no script (RN-VAR-004, seção 45).</summary>
    private static readonly string[] ValueTypes = ["number", "text", "boolean", "date", "timestamp", "sql", "object", "null"];

    /// <summary>
    /// RN-VAR-003: começa por letra (ou número em letra, `Nl`), `_` ou `$`, e continua com eles, marcas, dígitos e conectores; até 64 caracteres; em NFC, que é como a
    /// tela o compara e o manda; e não é um dos nomes que não podem ser nome, nem `select` e `values` em qualquer caixa, nem `$a$`, nem `$` com só dígitos. Os
    /// caracteres de formato e de direção (U+200B a U+200F, U+202A a U+202E, U+2066 a U+2069, U+FEFF) são `Cf`, e ficam de fora sem regra própria; a metade de um
    /// par UTF-16 vira U+FFFD, que não é letra.
    /// ponytail: as classes do Unicode pela categoria do .NET, e não `ID_Start`/`ID_Continue` (o .NET não as expõe): ficam de fora os poucos de `Other_ID_Start` e
    /// `Other_ID_Continue` (U+2118, U+212E, U+00B7, U+0387...). Se um deles aparecer num nome de verdade, a tabela entra aqui.
    /// </summary>
    public static bool IsVariableName(string name)
    {
        if (name.Length == 0 || !name.IsNormalized(NormalizationForm.FormC))
            return false;

        var count = 0;
        foreach (var rune in name.EnumerateRunes())
            if (++count > MaxNameLength || !(count == 1 ? StartsAName(rune) : ContinuesAName(rune)))
                return false;

        if (NotNames.Contains(name) || name.Equals("select", StringComparison.OrdinalIgnoreCase) || name.Equals("values", StringComparison.OrdinalIgnoreCase))
            return false;

        // `$a$` abriria um `$a$ ... $a$` no leitor do PostgreSQL, e `$1` é um marcador.
        return !(name.Length >= 2 && name[0] == '$' && (name[^1] == '$' || !name.AsSpan(1).ContainsAnyExceptInRange('0', '9')));
    }

    /// <summary>
    /// RN-VAR-028: o script declara variáveis no topo quando, depois dos espaços em branco e dos comentários (`--` e `//` até o fim da linha, `/* … */` e, em
    /// qualquer banco, `{ … }`), o texto começa por `let`, `const`, `interface` ou `type`, em minúsculas, seguido de espaço, tabulação ou quebra de linha e de um
    /// nome (só a forma: o começo de um nome). A `interface` e o `type` no topo contam como declaração (seção 45): o script que os escreve declara as variáveis deles. É uma aproximação que só decide se o "Executar com valores…" aparece no menu; o comentário que não fecha é o texto inteiro, e não declara.
    /// Os casos estão em `src/test-fixtures/variables/declares.json`, que a tela também lê.
    /// </summary>
    public static bool DeclaresVariables(string sql)
    {
        var at = 0;
        while (at < sql.Length)
        {
            var character = sql[at];
            var next = at + 1 < sql.Length ? sql[at + 1] : '\0';

            if (char.IsWhiteSpace(character))
                at++;
            else if ((character == '-' && next == '-') || (character == '/' && next == '/'))
                at = sql.IndexOfAny(['\n', '\r'], at) is var end and >= 0 ? end : sql.Length;
            else if (character == '/' && next == '*')
            {
                var close = sql.IndexOf("*/", at + 2, StringComparison.Ordinal);
                if (close < 0)
                    return false;

                at = close + 2;
            }
            else if (character == '{')
            {
                var close = sql.IndexOf('}', at + 1);
                if (close < 0)
                    return false;

                at = close + 1;
            }
            else
                break;
        }

        var keyword = 0;
        foreach (var word in Keywords)
            if (sql.AsSpan(at).StartsWith(word, StringComparison.Ordinal))
                keyword = word.Length;
        if (keyword == 0)
            return false;

        at += keyword;
        var separator = at;
        while (at < sql.Length && sql[at] is ' ' or '\t' or '\r' or '\n')
            at++;

        return at > separator && at < sql.Length && Rune.DecodeFromUtf16(sql.AsSpan(at), out var rune, out _) == System.Buffers.OperationStatus.Done && StartsAName(rune);
    }

    /// <summary>
    /// A forma de `values`, campo por campo: `values` (não é objeto, passa dos limites, um nome que não é nome ou repetido), `values.nome` (a entrada que não é um
    /// objeto com `type` e `value`, ou `type` e `items`), `values.nome.type`, `values.nome.value`, `values.nome.items` e `values.nome.items[2].value`. O mapa vazio vale:
    /// é o "Esquecer os valores deste script".
    /// </summary>
    public static IReadOnlyList<(string Field, string Message)> RunValuesRefusals(JsonElement? values)
    {
        if (values is not { ValueKind: JsonValueKind.Object } map)
            return [("values", "Informe os valores como um objeto do nome de cada variável para { type, value }.")];

        // Os limites antes das entradas: a resposta de um corpo grande demais tem uma recusa, e não uma por entrada.
        if (Encoding.UTF8.GetByteCount(map.GetRawText()) > MaxValuesBytes)
            return [("values", "Os valores lembrados passam de 64 KiB.")];

        if (map.EnumerateObject().Count() > MaxNames)
            return [("values", "Lembre até 500 valores.")];

        var refusals = new List<(string, string)>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in map.EnumerateObject())
        {
            if (!TryRead(() => property.Name, out var name) || !IsVariableName(name))
                refusals.Add(("values", "Cada nome é um nome de variável: começa por letra, _ ou $, tem até 64 caracteres e não é uma palavra reservada nem um nome do Prism."));
            else if (!names.Add(name))
                refusals.Add(("values", "Um nome aparece duas vezes nos valores."));
            else
                refusals.AddRange(EntryRefusals(property.Value, $"values.{name}", allowsList: true));
        }

        return refusals;
    }

    /// <summary>`{ type, value }` (o `value` texto, e nulo só no `null`), ou `{ type: "list", items }` com os itens nessa forma, sem lista dentro de lista.</summary>
    private static IReadOnlyList<(string Field, string Message)> EntryRefusals(JsonElement entry, string path, bool allowsList)
    {
        if (entry.ValueKind != JsonValueKind.Object || !entry.TryGetProperty("type", out var typeElement) || typeElement.ValueKind != JsonValueKind.String || !TryRead(typeElement.GetString, out var type))
            return [(path, "Cada valor é um objeto { type, value }, ou { type: \"list\", items }.")];

        if (type == "list")
        {
            if (!allowsList)
                return [($"{path}.type", "Uma lista não leva outra lista dentro.")];

            if (!HasOnlyTheKeys(entry, "type", "items") || entry.GetProperty("items").ValueKind != JsonValueKind.Array)
                return [($"{path}.items", "Os itens da lista são uma lista de { type, value }.")];

            var refusals = new List<(string, string)>();
            var index = 0;
            foreach (var item in entry.GetProperty("items").EnumerateArray())
                refusals.AddRange(EntryRefusals(item, $"{path}.items[{index++}]", allowsList: false));

            return refusals;
        }

        if (!ValueTypes.Contains(type, StringComparer.Ordinal))
            return [($"{path}.type", "O tipo é number, text, boolean, date, timestamp, sql, object, null ou list.")];

        if (!HasOnlyTheKeys(entry, "type", "value"))
            return [(path, "Cada valor é um objeto com type e value.")];

        var value = entry.GetProperty("value");
        if (type == "null")
            return value.ValueKind == JsonValueKind.Null ? [] : [($"{path}.value", "O valor do tipo null é nulo.")];

        if (value.ValueKind != JsonValueKind.String)
            return [($"{path}.value", "O valor é um texto.")];

        // A metade de um par UTF-16 e o UTF-8 inválido: ler o texto lança, e o cofre não os grava. É a recusa do campo, e nunca o 500.
        return TryRead(value.GetString, out _) ? [] : [($"{path}.value", "O texto tem metade de um par UTF-16 ou UTF-8 inválido.")];
    }

    private static bool HasOnlyTheKeys(JsonElement entry, string first, string second)
        => entry.TryGetProperty(first, out _) && entry.TryGetProperty(second, out _) && entry.EnumerateObject().Count() == 2;

    private static bool StartsAName(Rune rune)
        => rune.Value is '_' or '$' || Rune.GetUnicodeCategory(rune) is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter
            or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter or UnicodeCategory.LetterNumber;

    private static bool ContinuesAName(Rune rune)
        => StartsAName(rune) || Rune.GetUnicodeCategory(rune) is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.DecimalDigitNumber
            or UnicodeCategory.ConnectorPunctuation;

    /// <summary>
    /// O texto de um nome ou de um valor, ou nada quando o JSON o escreve com a metade de um par UTF-16 (`\uD800`) ou com UTF-8 inválido: a leitura lança
    /// `InvalidOperationException`, e o <c>System.Text.Json</c> não tem uma versão `Try` (a mesma captura do `QueryParameterRules`).
    /// </summary>
    private static bool TryRead(Func<string?> read, out string text)
    {
        try
        {
            text = read() ?? string.Empty;

            return true;
        }
        catch (InvalidOperationException)
        {
            text = string.Empty;

            return false;
        }
    }
}
