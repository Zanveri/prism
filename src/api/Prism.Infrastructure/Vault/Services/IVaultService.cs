using CSharpFunctionalExtensions;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.Vault.Services;

/// <summary>
/// O cofre do usuário que entrou. É `Singleton` porque guarda o cofre aberto (a chave e o documento)
/// de uma requisição para a outra; pastas e conexões são lidas e gravadas por aqui.
/// </summary>
public interface IVaultService
{
    bool IsUnlocked { get; }

    string? UserName { get; }

    /// <summary>
    /// Disparado uma vez para cada cofre fechado, por qualquer caminho (RN-COFRE-008): `Lock`, a entrada
    /// de outro usuário, o quinto erro de senha, o descarte do serviço. Numa troca de usuário ele chega
    /// depois que o cofre novo já abriu: diz que um cofre fechou, e não que nenhum está aberto. Quem
    /// assina fecha o que dependia do cofre anterior.
    /// </summary>
    event Action? Locked;

    /// <summary>
    /// Disparado depois de um cofre abrir (`CreateAsync` ou `UnlockAsync`), já com o semáforo liberado.
    /// </summary>
    event Action? Unlocked;

    /// <summary>
    /// Disparado no quinto erro seguido de senha na conferência (<see cref="ReadIfPasswordMatchesAsync"/>, <see cref="ChangePasswordAsync"/> ou
    /// <see cref="SaveWithPasswordAsync"/>), imediatamente antes de o cofre fechar (RN-AUDIT-004).
    /// </summary>
    event Action? FifthFailedVerification;

    /// <summary>
    /// Cria o arquivo do usuário e já deixa o cofre aberto, fechando o que estava aberto (RN-COFRE-007).
    /// Uma criação recusada não muda nada: o cofre que estava aberto continua aberto.
    /// </summary>
    Task<UnitResult<EVaultError>> CreateAsync(string userName, string password, CancellationToken cancellationToken);

    /// <summary>
    /// Fecha o cofre aberto e tenta abrir o do usuário (RN-COFRE-007). O anterior fecha mesmo que a
    /// entrada falhe. Usuário inexistente, senha errada e arquivo ilegível respondem `InvalidCredentials`
    /// (RN-COFRE-006); a única exceção é o cofre de formato mais novo que o conhecido, que responde
    /// `FormatUnsupported` sem olhar a senha (RN-VERSAO-005). RN-COFRE-013: a cada entrada bem-sucedida o serviço confere se o `.bak` está embrulhado
    /// pela mesma senha do principal (o sal e a chave embrulhada dos cabeçalhos) e, se não está (a segunda gravação de uma troca de senha falhou), o refaz na
    /// hora, regravando o principal. A falha dessa cura não impede a entrada: vai ao log como aviso.
    /// </summary>
    Task<UnitResult<EVaultError>> UnlockAsync(string userName, string password, CancellationToken cancellationToken);

    /// <summary>RN-COFRE-008: zera a chave na memória, descarta o documento e dispara <see cref="Locked"/>.</summary>
    void Lock();

    /// <summary>
    /// RN-CONN-002: confere a senha do usuário que está com o cofre aberto, derivando a chave de novo, e entrega o documento do
    /// MESMO cofre que a senha abriu, na mesma operação (com o semáforo tomado). Quem confere a senha e depois usa um dado do
    /// cofre faz as duas coisas por aqui: uma leitura feita antes (`Read`) pode ser de um cofre que outro usuário já trocou
    /// quando a conferência acontece, e a senha dele "confirmaria" o dado do anterior.
    ///
    /// Sucesso com o documento quando a senha confere (zera a contagem de erros); sucesso com `null` quando não confere (conta o
    /// erro); falha `Locked` quando não há cofre aberto, e no quinto erro seguido, já com o cofre fechado (RN-CONN-003).
    /// </summary>
    Task<Result<VaultDocument?, EVaultError>> ReadIfPasswordMatchesAsync(string password, CancellationToken cancellationToken);

    /// <summary>
    /// Muda toda vez que o cofre aberto muda: abrir (criar, entrar), fechar (sair, o quinto erro de senha, o descarte) e trocar de
    /// usuário. Não muda numa gravação, numa troca de senha nem numa leitura. Quem lê um dado do cofre e depois age com ele fora do semáforo lê a geração
    /// ANTES do dado e compara com a de depois: se mudou, o dado é do cofre anterior e a ação é abandonada. Começa em zero.
    /// </summary>
    long Generation { get; }

