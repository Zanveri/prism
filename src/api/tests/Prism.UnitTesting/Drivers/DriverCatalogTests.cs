using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Models;
using Prism.TestingCore.Fakers.Drivers;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// RN-DRIVER-002: o catálogo que vai dentro da API, e a recusa de um catálogo fora da forma. É do catálogo que saem o endereço do
/// download, o nome da pasta e os nomes dos arquivos extraídos; por isso o que não tem a forma esperada não passa da partida.
/// </summary>
public sealed class DriverCatalogTests
{
    private const string IbmDriverID = "ibm-data-server";

    private static readonly DriverCatalog Catalog = DriverCatalog.LoadDefault();

    /// <summary>Lê o catálogo de teste, aplica a alteração e tenta de novo: o que cada teste de recusa faz.</summary>
    private static Exception? ParseChanged(Action<JsonNode> change)
    {
        var node = JsonNode.Parse(DriverPackageFakers.CatalogJson(DriverPackageFakers.CreateValidPackage()))!;
        change(node);

        return Record.Exception(() => DriverCatalog.Parse(node.ToJsonString()));
    }

    private static JsonNode TestDriver(JsonNode catalog)
        => catalog["drivers"]![1]!;

    private static JsonNode TestPackage(JsonNode catalog)
        => TestDriver(catalog)["packages"]![DriverPackageFakers.Platform]!;

    [Trait("DriverCatalog", "LoadDefault")]
    [Fact(DisplayName = "OK o catálogo da API traz os drivers desta entrega, na ordem da tela")]
    public void LoadDefault_ShouldBeOK()
    {
        //Act
        var drivers = Catalog.Drivers;

        //Assert
        Assert.Equal(["postgresql", IbmDriverID, "sqlite", "mysql", "mariadb", "sql-server", "oracle", "firebird", "duckdb", "clickhouse", "bigquery", "databricks"], drivers.Select(driver => driver.ID));
        Assert.Equal(["PostgreSQL", "IBM Data Server", "SQLite", "MySQL", "MariaDB", "Microsoft SQL Server", "Oracle", "Firebird", "DuckDB", "ClickHouse", "Google BigQuery", "Databricks"], drivers.Select(driver => driver.Name));
        Assert.Equal(EDriverKind.Bundled, drivers[0].Kind);
        Assert.Equal([EDatabaseEngine.PostgreSql], drivers[0].Engines);
        Assert.Equal(EDriverKind.Downloadable, drivers[1].Kind);
        Assert.Equal("IBM", drivers[1].Vendor);
        Assert.Equal([EDatabaseEngine.Db2, EDatabaseEngine.Informix], drivers[1].Engines);
        Assert.All(drivers.Skip(2), driver =>
        {
            Assert.Equal(EDriverKind.Downloadable, driver.Kind);
            Assert.NotEmpty(driver.Engines!);
            Assert.NotNull(driver.Version);
            Assert.Null(driver.License);
            Assert.NotEmpty(driver.Packages!);
        });
    }

    [Trait("DriverCatalog", "LoadDefault")]
    [Fact(DisplayName = "OK o driver da IBM tem pacote no Windows x64, no Linux x64 e no macOS Apple Silicon, e não no macOS Intel")]
    public void LoadDefault_IbmDriver_HasPackagePerPlatform()
    {
        //Act
        var ibm = Catalog.Find(IbmDriverID)!;

        //Assert
        Assert.Equal(["linux-x64", "osx-arm64", "win-x64"], ibm.Packages!.Keys.Order());
        Assert.Equal("Net.IBM.Data.Db2", ibm.PackageFor("win-x64")!.ID);
        Assert.Equal("Net.IBM.Data.Db2-lnx", ibm.PackageFor("linux-x64")!.ID);
        Assert.Equal("Net.IBM.Data.Db2-osx", ibm.PackageFor("osx-arm64")!.ID);
        Assert.Null(ibm.PackageFor("osx-x64"));
        Assert.False(string.IsNullOrWhiteSpace(ibm.UnavailableNote));
        Assert.Equal("clidriver/bin/db2app64.dll", ibm.PackageFor("win-x64")!.NativeLibrary);
        Assert.Equal("clidriver/lib/libdb2.so", ibm.PackageFor("linux-x64")!.NativeLibrary);
        Assert.Equal("clidriver/lib/libdb2.dylib", ibm.PackageFor("osx-arm64")!.NativeLibrary);
        Assert.Null(ibm.PackageFor("win-x64")!.Note);
        Assert.Contains("libxml2", ibm.PackageFor("linux-x64")!.Note);
    }

