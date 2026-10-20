using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
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
///
/// As proteções que valem (RN-PROT-004) dependem das pastas acima, e saem do documento que a gravação acabou de escrever: é o que a resposta mostra. A
/// alteração que pede a senha do usuário (RN-PROT-003: marcar ou desmarcar o somente leitura, ou tirar o herdado movendo) a confere na mesma operação
/// do cofre que grava (`SaveOrRefuseWithPassword`).
/// </summary>
internal sealed class ConnectionRepository(IVaultService vaultService) : IConnectionRepository
{
    public async Task<Result<EffectiveProtections, ApiErrorDto>> Insert(Connection connection, CancellationToken cancellationToken)
    {
        EffectiveProtections? protections = null;

        // RN-PROT-003: criar uma conexão já marcada não pede a senha do usuário (nada do que existe muda).
        var saved = await vaultService.SaveOrRefuse(document =>
        {
            // A pasta pode ter sido excluída (estava vazia) depois de o usuário abrir o formulário: sem esta regra a conexão ficaria órfã.
            if (connection.FolderID is { } folderID && !VaultFolders.ExistsByID(document, folderID))
                return FolderErrors.NotFound(folderID);

            // RN-CONN-011.
            if (NameIsTaken(document, connection))
                return ConnectionErrors.AlreadyExists(connection.Name);

            var record = ConnectionRecords.ToRecord(connection);
            var inserted = document with { Connections = [.. document.Connections, record] };
            protections = ProtectionRules.Of(inserted, record);

            return inserted;
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou calculou as proteções.
        return protections!;
    }

    public async Task<Result<EffectiveProtections, ApiErrorDto>> Update(Connection connection, string? password, string? userPassword, CancellationToken cancellationToken)
    {
        EffectiveProtections? protections = null;

        var saved = await vaultService.SaveOrRefuseWithPassword(document =>
        {
            var existing = document.Connections.FirstOrDefault(record => record.ID == connection.ID);
            if (existing is null)
                return ConnectionErrors.NotFound(connection.ID);

            // RN-TRANSF-015: o usuário vazio só passa na conexão gravada já sem usuário (a que a importação trouxe sem ele: o "Renomear" e o "Mover" mandam o
            // que ela tem). Tirar o usuário de uma conexão que tem um continua sendo a recusa do formulário. Decidido aqui, contra o documento mais recente.
            if (string.IsNullOrWhiteSpace(connection.UserName) && !string.IsNullOrWhiteSpace(existing.UserName))
                return ConnectionErrors.UserNameRequired();

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
            // RN-DBEAVER-018: editar, renomear e mover mantêm a origem da conexão importada; o domínio não a conhece, e ela vem do registro gravado.
            var updated = ConnectionRecords.ToRecord(connection) with { Password = password ?? existing.Password, Origin = existing.Origin };
            var changed = document with { Connections = [.. document.Connections.Select(record => record.ID == connection.ID ? updated : record)] };
            protections = ProtectionRules.Of(changed, updated);

            return changed;
        }, userPassword, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        return protections!;
    }

    public async Task<Result<(Connection Copy, EffectiveProtections Protections), ApiErrorDto>> Duplicate(Guid id, DateTime createdAt, CancellationToken cancellationToken)
    {
        Connection? copy = null;
        EffectiveProtections? protections = null;

        var saved = await vaultService.SaveOrRefuse(document =>
        {
            var existing = document.Connections.FirstOrDefault(record => record.ID == id);
            if (existing is null)
                return ConnectionErrors.NotFound(id);

            // RN-CONN-016: na mesma pasta, com o primeiro nome de cópia livre nela (RN-CONN-011), contra este documento: outra requisição
            // pode ter gravado uma cópia depois do clique. A senha vai de registro para registro, sem sair do cofre.
            // RN-PROT-003: a cópia nasce com as proteções da origem, sem pedir a senha do usuário.
            var name = ConnectionRules.CopyName(existing.Name, candidate => NameIsTaken(document, existing.FolderID, null, candidate));
            copy = ConnectionRecords.ToDomain(existing).Duplicate(name, createdAt);
            var record = ConnectionRecords.ToRecord(copy);
            var duplicated = document with { Connections = [.. document.Connections, record] };
            protections = ProtectionRules.Of(duplicated, record);

            return duplicated;
        }, cancellationToken);

        if (saved.IsFailure)
            return saved.Error;

        // A gravação que deu certo rodou a função, e a função que não recusou fez a cópia.
        return (copy!, protections!);
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

}
