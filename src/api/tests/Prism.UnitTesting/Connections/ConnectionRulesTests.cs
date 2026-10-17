using Prism.Application.Connections.Models;
using Prism.Infrastructure.Databases.Models;

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

    [Trait("ConnectionRules", "VerificationIntervalIsValid")]
    [Theory(DisplayName = "OK o intervalo da verificação é de 5 a 3.600 segundos, e o ausente é o padrão")]
    [InlineData(null, true)]
    [InlineData(5, true)]
    [InlineData(30, true)]
    [InlineData(3600, true)]
    [InlineData(4, false)]
    [InlineData(0, false)]
    [InlineData(-30, false)]
    [InlineData(3601, false)]
    public void VerificationIntervalIsValid_ShouldAcceptFrom5To3600(int? interval, bool valid)
        => Assert.Equal(valid, ConnectionRules.VerificationIntervalIsValid(interval));

    [Trait("ConnectionRules", "NormalizeVerificationQuery")]
    [Theory(DisplayName = "OK a consulta de verificação em branco é nula, e a escrita é aparada")]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("  \n ", null)]
    [InlineData("  SELECT 1 \n", "SELECT 1")]
    public void NormalizeVerificationQuery_ShouldTrimAndBlankIsNull(string? query, string? normalized)
        => Assert.Equal(normalized, ConnectionRules.NormalizeVerificationQuery(query));

    /// <summary>RN-VERIF-001: até 1.000 caracteres depois de aparada, e uma leitura só no banco da conexão, com o motivo da recusa.</summary>
    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Theory(DisplayName = "OK a consulta de verificação em branco ou de uma leitura só serve")]
    [InlineData(null, EDatabaseEngine.PostgreSql)]
    [InlineData("  ", EDatabaseEngine.Db2)]
    [InlineData("SELECT 1", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT 1 FROM SYSIBM.SYSDUMMY1;", EDatabaseEngine.Db2)]
    [InlineData("SELECT 1 FROM systables WHERE tabid = 1", EDatabaseEngine.Informix)]
    public void VerificationQueryRefusal_ShouldBeNull_ForASingleRead(string? query, EDatabaseEngine engine)
        => Assert.Null(ConnectionRules.VerificationQueryRefusal(query, engine));

    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Theory(DisplayName = "Erro a consulta de verificação que não é uma leitura só diz por quê")]
    [InlineData("UPDATE loja.pedido SET x = 1", EDatabaseEngine.PostgreSql, "A consulta de verificação tem de ser uma leitura só: um UPDATE não é leitura.")]
    [InlineData("SELECT 1; SELECT 2", EDatabaseEngine.PostgreSql, "A consulta de verificação tem de ser uma leitura só: o texto tem mais de um comando.")]
    [InlineData("SELECT * FROM TABLE(MON_GET_DATABASE(-1))", EDatabaseEngine.Db2, "A consulta de verificação tem de ser uma leitura só: no Db2, uma função de tabela (TABLE (...)) pode gravar sem que o comando mostre.")]
    [InlineData("SHOW server_version", EDatabaseEngine.Informix, "A consulta de verificação tem de ser uma leitura só: um SHOW não é leitura.")]
    public void VerificationQueryRefusal_ShouldExplain(string query, EDatabaseEngine engine, string refusal)
        => Assert.Equal(refusal, ConnectionRules.VerificationQueryRefusal(query, engine));

    /// <summary>
    /// RN-VERIF-001 (alterada em 2026-10-17): a consulta não tem caractere de controle nem de direção do texto, como os outros campos da conexão
    /// (RN-CONN-010), menos a tabulação, a quebra de linha e o retorno de carro, que uma consulta de várias linhas tem. Vale também dentro de um comentário
    /// ou de uma cadeia, onde o U+202E faria o texto que a prévia da importação manda conferir parecer outro (RN-TRANSF-011).
    /// </summary>
    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Theory(DisplayName = "Erro a consulta de verificação com caractere de controle ou de direção do texto")]
    [InlineData("SELECT 1 FROM systables WHERE tabid = 1 /* \\u202E */", EDatabaseEngine.Informix)]
    [InlineData("SELECT '\\u202Eabc' FROM SYSIBM.SYSDUMMY1", EDatabaseEngine.Db2)]
    [InlineData("SELECT 1 -- \\u0000", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT \\u001B[31m 1", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT\\u000B1", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT 1\\u007F", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT \\u0085 1", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT 1 AS \\u200Fx", EDatabaseEngine.PostgreSql)]
    [InlineData("SELECT 1 AS \\u2066x \\u2069", EDatabaseEngine.PostgreSql)]
    public void VerificationQueryRefusal_ShouldBeError_ControlOrDirectionCharacter(string escaped, EDatabaseEngine engine)
    {
        //Arrange
        var query = System.Text.RegularExpressions.Regex.Unescape(escaped);

        //Act
        var refusal = ConnectionRules.VerificationQueryRefusal(query, engine);

        //Assert
        Assert.Equal("A consulta de verificação não pode ter caractere de controle nem de direção do texto.", refusal);
    }

    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Fact(DisplayName = "OK a consulta de verificação de várias linhas, com tabulação, quebra de linha e retorno de carro")]
    public void VerificationQueryRefusal_ShouldBeNull_WithLineBreaksAndTabs()
    {
        //Act
        var refusal = ConnectionRules.VerificationQueryRefusal("SELECT 1\r\n\tFROM systables\n\tWHERE tabid = 1\r", EDatabaseEngine.Informix);

        //Assert
        Assert.Null(refusal);
    }

    /// <summary>A ordem das recusas: o tamanho, depois os caracteres, e só então a leitura (o comando que grava e tem um U+202E diz o caractere).</summary>
    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Fact(DisplayName = "Erro a consulta de verificação diz a primeira recusa: o tamanho, os caracteres e a leitura")]
    public void VerificationQueryRefusal_ShouldExplainTheFirstRefusal()
    {
        //Act
        var tooLongWithControl = ConnectionRules.VerificationQueryRefusal("SELECT 1 \u202E" + new string('1', ConnectionRules.VerificationQueryMaxLength), EDatabaseEngine.PostgreSql);
        var writeWithControl = ConnectionRules.VerificationQueryRefusal("UPDATE t SET a = 1 -- \u202E", EDatabaseEngine.PostgreSql);

        //Assert
        Assert.Equal("A consulta de verificação pode ter no máximo 1.000 caracteres.", tooLongWithControl);
        Assert.Equal("A consulta de verificação não pode ter caractere de controle nem de direção do texto.", writeWithControl);
    }

    /// <summary>O limite é contado depois de aparada: os espaços em volta não contam.</summary>
    [Trait("ConnectionRules", "VerificationQueryRefusal")]
    [Fact(DisplayName = "Erro a consulta de verificação com mais de 1.000 caracteres, contados depois de aparada")]
    public void VerificationQueryRefusal_ShouldLimitTheLength()
    {
        //Arrange
        var atTheLimit = "SELECT " + new string('1', ConnectionRules.VerificationQueryMaxLength - 7);
        var overTheLimit = atTheLimit + "1";

        //Act
        var accepted = ConnectionRules.VerificationQueryRefusal("   " + atTheLimit + "   ", EDatabaseEngine.PostgreSql);
        var refused = ConnectionRules.VerificationQueryRefusal(overTheLimit, EDatabaseEngine.PostgreSql);

        //Assert
        Assert.Equal(1000, atTheLimit.Length);
        Assert.Null(accepted);
        Assert.Equal("A consulta de verificação pode ter no máximo 1.000 caracteres.", refused);
    }
}
