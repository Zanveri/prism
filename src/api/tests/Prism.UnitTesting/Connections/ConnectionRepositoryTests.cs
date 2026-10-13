using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Repositories;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Connections;
using Prism.TestingCore.Fakers.Vault;
using System.Net;

namespace Prism.UnitTesting.Connections;

/// <summary>
/// O que o repository entrega ao `SaveAsync` é uma função, e é ela que o serviço roda com o cofre
/// reservado. Estes testes fazem o papel do serviço: rodam a função contra um documento que já tem o
/// que uma requisição concorrente teria gravado entre a leitura do handler e a gravação, e conferem que
/// a existência da pasta, a duplicidade de nome (RN-CONN-011) e a existência da própria conexão são
/// decididas ali dentro. A recusa devolve o mesmo documento que recebeu: é o que faz o serviço não regravar.
/// </summary>
public sealed class ConnectionRepositoryTests
{
    private readonly Mock<IVaultService> _vault = new();
    private VaultDocument? _saved;

    private static VaultDocument Document(IReadOnlyList<VaultFolderRecord>? folders = null, IReadOnlyList<VaultConnectionRecord>? connections = null)
        => new("marina.costa", folders ?? [], connections ?? [], []);

    private static VaultConnectionRecord ToRecord(Connection connection)
        => new(connection.ID, connection.FolderID, connection.Name, connection.Engine, connection.Host, connection.Port, connection.Database, connection.UserName, connection.Password, connection.EnvironmentName, connection.EnvironmentColor, connection.CreatedAt, connection.UpdatedAt);

