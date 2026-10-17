using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json.Nodes;
using static Prism.UnitTesting.ConnectionTransfers.TransferFixtures;

namespace Prism.UnitTesting.ConnectionTransfers;

/// <summary>
/// RN-TRANSF-010 (etapa 7) e 014: o conteúdo aberto, lido campo a campo e conferido. Só a forma que monta a árvore (as listas, os itens, a chave e o pai), a
/// estrutura (chaves únicas de 1 a 64, referências, ciclos) e os limites (2.000, 2.000 e 32 níveis) recusam o arquivo inteiro; qualquer outro campo fora da
/// regra tira só aquele item, com a frase da regra da criação, e a pasta que não passa leva junto o que está dentro dela. De cada item que passa sai o que
/// valia nele na origem: o mais forte entre o `effective` e o que as pastas do arquivo dão.
/// </summary>
public sealed class ImportAnalysisTests
{
    private static Result<ImportAnalysis, ApiErrorDto> Analyze(JsonNode content)
    {
        var read = ImportedFile.Read(Parse(content));

        return read.Outcome switch
        {
            EImportedFileRead.Read => ImportAnalysis.Analyze(read.File!),
            EImportedFileRead.LimitsExceeded => TransferErrors.ImportLimitsExceeded(),
            _ => TransferErrors.FileInvalid()
        };
    }

    private static ImportAnalysis AnalyzeValid(JsonNode content)
    {
        var analysis = Analyze(content);
        Assert.True(analysis.IsSuccess, analysis.IsFailure ? analysis.Error.Type : null);

        return analysis.Value;
    }

    private static JsonObject Without(JsonObject item, string property)
    {
        item.Remove(property);

        return item;
    }

    [Trait("ImportAnalysis", "Analyze")]
    [Fact(DisplayName = "OK o arquivo que o Prism gera é lido inteiro, normalizado como a criação normaliza")]
    public void Analyze_ShouldBeOK()
    {
        //Arrange
        var content = FileContent(
            [FileFolder("f1", null, "  Estoque  ", color: "#2f6fdf"), FileFolder("f2", "f1", "Production PRD", environmentName: " Production ", environmentColor: "#d64545", confirmCommands: "all", readOnly: true)],
            [FileConnection("c1", "f2", "DATA  FIX", host: " informix-prd.exemplo.invalid ", database: " estoque ", userName: " datafix ", password: " senha com espaço ", verificationQuery: "  SELECT 1 FROM systables WHERE tabid = 1  "), FileConnection("c2", null, "Relatórios", engine: "PostgreSql", port: 5432, userName: null, password: null)]);

        //Act
        var analysis = AnalyzeValid(content);
        var production = analysis.FoldersByKey["f2"].Candidate!;
        var dataFix = analysis.ConnectionsByKey["c1"].Candidate!;
        var reports = analysis.ConnectionsByKey["c2"].Candidate!;

        //Assert
        Assert.Equal(0, analysis.InvalidCount);
        Assert.Equal("Estoque", analysis.FoldersByKey["f1"].Candidate!.Name);
        Assert.Equal("Production", production.EnvironmentName);
        Assert.Equal("all", production.ConfirmCommands);
        Assert.True(production.ReadOnly);
        Assert.Equal("DATA FIX", dataFix.Name);
        Assert.Equal(EDatabaseEngine.Informix, dataFix.Engine);
        Assert.Equal("informix-prd.exemplo.invalid", dataFix.Host);
        Assert.Equal("estoque", dataFix.Database);
        Assert.Equal("datafix", dataFix.UserName);
        Assert.Equal(" senha com espaço ", dataFix.Password);
        Assert.Equal("SELECT 1 FROM systables WHERE tabid = 1", dataFix.VerificationQuery);
        Assert.Equal(EDatabaseEngine.PostgreSql, reports.Engine);
        Assert.Equal(string.Empty, reports.UserName);
        Assert.Equal(string.Empty, reports.Password);
        Assert.Equal(new ImportOrigin(true, "all", new Prism.Application.Common.Environments.ShownEnvironment("Production", "#d64545")), analysis.ConnectionsByKey["c1"].Origin);
    }

