using FluentValidation.TestHelper;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Features.UpdateConnection;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Fakers.Connections;

namespace Prism.UnitTesting.Connections;

/// <summary>
/// RN-CONN-010: um campo inválido por vez, sempre `CONNECTION_INVALID`. O nome é medido depois de normalizado
/// (é o que o domínio grava); a pasta que não existe é 404 da gravação, e não regra daqui.
/// </summary>
public sealed class ConnectionValidatorsTests
{
    private static readonly CreateConnectionValidator CreateValidator = new();
    private static readonly UpdateConnectionValidator UpdateValidator = new();

    private static void AssertCreateInvalid(CreateConnectionCommand command, string property)
    {
        //Act
        var result = CreateValidator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID");
        Assert.All(result.Errors, error => Assert.Equal(property, error.PropertyName));
    }

    private static void AssertUpdateInvalid(UpdateConnectionCommand command, string property)
    {
        //Act
        var result = UpdateValidator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID");
        Assert.All(result.Errors, error => Assert.Equal(property, error.PropertyName));
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK conexão válida, com e sem pasta e ambiente")]
    public void CreateConnection_ShouldBeOK()
    {
        //Act
        var plain = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid());
        var full = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(folderID: Guid.CreateVersion7(), environmentName: "Produção", environmentColor: "#a1B2c3"));