    /// <summary>Roda a função do `SaveAsync` contra o documento atual, como o serviço faz, e responde o que o teste mandou (sucesso por padrão).</summary>
    private ConnectionRepository CreateRepository(VaultDocument current, EVaultError? failure = null)
    {
        _vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                _saved = change(current);

                return Task.FromResult(failure is null ? UnitResult.Success<EVaultError>() : UnitResult.Failure(failure.Value));
            });

        return new ConnectionRepository(_vault.Object);
    }

    private void VerifySavedOnce(CancellationToken cancellationToken)
    {
        _vault.Verify(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "OK acrescenta a conexão, com a senha, sem mexer no resto")]
    public async Task Insert_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = VaultFakers.CreateFolder();
        var existing = VaultFakers.CreateConnection(folderID: folder.ID);
        var current = Document([folder], [existing]);
        var connection = ConnectionFakers.Create(folderID: folder.ID, password: "segredo");
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(connection, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotNull(_saved);
        Assert.Equal([existing, ToRecord(connection)], _saved.Connections);
        Assert.Equal("segredo", _saved.Connections[1].Password);
        Assert.Same(current.Folders, _saved.Folders);
        Assert.Equal("marina.costa", _saved.UserName);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "OK na raiz, sem pasta")]
    public async Task Insert_ShouldBeOK_InTheRoot()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document());

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Single(_saved!.Connections);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "OK o mesmo nome em outra pasta, ou na raiz, é permitido")]
    public async Task Insert_ShouldBeOK_WhenTheNameIsTakenInAnotherFolder()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var first = VaultFakers.CreateFolder();
        var second = VaultFakers.CreateFolder();
        var current = Document([first, second], [VaultFakers.CreateConnection(folderID: first.ID, name: "Produção"), VaultFakers.CreateConnection(folderID: null, name: "Produção")]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(folderID: second.ID, name: "Produção"), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(3, _saved!.Connections.Count);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A corrida da criação: outra requisição gravou o mesmo nome na pasta depois da leitura do handler. RN-CONN-011.</summary>
    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro o nome já está na pasta, sem diferenciar maiúsculas, e o documento fica como estava")]
    public async Task Insert_ShouldBeError_WhenASiblingWithTheNameWasSavedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = VaultFakers.CreateFolder();
        var current = Document([folder], [VaultFakers.CreateConnection(folderID: folder.ID, name: "Produção")]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(folderID: folder.ID, name: "PRODUÇÃO"), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro o nome já está na raiz")]
    public async Task Insert_ShouldBeError_WhenTheNameIsTakenInTheRoot()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var current = Document(connections: [VaultFakers.CreateConnection(folderID: null, name: "Produção")]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(folderID: null, name: "produção"), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A pasta existia quando o usuário abriu o formulário e foi excluída (estava vazia) antes de a conexão ser gravada. Sem esta regra a conexão ficaria órfã.</summary>
    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro a pasta não está no documento, e o documento fica como estava")]
    public async Task Insert_ShouldBeError_WhenTheFolderDoesNotExist()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folderID = Guid.CreateVersion7();
        var current = Document([VaultFakers.CreateFolder()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(folderID: folderID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Contains(folderID.ToString(), result.Error.Detail);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Insert_ShouldBeError_WhenTheVaultIsLocked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document(), EVaultError.Locked);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro disco indisponível")]
    public async Task Insert_ShouldBeError_WhenTheDiskFails()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var repository = CreateRepository(Document(), EVaultError.Unavailable);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_UNAVAILABLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>A recusa explica o pedido do usuário mesmo que a regravação falhe: aqui o serviço do teste devolve disco indisponível, e a resposta continua sendo o 409.</summary>
    [Trait("ConnectionRepository", "Insert")]
    [Fact(DisplayName = "Erro a recusa da regra vale mesmo que a gravação falhe")]
    public async Task Insert_ShouldBeError_TheRefusalWinsOverTheDiskFailure()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var current = Document(connections: [VaultFakers.CreateConnection(folderID: null, name: "Produção")]);
        var repository = CreateRepository(current, EVaultError.Unavailable);

        //Act
        var result = await repository.Insert(ConnectionFakers.Create(folderID: null, name: "Produção"), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK troca a conexão no lugar dela e deixa as outras como estavam")]
    public async Task Update_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = VaultFakers.CreateFolder();
        var before = VaultFakers.CreateConnection();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga");
        var after = VaultFakers.CreateConnection();
        var current = Document([folder], [before, target, after]);
        var changed = ConnectionFakers.Create(iD: target.ID, folderID: folder.ID, name: "Nova", password: "nova-senha", createdAt: target.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(changed, "nova-senha", cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([before, ToRecord(changed), after], _saved!.Connections);
        Assert.Equal("nova-senha", _saved.Connections[1].Password);
        Assert.Same(current.Folders, _saved.Folders);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>
    /// RN-CONN-004 contra uma troca de senha concorrente. O handler leu a conexão com a senha antiga (a do domínio que chega aqui),
    /// e outra requisição gravou uma senha nova antes desta gravação. Senha omitida mantém a do documento que a função recebe,
    /// e não a que o handler leu: senão o resultado seria os campos desta alteração com a senha antiga, que nenhuma ordem serial dá.
    /// </summary>
    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK senha omitida mantém a do documento, e não a que o handler leu")]
    public async Task Update_WithoutPassword_ShouldKeepTheDocumentPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", password: "X-gravada-pela-outra-requisicao");
        var current = Document(connections: [target]);
        var readEarlier = ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Nova", host: target.Host, port: target.Port, password: "P0-lida-antes", createdAt: target.CreatedAt);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(readEarlier, null, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        var saved = Assert.Single(_saved!.Connections);
        Assert.Equal("X-gravada-pela-outra-requisicao", saved.Password);
        Assert.Equal("Nova", saved.Name);
        Assert.Equal(readEarlier.Host, saved.Host);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK senha enviada troca a do documento")]
    public async Task Update_WithPassword_ShouldReplaceTheDocumentPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", password: "X-do-documento");
        var repository = CreateRepository(Document(connections: [target]));

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Nova", password: "P0-lida-antes", createdAt: target.CreatedAt), "senha-nova", cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("senha-nova", Assert.Single(_saved!.Connections).Password);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK a conexão não conta como irmã de si mesma")]
    public async Task Update_ShouldBeOK_WhenKeepingItsOwnName()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Produção");
        var current = Document(connections: [target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "PRODUÇÃO", host: target.Host, port: target.Port), null, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("PRODUÇÃO", Assert.Single(_saved!.Connections).Name);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>
    /// RN-CONN-004: sem a senha, host e porta não mudam. A comparação é com o documento que a função recebe (o que uma alteração concorrente
    /// já gravou), e a recusa devolve o mesmo documento: nada é regravado.
    /// </summary>
    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro mudar o host sem informar a senha")]
    public async Task Update_ShouldBeError_WhenTheHostChangesWithoutPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", host: "pg.local", password: "senha-gravada");
        var current = Document(connections: [target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Nova", host: "outro.local", port: target.Port, createdAt: target.CreatedAt), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_INVALID", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        Assert.Equal("Ao mudar o host ou a porta, informe a senha da conexão de novo.", result.Error.Detail);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro mudar a porta sem informar a senha")]
    public async Task Update_ShouldBeError_WhenThePortChangesWithoutPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", password: "senha-gravada");
        var current = Document(connections: [target]);
        var repository = CreateRepository(current);
        var otherPort = target.Port == 5432 ? 5433 : 5432;

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Nova", host: target.Host, port: otherPort, createdAt: target.CreatedAt), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_INVALID", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK mudar host e porta com a senha enviada")]
    public async Task Update_ShouldBeOK_WhenTheServerChangesWithPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", host: "pg.local", password: "senha-gravada");
        var repository = CreateRepository(Document(connections: [target]));

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Antiga", host: "outro.local", port: target.Port + 1, createdAt: target.CreatedAt), "senha-do-outro-servidor", cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        var saved = Assert.Single(_saved!.Connections);
        Assert.Equal("outro.local", saved.Host);
        Assert.Equal(target.Port + 1, saved.Port);
        Assert.Equal("senha-do-outro-servidor", saved.Password);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>
    /// O host é comparado de forma exata: só as maiúsculas mudando já é outro servidor (um diretório de socket Unix em `/tmp/pgsock-x` não é
    /// `/tmp/PGSOCK-X`), e a senha gravada não vai a ele sem ser informada de novo.
    /// </summary>
    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro mudar só as maiúsculas do host sem informar a senha")]
    public async Task Update_ShouldBeError_WhenTheHostOnlyChangesCaseWithoutPassword()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", host: "pg.local", password: "senha-gravada");
        var current = Document(connections: [target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Nova", host: "PG.LOCAL", port: target.Port, createdAt: target.CreatedAt), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_INVALID", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>O servidor que a senha prende é host e porta: mudar só o banco (`engine`) mantém a senha gravada, que continua indo ao mesmo servidor.</summary>
    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "OK mudar só o banco, com host e porta iguais, mantém a senha gravada")]
    public async Task Update_WithoutPassword_ShouldBeOK_WhenOnlyTheEngineChanges()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Antiga", host: "pg.local", password: "senha-gravada", engine: EDatabaseEngine.PostgreSql);
        var repository = CreateRepository(Document(connections: [target]));

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "Antiga", engine: EDatabaseEngine.Db2, host: "pg.local", port: target.Port, createdAt: target.CreatedAt), null, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        var saved = Assert.Single(_saved!.Connections);
        Assert.Equal(EDatabaseEngine.Db2, saved.Engine);
        Assert.Equal("senha-gravada", saved.Password);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro a conexão foi excluída enquanto isso")]
    public async Task Update_ShouldBeError_WhenTheConnectionWasDeletedMeanwhile()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var connection = ConnectionFakers.Create();
        var current = Document(connections: [VaultFakers.CreateConnection()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(connection, null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro a nova pasta não está no documento")]
    public async Task Update_ShouldBeError_WhenTheFolderDoesNotExist()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection();
        var current = Document(connections: [target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: Guid.CreateVersion7()), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("FOLDER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro uma irmã com o nome foi gravada enquanto isso")]
    public async Task Update_ShouldBeError_WhenASiblingWithTheNameExists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Manutenção");
        var sibling = VaultFakers.CreateConnection(folderID: null, name: "Produção");
        var current = Document(connections: [target, sibling]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: null, name: "produção"), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro mover para a pasta onde já há o mesmo nome")]
    public async Task Update_ShouldBeError_WhenMovingToAFolderWithTheSameName()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = VaultFakers.CreateFolder();
        var target = VaultFakers.CreateConnection(folderID: null, name: "Produção");
        var current = Document([folder], [target, VaultFakers.CreateConnection(folderID: folder.ID, name: "Produção")]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, folderID: folder.ID, name: "Produção"), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_ALREADY_EXISTS", result.Error.Type);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Update")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Update_ShouldBeError_WhenTheVaultIsLocked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection();
        var repository = CreateRepository(Document(connections: [target]), EVaultError.Locked);

        //Act
        var result = await repository.Update(ConnectionFakers.Create(iD: target.ID, host: target.Host, port: target.Port), null, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Delete")]
    [Fact(DisplayName = "OK tira só a conexão do documento")]
    public async Task Delete_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var folder = VaultFakers.CreateFolder();
        var kept = VaultFakers.CreateConnection(folderID: folder.ID);
        var target = VaultFakers.CreateConnection(folderID: folder.ID);
        var current = Document([folder], [kept, target]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([kept], _saved!.Connections);
        Assert.Same(current.Folders, _saved.Folders);
        VerifySavedOnce(cancellationToken);
    }

    /// <summary>Apagar duas vezes: a segunda é 404, e o documento volta como entrou, para o `.bak` não perder a versão anterior.</summary>
    [Trait("ConnectionRepository", "Delete")]
    [Fact(DisplayName = "Erro a conexão já foi excluída, e o documento fica como estava")]
    public async Task Delete_ShouldBeError_WhenTheConnectionDoesNotExist()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var id = Guid.CreateVersion7();
        var current = Document(connections: [VaultFakers.CreateConnection()]);
        var repository = CreateRepository(current);

        //Act
        var result = await repository.Delete(id, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("CONNECTION_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        Assert.Contains(id.ToString(), result.Error.Detail);
        Assert.Same(current, _saved);
        VerifySavedOnce(cancellationToken);
    }

    [Trait("ConnectionRepository", "Delete")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Delete_ShouldBeError_WhenTheVaultIsLocked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var target = VaultFakers.CreateConnection();
        var repository = CreateRepository(Document(connections: [target]), EVaultError.Locked);

        //Act
        var result = await repository.Delete(target.ID, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        VerifySavedOnce(cancellationToken);
    }
}