    /// <summary>RN-DRIVER-002 e 003: versão exata, SHA-512 do arquivo do pacote, tamanho, e a licença pelo nome e pelo endereço oficial, que é `https://`.</summary>
    [Trait("DriverCatalog", "LoadDefault")]
    [Fact(DisplayName = "OK cada pacote tem SHA-512, tamanho e a página da licença dele no nuget.org")]
    public void LoadDefault_EveryPackage_HasHashSizeAndLicense()
    {
        //Act
        var ibm = Catalog.Find(IbmDriverID)!;

        //Assert
        Assert.All(ibm.Packages!.Values, package =>
        {
            Assert.Equal(64, Convert.FromBase64String(package.Sha512).Length);
            Assert.True(package.SizeBytes > 0);
            Assert.Equal($"https://www.nuget.org/packages/{package.ID}/{ibm.Version}/license", package.License.Url);
            Assert.False(string.IsNullOrWhiteSpace(package.License.Name));
            Assert.Equal("IBM.Data.Db2.dll", package.ManagedAssembly);
            Assert.Contains(package.Files, file => file is { From: "lib/net10.0/IBM.Data.Db2.dll", To: "IBM.Data.Db2.dll" });
            Assert.Equal([new DriverPackageMapping("buildTransitive/clidriver/", "clidriver/")], package.Trees);
        });
        Assert.Equal(3, ibm.Packages!.Values.Select(package => package.Sha512).Distinct().Count());
    }

    /// <summary>
    /// A versão do catálogo é a do driver contra o qual a API foi compilada: o assembly `IBM.Data.Db2` que a Infrastructure referencia
    /// tem a versão do pacote. Compilada sem o driver (`-p:IbmDriverRuntime=osx-x64`, ou no macOS Intel), a API não tem a referência,
    /// e não há o que comparar: quem confere a versão é a compilação de qualquer outra plataforma.
    /// </summary>
    [Trait("DriverCatalog", "LoadDefault")]
    [Fact(DisplayName = "OK a versão do driver da IBM no catálogo é a da referência de compilação")]
    public void LoadDefault_IbmVersion_IsTheCompileReference()
    {
        //Arrange
        var ibm = Catalog.Find(IbmDriverID)!;

        //Act
        var reference = typeof(DriverCatalog).Assembly.GetReferencedAssemblies().FirstOrDefault(assembly => assembly.Name == "IBM.Data.Db2");

        //Assert
        if (reference is not null)
            Assert.Equal(ibm.Version, reference.Version!.ToString());
    }

    [Trait("DriverCatalog", "LoadDefault")]
    [Fact(DisplayName = "OK a versão do driver embutido do PostgreSQL é a do Npgsql referenciado")]
    public void LoadDefault_PostgresVersion_IsTheNpgsqlReference()
    {
        //Act
        var reference = typeof(DriverCatalog).Assembly.GetReferencedAssemblies().Single(assembly => assembly.Name == "Npgsql");

        //Assert
        Assert.Equal(Catalog.Find("postgresql")!.Version, reference.Version!.ToString(3));
        Assert.StartsWith("https://", Catalog.Find("postgresql")!.License!.Url);
    }

