using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models;
using Prism.Application.Folders.Models;
using Prism.Application.Folders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Repositories;

/// <summary>
/// Lê e grava as conexões pelo serviço do cofre (não há SQL). Toda regra que uma requisição concorrente poderia
/// quebrar é decidida de dentro da função entregue ao `SaveAsync`: o serviço a roda com o semáforo tomado, sobre o
/// documento mais recente. Uma consulta feita antes não leu o cofre fechado no meio da requisição e não decide nada,
/// então a existência da pasta e da própria conexão, e a duplicidade de nome (RN-CONN-011), são ditas só aqui, onde
/// o cofre fechado vira 401 `VAULT_LOCKED`. A recusa devolve o documento que recebeu, e o serviço não regrava por isso.
/// Duplicar (RN-CONN-016) também é decidido lá dentro: a conexão de origem, o nome livre da cópia e a senha copiada saem do mesmo documento.
/// </summary>
internal sealed class ConnectionRepository(IVaultService vaultService) : IConnectionRepository
{
    public Task<UnitResult<ApiErrorDto>> Insert(Connection connection, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            // A pasta pode ter sido excluída (estava vazia) depois de o usuário abrir o formulário: sem esta regra a conexão ficaria órfã.
            if (connection.FolderID is { } folderID && !VaultFolders.ExistsByID(document, folderID))
                return FolderErrors.NotFound(folderID);

            // RN-CONN-011.
            if (NameIsTaken(document, connection))
                return ConnectionErrors.AlreadyExists(connection.Name);

            return document with { Connections = [.. document.Connections, ToRecord(connection)] };
        }, cancellationToken);

    public Task<UnitResult<ApiErrorDto>> Update(Connection connection, string? password, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            var existing = document.Connections.FirstOrDefault(record => record.ID == connection.ID);
            if (existing is null)
                return ConnectionErrors.NotFound(connection.ID);

            if (connection.FolderID is { } folderID && !VaultFolders.ExistsByID(document, folderID))
                return FolderErrors.NotFound(folderID);

            // RN-CONN-011, sem contar a própria conexão: salvar com o nome que ela já tem não é duplicidade.
            if (NameIsTaken(document, connection))
                return ConnectionErrors.AlreadyExists(connection.Name);

            // RN-CONN-004: sem a senha, host e porta não mudam. A senha gravada só é enviada ao servidor para o qual foi gravada, e é aqui, com o
            // documento mais recente, que se sabe qual é o servidor gravado: a leitura do handler pode ser de antes de outra alteração.
            if (password is null && !ConnectionRules.SameServer(existing.Host, existing.Port, connection.Host, connection.Port))
                return ConnectionErrors.PasswordRequiredToChangeServer();

            // RN-CONN-004: senha omitida mantém a do documento que esta função recebeu, e não a que o handler leu: com duas alterações
            // simultâneas (uma trocando a senha, outra não), usar a lida antes desfaria a troca, e nenhuma ordem serial dá esse resultado.
            var updated = ToRecord(connection) with { Password = password ?? existing.Password };

            return document with { Connections = [.. document.Connections.Select(record => record.ID == connection.ID ? updated : record)] };
        }, cancellationToken);

    public async Task<Result<Connection, ApiErrorDto>> Duplicate(Guid id, DateTime createdAt, CancellationToken cancellationToken)
    {
        Connection? copy = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var existing = document.Connections.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return ConnectionErrors.NotFound(id);

            // RN-CONN-016: na mesma pasta, com o primeiro nome de cópia livre nela (RN-CONN-011), contra este documento: outra requisição
            // pode ter gravado uma cópia depois do clique. A senha vai de registro para registro, sem sair do cofre.
            var name = ConnectionRules.CopyName(existing.Name, candidate => NameIsTaken(document, existing.FolderID, null, candidate));
            copy = ToDomain(existing).Duplicate(name, createdAt);

            return document with { Connections = [.. document.Connections, ToRecord(copy)] };
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou fez a cópia.
        return copy!;
    }

    public Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            if (!document.Connections.Any(record => record.ID == id))
                return ConnectionErrors.NotFound(id);

            return document with { Connections = [.. document.Connections.Where(record => record.ID != id)] };
        }, cancellationToken);

    /// <summary>RN-CONN-011: o nome é único na pasta (a raiz é um lugar), sem diferenciar maiúsculas. A própria conexão não colide com o nome que já tem.</summary>
    private static bool NameIsTaken(VaultDocument document, Connection connection)
        => NameIsTaken(document, connection.FolderID, connection.ID, connection.Name);

    /// <summary>`exceptID` é a conexão que não conta (a que está sendo alterada), ou `null` quando todas contam.</summary>
    private static bool NameIsTaken(VaultDocument document, Guid? folderID, Guid? exceptID, string name)
        => document.Connections.Any(record => record.FolderID == folderID && record.ID != exceptID && string.Equals(record.Name, name, StringComparison.OrdinalIgnoreCase));

    private static Connection ToDomain(VaultConnectionRecord record)
        => Connection.Restore(record.ID, record.FolderID, record.Name, record.Engine, record.Host, record.Port, record.Database, record.UserName, record.Password, record.EnvironmentName, record.EnvironmentColor, record.CreatedAt, record.UpdatedAt);

    private static VaultConnectionRecord ToRecord(Connection connection)
        => new(connection.ID, connection.FolderID, connection.Name, connection.Engine, connection.Host, connection.Port, connection.Database, connection.UserName, connection.Password, connection.EnvironmentName, connection.EnvironmentColor, connection.CreatedAt, connection.UpdatedAt);
}
