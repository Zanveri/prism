using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Transfers.Imports;

/// <summary>
/// RN-IMPORT-009, 012 e 015: a tabela de destino a partir do catálogo, a mesma na prévia, na prévia da cópia e no trabalho: o que não é uma tabela comum,
/// nos termos da edição (RN-EDIT-002), e as colunas com a classe de cada uma e as chaves de outras tabelas que apontam para ela.
/// </summary>
public static class ImportTargets
{
    /// <summary>
    /// RN-IMPORT-009: por que o destino não é uma tabela comum, ou nulo quando é. A tabela particionada do PostgreSQL é uma tabela; o apelido do Db2, a
    /// tabela temporária global, a tabela tipada e a tabela externa do Informix "não são uma tabela comum".
    /// </summary>
    public static string? NotATableReason(EDatabaseEngine engine, string kind)
        => kind switch
        {
            "table" => null,
            "view" => "é uma visão",
            "materializedView" => "é uma visão materializada",
            "foreign" when engine == EDatabaseEngine.PostgreSql => "é uma tabela estrangeira",
            _ => "não é uma tabela comum"
        };

    /// <summary>RN-IMPORT-009 e 012: a tabela como a prévia a mostra e a carga a usa: as colunas na ordem do catálogo e as chaves de outras tabelas que apontam para ela.</summary>
    public static ImportTargetTable TableOf(EDatabaseEngine engine, ImportCatalog catalog)
    {
        var columns = catalog.Table.Columns.OrderBy(column => column.Position).Select(column => ImportColumns.Of(engine, column, catalog.BaseTypes.GetValueOrDefault(column.Name))).ToList();
        var references = catalog.ReferencedBy
            .Where(reference => !(reference.ReferencingSchema == catalog.Table.Schema && reference.ReferencingTable == catalog.Table.Name))
            .Select(reference => new ImportReference(reference.ReferencingSchema, reference.ReferencingTable, reference.OnDelete ?? ForeignKeyRule.NoAction))
            .ToList();

        return new ImportTargetTable(catalog.Table.Schema, catalog.Table.Name, catalog.Table.OneAtATime, columns, references);
    }

    /// <summary>
    /// RN-IMPORT-015: a coluna converte do mesmo jeito nas duas leituras do catálogo: o mesmo tipo (com o tipo-base do domínio), a mesma classe e as
    /// mesmas casas e fuso. O que não muda a conversão (aceitar nulo, o padrão) pode mudar.
    /// </summary>
    public static bool ConvertsTheSame(ImportTargetColumn before, ImportTargetColumn after)
        => before.Type == after.Type && before.Class == after.Class && before.Number == after.Number && before.Scale == after.Scale && before.Fraction == after.Fraction && before.TimeZone == after.TimeZone && before.SpecialFloats == after.SpecialFloats && before.Importable == after.Importable;
}
