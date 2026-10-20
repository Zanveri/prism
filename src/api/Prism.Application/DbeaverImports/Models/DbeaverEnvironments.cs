using Prism.Application.Common.Environments;
using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;
using Prism.Core.Extensions;
using System.Globalization;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-012: o tipo de conexão do DBeaver vira o ambiente da conexão no Prism (o nome e a cor) e as proteções (o "Confirmar execução SQL" e as restrições de
/// permissão). O tipo é procurado nos `connection-types` do próprio arquivo e, sem ele lá, nos três do DBeaver (`dev`, `test` e `prod`, reconhecidos pelo ID).
/// </summary>
internal static class DbeaverEnvironments
{
    /// <summary>Os três tipos que o DBeaver traz (`DBPConnectionType`), com o nome em inglês, a cor, e as confirmações de cada um.</summary>
    private static readonly IReadOnlyDictionary<string, DbeaverType> BuiltIn = new Dictionary<string, DbeaverType>(StringComparer.Ordinal)
    {
        ["dev"] = new("dev", "Development", "255,255,255", false, false, false),
        ["test"] = new("test", "Test", "214,250,207", false, true, false),
        ["prod"] = new("prod", "Production", "250,207,207", true, true, false)
    };

    private static readonly IReadOnlyDictionary<string, string> PortugueseNames = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["dev"] = "Desenvolvimento",
        ["test"] = "Teste",
        ["prod"] = "Produção"
    };

    /// <summary>O que o tipo e a cor da conexão dão: o ambiente (nulo sem nome), as proteções e as marcas.</summary>
    internal sealed record Resolved(string? Name, string? Color, string? DbeaverType, bool Cut, bool Invalid, bool ConfirmAll, bool ConfirmDataChangeOnly, bool PermissionRestricted)
    {
        public override string ToString()
            => nameof(Resolved);
    }

    public static Resolved Resolve(string? typeID, string? connectionColor, IReadOnlyDictionary<string, DbeaverType> fileTypes)
    {
        // Sem tipo, `dev`, como no DBeaver; o tipo que nem o arquivo nem o DBeaver trazem também (o DBeaver o troca pelo `dev`).
        var id = string.IsNullOrWhiteSpace(typeID) ? "dev" : typeID.Trim();
        var builtIn = BuiltIn.GetValueOrDefault(id);
        var inFile = fileTypes.GetValueOrDefault(id);
        if (builtIn is null && inFile is null)
        {
            id = "dev";
            builtIn = BuiltIn[id];
            inFile = fileTypes.GetValueOrDefault(id);
        }

        var fileName = Blank(inFile?.Name);
        var dbeaverName = fileName ?? builtIn?.Name ?? id;

        // Os três, reconhecidos pelo ID: o nome padrão em inglês (ou nenhum) vira o nome em português, e o renomeado pela pessoa fica com o nome dela.
        var shownName = builtIn is not null && (fileName is null || string.Equals(fileName, builtIn.Name, StringComparison.OrdinalIgnoreCase)) ? PortugueseNames[id] : dbeaverName;

        var normalized = shownName.NormalizeName();
        var invalid = normalized.Length == 0 || TextRules.HasControlOrDirection(normalized);
        var cut = !invalid && normalized.Length > EnvironmentRules.NameMaxLength;
        var environmentName = invalid ? null : cut ? TextRules.Cut(normalized, EnvironmentRules.NameMaxLength).TrimEnd() : normalized;

        // O nome do tipo no DBeaver, para a dica da marca "confirma todos os comandos": nulo quando tem caractere de controle ou de direção do texto.
        var typeNormalized = dbeaverName.NormalizeName();
        var typeName = typeNormalized.Length == 0 || TextRules.HasControlOrDirection(typeNormalized) ? null : TextRules.Cut(typeNormalized, EnvironmentRules.NameMaxLength).TrimEnd();

        // A cor da própria conexão vence a do tipo; o branco e o inválido não contam. O ambiente sem nome não leva a cor.
        var color = environmentName is null ? null : HexOf(connectionColor) ?? HexOf(inFile?.Color ?? builtIn?.Color);

        var confirmExecute = inFile?.ConfirmExecute ?? builtIn?.ConfirmExecute ?? false;
        var confirmDataChange = inFile?.ConfirmDataChange ?? builtIn?.ConfirmDataChange ?? false;

        return new Resolved(environmentName, color, typeName, cut, invalid && normalized.Length > 0, confirmExecute, confirmDataChange && !confirmExecute, inFile?.PermissionRestricted == true);
    }

    /// <summary>A cor do DBeaver, `"R,G,B"` em decimal, como `#RRGGBB` em maiúsculas; nula no branco (que é "sem cor" no DBeaver) e no que não é três inteiros de 0 a 255.</summary>
    public static string? HexOf(string? color)
    {
        if (string.IsNullOrWhiteSpace(color))
            return null;

        var parts = color.Split(',');
        if (parts.Length != 3)
            return null;

        var channels = new int[3];
        for (var index = 0; index < 3; index++)
            if (!int.TryParse(parts[index].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out channels[index]) || channels[index] > 255)
                return null;

        return channels is [255, 255, 255] ? null : string.Create(CultureInfo.InvariantCulture, $"#{channels[0]:X2}{channels[1]:X2}{channels[2]:X2}");
    }

    private static string? Blank(string? text)
        => string.IsNullOrWhiteSpace(text) ? null : text.Trim();
}
