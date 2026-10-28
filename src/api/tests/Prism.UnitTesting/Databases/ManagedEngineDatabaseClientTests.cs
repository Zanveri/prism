using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog.Core;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// A string de conexão de cada um dos dez motores gerenciados sob demanda (<see cref="ManagedEngineDatabaseConnection"/>).
/// </summary>
public sealed class ManagedEngineDatabaseClientTests
{
    private static string Build(
        EDatabaseEngine engine,
        string host = "db.exemplo.local",
        int port = 3306,
        string database = "estoque",
        string userName = "analista",
        string password = "segredo")
        => new ManagedEngineDatabaseConnection(engine, new ConnectionSettings(engine, host, port, database, userName, password), Logger.None).BuildConnectionString();

    [Trait("ManagedEngineDatabaseConnection", "BuildConnectionString")]
    [Fact(DisplayName = "OK gera a string de conexão de cada um dos dez bancos sob demanda")]
    public void BuildConnectionString_AllManagedEngines_ShouldBeOK()
    {
        //Act & Assert
        Assert.Equal("Data Source=estoque;Mode=ReadWriteCreate;Pooling=False;Password=segredo", Build(EDatabaseEngine.Sqlite));
        Assert.Equal("Server=db.exemplo.local;Port=3306;Database=estoque;User ID=analista;Password=segredo;Pooling=False;ConnectionTimeout=15;AllowUserVariables=True", Build(EDatabaseEngine.MySql));
        Assert.Equal("Server=db.exemplo.local;Port=3306;Database=estoque;User ID=analista;Password=segredo;Pooling=False;ConnectionTimeout=15;AllowUserVariables=True", Build(EDatabaseEngine.MariaDb));
        Assert.Equal("Data Source=db.exemplo.local,1433;Initial Catalog=estoque;User ID=analista;Password=segredo;Pooling=False;Connect Timeout=15;TrustServerCertificate=True", Build(EDatabaseEngine.SqlServer, port: 1433));
        Assert.Equal("Data Source=//db.exemplo.local:1521/estoque;User Id=analista;Password=segredo;Pooling=False;Connection Timeout=15", Build(EDatabaseEngine.Oracle, port: 1521));
        Assert.Equal("DataSource=db.exemplo.local;Port=3050;Database=estoque;UserID=analista;Password=segredo;Pooling=False;ConnectionTimeout=15;Charset=UTF8", Build(EDatabaseEngine.Firebird, port: 3050));
        Assert.Equal("Data Source=estoque", Build(EDatabaseEngine.DuckDb));
        Assert.Equal("Host=db.exemplo.local;Port=8123;Database=estoque;Username=analista;Password=segredo", Build(EDatabaseEngine.ClickHouse, port: 8123));
        Assert.Equal("Driver=\"{Google BigQuery}\";Host=db.exemplo.local;Port=443;Catalog=estoque;UID=analista;PWD=segredo", Build(EDatabaseEngine.BigQuery, port: 443));
        Assert.Equal("Driver=\"{Simba Spark ODBC Driver}\";Host=db.exemplo.local;Port=443;Schema=estoque;UID=analista;PWD=segredo;AuthMech=3;SSL=1;ThriftTransport=2", Build(EDatabaseEngine.Databricks, port: 443));
    }

    [Trait("ManagedEngineDatabaseConnection", "BuildConnectionString")]
    [Fact(DisplayName = "OK escapa ponto e vírgula e aspas duplas nos campos da conexão")]
    public void BuildConnectionString_SpecialCharacters_ShouldBeEscaped()
    {
        //Act
        var connectionString = Build(EDatabaseEngine.MySql, password: "a;b\"c");

        //Assert
        Assert.Contains("Password='a;b\"c'", connectionString);
    }
}