    /// <summary>
    /// RN-DRIVER-008: em produção o destino é o contêiner plano do nuget.org, por HTTPS, e a pasta é `drivers/` dentro da pasta de dados.
    /// Nenhum dos dois vem de variável de ambiente nem de configuração: saem daqui, e só o host de teste troca o registro.
    /// </summary>
    [Trait("DriverSettings", "For")]
    [Fact(DisplayName = "OK em produção os pacotes vêm do nuget.org por HTTPS e ficam em drivers/, na pasta de dados")]
    public void SettingsFor_PointsToNuGetOrgAndToTheDriversFolder()
    {
        //Arrange
        var dataDirectory = Path.Combine(Path.GetTempPath(), "prism-dados");

        //Act
        var settings = DriverSettings.For(dataDirectory);

        //Assert
        Assert.Equal("https://api.nuget.org/v3-flatcontainer/", settings.PackageSource.AbsoluteUri);
        Assert.Equal(Path.Combine(dataDirectory, "drivers"), settings.Directory);
        Assert.Equal(RuntimeInformation.RuntimeIdentifier, settings.Platform);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "OK o catálogo de teste, com um driver em cada situação, é aceito")]
    public void Parse_ShouldBeOK()
    {
        //Act
        var exception = ParseChanged(_ => { });

        //Assert
        Assert.Null(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro identificador de driver repetido")]
    public void Parse_ShouldBeError_WhenDriverIDRepeats()
    {
        //Act
        var exception = ParseChanged(catalog => catalog["drivers"]![3]!["id"] = DriverPackageFakers.DriverID);

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>O identificador vira nome de pasta: nada de barra, ponto ou maiúscula.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro identificador de driver com caminho")]
    public void Parse_ShouldBeError_WhenDriverIDIsAPath()
    {
        //Act
        var exception = ParseChanged(catalog => TestDriver(catalog)["id"] = "../fora");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>A versão vira nome de pasta e pedaço do endereço do download.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro versão com caminho")]
    public void Parse_ShouldBeError_WhenVersionIsAPath()
    {
        //Act
        var exception = ParseChanged(catalog => TestDriver(catalog)["version"] = "1.0/../..");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>O nome do pacote entra no endereço do download.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro nome de pacote com endereço dentro")]
    public void Parse_ShouldBeError_WhenPackageIDIsNotANuGetName()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["id"] = "pacote/../../outro?x=");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro SHA-512 que não tem 64 bytes")]
    public void Parse_ShouldBeError_WhenHashIsNotSha512()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["sha512"] = Convert.ToBase64String(new byte[32]));

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro pacote sem tamanho")]
    public void Parse_ShouldBeError_WhenSizeIsZero()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["sizeBytes"] = 0);

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>O endereço da licença é o que a pessoa lê antes de aceitar: só `https://`.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro licença com endereço que não é https")]
    public void Parse_ShouldBeError_WhenLicenseUrlIsNotHttps()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["license"]!["url"] = "http://licenca.exemplo.test/texto");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro licença com endereço que tem espaço ou caractere invisível")]
    public void Parse_ShouldBeError_WhenLicenseUrlHasInvisibleCharacters()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["license"]!["url"] = "https://licenca.exemplo.test/‮texto");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>RN-DRIVER-003: o destino de um arquivo extraído sai do catálogo, e não pode sair da pasta do driver.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro arquivo do pacote com destino fora da pasta")]
    public void Parse_ShouldBeError_WhenFileTargetLeavesTheFolder()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["files"]![0]!["to"] = "../Driver.Teste.dll");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro pasta do pacote com destino absoluto")]
    public void Parse_ShouldBeError_WhenTreeTargetIsAbsolute()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["trees"]![0]!["to"] = "/nativo/");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>RN-DRIVER-006: o banco diz qual driver falta, e por isso só um driver o atende.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro banco atendido por dois drivers")]
    public void Parse_ShouldBeError_WhenEngineIsServedTwice()
    {
        //Act
        var exception = ParseChanged(catalog => TestDriver(catalog)["engines"] = new JsonArray(1));

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro driver baixável sem pacote nenhum")]
    public void Parse_ShouldBeError_WhenDownloadableHasNoPackage()
    {
        //Act
        var exception = ParseChanged(catalog => TestDriver(catalog)["packages"] = new JsonObject());

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro driver em breve com versão")]
    public void Parse_ShouldBeError_WhenComingSoonHasVersion()
    {
        //Act
        var exception = ParseChanged(catalog => catalog["drivers"]![3]!["version"] = "1.0.0");

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }

    /// <summary>Um campo escrito errado não pode ser ignorado em silêncio: o catálogo é a única fonte do que a API baixa.</summary>
    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro campo desconhecido")]
    public void Parse_ShouldBeError_WhenFieldIsUnknown()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog)["sha256"] = "x");

        //Assert
        Assert.IsType<JsonException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro campo obrigatório ausente")]
    public void Parse_ShouldBeError_WhenRequiredFieldIsMissing()
    {
        //Act
        var exception = ParseChanged(catalog => TestPackage(catalog).AsObject().Remove("sha512"));

        //Assert
        Assert.IsType<JsonException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro tipo de driver desconhecido")]
    public void Parse_ShouldBeError_WhenKindIsUnknown()
    {
        //Act
        var exception = ParseChanged(catalog => TestDriver(catalog)["kind"] = "remoto");

        //Assert
        Assert.IsType<JsonException>(exception);
    }

    [Trait("DriverCatalog", "Parse")]
    [Fact(DisplayName = "Erro catálogo sem drivers")]
    public void Parse_ShouldBeError_WhenThereAreNoDrivers()
    {
        //Act
        var exception = Record.Exception(() => DriverCatalog.Parse("""{ "drivers": [] }"""));

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
    }
}