    /// <summary>
    /// RN-TRANSF-010, etapa 7: só a falta ou o tipo errado das listas, de um item (um objeto), da `key` (texto) e do pai (`parentKey` ou `folderKey`, texto ou
    /// nulo, e sempre presente) recusam o arquivo inteiro: sem eles a árvore não se monta.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Theory(DisplayName = "Erro forma que não monta a árvore é IMPORT_FILE_INVALID")]
    [InlineData("sem-folders")]
    [InlineData("folders-objeto")]
    [InlineData("sem-connections")]
    [InlineData("item-texto")]
    [InlineData("key-numero")]
    [InlineData("sem-key")]
    [InlineData("sem-parentKey")]
    [InlineData("parentKey-numero")]
    [InlineData("sem-folderKey")]
    [InlineData("folderKey-booleano")]
    [InlineData("raiz-lista")]
    public void Analyze_ShouldBeError_Shape(string change)
    {
        //Arrange
        JsonNode content = FileContent([FileFolder("f1", null, "Estoque")], [FileConnection("c1", "f1", "DATA FIX")]);
        switch (change)
        {
            case "sem-folders": content.AsObject().Remove("folders"); break;
            case "folders-objeto": content["folders"] = new JsonObject(); break;
            case "sem-connections": content.AsObject().Remove("connections"); break;
            case "item-texto": content["connections"]!.AsArray().Add("c2"); break;
            case "key-numero": content["folders"]![0]!["key"] = 1; break;
            case "sem-key": Without(content["connections"]![0]!.AsObject(), "key"); break;
            case "sem-parentKey": Without(content["folders"]![0]!.AsObject(), "parentKey"); break;
            case "parentKey-numero": content["folders"]![0]!["parentKey"] = 1; break;
            case "sem-folderKey": Without(content["connections"]![0]!.AsObject(), "folderKey"); break;
            case "folderKey-booleano": content["connections"]![0]!["folderKey"] = false; break;
            case "raiz-lista": content = new JsonArray(); break;
        }

        //Act
        var analysis = Analyze(content);

        //Assert
        Assert.Equal("IMPORT_FILE_INVALID", analysis.Error.Type);
    }

    /// <summary>
    /// RN-TRANSF-010, etapa 7: a estrutura fecha. As chaves têm de 1 a 64 caracteres e são únicas no conjunto das pastas e das conexões (comparação exata:
    /// `F1` e `f1` são duas); toda referência aponta para uma pasta do arquivo (não para uma conexão); e nenhuma pasta fica dentro dela mesma ou de uma
    /// descendente, num ciclo de qualquer tamanho.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Theory(DisplayName = "Erro estrutura que não fecha é IMPORT_FILE_INVALID")]
    [InlineData("chave-vazia")]
    [InlineData("chave-de-65")]
    [InlineData("chave-repetida-entre-pastas")]
    [InlineData("chave-repetida-entre-pasta-e-conexao")]
    [InlineData("pai-que-nao-existe")]
    [InlineData("pasta-de-conexao-que-e-conexao")]
    [InlineData("pasta-dentro-dela-mesma")]
    [InlineData("ciclo-de-tres")]
    public void Analyze_ShouldBeError_Structure(string change)
    {
        //Arrange
        var folders = new List<JsonObject> { FileFolder("f1", null, "Estoque"), FileFolder("f2", "f1", "Production PRD"), FileFolder("f3", "f2", "Interna") };
        var connections = new List<JsonObject> { FileConnection("c1", "f3", "DATA FIX") };
        switch (change)
        {
            case "chave-vazia": connections[0]["key"] = ""; break;
            case "chave-de-65": connections[0]["key"] = new string('c', 65); break;
            case "chave-repetida-entre-pastas": folders[2]["key"] = "f2"; break;
            case "chave-repetida-entre-pasta-e-conexao": connections[0]["key"] = "f1"; break;
            case "pai-que-nao-existe": folders[1]["parentKey"] = "f9"; break;
            case "pasta-de-conexao-que-e-conexao": connections.Add(FileConnection("c2", "c1", "NOMINAL")); break;
            case "pasta-dentro-dela-mesma": folders[0]["parentKey"] = "f1"; break;
            case "ciclo-de-tres": folders[0]["parentKey"] = "f3"; break;
        }

        //Act
        var analysis = Analyze(FileContent(folders, connections));

        //Assert
        Assert.Equal("IMPORT_FILE_INVALID", analysis.Error.Type);
    }

