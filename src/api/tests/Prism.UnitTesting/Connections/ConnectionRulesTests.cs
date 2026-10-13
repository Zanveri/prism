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

    /// <summary>RN-CONN-016: o nome da cópia é "&lt;nome&gt; (cópia)" quando ele está livre na pasta.</summary>
    [Trait("ConnectionRules", "CopyName")]
    [Fact(DisplayName = "OK a primeira cópia é o nome com (cópia)")]
    public void CopyName_ShouldBeTheNameWithCopy_WhenItIsFree()
        => Assert.Equal("MES Produção (cópia)", ConnectionRules.CopyName("MES Produção", _ => false));

    [Trait("ConnectionRules", "CopyName")]
    [Fact(DisplayName = "OK com (cópia) tomado, vem (cópia 2), depois (cópia 3)")]
    public void CopyName_ShouldNumberTheCopy_WhenTheNameIsTaken()
    {
        //Arrange
        var taken = new HashSet<string>(StringComparer.Ordinal) { "MES (cópia)", "MES (cópia 2)" };

        //Assert
        Assert.Equal("MES (cópia 3)", ConnectionRules.CopyName("MES", taken.Contains));
        Assert.Equal("MES (cópia 2)", ConnectionRules.CopyName("MES", name => name == "MES (cópia)"));
    }

    /// <summary>A unicidade não é desta função: ela pergunta a quem chama por cada candidato, na ordem, e para no primeiro livre.</summary>
    [Trait("ConnectionRules", "CopyName")]
    [Fact(DisplayName = "OK pergunta os candidatos na ordem e para no primeiro livre")]
    public void CopyName_ShouldAskTheCandidatesInOrder()
    {
        //Arrange
        var asked = new List<string>();

        //Act
        var name = ConnectionRules.CopyName("MES", candidate =>
        {
            asked.Add(candidate);

            return asked.Count < 3;
        });

        //Assert
        Assert.Equal(["MES (cópia)", "MES (cópia 2)", "MES (cópia 3)"], asked);
        Assert.Equal("MES (cópia 3)", name);
    }

    /// <summary>RN-CONN-010: o nome tem até 80 caracteres. O original é cortado para o sufixo caber, e o corte não deixa espaço antes dele.</summary>
    [Trait("ConnectionRules", "CopyName")]
    [Fact(DisplayName = "OK corta o nome original para caber no limite, sem espaço sobrando antes do sufixo")]
    public void CopyName_ShouldCutTheOriginalName_ToFitTheLimit()
    {
        //Arrange
        var name = new string('a', 80);
        var withSpaceAtTheCut = $"{new string('b', 71)} {new string('c', 8)}";

        //Act
        var first = ConnectionRules.CopyName(name, _ => false);
        var tenth = ConnectionRules.CopyName(name, candidate => !candidate.EndsWith(" (cópia 10)", StringComparison.Ordinal));
        var cutAtTheSpace = ConnectionRules.CopyName(withSpaceAtTheCut, _ => false);

        //Assert
        Assert.Equal($"{new string('a', 72)} (cópia)", first);
        Assert.Equal(ConnectionRules.NameMaxLength, first.Length);
        Assert.Equal($"{new string('a', 69)} (cópia 10)", tenth);
        Assert.Equal(ConnectionRules.NameMaxLength, tenth.Length);
        Assert.Equal($"{new string('b', 71)} (cópia)", cutAtTheSpace);
        Assert.True(ConnectionRules.NameIsValid(first));
        Assert.True(ConnectionRules.NameIsValid(tenth));
    }

    /// <summary>O corte não parte um caractere em dois: um emoji (dois `char`) ou uma letra com acento combinado na fronteira sai inteiro.</summary>
    [Trait("ConnectionRules", "CopyName")]
    [Fact(DisplayName = "OK o corte não parte um caractere de duas unidades nem uma letra com acento combinado")]
    public void CopyName_ShouldNotSplitATextElement()
    {
        //Arrange
        var emoji = $"{new string('a', 71)}\U0001F680{new string('z', 7)}";
        var combining = $"{new string('a', 71)}é{new string('z', 7)}";

        //Act
        var withEmoji = ConnectionRules.CopyName(emoji, _ => false);
        var withCombining = ConnectionRules.CopyName(combining, _ => false);

        //Assert
        Assert.Equal($"{new string('a', 71)} (cópia)", withEmoji);
        Assert.Equal($"{new string('a', 71)} (cópia)", withCombining);
    }

    [Trait("ConnectionRules", "NameIsValid")]
    [Fact(DisplayName = "OK o limite do nome é o da RN-CONN-010")]
    public void NameIsValid_ShouldUseTheNameMaxLength()
    {
        //Assert
        Assert.Equal(80, ConnectionRules.NameMaxLength);
        Assert.True(ConnectionRules.NameIsValid(new string('a', ConnectionRules.NameMaxLength)));
        Assert.False(ConnectionRules.NameIsValid(new string('a', ConnectionRules.NameMaxLength + 1)));
    }
}
