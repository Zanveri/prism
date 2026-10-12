using CSharpFunctionalExtensions;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Queries;

/// <summary>
/// Leitura das conexões do cofre aberto. Diferente da `IFolderQueries`, que devolve `bool` e por isso não carrega a
/// falha de uma leitura, o retorno aqui é um `Result`: o cofre fechado é uma falha `Locked` (o handler responde 401
/// `VAULT_LOCKED`), e "a conexão não existe" é um sucesso com `null` (404). Uma consulta que não leu o cofre nunca
/// responde "não existe".
/// </summary>
public interface IConnectionQueries
{
    /// <summary>
    /// O registro como o cofre o guarda, com a senha do banco: serve a quem a usa (revelar a senha, e a Tarefa 10
    /// para abrir a sessão). Nunca vai a uma resposta.
    /// </summary>
    Task<Result<VaultConnectionRecord?, EVaultError>> GetRecordByID(Guid id, CancellationToken cancellationToken);
}