    [Trait("ImportAnalysis", "Analyze")]
    [Fact(DisplayName = "OK chaves de 64 caracteres, e F1 e f1 são duas")]
    public void Analyze_ShouldBeOK_KeysAreExact()
    {
        //Act
        var analysis = AnalyzeValid(FileContent([FileFolder("F1", null, "Estoque"), FileFolder("f1", null, "Outro")], [FileConnection(new string('c', 64), "f1", "DATA FIX")]));

        //Assert
        Assert.Equal(2, analysis.Folders.Count);
        Assert.Single(analysis.Connections);
    }

    /// <summary>RN-TRANSF-010, etapa 7: até 2.000 conexões, 2.000 pastas e 32 níveis (a pasta da raiz do arquivo é o nível 1); além disso, `IMPORT_LIMITS_EXCEEDED`.</summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Theory(DisplayName = "Erro arquivo além dos limites")]
    [InlineData("conexoes", 2000, true)]
    [InlineData("conexoes", 2001, false)]
    [InlineData("pastas", 2000, true)]
    [InlineData("pastas", 2001, false)]
    [InlineData("niveis", 32, true)]
    [InlineData("niveis", 33, false)]
    public void Analyze_ShouldBeError_Limits(string what, int count, bool fits)
    {
        //Arrange
        var content = what switch
        {
            "conexoes" => FileContent(connections: Enumerable.Range(1, count).Select(index => FileConnection($"c{index}", null, $"Conexão {index}"))),
            "pastas" => FileContent(Enumerable.Range(1, count).Select(index => FileFolder($"f{index}", null, $"Pasta {index}"))),
            _ => FileContent(Enumerable.Range(1, count).Select(index => FileFolder($"f{index}", index == 1 ? null : $"f{index - 1}", $"Nível {index}")))
        };

        //Act
        var analysis = Analyze(content);

        //Assert
        if (fits)
            Assert.True(analysis.IsSuccess);
        else
            Assert.Equal("IMPORT_LIMITS_EXCEEDED", analysis.Error.Type);
    }