        //Assert
        plain.ShouldNotHaveAnyValidationErrors();
        full.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK nos limites: nome 1 e 80, porta 1 e 65535, ambiente 30, cada banco")]
    public void CreateConnection_ShouldBeOK_AtTheLimits()
    {
        //Act
        var results = new[]
        {
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(name: "a")),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(name: new string('a', 80))),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(name: $"   {new string('a', 80)}  ")),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(port: 1)),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(port: 65535)),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentName: new string('a', 30))),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.PostgreSql)),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.Db2)),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.Informix))
        };

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK senha só com espaços é uma senha")]
    public void CreateConnection_ShouldBeOK_PasswordOfSpaces()
    {
        //Act
        var result = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(password: "   "));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome vazio")]
    public void CreateConnection_ShouldBeError_NameEmpty()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(name: string.Empty), "Name");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome só com espaços")]
    public void CreateConnection_ShouldBeError_NameBlank()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(name: "  \t "), "Name");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome com 81 caracteres")]
    public void CreateConnection_ShouldBeError_NameTooLong()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(name: new string('a', 81)), "Name");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome nulo no corpo")]
    public void CreateConnection_ShouldBeError_NameNull()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Name = null! }, "Name");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro host vazio")]
    public void CreateConnection_ShouldBeError_HostEmpty()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Host = string.Empty }, "Host");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro host só com espaços")]
    public void CreateConnection_ShouldBeError_HostBlank()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(host: "   "), "Host");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro porta 0")]
    public void CreateConnection_ShouldBeError_PortZero()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Port = 0 }, "Port");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro porta 65536")]
    public void CreateConnection_ShouldBeError_PortTooHigh()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(port: 65536), "Port");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro porta negativa")]
    public void CreateConnection_ShouldBeError_PortNegative()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(port: -1), "Port");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro banco de dados vazio")]
    public void CreateConnection_ShouldBeError_DatabaseEmpty()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Database = string.Empty }, "Database");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro usuário vazio")]
    public void CreateConnection_ShouldBeError_UserNameEmpty()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { UserName = string.Empty }, "UserName");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro senha vazia")]
    public void CreateConnection_ShouldBeError_PasswordEmpty()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Password = string.Empty }, "Password");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro banco 0")]
    public void CreateConnection_ShouldBeError_EngineZero()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Engine = 0 }, "Engine");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro banco 4")]
    public void CreateConnection_ShouldBeError_EngineUnknown()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Engine = (EDatabaseEngine)14 }, "Engine");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro nome do ambiente com 31 caracteres")]
    public void CreateConnection_ShouldBeError_EnvironmentNameTooLong()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentName: new string('a', 31)), "EnvironmentName");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente com nome de cor")]
    public void CreateConnection_ShouldBeError_EnvironmentColorName()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentColor: "red"), "EnvironmentColor");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente com cinco dígitos")]
    public void CreateConnection_ShouldBeError_EnvironmentColorTooShort()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentColor: "#12345"), "EnvironmentColor");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente com sete dígitos")]
    public void CreateConnection_ShouldBeError_EnvironmentColorTooLong()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentColor: "#1234567"), "EnvironmentColor");

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente que não é hexadecimal")]
    public void CreateConnection_ShouldBeError_EnvironmentColorNotHex()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid(environmentColor: "#GGGGGG"), "EnvironmentColor");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK conexão válida, sem senha (mantém a gravada) e com senha")]
    public void UpdateConnection_ShouldBeOK()
    {
        //Act
        var keepingPassword = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid());
        var replacingPassword = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(password: "nova-senha", folderID: Guid.CreateVersion7(), environmentName: "Produção", environmentColor: "#a1B2c3"));

        //Assert
        keepingPassword.ShouldNotHaveAnyValidationErrors();
        replacingPassword.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK nos limites: nome 1 e 80, porta 1 e 65535, ambiente 30")]
    public void UpdateConnection_ShouldBeOK_AtTheLimits()
    {
        //Act
        var results = new[]
        {
            UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(name: "a")),
            UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(name: new string('a', 80))),
            UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(port: 1)),
            UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(port: 65535)),
            UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(environmentName: new string('a', 30)))
        };

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro nome vazio")]
    public void UpdateConnection_ShouldBeError_NameEmpty()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(name: string.Empty), "Name");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro nome com 81 caracteres")]
    public void UpdateConnection_ShouldBeError_NameTooLong()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(name: new string('a', 81)), "Name");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro host vazio")]
    public void UpdateConnection_ShouldBeError_HostEmpty()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { Host = string.Empty }, "Host");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro porta 0")]
    public void UpdateConnection_ShouldBeError_PortZero()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { Port = 0 }, "Port");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro porta 65536")]
    public void UpdateConnection_ShouldBeError_PortTooHigh()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(port: 65536), "Port");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro banco de dados vazio")]
    public void UpdateConnection_ShouldBeError_DatabaseEmpty()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { Database = string.Empty }, "Database");

    /// <summary>
    /// RN-TRANSF-015: o usuário vazio passa pelo validator do `PATCH` para chegar à gravação, que o aceita só na conexão gravada já sem usuário e o recusa,
    /// com a mesma frase no campo, na que tem um (`ConnectionRepositoryTests`). O preenchido segue as regras de sempre.
    /// </summary>
    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK usuário vazio passa pelo validator, e a gravação decide")]
    public void UpdateConnection_ShouldBeOK_UserNameEmpty()
    {
        //Act
        var empty = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { UserName = string.Empty });
        var blank = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { UserName = "   " });

        //Assert
        empty.ShouldNotHaveAnyValidationErrors();
        blank.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>`null` mantém a senha gravada (RN-CONN-004); o texto vazio não é "omitida", e deixaria a conexão sem senha.</summary>
    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro senha enviada vazia")]
    public void UpdateConnection_ShouldBeError_PasswordEmpty()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(password: string.Empty), "Password");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro banco 0")]
    public void UpdateConnection_ShouldBeError_EngineZero()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { Engine = 0 }, "Engine");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro banco 4")]
    public void UpdateConnection_ShouldBeError_EngineUnknown()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { Engine = (EDatabaseEngine)14 }, "Engine");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro nome do ambiente com 31 caracteres")]
    public void UpdateConnection_ShouldBeError_EnvironmentNameTooLong()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(environmentName: new string('a', 31)), "EnvironmentName");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente com nome de cor")]
    public void UpdateConnection_ShouldBeError_EnvironmentColorName()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(environmentColor: "red"), "EnvironmentColor");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente com cinco dígitos")]
    public void UpdateConnection_ShouldBeError_EnvironmentColorTooShort()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(environmentColor: "#12345"), "EnvironmentColor");

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro cor do ambiente que não é hexadecimal")]
    public void UpdateConnection_ShouldBeError_EnvironmentColorNotHex()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid(environmentColor: "#GGGGGG"), "EnvironmentColor");

    /// <summary>RN-PROT-001 e RN-VERIF-001: os campos novos são opcionais, e o ausente é o padrão.</summary>
    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK com as proteções e a verificação, nos limites, e sem elas")]
    public void CreateConnection_ShouldBeOK_WithTheSafeguards()
    {
        //Act
        var results = new[]
        {
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid() with { ConfirmCommands = "none", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 5, VerificationQuery = "SELECT 1" }),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid() with { ConfirmCommands = "irreversible", VerificationInterval = 3600 }),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid() with { ConfirmCommands = "all", VerificationQuery = "   " }),
            CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid() with { ConfirmCommands = "" })
        };

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro confirmação fora da lista")]
    public void CreateConnection_ShouldBeError_ConfirmCommandsNotInTheList()
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { ConfirmCommands = "sempre" }, nameof(CreateConnectionCommand.ConfirmCommands));

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Theory(DisplayName = "Erro intervalo da verificação fora de 5 a 3.600 segundos")]
    [InlineData(4)]
    [InlineData(0)]
    [InlineData(3601)]
    public void CreateConnection_ShouldBeError_VerificationIntervalOutOfRange(int interval)
        => AssertCreateInvalid(ConnectionFakers.ReturnCreateConnectionCommandValid() with { VerificationInterval = interval }, nameof(CreateConnectionCommand.VerificationInterval));

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro consulta de verificação que não é leitura, com o motivo, no banco escolhido")]
    public void CreateConnection_ShouldBeError_VerificationQueryNotARead()
    {
        //Act
        var result = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.PostgreSql) with { VerificationQuery = "SELECT 1; DROP TABLE x" });

        //Assert
        result.ShouldHaveValidationErrorFor(nameof(CreateConnectionCommand.VerificationQuery)).WithErrorCode("CONNECTION_INVALID").WithErrorMessage("A consulta de verificação tem de ser uma leitura só: o texto tem mais de um comando.");
    }

    /// <summary>
    /// RN-VERIF-001 (alterada em 2026-10-17): a consulta com caractere de controle ou de direção do texto é recusada no campo dela, com a frase da regra, na
    /// criação, na alteração e no teste (as mesmas regras, num lugar só, `ConnectionRules.VerificationQueryRefusal`); a de várias linhas passa.
    /// </summary>
    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "Erro consulta de verificação com caractere de direção do texto, na criação, na alteração e no teste")]
    public void Connection_ShouldBeError_VerificationQueryWithDirectionCharacter()
    {
        //Arrange
        const string Query = "SELECT 1 /* \u202E */";
        const string Message = "A consulta de verificação não pode ter caractere de controle nem de direção do texto.";

        //Act
        var create = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.PostgreSql) with { VerificationQuery = Query });
        var update = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { VerificationQuery = Query });
        var test = new Prism.Application.Connections.Features.TestConnection.TestConnectionValidator().TestValidate(new Prism.Application.Connections.Features.TestConnection.TestConnectionCommand
        {
            Engine = EDatabaseEngine.PostgreSql,
            Host = "postgres.exemplo.invalid",
            Port = 5432,
            Database = "estoque",
            UserName = "datafix",
            Password = "senha-ficticia",
            VerificationQuery = Query
        });
        var multiline = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid(engine: EDatabaseEngine.PostgreSql) with { VerificationQuery = "SELECT 1\r\n\tWHERE true" });

        //Assert
        create.ShouldHaveValidationErrorFor(nameof(CreateConnectionCommand.VerificationQuery)).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(Message);
        update.ShouldHaveValidationErrorFor(nameof(UpdateConnectionCommand.VerificationQuery)).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(Message);
        test.ShouldHaveValidationErrorFor("VerificationQuery").WithErrorCode("CONNECTION_INVALID").WithErrorMessage(Message);
        multiline.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "OK com as proteções, a verificação e a senha do usuário")]
    public void UpdateConnection_ShouldBeOK_WithTheSafeguards()
    {
        //Act
        var result = UpdateValidator.TestValidate(ConnectionFakers.ReturnUpdateConnectionCommandValid(userPassword: "senha-do-usuario") with { ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = true, VerificationInterval = 60, VerificationQuery = "VALUES 1" });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro confirmação fora da lista")]
    public void UpdateConnection_ShouldBeError_ConfirmCommandsNotInTheList()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { ConfirmCommands = "ALL" }, nameof(UpdateConnectionCommand.ConfirmCommands));

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro intervalo da verificação abaixo de 5 segundos")]
    public void UpdateConnection_ShouldBeError_VerificationIntervalOutOfRange()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { VerificationInterval = 1 }, nameof(UpdateConnectionCommand.VerificationInterval));

    [Trait("UpdateConnectionValidator", "UpdateConnectionCommand")]
    [Fact(DisplayName = "Erro consulta de verificação com mais de 1.000 caracteres")]
    public void UpdateConnection_ShouldBeError_VerificationQueryTooLong()
        => AssertUpdateInvalid(ConnectionFakers.ReturnUpdateConnectionCommandValid() with { VerificationQuery = "SELECT " + new string('1', 1000) }, nameof(UpdateConnectionCommand.VerificationQuery));

    /// <summary>
    /// RN-CONN-010 (seção 34): os tetos do host (255), do banco de dados (128) e do usuário (128), contados depois de aparados, e o da senha (1.024),
    /// contada como veio, com a frase de cada um no campo, na criação e na alteração (as mesmas regras do teste e da importação).
    /// </summary>
    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Theory(DisplayName = "Erro host, banco de dados, usuário ou senha acima do teto, com a frase do campo")]
    [InlineData("Host", "O host pode ter até 255 caracteres.")]
    [InlineData("Database", "O banco de dados pode ter até 128 caracteres.")]
    [InlineData("UserName", "O usuário do banco pode ter até 128 caracteres.")]
    [InlineData("Password", "A senha do banco pode ter até 1.024 caracteres.")]
    public void Connection_ShouldBeError_FieldAboveItsLimit(string property, string message)
    {
        //Arrange
        var valid = ConnectionFakers.ReturnCreateConnectionCommandValid();
        var create = property switch
        {
            "Host" => valid with { Host = new string('h', 256) },
            "Database" => valid with { Database = new string('d', 129) },
            "UserName" => valid with { UserName = new string('u', 129) },
            _ => valid with { Password = new string('s', 1025) }
        };
        var updateValid = ConnectionFakers.ReturnUpdateConnectionCommandValid();
        var update = property switch
        {
            "Host" => updateValid with { Host = new string('h', 256) },
            "Database" => updateValid with { Database = new string('d', 129) },
            "UserName" => updateValid with { UserName = new string('u', 129) },
            _ => updateValid with { Password = new string('s', 1025) }
        };

        //Act
        var created = CreateValidator.TestValidate(create);
        var updated = UpdateValidator.TestValidate(update);

        //Assert
        created.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(message);
        updated.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(message);
    }

    /// <summary>
    /// Os tetos são contados depois de aparados (o host, o banco e o usuário), que é o que se grava, e a senha como veio, com os espaços: no limite exato,
    /// passa.
    /// </summary>
    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK nos tetos: host 255, banco 128, usuário 128 (com espaços nas pontas) e senha 1.024")]
    public void CreateConnection_ShouldBeOK_AtTheTextCeilings()
    {
        //Arrange
        var command = ConnectionFakers.ReturnCreateConnectionCommandValid() with
        {
            Host = "  " + new string('h', 255) + "  ",
            Database = " " + new string('d', 128) + " ",
            UserName = " " + new string('u', 128) + " ",
            Password = " " + new string('s', 1022) + " "
        };

        //Act
        var result = CreateValidator.TestValidate(command);

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>
    /// RN-CONN-010 e RN-PASTA-001: o nome, o host, o banco de dados, o usuário e o nome do ambiente não têm caractere de controle (U+0000 a U+001F, U+007F a
    /// U+009F) nem de direção do texto (U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069): um U+202E faria o host que a prévia da importação manda conferir
    /// parecer outro. A tabulação e a quebra de linha do nome viram espaço na normalização, e passam.
    /// </summary>
    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Theory(DisplayName = "Erro caractere de controle ou de direção do texto no nome, host, banco, usuário ou ambiente")]
    [InlineData("Name", "\u202E", "O nome da conexão não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Name", "\u0001", "O nome da conexão não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Host", "\u202E", "O host não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Host", "\u0000", "O host não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Host", "\t", "O host não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Database", "\u2066", "O banco de dados não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("Database", "\u009F", "O banco de dados não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("UserName", "\u200E", "O usuário do banco não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("UserName", "\u007F", "O usuário do banco não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("EnvironmentName", "\u200F", "O ambiente não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("EnvironmentName", "\u2069", "O ambiente não pode ter caractere de controle nem de direção do texto.")]
    public void Connection_ShouldBeError_ControlOrDirectionCharacter(string property, string escaped, string message)
    {
        //Arrange
        var character = System.Text.RegularExpressions.Regex.Unescape(escaped);
        var valid = ConnectionFakers.ReturnCreateConnectionCommandValid();
        var create = property switch
        {
            "Name" => valid with { Name = $"PRD{character}DF" },
            "Host" => valid with { Host = $"informix{character}.exemplo.invalid" },
            "Database" => valid with { Database = $"estoque{character}" + "x" },
            "UserName" => valid with { UserName = $"data{character}fix" },
            _ => valid with { EnvironmentName = $"Prod{character}uction" }
        };
        var test = new Prism.Application.Connections.Features.TestConnection.TestConnectionValidator().TestValidate(new Prism.Application.Connections.Features.TestConnection.TestConnectionCommand
        {
            Engine = EDatabaseEngine.Informix,
            Host = property == "Host" ? create.Host : "informix.exemplo.invalid",
            Port = 9089,
            Database = property == "Database" ? create.Database : "estoque",
            UserName = property == "UserName" ? create.UserName : "datafix",
            Password = "senha-ficticia"
        });

        //Act
        var result = CreateValidator.TestValidate(create);

        //Assert
        result.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(message);
        if (property is "Host" or "Database" or "UserName")
            test.ShouldHaveValidationErrorFor(property).WithErrorCode("CONNECTION_INVALID").WithErrorMessage(message);
    }

    [Trait("CreateConnectionValidator", "CreateConnectionCommand")]
    [Fact(DisplayName = "OK tabulação e quebra de linha no nome viram espaço, e passam")]
    public void CreateConnection_ShouldBeOK_TabInTheNameIsNormalized()
    {
        //Act
        var result = CreateValidator.TestValidate(ConnectionFakers.ReturnCreateConnectionCommandValid() with { Name = "DATA\tFIX\nPRD" });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }
}
