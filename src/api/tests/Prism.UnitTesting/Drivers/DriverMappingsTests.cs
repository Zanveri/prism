using Prism.Application.Drivers.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Models;
using System.Text.Json;

namespace Prism.UnitTesting.Drivers;

/// <summary>O item da lista como a tela o valida (`drivers.schema.ts`): os sete estados em texto, os bancos em número, e toda chave sempre presente.</summary>
public sealed class DriverMappingsTests
{
    /// <summary>O JSON que o MVC escreve: camelCase, com `ID` virando `id`.</summary>
    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private static DriverInfo Driver(EDriverState state, DriverInstallFailure? error = null)
        => new("driver-de-teste", "Driver de Teste", "Fabricante", [EDatabaseEngine.Db2, EDatabaseEngine.Informix], state, "1.2.3", 4096, new DriverLicense("Licença", "https://licenca.exemplo.test/texto"), "Nota", new DriverProgress(1024, 4096), error, true);

    [Trait("DriverMappings", "ToDto")]
    [Fact(DisplayName = "OK cada estado sai com a grafia que a tela conhece")]
    public void ToDto_EveryState_HasTheNameTheScreenKnows()
    {
        //Arrange
        var expected = new Dictionary<EDriverState, string>
        {
            [EDriverState.Bundled] = "bundled",
            [EDriverState.Available] = "available",
            [EDriverState.Installing] = "installing",
            [EDriverState.Installed] = "installed",
            [EDriverState.Failed] = "failed",
            [EDriverState.Unavailable] = "unavailable",
            [EDriverState.ComingSoon] = "comingSoon"
        };

        //Act
        var states = Enum.GetValues<EDriverState>().ToDictionary(state => state, state => DriverMappings.ToDto(Driver(state)).State);

        //Assert
        Assert.Equal(expected, states);
    }

    [Trait("DriverMappings", "ToDto")]
    [Fact(DisplayName = "OK os campos do driver passam como estão")]
    public void ToDto_CopiesTheFields()
    {
        //Arrange
        var driver = Driver(EDriverState.Installing);

        //Act
        var dto = DriverMappings.ToDto(driver);

        //Assert
        Assert.Equal(driver.ID, dto.ID);
        Assert.Equal(driver.Name, dto.Name);
        Assert.Equal(driver.Vendor, dto.Vendor);
        Assert.Equal(driver.Engines, dto.Engines);
        Assert.Equal(driver.Version, dto.Version);
        Assert.Equal(driver.SizeBytes, dto.SizeBytes);
        Assert.Equal(driver.License, dto.License);
        Assert.Equal(driver.PlatformNote, dto.PlatformNote);
        Assert.Equal(driver.Progress, dto.Progress);
        Assert.Null(dto.Error);
        Assert.True(dto.RestartRequired);
    }

    /// <summary>RN-DRIVER-003 e 004: os dois códigos de uma instalação que falhou, com a causa.</summary>
    [Trait("DriverMappings", "ToDto")]
    [Fact(DisplayName = "OK a falha de instalação sai com o código da especificação e a causa")]
    public void ToDto_Failure_HasTheSpecCodeAndTheCause()
    {
        //Act
        var download = DriverMappings.ToDto(Driver(EDriverState.Failed, new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "A conexão caiu durante o download.")));
        var integrity = DriverMappings.ToDto(Driver(EDriverState.Failed, new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O arquivo baixado não confere.")));

        //Assert
        Assert.Equal(new DriverErrorDto("DRIVER_DOWNLOAD_FAILED", "A conexão caiu durante o download."), download.Error);
        Assert.Equal(new DriverErrorDto("DRIVER_INTEGRITY_FAILED", "O arquivo baixado não confere."), integrity.Error);
    }

    /// <summary>O cancelamento não é erro: o serviço nunca o guarda, e não há código para ele na especificação.</summary>
    [Trait("DriverMappings", "ToDto")]
    [Fact(DisplayName = "Erro o cancelamento não tem código de erro")]
    public void ToDto_ShouldThrow_WhenTheFailureIsACancellation()
    {
        //Act
        var exception = Record.Exception(() => DriverMappings.ToDto(Driver(EDriverState.Failed, new DriverInstallFailure(EDriverInstallFailure.Canceled, "A instalação foi cancelada."))));

        //Assert
        Assert.IsType<NotImplementedException>(exception);
    }

    /// <summary>"Toda chave do item vem sempre, com `null` quando não se aplica": as doze chaves do `driverSchema` da tela, com os nomes dele.</summary>
    [Trait("DriverMappings", "ToDto")]
    [Fact(DisplayName = "OK o JSON do item tem as doze chaves do schema da tela, também quando o valor é nulo")]
    public void ToDto_Json_HasEveryKeyOfTheScreenSchema()
    {
        //Arrange
        var comingSoon = new DriverInfo("em-breve", "Em Breve", "Fabricante", [], EDriverState.ComingSoon, null, null, null, null, null, null, false);

        //Act
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(DriverMappings.ToDto(comingSoon), WebJson));
        using var full = JsonDocument.Parse(JsonSerializer.Serialize(DriverMappings.ToDto(Driver(EDriverState.Failed, new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "causa"))), WebJson));

        //Assert
        string[] keys = ["id", "name", "vendor", "engines", "state", "version", "sizeBytes", "license", "platformNote", "progress", "error", "restartRequired"];
        Assert.Equal(keys, json.RootElement.EnumerateObject().Select(property => property.Name));
        Assert.Equal(keys, full.RootElement.EnumerateObject().Select(property => property.Name));
        Assert.Equal("""{"id":"em-breve","name":"Em Breve","vendor":"Fabricante","engines":[],"state":"comingSoon","version":null,"sizeBytes":null,"license":null,"platformNote":null,"progress":null,"error":null,"restartRequired":false}""", json.RootElement.GetRawText());
        Assert.Equal("[2,3]", full.RootElement.GetProperty("engines").GetRawText());
        Assert.Equal(["name", "url"], full.RootElement.GetProperty("license").EnumerateObject().Select(property => property.Name));
        Assert.Equal("https://licenca.exemplo.test/texto", full.RootElement.GetProperty("license").GetProperty("url").GetString());
        Assert.Equal("""{"receivedBytes":1024,"totalBytes":4096}""", full.RootElement.GetProperty("progress").GetRawText());
        Assert.Equal("""{"code":"DRIVER_DOWNLOAD_FAILED","detail":"causa"}""", full.RootElement.GetProperty("error").GetRawText());
    }
}
