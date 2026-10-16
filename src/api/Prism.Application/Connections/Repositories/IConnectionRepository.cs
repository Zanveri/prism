using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Connections.Repositories;

/// <summary>
/// Internal, e não pública como a `IConnectionQueries`: a assinatura trafega o domínio, que é internal. Expor um tipo
/// internal em interface pública não compila.
///
/// Não há `GetByID`: o handler que altera lê o registro pela `IConnectionQueries`. O cofre não tem restrições como um
/// banco, então a falha de uma gravação não é só a do disco: o que o banco garantiria por chave única e chave
/// estrangeira (a pasta existe, o nome é livre na pasta, RN-CONN-011) e a existência da própria conexão são conferidos
/// dentro da gravação, e a recusa volta como o erro da API. O cofre fechado e o disco também, pela tradução do `VaultErrors`.
/// </summary>
internal interface IConnectionRepository
{
    /// <summary>
    /// Falha com 404 `FOLDER_NOT_FOUND` (a pasta), 409 `CONNECTION_ALREADY_EXISTS` ou 401 `VAULT_LOCKED`. Devolve as proteções que valem (RN-PROT-004),
    /// do documento gravado.
    /// </summary>
    Task<Result<EffectiveProtections, ApiErrorDto>> Insert(Connection connection, CancellationToken cancellationToken);

    /// <summary>
    /// Grava todos os campos da conexão. As mesmas falhas do `Insert`, mais 404 `CONNECTION_NOT_FOUND` e, com `password` nula e host ou
    /// porta diferentes dos gravados, 422 `CONNECTION_INVALID` (RN-CONN-004: a senha gravada só vai ao servidor para o qual foi gravada).
    ///
    /// `password` é a senha nova, ou `null` para manter a gravada (RN-CONN-004), e `connection.Password` não é usado: o domínio chega com
    /// a senha que o handler leu antes, e outra requisição pode ter gravado outra desde então. Manter a gravada é resolvido dentro da
    /// gravação, a partir do registro do documento mais recente.
    ///
    /// `userPassword` é a senha do usuário do Prism, que a alteração do somente leitura pede (RN-PROT-003): sem ela, 422 `USER_PASSWORD_REQUIRED`;
    /// errada, 422 `INVALID_PASSWORD` (e o quinto erro seguido, 401 `VAULT_LOCKED`). Conferida na mesma operação do cofre que grava, só quando pedida.
    /// Devolve as proteções que valem (RN-PROT-004), do documento gravado.
    /// </summary>
    Task<Result<EffectiveProtections, ApiErrorDto>> Update(Connection connection, string? password, string? userPassword, CancellationToken cancellationToken);

    /// <summary>
    /// RN-CONN-016: grava a cópia da conexão `id` na mesma pasta, com todos os campos e a senha, o nome "&lt;nome&gt; (cópia)" (ou "(cópia 2)"…, o
    /// primeiro livre na pasta) e as duas datas em `createdAt`, e devolve a cópia. A origem, o nome e a senha saem do documento mais recente, dentro
    /// da gravação, com as proteções e a verificação da origem (RN-PROT-003: sem pedir a senha do usuário). Falha com 404 `CONNECTION_NOT_FOUND` quando a
    /// conexão não existe, ou 401 `VAULT_LOCKED`.
    /// </summary>
    Task<Result<(Connection Copy, EffectiveProtections Protections), ApiErrorDto>> Duplicate(Guid id, DateTime createdAt, CancellationToken cancellationToken);

    /// <summary>Falha com 404 `CONNECTION_NOT_FOUND` quando a conexão não existe.</summary>
    Task<UnitResult<ApiErrorDto>> Delete(Guid id, CancellationToken cancellationToken);
}