    /// <summary>
    /// RN-COFRE-013 e RN-DIARIO-004: troca a senha do usuário do cofre aberto e gira a chave do diário. Confere a senha atual pelo mesmo caminho do <see cref="ReadIfPasswordMatchesAsync"/>
    /// (uma derivação com o sal e os parâmetros do arquivo, a mesma contagem de erros seguidos e o mesmo fechamento no quinto, RN-CONN-003), recusa
    /// a nova igual a ela, gera uma chave nova para o diário (passada a <paramref name="beforeSave"/> antes de gravar o cofre) e RECIFRA o cofre (RN-COFRE-003): gera uma chave do cofre nova, cifra o conteúdo com ela (nonce novo, o cabeçalho novo como dado
    /// autenticado, RN-COFRE-004) e a embrulha com a chave derivada da senha nova (sal novo, parâmetros atuais das opções, nunca mais fracos que os do arquivo: campo a campo, o maior dos dois). Assim, quem tem a senha antiga
    /// e uma cópia antiga do arquivo não lê nada do que for gravado depois: a chave que a cópia entrega é a antiga, que é zerada da memória. A gravação
    /// é a de sempre (RN-COFRE-005) e acontece com o cofre reservado, como a de <see cref="SaveAsync"/>: uma não se intercala com a outra, e uma gravação
    /// comum que entra logo depois da troca usa a chave nova. Segue-se uma segunda gravação do mesmo arquivo, para o `.bak` também ficar com a senha nova
    /// (sem ela, a senha antiga voltaria a abrir o cofre se o principal sumisse, porque o app promove o `.bak`).
    ///
    /// O cofre continua aberto: não dispara <see cref="Locked"/> nem muda a <see cref="Generation"/>, então as sessões com
    /// os bancos não caem. Falhas: `CurrentPasswordInvalid` (conta um erro), `PasswordUnchanged` (depois da conferência), `Locked` (sem cofre
    /// aberto, e no quinto erro seguido, já com o cofre fechado) e `Unavailable` (`beforeSave` devolveu `false` ou a PRIMEIRA gravação falhou: se a primeira gravação falhar depois de `beforeSave`, <paramref name="onSaveFailed"/> é chamado, e o arquivo e a memória seguem com a senha e a
    /// chave antigas). A falha só da segunda gravação mantém a troca (sucesso) e vai ao log como aviso: o `.bak` fica com o embrulho antigo até a próxima
    /// gravação comum.
    /// </summary>
    Task<UnitResult<EVaultError>> ChangePasswordAsync(string currentPassword, string newPassword, CancellationToken cancellationToken, Func<byte[], CancellationToken, Task<bool>>? beforeSave = null, Func<CancellationToken, Task>? onSaveFailed = null);

    Result<VaultDocument, EVaultError> Read();

    /// <summary>
    /// Aplica a alteração ao documento atual e grava. Uma gravação por vez: `change` sempre recebe o
    /// resultado da anterior. Quando volta, o arquivo já está no disco; se a gravação falha, o documento
    /// continua o anterior. `change` roda com o cofre reservado para esta gravação: ele não chama
    /// `SaveAsync`, `Lock` nem as outras operações do serviço, ou ficaria esperando por si mesmo.
    /// Se `change` devolve a mesma instância que recebeu, nada é gravado e a resposta é sucesso: é como
    /// a função recusa uma mudança sem custar uma regravação (e sem apagar a versão do `.bak`).
    /// </summary>
    Task<UnitResult<EVaultError>> SaveAsync(Func<VaultDocument, VaultDocument> change, CancellationToken cancellationToken);

    /// <summary>
    /// RN-PROT-003: o <see cref="SaveAsync"/> da alteração que pode pedir a senha do usuário. Com o semáforo tomado, numa operação só: aplica `change`
    /// ao documento atual, pergunta a `needsPassword` (o documento de antes e o de depois) se a mudança pede a senha e, se pede, confere `password`
    /// pelo mesmo caminho do <see cref="ReadIfPasswordMatchesAsync"/> (a mesma derivação, a mesma contagem de erros seguidos e o mesmo fechamento no
    /// quinto, RN-CONN-003); só então grava. Quem decide se a senha é pedida é o documento mais recente, e não o que quem chama leu antes.
    ///
    /// `Missing` (a senha pedida não veio, nula ou vazia: nada é conferido nem contado) e `Wrong` (não conferiu: o erro é contado) não gravam nada.
    /// A senha que vem sem ser pedida não é conferida (`NotNeeded`). `change` que devolve a mesma instância é "nada a gravar", como no
    /// <see cref="SaveAsync"/>, e não pede senha. As falhas são as do <see cref="SaveAsync"/>, mais `Locked` no quinto erro seguido, já com o cofre fechado.
    /// </summary>
    Task<Result<EPasswordCheck, EVaultError>> SaveWithPasswordAsync(Func<VaultDocument, VaultDocument> change, Func<VaultDocument, VaultDocument, bool> needsPassword, string? password, CancellationToken cancellationToken);
}
