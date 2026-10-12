namespace Prism.Application.Folders.Queries;

/// <summary>
/// Conferências sobre as pastas do cofre aberto, antes de uma escrita. Servem para responder com o erro
/// certo e depressa; quem garante a regra contra uma requisição concorrente, e contra um cofre que fechou,
/// é o `IFolderRepository`, de dentro da gravação.
///
/// O retorno é `bool`, que não tem como carregar a falha de uma leitura: com o cofre fechado no meio da
/// requisição cada método responde como um documento sem pastas. Por isso uma consulta que não leu o cofre
/// não decide nada: só um "sim" (duplicidade, filhos, descendente) pode recusar um pedido, e um "não" segue
/// para a gravação, que é quem responde 404, 409 ou 401 `VAULT_LOCKED`.
/// </summary>
public interface IFolderQueries
{
    /// <summary>RN-PASTA-002: já existe uma pasta com este nome entre as filhas de `parentID` (a raiz, quando nulo), sem diferenciar maiúsculas?</summary>
    Task<bool> Exists(string name, Guid? parentID, CancellationToken cancellationToken);

    /// <summary>
    /// A pasta existe? Atenção: o `false` não distingue "não existe" de "cofre fechado". Não responda 404
    /// por ele: quem grava confere a existência de novo dentro do `SaveAsync` (com `VaultFolders.ExistsByID`),
    /// onde o cofre fechado vira 401 `VAULT_LOCKED`. Serve a quem só precisa de uma pergunta rápida e
    /// sem efeito, e não a quem decide uma resposta de erro.
    /// </summary>
    Task<bool> ExistsByID(Guid id, CancellationToken cancellationToken);

    /// <summary>RN-PASTA-004: a pasta tem subpastas ou conexões?</summary>
    Task<bool> HasChildren(Guid id, CancellationToken cancellationToken);

    /// <summary>RN-PASTA-003: `candidateID` é a própria pasta `ancestorID` ou está dentro dela, a qualquer profundidade?</summary>
    Task<bool> IsSelfOrDescendant(Guid candidateID, Guid ancestorID, CancellationToken cancellationToken);
}
