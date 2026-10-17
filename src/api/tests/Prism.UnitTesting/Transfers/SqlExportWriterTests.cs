using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-011: o que o arquivo SQL tem além do que as fixtures `sql-literal.json`, `sql-binary.json` e `sql-insert.json` conferem: o binário do Db2
/// em pedaços de 16.336 bytes, o Informix sempre com uma linha por comando, o binário com "NULL", e o registro do formato.
/// </summary>
public sealed class SqlExportWriterTests
{
    private static SqlExportOptions Options(int rowsPerStatement = 10, EExportBinary binary = EExportBinary.Literal)
        => new("estoque", "pedido", false, rowsPerStatement, binary);

    /// <summary>A constante hexadecimal do Db2 tem até 32.672 dígitos: o valor maior vai em pedaços unidos por `||`, cada um no `BLOB(...)` da coluna `BLOB`.</summary>
    [Trait("ExportText", "BinaryLiteral")]
    [Fact(DisplayName = "OK o binário do Db2 em pedaços de 16.336 bytes")]
    public void BinaryLiteral_Db2_IsSplitIntoPiecesOf16336Bytes()
    {
        //Arrange
        var bytes = Enumerable.Range(0, (2 * ExportText.Db2HexPieceBytes) + 1).Select(index => (byte)index).ToArray();
        var first = Convert.ToHexString(bytes, 0, ExportText.Db2HexPieceBytes);
        var second = Convert.ToHexString(bytes, ExportText.Db2HexPieceBytes, ExportText.Db2HexPieceBytes);
        var last = Convert.ToHexString(bytes, 2 * ExportText.Db2HexPieceBytes, 1);

        //Act
        var blob = ExportText.BinaryLiteral(EDatabaseEngine.Db2, bytes, "BLOB");
        var varbinary = ExportText.BinaryLiteral(EDatabaseEngine.Db2, bytes[..(ExportText.Db2HexPieceBytes + 1)], "VARBINARY");
        var exact = ExportText.BinaryLiteral(EDatabaseEngine.Db2, bytes[..ExportText.Db2HexPieceBytes], "BLOB");

        //Assert
        Assert.Equal($"BLOB(X'{first}') || BLOB(X'{second}') || BLOB(X'{last}')", blob);
        Assert.Equal($"X'{first}' || X'{Convert.ToHexString(bytes, ExportText.Db2HexPieceBytes, 1)}'", varbinary);
        Assert.Equal($"BLOB(X'{first}')", exact);
    }

    /// <summary>O PostgreSQL não tem teto de constante: o `decode` leva o valor inteiro.</summary>
    [Trait("ExportText", "BinaryLiteral")]
    [Fact(DisplayName = "OK o binário do PostgreSQL inteiro num decode só")]
    public void BinaryLiteral_PostgreSql_IsWhole()
    {
        //Arrange
        var bytes = Enumerable.Range(0, 40000).Select(index => (byte)index).ToArray();

        //Act
        var literal = ExportText.BinaryLiteral(EDatabaseEngine.PostgreSql, bytes, "bytea");

        //Assert
        Assert.Equal($"decode('{Convert.ToHexString(bytes)}', 'hex')", literal);
    }

    /// <summary>O Informix não aceita várias linhas num `INSERT … VALUES`: mesmo que o pedido chegasse com 10 (quem começa recusa), cada linha é um comando.</summary>
    [Trait("SqlExportWriter", "Write")]
    [Fact(DisplayName = "OK o Informix tem sempre uma linha por comando")]
    public void Informix_WritesOneRowPerStatement()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Sql, [new ExportColumn("id", "INTEGER", "number")], [[ExportCell.FromText("1")], [ExportCell.FromText("2")]], Options(), engine: EDatabaseEngine.Informix);

        //Assert
        Assert.Equal("INSERT INTO \"estoque\".\"pedido\" (\"id\") VALUES (1);\nINSERT INTO \"estoque\".\"pedido\" (\"id\") VALUES (2);\n", text);
    }

    /// <summary>
    /// RN-EXPORT-006 e 011: com o binário "NULL", o valor nem é pedido ao leitor e chega nulo: sai `NULL`, e no Informix a linha sai inteira, sem o comentário
    /// do binário.
    /// </summary>
    [Trait("SqlExportWriter", "Write")]
    [Fact(DisplayName = "OK o binário NULL sai NULL, também no Informix")]
    public void BinaryAsNull_IsWrittenAsNull()
    {
        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.Sql, [new ExportColumn("id", "INTEGER", "number"), new ExportColumn("foto", "BYTE", "binary")], [[ExportCell.FromText("1"), ExportCell.Null]], Options(1, EExportBinary.Null), engine: EDatabaseEngine.Informix);

        //Assert
        Assert.Equal("INSERT INTO \"estoque\".\"pedido\" (\"id\", \"foto\") VALUES (1, NULL);\n", text);
        Assert.Equal(0, counts.SkippedRows);
    }

    /// <summary>O comentário no lugar da linha leva só o número dela, contado da origem a partir de 1, e uma frase fixa: nenhum nome, nenhum valor.</summary>
    [Trait("SqlExportWriter", "Write")]
    [Fact(DisplayName = "OK o comentário da linha pulada não leva dado do banco")]
    public void SkippedRow_CommentHasNoDatabaseText()
    {
        //Arrange
        ExportColumn[] columns = [new("nome", "text", "text")];
        IReadOnlyList<ExportCell>[] rows = [.. Enumerable.Range(0, 1233).Select(_ => (IReadOnlyList<ExportCell>)[ExportCell.FromText("ok")]), [ExportCell.FromText("valor\nDROP TABLE x;\u0001")]];

        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.Sql, columns, rows, Options(1000));

        //Assert
        var comment = text.Split('\n').Single(line => line.StartsWith("--", StringComparison.Ordinal));
        Assert.Equal("-- Linha 1234 não exportada: um valor tem caractere de controle que não vira literal.", comment);
        Assert.DoesNotContain("DROP", text, StringComparison.Ordinal);
        Assert.Equal(1, counts.SkippedRows);
    }

    [Trait("ExportFormats", "Create")]
    [Theory(DisplayName = "OK cada formato da lista tem o seu escritor")]
    [InlineData(ExportFormats.Csv, typeof(CsvExportWriter))]
    [InlineData(ExportFormats.SourceCode, typeof(SourceCodeExportWriter))]
    [InlineData(ExportFormats.DbUnit, typeof(DbUnitExportWriter))]
    [InlineData(ExportFormats.Html, typeof(HtmlExportWriter))]
    [InlineData(ExportFormats.Json, typeof(JsonExportWriter))]
    [InlineData(ExportFormats.Markdown, typeof(MarkdownExportWriter))]
    [InlineData(ExportFormats.Sql, typeof(SqlExportWriter))]
    [InlineData(ExportFormats.Txt, typeof(TxtExportWriter))]
    [InlineData(ExportFormats.Xlsx, typeof(XlsxExportWriter))]
    [InlineData(ExportFormats.Xml, typeof(XmlExportWriter))]
    public void Create_EachFormat_HasItsWriter(string format, Type writer)
    {
        //Arrange
        var (options, errors) = ExportOptionsReader.Read(format, null, "pedido");
        using var stream = new MemoryStream();

        //Act
        var created = ExportFormats.Create(format, new ExportWriterContext([new ExportColumn("id", "int4", "number")], "pedido", EDatabaseEngine.PostgreSql, options!), stream);

        //Assert
        Assert.Empty(errors);
        Assert.IsType(writer, created);
        Assert.Equal(ExportFormats.All.Count, ExportFormats.All.Distinct().Count());
    }
}
