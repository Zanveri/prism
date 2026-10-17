using FluentValidation.TestHelper;
using Prism.Application.Transfers.Features.StartImport;
using Prism.Application.Transfers.Models;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Transfers.Models;
using System.Text.Json;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// As notas da seção 36: a forma do começo da importação, recusada de uma vez com `IMPORT_OPTIONS_INVALID` no campo: a carga (`load`), lida à mão, com o
/// padrão do Prism no que não vem (e a conferência, que a cópia não tem); o mapeamento obrigatório; e o número da janela.
/// </summary>
public sealed class LoadRequestTests
{
    private const string OptionsInvalid = "IMPORT_OPTIONS_INVALID";
    private const string FileID = "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f5a6";

    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private static StartImportCommand Import(string? load = "{}", IReadOnlyList<ImportMappingDto?>? mapping = null, long windowID = 1)
        => new()
        {
            FileID = FileID,
            Format = "csv",
            Target = new ImportTargetDto { ConnectionID = Guid.CreateVersion7(), Schema = "estoque", Table = "pedido" },
            Mapping = mapping ?? [new ImportMappingDto { Source = 0, Target = "id" }],
            Load = load is null ? null : Json(load),
            WindowID = windowID
        };

    [Trait("ImportRequestRules", "Load")]
    [Theory(DisplayName = "OK a carga tem o padrão do Prism no que não vem, e o nulo é Tudo numa transação só")]
    [InlineData("{}", false, false, 10000, true)]
    [InlineData("""{"empty": true, "commitEvery": null, "check": false}""", false, true, null, false)]
    [InlineData("""{"commitEvery": 1}""", false, false, 1, true)]
    [InlineData("""{"commitEvery": 1000000}""", true, false, 1000000, false)]
    public void Load_ShouldReadWithTheDefaults(string load, bool copy, bool empty, int? commitEvery, bool check)
    {
        //Act
        var (read, errors) = ImportRequestRules.Load(Json(load), copy);

        //Assert
        Assert.Empty(errors);
        Assert.Equal(new LoadSettings(empty, commitEvery, check), read);
    }

    [Trait("ImportRequestRules", "Load")]
    [Theory(DisplayName = "Erro a carga fora da faixa, do tipo errado ou com a conferência na cópia é recusada no campo")]
    [InlineData("""{"commitEvery": 0}""", false, "load.commitEvery")]
    [InlineData("""{"commitEvery": 1000001}""", false, "load.commitEvery")]
    [InlineData("""{"commitEvery": "10"}""", false, "load.commitEvery")]
    [InlineData("""{"commitEvery": 1.5}""", false, "load.commitEvery")]
    [InlineData("""{"empty": "sim"}""", false, "load.empty")]
    [InlineData("""{"check": 1}""", false, "load.check")]
    [InlineData("""{"check": true}""", true, "load.check")]
    [InlineData("[]", false, "load")]
    public void Load_Invalid_ShouldBeRefusedOnTheField(string load, bool copy, string field)
    {
        //Act
        var (read, errors) = ImportRequestRules.Load(Json(load), copy);

        //Assert
        Assert.Null(read);
        Assert.Equal(field, Assert.Single(errors).Field);
    }

    [Trait("StartImportValidator", "StartImportCommand")]
    [Fact(DisplayName = "Erro o começo da importação sem carga, sem mapeamento e sem janela é recusado no campo")]
    public void StartImport_WithoutLoadMappingOrWindow_ShouldBeRefused()
    {
        //Act
        var result = new StartImportValidator().TestValidate(Import(load: null, mapping: null, windowID: 0) with { Mapping = null });

        //Assert
        result.ShouldHaveValidationErrorFor("load").WithErrorCode(OptionsInvalid);
        result.ShouldHaveValidationErrorFor("mapping").WithErrorMessage("Escolha ao menos uma coluna da tabela para receber valores.");
        result.ShouldHaveValidationErrorFor("windowID").WithErrorCode(OptionsInvalid);
    }

    [Trait("StartImportValidator", "StartImportCommand")]
    [Fact(DisplayName = "OK o começo da importação com a forma certa passa")]
    public void StartImport_Valid_ShouldPass()
        => new StartImportValidator().TestValidate(Import()).ShouldNotHaveAnyValidationErrors();
}