    /// <summary>
    /// RN-TRANSF-014: o item que não passa nas regras da criação não é importado, e o motivo é a frase da regra; o resto do arquivo continua importável. É o
    /// que deixa um arquivo de um Prism mais novo, que traz um banco ou um valor que este não conhece, ser importado em parte.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Theory(DisplayName = "OK conexão fora da regra fica não importável, com o motivo")]
    [InlineData("banco-desconhecido", "Este Prism não conhece o banco MySql.")]
    [InlineData("banco-em-numero", "Este Prism não conhece o banco 1.")]
    [InlineData("banco-em-minusculas", "Este Prism não conhece o banco informix.")]
    [InlineData("sem-banco", "Falta o banco da conexão no arquivo.")]
    [InlineData("porta-em-texto", "Informe uma porta de 1 a 65535.")]
    [InlineData("porta-com-casas", "Informe uma porta de 1 a 65535.")]
    [InlineData("porta-zero", "Informe uma porta de 1 a 65535.")]
    [InlineData("porta-65536", "Informe uma porta de 1 a 65535.")]
    [InlineData("sem-porta", "Falta a porta no arquivo.")]
    [InlineData("sem-nome", "Falta o nome da conexão no arquivo.")]
    [InlineData("nome-de-81", "O nome da conexão deve ter de 1 a 80 caracteres.")]
    [InlineData("nome-em-numero", "O nome da conexão não está no formato que este Prism lê.")]
    [InlineData("host-vazio", "Informe o host.")]
    [InlineData("host-de-256", "O host pode ter até 255 caracteres.")]
    [InlineData("host-invertido", "O host não pode ter caractere de controle nem de direção do texto.")]
    [InlineData("banco-de-dados-de-129", "O banco de dados pode ter até 128 caracteres.")]
    [InlineData("usuario-de-129", "O usuário do banco pode ter até 128 caracteres.")]
    [InlineData("senha-de-1025", "A senha do banco pode ter até 1.024 caracteres.")]
    [InlineData("senha-sem-usuario", "A senha do banco veio sem o usuário.")]
    [InlineData("readOnly-texto", "O somente leitura da conexão não está no formato que este Prism lê.")]
    [InlineData("confirmacao-fora", "Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.")]
    [InlineData("ambiente-de-31", "O ambiente pode ter no máximo 30 caracteres.")]
    [InlineData("cor-do-ambiente", "Use uma cor no formato #RRGGBB.")]
    [InlineData("intervalo-4", "A verificação deve ser feita a cada 5 a 3.600 segundos.")]
    [InlineData("intervalo-texto", "A verificação deve ser feita a cada 5 a 3.600 segundos.")]
    [InlineData("consulta-que-grava", "A consulta de verificação tem de ser uma leitura só: um UPDATE não é leitura.")]
    [InlineData("consulta-de-1001", "A consulta de verificação pode ter no máximo 1.000 caracteres.")]
    [InlineData("effective-texto", "O que valia na conexão não está no formato que este Prism lê.")]
    [InlineData("effective-readOnly-numero", "O que valia na conexão não está no formato que este Prism lê.")]
    public void Analyze_ShouldBeOK_InvalidConnectionWithTheReason(string change, string reason)
    {
        //Arrange
        var connection = FileConnection("c1", null, "DATA FIX");
        switch (change)
        {
            case "banco-desconhecido": connection["engine"] = "MySql"; break;
            case "banco-em-numero": connection["engine"] = 1; break;
            case "banco-em-minusculas": connection["engine"] = "informix"; break;
            case "sem-banco": connection.Remove("engine"); break;
            case "porta-em-texto": connection["port"] = "9089"; break;
            case "porta-com-casas": connection["port"] = JsonNode.Parse("9089.0"); break;
            case "porta-zero": connection["port"] = 0; break;
            case "porta-65536": connection["port"] = 65536; break;
            case "sem-porta": connection.Remove("port"); break;
            case "sem-nome": connection["name"] = null; break;
            case "nome-de-81": connection["name"] = new string('n', 81); break;
            case "nome-em-numero": connection["name"] = 81; break;
            case "host-vazio": connection["host"] = "  "; break;
            case "host-de-256": connection["host"] = new string('h', 256); break;
            case "host-invertido": connection["host"] = "informix-prd\u202Ednelavni.olpmexe"; break;
            case "banco-de-dados-de-129": connection["database"] = new string('d', 129); break;
            case "usuario-de-129": connection["userName"] = new string('u', 129); break;
            case "senha-de-1025": connection["password"] = new string('s', 1025); break;
            case "senha-sem-usuario": connection.Remove("userName"); break;
            case "readOnly-texto": connection["readOnly"] = "sim"; break;
            case "confirmacao-fora": connection["confirmCommands"] = "todos"; break;
            case "ambiente-de-31": connection["environmentName"] = new string('a', 31); break;
            case "cor-do-ambiente": connection["environmentColor"] = "vermelho"; break;
            case "intervalo-4": connection["verificationInterval"] = 4; break;
            case "intervalo-texto": connection["verificationInterval"] = "30"; break;
            case "consulta-que-grava": connection["verificationQuery"] = "UPDATE systables SET tabname = 'x'"; break;
            case "consulta-de-1001": connection["verificationQuery"] = "SELECT 1 " + new string(' ', 980) + "FROM systables x"; break;
            case "effective-texto": connection["effective"] = "somente leitura"; break;
            case "effective-readOnly-numero": connection["effective"]!["readOnly"] = 1; break;
        }
        var content = FileContent(connections: [connection, FileConnection("c2", null, "NOMINAL")]);

        //Act
        var analysis = AnalyzeValid(content);

        //Assert
        Assert.Equal(reason, analysis.ConnectionsByKey["c1"].Invalid);
        Assert.Null(analysis.ConnectionsByKey["c1"].Candidate);
        Assert.Null(analysis.ConnectionsByKey["c2"].Invalid);
        Assert.Equal(1, analysis.InvalidCount);
    }

