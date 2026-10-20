using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using System.Xml;
using System.Xml.Linq;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-012: o documento XML do DBeaver e o conjunto do DbUnit, inteiros, além do que as fixtures `xml-text.json`, `xml-name.json` e
/// `dbunit-dataset.json` conferem: a estrutura, a raiz vazia, o `DOCTYPE`, o nulo e o vazio, e que o documento sai bem formado com nomes e valores hostis,
/// com a volta exata dos nomes.
/// </summary>
public sealed class XmlExportWritersTests
{
    private static readonly XmlExportOptions Xml = new(false, EExportBinary.Hex);

    private static readonly ExportColumn[] Pedido = [new("id", "int4", "number"), new("cliente", "text", "text")];

    /// <summary>O exemplo da regra: a declaração, a raiz com o nome da origem, um `DATA_RECORD` por linha, recuo de 2 espaços e LF.</summary>
    [Trait("XmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o XML é o do exemplo da regra")]
    public void Xml_IsTheExampleOfTheRule()
    {
        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.Xml, Pedido, [[ExportCell.FromText("1"), ExportCell.FromText("Ana")]], Xml);

        //Assert
        Assert.Equal("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<pedido>\n  <DATA_RECORD>\n    <id>1</id>\n    <cliente>Ana</cliente>\n  </DATA_RECORD>\n</pedido>\n", text);
        Assert.Equal(0, counts.RemovedCharacters);
    }

    /// <summary>RN-EXPORT-006: sem linhas, a declaração e a raiz vazia.</summary>
    [Trait("XmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o XML sem linhas é a raiz vazia")]
    public void Xml_WithoutRows_IsTheEmptyRoot()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Xml, Pedido, [], Xml);

        //Assert
        Assert.Equal("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<pedido/>\n", text);
    }

    /// <summary>O nulo e o texto vazio são o elemento vazio, como no DBeaver; o binário sai em hexadecimal, como a grade.</summary>
    [Trait("XmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o nulo e o vazio são o elemento vazio, e o binário sai em hexadecimal")]
    public void Xml_NullAndEmpty_AreTheEmptyElement()
    {
        //Arrange
        ExportColumn[] columns = [new("a", "text", "text"), new("b", "text", "text"), new("foto", "bytea", "binary")];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Xml, columns, [[ExportCell.Null, ExportCell.FromText(string.Empty), ExportCell.FromBytes([0xDE, 0xAD])]], Xml);

        //Assert
        Assert.Contains("    <a/>\n    <b/>\n    <foto>0xDEAD</foto>\n", text);
    }

    /// <summary>
    /// "Declaração DOCTYPE": a raiz tem `DATA_RECORD`s, o `DATA_RECORD` tem cada coluna, opcional, na ordem (a repetida aparece repetida), e cada nome é
    /// declarado uma vez, também o da coluna que se chama como a raiz ou `DATA_RECORD`.
    /// </summary>
    [Trait("XmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o DOCTYPE do DBeaver declara cada nome uma vez")]
    public void Xml_Doctype_DeclaresEachNameOnce()
    {
        //Arrange
        ExportColumn[] columns = [new("id", "int4", "number"), new("nome completo", "text", "text"), new("id", "int4", "number"), new("DATA_RECORD", "text", "text"), new("pedido", "text", "text")];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.Xml, columns, [], Xml with { Doctype = true });

        //Assert
        Assert.Equal(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE pedido [\n  <!ELEMENT pedido (DATA_RECORD*)>\n  <!ELEMENT DATA_RECORD (id?,nome_x0020_completo?,id?,DATA_RECORD?,pedido?)+>\n  <!ELEMENT id (#PCDATA)>\n  <!ELEMENT nome_x0020_completo (#PCDATA)>\n]>\n<pedido/>\n",
            text);
    }

    /// <summary>
    /// Nomes e valores hostis (marca de direção, `]]&gt;`, `&lt;script&gt;`, U+0000, U+FFFE, o par solto, emoji, um `_x0041_` já escrito): o documento sai bem
    /// formado, os nomes voltam exatos pela regra do .NET, e o que o XML 1.0 não aceita no valor é tirado e contado (o nome não perde nada).
    /// </summary>
    [Trait("XmlExportWriter", "Write")]
    [Fact(DisplayName = "OK o XML com nomes e valores hostis é bem formado")]
    public void Xml_HostileNamesAndValues_AreWellFormed()
    {
        //Arrange
        string[] names = ["1x", "a b", "]]>", "<script>", "x\u0000y", "\u202Eid", "_x0041_", "emoji😀", "\uD800solto"];
        var columns = names.Select(name => new ExportColumn(name, "text", "text")).ToArray();
        IReadOnlyList<ExportCell> row = [.. names.Select(_ => ExportCell.FromText("v<&>]]>\r\n\u0000\uFFFE\uDC00😀"))];

        //Act
        var (text, counts) = ExportWriting.Write(ExportFormats.Xml, columns, [row], Xml with { Doctype = true }, sourceName: "nota fiscal");

        //Assert
        var document = XDocument.Parse(text, LoadOptions.PreserveWhitespace);
        Assert.Equal("nota fiscal", XmlConvert.DecodeName(document.Root!.Name.LocalName));
        var values = document.Root.Element("DATA_RECORD")!.Elements().ToList();
        Assert.Equal(names, values.Select(element => XmlConvert.DecodeName(element.Name.LocalName)));
        Assert.All(values, element => Assert.Equal("v<&>]]>\r\n😀", element.Value));
        Assert.Equal(3 * names.Length, counts.RemovedCharacters);
    }

    /// <summary>O DbUnit com nomes e valores hostis: bem formado, o atributo repetido com o sufixo, e o valor que volta igual pelo leitor de XML.</summary>
    [Trait("DbUnitExportWriter", "Write")]
    [Fact(DisplayName = "OK o DbUnit com nomes e valores hostis é bem formado")]
    public void DbUnit_HostileNamesAndValues_AreWellFormed()
    {
        //Arrange
        string[] names = ["id", "ID", "a b", "<script>", "]]>", "x\"y", "_x0041_"];
        var columns = names.Select(name => new ExportColumn(name, "text", "text")).ToArray();
        IReadOnlyList<ExportCell> row = [.. names.Select(_ => ExportCell.FromText("diz \"oi\" <b> & \t\r\n'x'"))];

        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.DbUnit, columns, [row], new DbUnitExportOptions("nota fiscal", true, false, EExportBinary.Hex));

        //Assert
        var element = XDocument.Parse(text).Root!.Elements().Single();
        Assert.Equal("NOTA FISCAL", XmlConvert.DecodeName(element.Name.LocalName));
        Assert.Equal(["ID", "ID_2", "A B", "<SCRIPT>", "]]>", "X\"Y", "_X0041_"], element.Attributes().Select(attribute => XmlConvert.DecodeName(attribute.Name.LocalName)));
        Assert.All(element.Attributes(), attribute => Assert.Equal("diz \"oi\" <b> & \t\r\n'x'", attribute.Value));
    }

    /// <summary>O DbUnit escreve o binário em hexadecimal, como a grade, e com "Deixar vazio" ele chega nulo e o atributo some.</summary>
    [Trait("DbUnitExportWriter", "Write")]
    [Fact(DisplayName = "OK o binário do DbUnit em hexadecimal")]
    public void DbUnit_Binary_IsHex()
    {
        //Act
        var (text, _) = ExportWriting.Write(ExportFormats.DbUnit, [new ExportColumn("foto", "bytea", "binary"), new ExportColumn("id", "int4", "number")], [[ExportCell.FromBytes([0x00, 0xFF]), ExportCell.FromText("1")], [ExportCell.Null, ExportCell.FromText("2")]], new DbUnitExportOptions("pedido", true, false, EExportBinary.Hex));

        //Assert
        Assert.Contains("    <PEDIDO FOTO=\"0x00FF\" ID=\"1\"/>\n    <PEDIDO ID=\"2\"/>\n", text);
    }
}
