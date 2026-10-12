using Prism.Application.Connections.Models;

namespace Prism.UnitTesting.Connections;

/// <summary>RN-CONN-004 e 013: "o mesmo servidor" é o mesmo host e a mesma porta; é só isso que prende a senha gravada.</summary>
public sealed class ConnectionRulesTests
{
    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "OK mesmo host e mesma porta")]
    public void SameServer_ShouldBeTrue_WhenHostAndPortAreTheSame()
        => Assert.True(ConnectionRules.SameServer("pg.local", 5432, "pg.local", 5432));

    /// <summary>A gravação apara as pontas do host (`Connection.Create` e `Update`), e é só isso que a comparação desfaz.</summary>
    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "OK o host ignora só os espaços das pontas")]
    public void SameServer_ShouldBeTrue_WhenTheHostOnlyChangesEdgeSpaces()
    {
        //Assert
        Assert.True(ConnectionRules.SameServer(" db.local ", 5432, "db.local", 5432));
        Assert.True(ConnectionRules.SameServer("db.local", 5432, "  db.local\t", 5432));
    }

    /// <summary>
    /// A comparação é exata (`Ordinal`). Host que começa por `/` é diretório de socket Unix no driver, e nos sistemas de arquivos que
    /// diferenciam maiúsculas `/tmp/pgsock-x` e `/tmp/PGSOCK-X` são servidores diferentes. Nos nomes de rede, o `OrdinalIgnoreCase` iguala
    /// letras que são endereços diferentes (`ς` e `σ`, `µ` e `μ`), e quem controla a resolução do nome parecido receberia a senha.
    /// </summary>
    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "Erro host que só muda em maiúsculas e minúsculas é outro servidor")]
    public void SameServer_ShouldBeFalse_WhenTheHostOnlyChangesCase()
    {
        //Assert
        Assert.False(ConnectionRules.SameServer("DB.local", 5432, "db.local", 5432));
        Assert.False(ConnectionRules.SameServer("db.local", 5432, "DB.local", 5432));
        Assert.False(ConnectionRules.SameServer("/tmp/pgsock-x", 5432, "/tmp/PGSOCK-X", 5432));
    }

    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "Erro letras que o OrdinalIgnoreCase iguala mas são endereços diferentes")]
    public void SameServer_ShouldBeFalse_WhenTheHostHasLettersThatOnlyIgnoreCaseEquates()
    {
        //Assert
        Assert.False(ConnectionRules.SameServer("bolo\u03C2.test", 5432, "bolo\u03C3.test", 5432));
        Assert.False(ConnectionRules.SameServer("\u00B5.test", 5432, "\u03BC.test", 5432));
    }

    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "Erro outro host, mesmo que seja a mesma máquina por outro nome")]
    public void SameServer_ShouldBeFalse_WhenTheHostDiffers()
    {
        //Assert
        Assert.False(ConnectionRules.SameServer("pg.local", 5432, "outro.local", 5432));
        Assert.False(ConnectionRules.SameServer("127.0.0.1", 5432, "localhost", 5432));
        Assert.False(ConnectionRules.SameServer("pg.local", 5432, "pg .local", 5432));
    }

    [Trait("ConnectionRules", "SameServer")]
    [Fact(DisplayName = "Erro outra porta")]
    public void SameServer_ShouldBeFalse_WhenThePortDiffers()
        => Assert.False(ConnectionRules.SameServer("pg.local", 5432, "pg.local", 5433));
}
