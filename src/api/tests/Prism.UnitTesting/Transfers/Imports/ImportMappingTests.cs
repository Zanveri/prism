using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>RN-IMPORT-009: o mapeamento automático (pelo nome e pela posição) e a conferência do mapeamento pedido contra a tabela.</summary>
public sealed class ImportMappingTests
{
    private static ImportTargetColumn Column(string name, string type = "text", string? generated = null)
        => ImportColumns.Of(EDatabaseEngine.PostgreSql, new ColumnInfo(name, type, true, false, 1, null, generated));

    private static readonly IReadOnlyList<ImportTargetColumn> Table =
    [
        Column("id", "integer", ColumnGeneration.Always),
        Column("data_de_criacao", "date"),
        Column("Nome"),
        Column("nome"),
        Column("total", "numeric")
    ];

    [Trait("ImportMapping", "Suggest")]
    [Fact(DisplayName = "OK pelo nome: primeiro o igual; sem ele, sem maiúsculas, acentos e com espaço, hífen e sublinhado iguais; o ambíguo e o repetido ficam de fora")]
    public void Suggest_ByName_ShouldFollowTheRule()
    {
        //Act
        var mapping = ImportMapping.Suggest(["id", "Data de criação", "nome", "NOME", "Total", "TOTAL", "obs"], byName: true, Table);

        //Assert
        Assert.Equal([new ImportMappingEntry(1, "data_de_criacao"), new ImportMappingEntry(2, "nome"), new ImportMappingEntry(4, "total")], mapping);
    }

    [Trait("ImportMapping", "Suggest")]
    [Fact(DisplayName = "OK sem cabeçalho, pela posição: a coluna N vai para a N da tabela, menos a desabilitada")]
    public void Suggest_ByPosition_ShouldSkipTheDisabled()
    {
        //Act
        var mapping = ImportMapping.Suggest(["Coluna 1", "Coluna 2", "Coluna 3", "Coluna 4", "Coluna 5", "Coluna 6"], byName: false, Table);

        //Assert
        Assert.Equal([new ImportMappingEntry(1, "data_de_criacao"), new ImportMappingEntry(2, "Nome"), new ImportMappingEntry(3, "nome"), new ImportMappingEntry(4, "total")], mapping);
    }

    [Trait("ImportMapping", "Refusal")]
    [Fact(DisplayName = "ERRO a posição além das colunas do arquivo, a coluna que a tabela não tem e a calculada pelo banco, no campo")]
    public void Refusal_ShouldPointTheField()
    {
        //Act
        var source = ImportMapping.Refusal([new ImportMappingEntry(0, "total"), new ImportMappingEntry(3, "nome")], 3, Table);
        var missing = ImportMapping.Refusal([new ImportMappingEntry(0, "obs")], 3, Table);
        var generated = ImportMapping.Refusal([new ImportMappingEntry(0, "id")], 3, Table);
        var fine = ImportMapping.Refusal([new ImportMappingEntry(2, "Nome")], 3, Table);

        //Assert
        Assert.Equal(("mapping[1].source", "A coluna 4 do arquivo não existe: o arquivo tem 3 colunas."), source);
        Assert.Equal(("mapping[0].target", "A tabela não tem a coluna obs."), missing);
        Assert.Equal(("mapping[0].target", "O banco calcula esta coluna e não aceita valor."), generated);
        Assert.Null(fine);
    }

    [Trait("ImportMapping", "Normalize")]
    [Theory(DisplayName = "OK o nome sem maiúsculas nem acentos, com o espaço, o hífen e o sublinhado iguais")]
    [InlineData("Data de criação", "data_de_criacao")]
    [InlineData("data-de-criação", "data_de_criacao")]
    [InlineData("ÇÃO", "cao")]
    public void Normalize_ShouldMatchTheSearch(string name, string expected)
        => Assert.Equal(expected, ImportMapping.Normalize(name));
}
