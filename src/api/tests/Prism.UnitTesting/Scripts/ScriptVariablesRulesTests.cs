using Prism.Application.Scripts.Models;
using System.Text;
using System.Text.Json;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// RN-VAR-028: o `declaresVariables` pelos casos de `src/test-fixtures/variables/declares.json` (escritos à mão; a tela lê o mesmo arquivo, e as duas têm de decidir
/// igual), os nomes da RN-VAR-003 e a forma dos valores lembrados, com o campo de cada recusa.
/// </summary>
public sealed class ScriptVariablesRulesTests
{
    public static TheoryData<string, string, bool> Fixture()
    {
        var data = new TheoryData<string, string, bool>();
        using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-fixtures", "variables", "declares.json")));
        foreach (var item in document.RootElement.GetProperty("cases").EnumerateArray())
            data.Add(item.GetProperty("name").GetString()!, item.GetProperty("text").GetString()!, item.GetProperty("declares").GetBoolean());

        return data;
    }

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);

        return document.RootElement.Clone();
    }

    [Trait("ScriptVariablesRules", "DeclaresVariables")]
    [Theory(DisplayName = "OK decide o declaresVariables como o fixture")]
    [MemberData(nameof(Fixture))]
    public void DeclaresVariables_ShouldFollowTheFixture(string name, string text, bool expected)
    {
        //Act
        var declares = ScriptVariablesRules.DeclaresVariables(text);

        //Assert
        Assert.True(expected == declares, $"{name}: esperado {expected}, decidiu {declares}");
    }

    [Trait("ScriptVariablesRules", "IsVariableName")]
    [Theory(DisplayName = "OK aceita os nomes da RN-VAR-003")]
    [InlineData("x")]
    [InlineData("cliente_id")]
    [InlineData("_x")]
    [InlineData("$total")]
    [InlineData("variável_1")]
    [InlineData("preçoMédio")]
    [InlineData("名前")]
    [InlineData("Select1")]
    [InlineData("$a")]
    [InlineData("$1a")]
    [InlineData("Constructor")]
    public void IsVariableName_ValidNames_ShouldBeTrue(string name)
        => Assert.True(ScriptVariablesRules.IsVariableName(name));

    [Trait("ScriptVariablesRules", "IsVariableName")]
    [Theory(DisplayName = "Erro recusa o que não é nome: palavra reservada, nome do Prism, do ambiente, vedado, select, values, $a$ e $1")]
    [InlineData("")]
    [InlineData("1x")]
    [InlineData("a-b")]
    [InlineData("a b")]
    [InlineData("let")]
    [InlineData("const")]
    [InlineData("undefined")]
    [InlineData("NaN")]
    [InlineData("date")]
    [InlineData("Math")]
    [InlineData("window")]
    [InlineData("globalThis")]
    [InlineData("__proto__")]
    [InlineData("constructor")]
    [InlineData("prototype")]
    [InlineData("toString")]
    [InlineData("hasOwnProperty")]
    [InlineData("then")]
    [InlineData("select")]
    [InlineData("SELECT")]
    [InlineData("Values")]
    [InlineData("$a$")]
    [InlineData("$$")]
    [InlineData("$1")]
    [InlineData("$123")]
    [InlineData("a​b")]
    [InlineData("﻿a")]
    [InlineData("a‮b")]
    [InlineData("😀")]
    [InlineData("\\u0061")]
    public void IsVariableName_NotNames_ShouldBeFalse(string name)
        => Assert.False(ScriptVariablesRules.IsVariableName(name));

    [Trait("ScriptVariablesRules", "IsVariableName")]
    [Fact(DisplayName = "Erro o nome tem até 64 caracteres, contados por ponto de código, e vem em NFC")]
    public void IsVariableName_LengthAndNormalization()
    {
        //Arrange
        var decomposed = "variável";

        //Assert
        Assert.True(ScriptVariablesRules.IsVariableName(new string('a', 64)));
        Assert.False(ScriptVariablesRules.IsVariableName(new string('a', 65)));
        Assert.True(ScriptVariablesRules.IsVariableName(string.Concat(Enumerable.Repeat("𝒜", 64))));
        Assert.False(ScriptVariablesRules.IsVariableName(string.Concat(Enumerable.Repeat("𝒜", 65))));
        Assert.False(ScriptVariablesRules.IsVariableName(decomposed));
        Assert.True(ScriptVariablesRules.IsVariableName(decomposed.Normalize()));
    }

    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Fact(DisplayName = "OK aceita cada tipo, a lista (vazia também) e o mapa vazio")]
    public void RunValuesRefusals_ValidValues_ShouldBeEmpty()
    {
        //Arrange
        var values = Json("""
            {
              "cliente_id": { "type": "number", "value": "7" },
              "nome": { "type": "text", "value": "Ana" },
              "ativo": { "type": "boolean", "value": "true" },
              "inicio": { "type": "date", "value": "2026-10-01" },
              "quando": { "type": "timestamp", "value": "2026-10-01T12:00:00Z" },
              "ordem": { "type": "sql", "value": "nome DESC" },
              "cliente": { "type": "object", "value": "{ id: 7, nome: 'Ana' }" },
              "nada": { "type": "null", "value": null },
              "status": { "type": "list", "items": [{ "type": "text", "value": "aberta" }, { "type": "null", "value": null }] },
              "vazia": { "type": "list", "items": [] },
              "variável": { "type": "text", "value": "" }
            }
            """);

        //Assert
        Assert.Empty(ScriptVariablesRules.RunValuesRefusals(values));
        Assert.Empty(ScriptVariablesRules.RunValuesRefusals(Json("{}")));
    }

    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Theory(DisplayName = "Erro values ausente, nulo ou que não é objeto é recusado no campo values")]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("1")]
    public void RunValuesRefusals_NotAnObject_RefusesValues(string? json)
    {
        //Act
        var refusals = ScriptVariablesRules.RunValuesRefusals(json is null ? null : Json(json));

        //Assert
        Assert.Equal(["values"], refusals.Select(refusal => refusal.Field));
    }

    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Fact(DisplayName = "Erro até 500 nomes e até 64 KiB, os bytes do JSON como veio, numa recusa só")]
    public void RunValuesRefusals_Limits()
    {
        //Arrange
        static string Map(int count, int length)
            => "{" + string.Join(",", Enumerable.Range(0, count).Select(index => $"\"v{index}\":{{\"type\":\"text\",\"value\":\"{new string('a', length)}\"}}")) + "}";

        var fiveHundred = Map(500, 1);
        var fiveHundredAndOne = Map(501, 1);
        var prefix = "{\"v\":{\"type\":\"text\",\"value\":\"";
        var exactly = prefix + new string('a', ScriptVariablesRules.MaxValuesBytes - prefix.Length - 3) + "\"}}";
        var oneByteMore = prefix + new string('a', ScriptVariablesRules.MaxValuesBytes - prefix.Length - 2) + "\"}}";

        //Assert
        Assert.Equal(ScriptVariablesRules.MaxValuesBytes, Encoding.UTF8.GetByteCount(exactly));
        Assert.Empty(ScriptVariablesRules.RunValuesRefusals(Json(fiveHundred)));
        Assert.Equal([("values", "Lembre até 500 valores.")], ScriptVariablesRules.RunValuesRefusals(Json(fiveHundredAndOne)));
        Assert.Empty(ScriptVariablesRules.RunValuesRefusals(Json(exactly)));
        Assert.Equal([("values", "Os valores lembrados passam de 64 KiB.")], ScriptVariablesRules.RunValuesRefusals(Json(oneByteMore)));
    }

    /// <summary>RN-VAR-014: as chaves `__proto__` e `constructor` nunca chegam ao cofre, e por isso nunca voltam à tela.</summary>
    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Theory(DisplayName = "Erro o nome que não é nome de variável é recusado no campo values, sem o nome na mensagem")]
    [InlineData("__proto__")]
    [InlineData("constructor")]
    [InlineData("prototype")]
    [InlineData("toString")]
    [InlineData("select")]
    [InlineData("1x")]
    [InlineData("$1")]
    [InlineData("")]
    public void RunValuesRefusals_BadName_RefusesValues(string name)
    {
        //Arrange
        var values = Json($$"""{ "ok": { "type": "text", "value": "a" }, {{JsonSerializer.Serialize(name)}}: { "type": "text", "value": "b" } }""");

        //Act
        var refusals = ScriptVariablesRules.RunValuesRefusals(values);

        //Assert
        var refusal = Assert.Single(refusals);
        Assert.Equal("values", refusal.Field);
        Assert.DoesNotContain(name.Length > 0 ? name : "\"\"", refusal.Message);
    }

    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Fact(DisplayName = "Erro o nome repetido e o nome com metade de um par UTF-16 são recusados no campo values")]
    public void RunValuesRefusals_RepeatedOrBrokenName_RefusesValues()
    {
        //Arrange
        var repeated = Json("""{ "x": { "type": "text", "value": "a" }, "x": { "type": "text", "value": "b" } }""");
        var broken = Json("""{ "\uD800": { "type": "text", "value": "a" } }""");

        //Assert
        Assert.Equal([("values", "Um nome aparece duas vezes nos valores.")], ScriptVariablesRules.RunValuesRefusals(repeated));
        Assert.Equal(["values"], ScriptVariablesRules.RunValuesRefusals(broken).Select(refusal => refusal.Field));
    }

    [Trait("ScriptVariablesRules", "RunValuesRefusals")]
    [Theory(DisplayName = "Erro a entrada fora da forma é recusada no campo dela")]
    [InlineData("1", "values.x")]
    [InlineData("\"7\"", "values.x")]
    [InlineData("{}", "values.x")]
    [InlineData("""{ "value": "7" }""", "values.x")]
    [InlineData("""{ "type": 1, "value": "7" }""", "values.x")]
    [InlineData("""{ "type": "integer", "value": "7" }""", "values.x.type")]
    [InlineData("""{ "type": "Number", "value": "7" }""", "values.x.type")]
    [InlineData("""{ "type": "number" }""", "values.x")]
    [InlineData("""{ "type": "number", "value": "7", "label": "sete" }""", "values.x")]
    [InlineData("""{ "type": "number", "value": 7 }""", "values.x.value")]
    [InlineData("""{ "type": "text", "value": null }""", "values.x.value")]
    [InlineData("""{ "type": "text", "value": "\uDC00" }""", "values.x.value")]
    [InlineData("""{ "type": "null", "value": "" }""", "values.x.value")]
    [InlineData("""{ "type": "null" }""", "values.x")]
    [InlineData("""{ "type": "list" }""", "values.x.items")]
    [InlineData("""{ "type": "list", "items": {} }""", "values.x.items")]
    [InlineData("""{ "type": "list", "items": [], "value": "1" }""", "values.x.items")]
    [InlineData("""{ "type": "list", "items": [{ "type": "text", "value": "a" }, { "type": "number", "value": 1 }] }""", "values.x.items[1].value")]
    [InlineData("""{ "type": "list", "items": [{ "type": "list", "items": [] }] }""", "values.x.items[0].type")]
    public void RunValuesRefusals_BadEntry_RefusesTheField(string entry, string field)
    {
        //Arrange
        var values = Json($$"""{ "ok": { "type": "text", "value": "a" }, "x": {{entry}} }""");

        //Act
        var refusals = ScriptVariablesRules.RunValuesRefusals(values);

        //Assert
        Assert.Equal([field], refusals.Select(refusal => refusal.Field));
    }
}
