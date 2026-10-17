using System.Globalization;
using System.Text;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>RN-IMPORT-009: uma coluna do arquivo (pela posição, a partir de 0) para uma coluna da tabela (pelo nome, como está no catálogo).</summary>
public sealed record ImportMappingEntry(int Source, string Target)
{
    public override string ToString()
        => nameof(ImportMappingEntry);
}

/// <summary>
/// RN-IMPORT-009: o mapeamento automático e a conferência do mapeamento pedido contra a tabela. O automático leva só às colunas que recebem valores (a
/// desabilitada nunca é escolhida): com cabeçalho, e no JSON, pelo nome; sem cabeçalho, pela posição.
/// </summary>
public static class ImportMapping
{
    /// <summary>
    /// O mapeamento automático. Pelo nome: primeiro a coluna de nome igual, letra por letra; sem ela, a igual sem diferenciar maiúsculas nem acentos, com o
    /// espaço, o hífen e o sublinhado contando como iguais, quando só uma casa assim (com mais de uma, a coluna do arquivo fica em "Não importar"). Pela
    /// posição: a coluna N do arquivo vai para a coluna N da tabela, na ordem do catálogo. Duas colunas do arquivo para a mesma da tabela: a primeira fica
    /// com ela. Só as colunas do arquivo que receberam uma da tabela entram, na ordem do arquivo.
    /// </summary>
    public static IReadOnlyList<ImportMappingEntry> Suggest(IReadOnlyList<string> fileColumns, bool byName, IReadOnlyList<ImportTargetColumn> table)
    {
        var taken = new HashSet<string>(StringComparer.Ordinal);
        var mapping = new List<ImportMappingEntry>();
        var importable = table.Where(column => column.Importable).ToList();

        for (var source = 0; source < fileColumns.Count; source++)
        {
            ImportTargetColumn? target;
            if (byName)
            {
                target = importable.FirstOrDefault(column => column.Name == fileColumns[source]);
                if (target is null)
                {
                    var key = Normalize(fileColumns[source]);
                    var matches = importable.Where(column => Normalize(column.Name) == key).Take(2).ToList();
                    target = matches.Count == 1 ? matches[0] : null;
                }
            }
            else
                target = source < table.Count && table[source].Importable ? table[source] : null;

            if (target is not null && taken.Add(target.Name))
                mapping.Add(new ImportMappingEntry(source, target.Name));
        }

        return mapping;
    }

    /// <summary>
    /// A primeira recusa do mapeamento pedido, com o caminho do campo (`mapping[3].source`, `mapping[3].target`): a posição além das colunas do arquivo, a
    /// coluna que a tabela não tem, a calculada pelo banco e a de um tipo que não se importa. Nula quando ele serve.
    /// </summary>
    public static (string Field, string Message)? Refusal(IReadOnlyList<ImportMappingEntry> mapping, int fileColumns, IReadOnlyList<ImportTargetColumn> table)
    {
        for (var index = 0; index < mapping.Count; index++)
        {
            var entry = mapping[index];
            if (entry.Source >= fileColumns)
                return ($"mapping[{index}].source", $"A coluna {entry.Source + 1} do arquivo não existe: o arquivo tem {ImportText.Thousands(fileColumns)} {(fileColumns == 1 ? "coluna" : "colunas")}.");

            if (table.FirstOrDefault(column => column.Name == entry.Target) is not { } target)
                return ($"mapping[{index}].target", $"A tabela não tem a coluna {entry.Target}.");

            if (!target.Importable)
                return ($"mapping[{index}].target", target.Reason!);
        }

        return null;
    }

    /// <summary>RN-IMPORT-009 e RN-BUSCA-001: o nome sem diferenciar maiúsculas nem acentos, com o espaço, o hífen e o sublinhado contando como iguais.</summary>
    public static string Normalize(string name)
    {
        var bare = new StringBuilder(name.Length);
        foreach (var character in name.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark)
                continue;

            bare.Append(character is ' ' or '-' ? '_' : character);
        }

        return bare.ToString().ToLowerInvariant();
    }
}