    /// <summary>
    /// RN-TRANSF-015 e 007: o usuário e a senha podem faltar (a conexão entra sem eles), e a verificação, a confirmação, o somente leitura e o `effective`
    /// nulos ou ausentes são o padrão do cofre; um campo que este Prism não conhece é ignorado.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Fact(DisplayName = "OK os campos opcionais podem faltar, e o desconhecido é ignorado")]
    public void Analyze_ShouldBeOK_OptionalFieldsMayBeMissing()
    {
        //Arrange
        var connection = new JsonObject { ["key"] = "c1", ["folderKey"] = null, ["name"] = "DATA FIX", ["engine"] = "Db2", ["host"] = "db2.exemplo.invalid", ["port"] = 50000, ["database"] = "estoque", ["campoNovo"] = new JsonObject { ["x"] = 1 } };
        var folder = new JsonObject { ["key"] = "f1", ["parentKey"] = null, ["name"] = "Estoque", ["readOnly"] = null, ["effective"] = null };

        //Act
        var analysis = AnalyzeValid(FileContent([folder], [connection]));
        var candidate = analysis.ConnectionsByKey["c1"].Candidate!;

        //Assert
        Assert.Equal(string.Empty, candidate.UserName);
        Assert.Equal(string.Empty, candidate.Password);
        Assert.True(candidate.VerificationEnabled);
        Assert.Equal(30, candidate.VerificationInterval);
        Assert.Null(candidate.VerificationQuery);
        Assert.Null(candidate.ConfirmCommands);
        Assert.False(candidate.ReadOnly);
        Assert.False(analysis.FoldersByKey["f1"].Candidate!.ReadOnly);
        Assert.Equal(new ImportOrigin(false, null, null), analysis.ConnectionsByKey["c1"].Origin);
    }

    /// <summary>
    /// RN-TRANSF-014: a pasta que não passa leva junto o que está dentro dela, a qualquer profundidade, com o motivo "A pasta X não pode ser importada."; as
    /// irmãs e o resto do arquivo continuam importáveis.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Fact(DisplayName = "OK pasta fora da regra leva junto o que está dentro dela")]
    public void Analyze_ShouldBeOK_InvalidFolderTakesItsContent()
    {
        //Arrange
        var content = FileContent(
            [FileFolder("f1", null, "Estoque"), FileFolder("f2", "f1", "Production PRD", color: "vermelha"), FileFolder("f3", "f2", "Interna"), FileFolder("f4", "f1", "Desenvolvimento DEV")],
            [FileConnection("c1", "f3", "DATA FIX"), FileConnection("c2", "f4", "NOMINAL")]);

        //Act
        var analysis = AnalyzeValid(content);

        //Assert
        Assert.Equal("Use uma cor no formato #RRGGBB.", analysis.FoldersByKey["f2"].Invalid);
        Assert.Equal("A pasta Production PRD não pode ser importada.", analysis.FoldersByKey["f3"].Invalid);
        Assert.Equal("A pasta Production PRD não pode ser importada.", analysis.ConnectionsByKey["c1"].Invalid);
        Assert.Null(analysis.FoldersByKey["f1"].Invalid);
        Assert.Null(analysis.FoldersByKey["f4"].Invalid);
        Assert.Null(analysis.ConnectionsByKey["c2"].Invalid);
        Assert.Equal(3, analysis.InvalidCount);
    }

