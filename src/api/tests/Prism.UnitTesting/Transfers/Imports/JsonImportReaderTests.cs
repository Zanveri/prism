using CSharpFunctionalExtensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Readers;
using Serilog.Core;
using System.Text;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-005 e 008: o leitor do JSON: as duas formas, as chaves do arquivo inteiro, os problemas de cada item, os valores (o texto, o número como está,
/// o lógico, o nulo, o objeto e a lista como estão no arquivo), o JSON mal formado e o UTF-8 inválido com a linha, e o espaço que cresce até um valor.
/// </summary>
public sealed class JsonImportReaderTests
{
    private static Result<ImportReader, ImportReadFailure> Open(string json, IReadOnlyList<string>? keys = null)
        => Open(Encoding.UTF8.GetBytes(json), keys);

    private static Result<ImportReader, ImportReadFailure> Open(byte[] json, IReadOnlyList<string>? keys = null)
        => ImportReader.Open(ImportFormats.Json, new JsonImportOptions(keys), new MemoryStream(json), Logger.None, CancellationToken.None);

    private static (ImportReader Reader, List<ImportRecord> Records) ReadAll(string json, IReadOnlyList<string>? keys = null)
    {
        var opened = Open(json, keys);
        Assert.True(opened.IsSuccess, opened.IsFailure ? opened.Error.Message : null);
        var records = new List<ImportRecord>();
        while (true)
        {
            var next = opened.Value.Next(CancellationToken.None);
            Assert.True(next.IsSuccess, next.IsFailure ? next.Error.Message : null);
            if (next.Value is null)
                return (opened.Value, records);

            records.Add(next.Value);
        }
    }

    private static ImportReadFailure FirstFailure(byte[] json, IReadOnlyList<string>? keys = null)
    {
        var opened = Open(json, keys);
        if (opened.IsFailure)
            return opened.Error;

        using var reader = opened.Value;
        while (true)
        {
            var next = reader.Next(CancellationToken.None);
            if (next.IsFailure)
                return next.Error;

            Assert.NotNull(next.Value);
        }
    }

    [Trait("JsonImportReader", "Begin")]
    [Fact(DisplayName = "OK a lista de objetos, com as chaves do arquivo inteiro na ordem em que aparecem")]
    public void Begin_List_ShouldReadAllTheKeys()
    {
        //Act
        var (reader, records) = ReadAll("[{\"id\": 1, \"nome\": \"Ana\"}, {\"id\": 2}, {\"obs\": null, \"id\": 3}]");

        //Assert
        Assert.Null(reader.Info.ListKey);
        Assert.Equal(["id", "nome", "obs"], reader.Columns);
        Assert.Equal([1L, 2L, 3L], records.Select(record => record.Line));
        Assert.Equal(EImportValueSource.Null, records[1].Values[1].Source);
        Assert.Equal("3", records[2].Values[0].Text);
    }

    [Trait("JsonImportReader", "Begin")]
    [Fact(DisplayName = "OK o objeto com uma chave só, a lista em pedido, com o BOM")]
    public void Begin_ObjectWithAList_ShouldReadTheList()
    {
        //Arrange
        byte[] json = [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("{ \"pedido\": [ { \"id\": 1 } ] }")];

        //Act
        var opened = Open(json);
        var record = opened.Value.Next(CancellationToken.None);
        var end = opened.Value.Next(CancellationToken.None);

        //Assert
        Assert.Equal("pedido", opened.Value.Info.ListKey);
        Assert.Equal("1", record.Value!.Values[0].Text);
        Assert.Null(end.Value);
    }

    [Trait("JsonImportReader", "Begin")]
    [Theory(DisplayName = "ERRO outra forma: o valor solto, a lista de listas na raiz, o objeto com duas chaves, o objeto sem lista")]
    [InlineData("42")]
    [InlineData("{}")]
    [InlineData("{\"a\": 1}")]
    [InlineData("{\"a\": [], \"b\": []}")]
    public void Begin_OtherShape_ShouldBeRefused(string json)
    {
        //Act
        var refusal = FirstFailure(Encoding.UTF8.GetBytes(json));

        //Assert
        Assert.Equal(EImportReadReason.Format, refusal.Reason);
        Assert.Equal("O JSON não é uma lista de objetos, nem um objeto com uma lista de objetos dentro.", refusal.Message);
    }

    [Trait("JsonImportReader", "ReadNext")]
    [Fact(DisplayName = "OK os valores: o texto sem os escapes, o número como está, o lógico, o nulo e o objeto e a lista como estão no arquivo")]
    public void Next_Values_ShouldKeepTheirForm()
    {
        //Act
        var (_, records) = ReadAll("[{\"t\": \"a\\\"b\\n\\u00e9\", \"n\": 12345678901234567890.5, \"b\": true, \"f\": false, \"z\": null, \"o\": {\"x\": [1, 2]}, \"l\": [ 1 ,2 ], \"s\": \"\\ud83d\"}]");
        var values = records[0].Values;

        //Assert
        Assert.Equal(new ImportValue("a\"b\né", EImportValueSource.Text), values[0]);
        Assert.Equal(new ImportValue("12345678901234567890.5", EImportValueSource.Canonical), values[1]);
        Assert.Equal(new ImportValue("true", EImportValueSource.Canonical), values[2]);
        Assert.Equal(new ImportValue("false", EImportValueSource.Canonical), values[3]);
        Assert.Equal(ImportValue.Null, values[4]);
        Assert.Equal(new ImportValue("{\"x\": [1, 2]}", EImportValueSource.Json), values[5]);
        Assert.Equal(new ImportValue("[ 1 ,2 ]", EImportValueSource.Json), values[6]);
        Assert.Equal("\ud83d", values[7].Text);
    }

    [Trait("JsonImportReader", "ReadNext")]
    [Fact(DisplayName = "OK os problemas da linha: o item que não é objeto, a chave repetida e a chave que não estava no arquivo")]
    public void Next_Problems_ShouldBeMarkedOnTheLine()
    {
        //Act
        var (_, records) = ReadAll("[{\"id\": 1}, 5, [1, {\"a\": 2}], {\"id\": 2, \"id\": 3}, {\"obs\": 1}]", keys: ["id"]);

        //Assert
        Assert.Null(records[0].Problem);
        Assert.Equal("O item 2 da lista não é um objeto.", records[1].Problem!.Message);
        Assert.Equal("O item 3 da lista não é um objeto.", records[2].Problem!.Message);
        Assert.Equal("O item 4 da lista tem a chave id duas vezes.", records[3].Problem!.Message);
        Assert.Equal("O item 5 da lista tem a chave obs, que não estava no arquivo quando ele foi lido.", records[4].Problem!.Message);
    }

    [Trait("JsonImportReader", "Begin")]
    [Fact(DisplayName = "ERRO o JSON mal formado, com a linha e o byte da linha somados de 1")]
    public void Next_Malformed_ShouldSayTheLineAndTheByte()
    {
        //Act
        var refusal = FirstFailure(Encoding.UTF8.GetBytes("[\n{\"id\": 1},\n{\"id\": 2,}\n]"));

        //Assert
        Assert.Equal(EImportReadReason.Format, refusal.Reason);
        Assert.Equal("O arquivo não é um JSON válido: erro na linha 3, byte 10 da linha.", refusal.Message);
        Assert.Equal(3, refusal.Line);
    }

    [Trait("JsonImportReader", "Begin")]
    [Fact(DisplayName = "ERRO o UTF-8 inválido, com a linha")]
    public void Next_InvalidUtf8_ShouldSayTheLine()
    {
        //Arrange
        byte[] json = [.. Encoding.UTF8.GetBytes("[\n{\"a\": \"x\"},\n{\"a\": \""), 0xC3, 0x28, .. Encoding.UTF8.GetBytes("\"}]")];

        //Act
        var refusal = FirstFailure(json);

        //Assert
        Assert.Equal(EImportReadReason.Encoding, refusal.Reason);
        Assert.Equal("O JSON não é UTF-8 válido: erro na linha 3 do arquivo.", refusal.Message);
    }

    [Trait("JsonImportReader", "ReadNext")]
    [Fact(DisplayName = "OK o texto e o objeto maiores que o bloco de leitura fazem o espaço crescer, sem perder nada")]
    public void Next_ValuesLargerThanTheBlock_ShouldGrowTheBuffer()
    {
        //Arrange
        var text = new string('é', 150_000);
        var inner = $"{{\"lista\": [{string.Join(", ", Enumerable.Range(0, 30_000))}]}}";

        //Act
        var (reader, records) = ReadAll($"[{{\"t\": \"{text}\", \"o\": {inner}}}, {{\"t\": \"fim\"}}]");

        //Assert
        Assert.Equal(text, records[0].Values[0].Text);
        Assert.Equal(inner, records[0].Values[1].Text);
        Assert.Equal("fim", records[1].Values[0].Text);
        Assert.Equal(reader.Size, reader.Position);
    }

    [Trait("JsonImportReader", "Limits")]
    [Fact(DisplayName = "ERRO mais de 16.384 chaves e a chave acima de 256 caracteres")]
    public void Begin_KeyLimits_ShouldBeRefused()
    {
        //Arrange
        var many = $"[{{{string.Join(", ", Enumerable.Range(0, 16385).Select(index => $"\"k{index}\": 1"))}}}]";
        var longKey = $"[{{\"a\": 1, \"{new string('k', 257)}\": 2}}]";

        //Act
        var columns = FirstFailure(Encoding.UTF8.GetBytes(many));
        var name = FirstFailure(Encoding.UTF8.GetBytes(longKey));

        //Assert
        Assert.Equal("O arquivo tem mais de 16.384 colunas.", columns.Message);
        Assert.Equal("O nome da coluna 2 do arquivo passa de 256 caracteres.", name.Message);
    }

    [Trait("JsonImportReader", "Begin")]
    [Fact(DisplayName = "OK com as chaves do pedido, a leitura não percorre o arquivo antes, e a posição de cada coluna é a da lista")]
    public void Begin_WithKeys_ShouldUseTheirPositions()
    {
        //Act
        var (reader, records) = ReadAll("[{\"id\": 1, \"nome\": \"Ana\"}]", keys: ["nome", "id"]);

        //Assert
        Assert.Equal(["nome", "id"], reader.Columns);
        Assert.Equal("Ana", records[0].Values[0].Text);
        Assert.Equal("1", records[0].Values[1].Text);
    }

    [Trait("JsonImportReader", "Limits")]
    [Fact(DisplayName = "ERRO o texto sem escape acima de 64 MiB para a leitura no próprio token, com o item e a chave")]
    public void Next_ValueAbove64MiB_ShouldBeRefused()
    {
        //Arrange
        var head = Encoding.UTF8.GetBytes("[{\"id\": 1, \"obs\": \"");
        var tail = Encoding.UTF8.GetBytes("\"}]");
        var bytes = new byte[head.Length + ImportReader.MaxValueBytes + 1 + tail.Length];
        head.CopyTo(bytes, 0);
        bytes.AsSpan(head.Length, (int)ImportReader.MaxValueBytes + 1).Fill((byte)'x');
        tail.CopyTo(bytes, bytes.Length - tail.Length);

        //Act
        var refusal = FirstFailure(bytes, keys: ["id", "obs"]);

        //Assert
        Assert.True(refusal.ValueTooLarge);
        Assert.Equal(EImportReadReason.Limits, refusal.Reason);
        Assert.Equal(1, refusal.Line);
        Assert.Equal("obs", refusal.Column);
        Assert.Equal("Um valor do item 1 da lista, coluna obs, passa de 64 MiB, e o Prism não o importa.", refusal.Message);
    }
}