    /// <summary>
    /// RN-TRANSF-013: o que valia na origem é o mais forte entre o `effective` do arquivo e o que as pastas do arquivo dão. No arquivo que o Prism gerou os
    /// dois são iguais; num editado, ganha o mais forte: o somente leitura e a confirmação de uma pasta acima valem mesmo com o `effective` dizendo menos, e o
    /// `effective` que diz mais vale também. O ambiente de origem é o próprio, ou o do `effective`, ou o da pasta mais próxima acima que tem um.
    /// </summary>
    [Trait("ImportAnalysis", "Analyze")]
    [Fact(DisplayName = "OK o que valia na origem é o mais forte entre o effective e as pastas do arquivo")]
    public void Analyze_ShouldBeOK_OriginIsTheStrongest()
    {
        //Arrange
        var weakEffective = new JsonObject { ["readOnly"] = false, ["confirmCommands"] = null, ["environmentName"] = null, ["environmentColor"] = null };
        var strongEffective = new JsonObject { ["readOnly"] = true, ["confirmCommands"] = "all", ["environmentName"] = "Production", ["environmentColor"] = "#d64545" };
        var content = FileContent(
            [FileFolder("f1", null, "Estoque", confirmCommands: "irreversible", readOnly: true), FileFolder("f2", "f1", "Production PRD", environmentName: "Homologação", environmentColor: "#e0a030", effective: new JsonObject { ["readOnly"] = false })],
            [FileConnection("c1", "f2", "Editada", effective: weakEffective), FileConnection("c2", null, "Na raiz", effective: strongEffective), FileConnection("c3", "f2", "Sem effective", effective: null)]);
        content["connections"]![2]!.AsObject().Remove("effective");

        //Act
        var analysis = AnalyzeValid(content);

        //Assert
        Assert.Equal(new ImportOrigin(true, "irreversible", new Prism.Application.Common.Environments.ShownEnvironment("Homologação", "#e0a030")), analysis.ConnectionsByKey["c1"].Origin);
        Assert.Equal(new ImportOrigin(true, "all", new Prism.Application.Common.Environments.ShownEnvironment("Production", "#d64545")), analysis.ConnectionsByKey["c2"].Origin);
        Assert.Equal(new ImportOrigin(true, "irreversible", new Prism.Application.Common.Environments.ShownEnvironment("Homologação", "#e0a030")), analysis.ConnectionsByKey["c3"].Origin);
        Assert.Equal(new ImportOrigin(true, "irreversible", null), analysis.FoldersByKey["f2"].Origin);
    }

    /// <summary>RN-LOG-001: o que a leitura guarda (com a senha do banco) escreve só o nome do tipo.</summary>
    [Trait("ImportedFile", "ToString")]
    [Fact(DisplayName = "OK a leitura do arquivo não escreve o conteúdo")]
    public void ImportedFile_ToString_ShouldNotWriteTheContent()
    {
        //Arrange
        var analysis = AnalyzeValid(FileContent(connections: [FileConnection("c1", null, "DATA FIX", password: "senha-que-nao-pode-aparecer")]));
        var item = analysis.ConnectionsByKey["c1"];

        //Assert
        Assert.Equal(nameof(ImportConnectionItem), item.ToString());
        Assert.Equal(nameof(ImportedConnection), item.Raw.ToString());
        Assert.Equal(nameof(ConnectionCandidate), item.Candidate!.ToString());
        Assert.Equal(nameof(FileValue), item.Raw.Password.ToString());
        Assert.Equal(nameof(ImportAnalysis), analysis.ToString());
    }
}
