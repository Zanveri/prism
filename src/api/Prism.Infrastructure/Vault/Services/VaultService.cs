using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using System.Security.Cryptography;
using System.Text.Json;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Vault.Services;

/// <param name="deriveKey">
/// A derivação da chave a partir da senha. Em produção é o <see cref="VaultCrypto.DeriveKey"/>; entra
/// pelo construtor para o teste da RN-COFRE-006 conferir que o usuário inexistente também deriva.
/// </param>
/// <param name="newKey">
/// A geração da chave do cofre (RN-COFRE-003). Em produção é o <see cref="VaultCrypto.NewKey"/>; entra pelo construtor para o teste ver o buffer da chave
/// nova que uma troca de senha que falhou gerou e conferir que ele foi zerado.
/// </param>
/// <param name="logger">Os registros do serviço são só dois avisos, da troca de senha e da cura do `.bak` (ver <see cref="ChangePasswordAsync"/> e <see cref="HealBackup"/>): sem senha, sem nome de usuário e sem exceção (RN-LOG-001).</param>
internal sealed class VaultService(IVaultFileClient client, IOptions<VaultOptions> options, Func<string, VaultKdf, byte[]> deriveKey, Func<byte[]> newKey, ILogger logger) : IVaultService, IDisposable
{
    /// <summary>RN-CONN-003: o quinto erro seguido de senha fecha o cofre.</summary>
    private const int MaxFailedVerifications = 5;

    private readonly VaultOptions _options = options.Value;

    private readonly ILogger _logger = logger.ForContext<VaultService>();

    /// <summary>
    /// Um de cada vez em tudo o que troca o cofre aberto ou usa a chave: carregar, alterar, cifrar e
    /// gravar não se intercalam, e a chave nunca é zerada no meio de uma gravação.
    /// </summary>
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>Só é trocado com o semáforo tomado; quem lê sem ele (`Read`, `IsUnlocked`, `UserName`) vê o cofre inteiro de antes ou o de depois.</summary>
    private volatile OpenVault? _open;

    private int _failedVerifications;
    private bool _closedSinceLastRelease;
    private bool _openedSinceLastRelease;
    private long _generation;

    public bool IsUnlocked => _open is not null;

    public long Generation => Interlocked.Read(ref _generation);

    public string? UserName => _open?.UserName;

    public event Action? Locked;

    public event Action? Unlocked;

    public event Action? FifthFailedVerification;

    public Task<UnitResult<EVaultError>> CreateAsync(string userName, string password, CancellationToken cancellationToken)
        => Exclusive(() => Create(userName, password, cancellationToken), cancellationToken);

    public Task<UnitResult<EVaultError>> UnlockAsync(string userName, string password, CancellationToken cancellationToken)
        => Exclusive(() => Unlock(userName, password, cancellationToken), cancellationToken);

    public Task<Result<VaultDocument?, EVaultError>> ReadIfPasswordMatchesAsync(string password, CancellationToken cancellationToken)
        => Exclusive(() => ReadIfPasswordMatches(password), cancellationToken);

    public Task<UnitResult<EVaultError>> SaveAsync(Func<VaultDocument, VaultDocument> change, CancellationToken cancellationToken)
        => Exclusive(() => Save(change, cancellationToken), cancellationToken);

    public Task<UnitResult<EVaultError>> ChangePasswordAsync(string currentPassword, string newPassword, CancellationToken cancellationToken, Func<byte[], CancellationToken, Task<bool>>? beforeSave = null, Func<CancellationToken, Task>? onSaveFailed = null)
        => ExclusiveAsync(() => ChangePassword(currentPassword, newPassword, cancellationToken, beforeSave, onSaveFailed), cancellationToken);

    public Task<Result<EPasswordCheck, EVaultError>> SaveWithPasswordAsync(Func<VaultDocument, VaultDocument> change, Func<VaultDocument, VaultDocument, bool> needsPassword, string? password, CancellationToken cancellationToken)
        => Exclusive(() => SaveWithPassword(change, needsPassword, password, cancellationToken), cancellationToken);

    public Result<VaultDocument, EVaultError> Read()
    {
        var open = _open;
        if (open is null)
            return EVaultError.Locked;

        return open.Document;
    }

    /// <summary>
    /// Espera a operação em andamento terminar, de forma síncrona: é o que impede a chave de ser zerada
    /// enquanto uma gravação a usa. A espera é curta, a de uma gravação ou de uma derivação.
    /// </summary>
    public void Lock()
    {
        _gate.Wait();
        RunAndRelease(Close);
    }

    /// <summary>
    /// RN-COFRE-008: o app fechando zera a chave. O contêiner descarta o serviço no desligamento normal
    /// da API. Nada mais depende deste descarte: toda gravação termina dentro do `SaveAsync`.
    /// </summary>
    public void Dispose()
        => Lock();

    private async Task<T> Exclusive<T>(Func<T> work, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);

        return RunAndRelease(work);
    }

    private async Task<T> ExclusiveAsync<T>(Func<Task<T>> work, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);

        return await RunAndReleaseAsync(work);
    }

    /// <summary>
    /// Roda com o semáforo já tomado e sai pelo `Leave`. É `using`, e não uma chamada solta no fim: se
    /// `work` lançar (um defeito, não uma falha prevista), a saída acontece do mesmo jeito, e o serviço
    /// não fica travado para todas as requisições seguintes.
    /// </summary>
    private T RunAndRelease<T>(Func<T> work)
    {
        using (new Exit(this))
            return work();
    }

    private async Task<T> RunAndReleaseAsync<T>(Func<Task<T>> work)
    {
        using (new Exit(this))
            return await work();
    }

    /// <summary>
    /// A saída de toda operação: libera o semáforo e só então avisa quem assina `Locked` e `Unlocked`, para um
    /// assinante que chame o serviço de volta não encontrar o semáforo preso. Vale também quando o
    /// trabalho termina em exceção: o `Unlock` fecha o cofre anterior antes de tentar, e quem assina
    /// fecha as sessões com os bancos por este aviso (RN-COFRE-008), então ele sai na mesma chamada em
    /// que o cofre fechou.
    /// </summary>
    private void Leave()
    {
        var closed = _closedSinceLastRelease;
        var opened = _openedSinceLastRelease;
        _closedSinceLastRelease = false;
        _openedSinceLastRelease = false;
        _gate.Release();

        if (closed)
            Locked?.Invoke();

        if (opened)
            Unlocked?.Invoke();
    }

    private UnitResult<EVaultError> Create(string userName, string password, CancellationToken cancellationToken)
    {
        // Arquivo ilegível no lugar também é "já existe": criar por cima apagaria o cofre de alguém (seção 7 da especificação).
        var existing = client.Read(userName);
        if (existing.IsFailure)
            return existing.Error == EVaultFileError.Unavailable ? EVaultError.Unavailable : EVaultError.UserAlreadyExists;

        if (existing.Value.HasValue)
            return EVaultError.UserAlreadyExists;

        // RN-COFRE-002 e 003: sal aleatório por usuário, e uma chave do cofre aleatória que nem o usuário
        // conhece; a chave que sai da senha só serve para cifrar essa.
        var kdf = NewKdf();
        var associatedData = VaultCrypto.AssociatedData(VaultCrypto.Version, kdf);
        var key = newKey();
        var passwordKey = deriveKey(password, kdf);
        var wrappedKey = VaultCrypto.Seal(passwordKey, key, associatedData);
        CryptographicOperations.ZeroMemory(passwordKey);

        var journal = new VaultJournalRecord(VaultCrypto.NewKey(), DateTimeOffset.UtcNow);
        var document = new VaultDocument(userName, [], [], [], VaultWorkspaceRecord.Empty, [], Journal: journal);
        var file = new VaultFile(VaultCrypto.Version, kdf, wrappedKey, Seal(key, document, associatedData));

        if (client.Write(userName, file, cancellationToken).IsFailure)
        {
            CryptographicOperations.ZeroMemory(key);
            CryptographicOperations.ZeroMemory(journal.Key);

            return EVaultError.Unavailable;
        }

        // RN-COFRE-007: um cofre aberto por vez. O anterior só fecha aqui, com o novo já gravado: uma
        // criação recusada (nome em uso, disco) não derruba a sessão de quem está dentro.
        Close();
        Open(new OpenVault(userName, key, file, document));

        return UnitResult.Success<EVaultError>();
    }

    private UnitResult<EVaultError> Unlock(string userName, string password, CancellationToken cancellationToken)
    {
        // RN-COFRE-007: o anterior fecha antes da tentativa. Uma entrada que falha não deixa o cofre de outra pessoa aberto.
        Close();

        var read = client.Read(userName);
        if (read.IsFailure && read.Error == EVaultFileError.Unavailable)
            return EVaultError.Unavailable;

        // RN-VERSAO-005: o formato mais novo é recusado ANTES de qualquer derivação, com a senha certa ou com a errada: a recusa vem antes de a
        // senha ser olhada. É a única exceção ao 401 único da RN-COFRE-006, porque este cofre não está ilegível: sem a resposta própria, quem
        // voltasse a uma versão antiga do Prism concluiria que errou a senha.
        if (read.IsFailure && read.Error == EVaultFileError.NewerFormat)
            return EVaultError.FormatUnsupported;

        // RN-COFRE-006: usuário inexistente (ou arquivo ilegível) custa a mesma derivação de uma senha
        // errada, para o tempo da resposta não dizer se o usuário existe. O sal é sorteado e a chave, descartada.
        if (read.IsFailure || read.Value.HasNoValue)
        {
            CryptographicOperations.ZeroMemory(deriveKey(password, NewKdf()));

            return EVaultError.InvalidCredentials;
        }

        var file = read.Value.Value;
        var associatedData = VaultCrypto.AssociatedData(file.Version, file.Kdf);

        // A chave derivada da senha fica até o fim da entrada, e não só até abrir a chave do cofre: a migração de um formato antigo (abaixo) embrulha a
        // chave do cofre de novo, com o cabeçalho do formato atual. Ela é zerada em todos os caminhos.
        var passwordKey = deriveKey(password, file.Kdf);
        var key = client.Open(passwordKey, file.WrappedKey, associatedData);
        if (key.IsFailure)
        {
            CryptographicOperations.ZeroMemory(passwordKey);

            return EVaultError.InvalidCredentials;
        }

        // RN-COFRE-003: a tag e o cabeçalho autenticado fazem o conteúdo adulterado não abrir.
        var plaintext = client.Open(key.Value, file.Payload, associatedData);
        if (plaintext.IsFailure)
        {
            CryptographicOperations.ZeroMemory(passwordKey);
            CryptographicOperations.ZeroMemory(key.Value);

            return EVaultError.InvalidCredentials;
        }

        // O que autenticou com a chave do cofre foi gravado por este serviço; não é entrada de fora.
        var document = JsonSerializer.Deserialize<VaultDocument>(plaintext.Value)!;
        CryptographicOperations.ZeroMemory(plaintext.Value);

        // RN-VERSAO-005: o cofre de formato mais antigo é migrado ao abrir. Sem migração, a cura do `.bak` roda como sempre; com ela, não: a gravação
        // da migração acabou de pôr no `.bak` o arquivo de antes, que é o que a regra manda guardar.
        var migrated = file.Version < VaultCrypto.Version;
        if (migrated)
            (file, document) = Migrate(userName, file, passwordKey, key.Value, document, cancellationToken);
        else if (document.Journal is null)
            (file, document, migrated) = EnsureJournal(userName, file, key.Value, document, associatedData, cancellationToken);

        CryptographicOperations.ZeroMemory(passwordKey);

        Open(new OpenVault(userName, key.Value, file, document));

        if (!migrated)
            HealBackup(userName, file, cancellationToken);

        return UnitResult.Success<EVaultError>();
    }

    /// <summary>
    /// RN-VERSAO-005, RN-SCRIPT-002, RN-ABAS-006, RN-SCRIPT-011 e RN-DIARIO-002: a migração de um cofre de formato mais antigo, ao abrir, com o semáforo tomado e a senha já
    /// conferida. O documento passa pelo <see cref="VaultMigration.Upgrade"/> (do 1 para o 2, a lista de scripts vazia; do 2 para o 3, a área de trabalho vazia;
    /// do 3 para o 4, a lista de pastas de scripts vazia), ganha a chave do diário se ainda não tinha, e o arquivo
    /// é regravado no formato atual: a mesma senha, o mesmo sal e os mesmos parâmetros, e a mesma chave do cofre, embrulhada de novo e com o conteúdo cifrado de novo, porque o número do formato faz parte do dado autenticado
    /// das duas cifras (RN-COFRE-003 e 004). A gravação é a de sempre (RN-COFRE-005): atômica, e o arquivo de antes vai para o `.bak`.
    ///
    /// A falha do disco não impede a entrada, que não precisa gravar nada: o cofre abre com o arquivo migrado na memória, e a primeira gravação seguinte o escreve
    /// inteiro (o `Save` grava o arquivo da memória, no formato atual); sem gravação no meio, a entrada seguinte migra de novo. O aviso leva só a classe da falha,
    /// sem senha, sem nome de usuário e sem exceção (RN-LOG-001).
    /// </summary>
    private (VaultFile File, VaultDocument Document) Migrate(string userName, VaultFile file, byte[] passwordKey, byte[] key, VaultDocument document, CancellationToken cancellationToken)
    {
        var associatedData = VaultCrypto.AssociatedData(VaultCrypto.Version, file.Kdf);
        var upgraded = VaultMigration.Upgrade(document, file.Version);
        if (upgraded.Journal is null)
            upgraded = upgraded with { Journal = new VaultJournalRecord(VaultCrypto.NewKey(), DateTimeOffset.UtcNow) };

        var migrated = new VaultFile(VaultCrypto.Version, file.Kdf, VaultCrypto.Seal(passwordKey, key, associatedData), Seal(key, upgraded, associatedData));

        var written = client.Write(userName, migrated, cancellationToken);
        if (written.IsFailure)
            _logger.Warning("O cofre do formato {Format} não pôde ser regravado no formato {CurrentFormat} na entrada ({Failure:l}); a próxima gravação o regrava.", file.Version, VaultCrypto.Version, written.Error.ToString());

        return (migrated, upgraded);
    }

    /// <summary>RN-DIARIO-002: garante que um cofre já no formato atual mas ainda sem `Journal` receba e persista sua chave na primeira abertura.</summary>
    private (VaultFile File, VaultDocument Document, bool Written) EnsureJournal(string userName, VaultFile file, byte[] key, VaultDocument document, byte[] associatedData, CancellationToken cancellationToken)
    {
        var withJournal = document with { Journal = new VaultJournalRecord(VaultCrypto.NewKey(), DateTimeOffset.UtcNow) };
        var updated = file with { Payload = Seal(key, withJournal, associatedData) };
        var written = client.Write(userName, updated, cancellationToken);
        if (written.IsFailure)
            _logger.Warning("A chave do diário não pôde ser gravada no cofre na entrada ({Failure:l}); a próxima gravação a persiste.", written.Error.ToString());

        return (updated, withJournal, written.IsSuccess);
    }

    /// <summary>
    /// RN-COFRE-013: a cura da cópia de segurança, a cada entrada bem-sucedida (só depois de a senha conferir, então a entrada que falha não faz nada a mais, RN-COFRE-006).
    /// A troca de senha grava duas vezes para o `.bak` ficar com a senha nova, e a segunda pode ter falhado, ou a energia pode ter caído entre as duas: então o `.bak` é o
    /// principal de antes, embrulhado pela senha ANTIGA, e se o principal sumir o app o promove (RN-COFRE-005) e a senha antiga volta a abrir o cofre. Aqui o serviço
    /// compara o sal e a chave embrulhada dos dois cabeçalhos (e não o arquivo inteiro: depois de uma gravação comum o `.bak` é a versão anterior e DIFERENTE do principal,
    /// com o mesmo embrulho, e isso não se refaz). Se o embrulho difere, o principal é regravado: o `File.Replace` põe o principal, que já tem a senha nova, no lugar do
    /// `.bak`. Uma única regravação basta (na troca a primeira já mudou o principal). Um `.bak` ilegível ou de formato mais novo não é tocado (RN-VERSAO-005): a regravação
    /// o sobrescreveria. A falha da cura não impede a entrada: vai ao log como aviso, e a entrada seguinte tenta de novo.
    /// </summary>
    private void HealBackup(string userName, VaultFile file, CancellationToken cancellationToken)
    {
        var backup = client.ReadBackup(userName);
        if (backup.IsFailure || backup.Value.HasNoValue || HasTheSameWrapping(backup.Value.Value, file))
            return;

        var rewritten = client.Write(userName, file, cancellationToken);
        if (rewritten.IsFailure)
            _logger.Warning("A cópia de segurança do cofre não pôde ser refeita na entrada ({Failure:l}); a próxima entrada tenta de novo.", rewritten.Error.ToString());
    }

    /// <summary>
    /// O mesmo embrulho é o mesmo sal da derivação e a mesma chave embrulhada (nonce, conteúdo cifrado e tag): é a mesma senha. Dado público do cabeçalho, sem
    /// comparação em tempo constante. O `.bak` de formato anterior com o mesmo sal é o arquivo de antes da migração (RN-VERSAO-005): a migração embrulha a chave
    /// de novo, com o cabeçalho do formato atual, mas a senha e o sal são os mesmos (a troca de senha sempre sorteia outro sal), e ele fica onde está.
    /// </summary>
    private static bool HasTheSameWrapping(VaultFile backup, VaultFile file)
        => backup.Kdf.Salt.AsSpan().SequenceEqual(file.Kdf.Salt) && (backup.Version < file.Version || (backup.WrappedKey.Nonce.AsSpan().SequenceEqual(file.WrappedKey.Nonce) && backup.WrappedKey.Ciphertext.AsSpan().SequenceEqual(file.WrappedKey.Ciphertext) && backup.WrappedKey.Tag.AsSpan().SequenceEqual(file.WrappedKey.Tag)));

    /// <summary>
    /// Com o semáforo tomado, a conferência e o documento são do mesmo cofre: o `_open` não troca entre uma coisa e outra. É por
    /// isso que a conferência da senha e a entrega do dado são uma operação só (ver `IVaultService.ReadIfPasswordMatchesAsync`).
    /// </summary>
    private Result<VaultDocument?, EVaultError> ReadIfPasswordMatches(string password)
    {
        var open = _open;
        if (open is null)
            return EVaultError.Locked;

        var matched = CheckPassword(open, password);
        if (matched.IsFailure)
            return matched.Error;

        if (!matched.Value)
            return Result.Success<VaultDocument?, EVaultError>(null);

        return open.Document;
    }

    /// <summary>
    /// RN-COFRE-013 e RN-DIARIO-004. Tudo com o semáforo tomado: a conferência, o documento, o rekey do diário e a gravação são do mesmo cofre aberto, e nenhuma gravação comum se
    /// intercala. A troca RECIFRA o cofre (RN-COFRE-003): a chave do cofre é outra, o conteúdo é cifrado com ela (nonce novo, e o cabeçalho novo como dado
    /// autenticado, RN-COFRE-004), e ela é embrulhada com a chave derivada da senha nova. Nada vale antes de a gravação terminar: se ela falha, o
    /// `_open` continua o de antes, com a chave e o cabeçalho antigos, e o arquivo também (o `Write` do client só troca o principal inteiro). A chave
    /// antiga só é zerada depois de o `_open` trocar, e nenhum caminho a guarda em variável através do semáforo: toda operação lê o `_open` depois de
    /// tomá-lo, então uma gravação comum que entra logo depois da troca usa a chave nova. Depois da primeira gravação vem uma SEGUNDA do mesmo arquivo,
    /// para o `.bak` ficar igual ao principal novo; a falha só dela não desfaz a troca.
    /// </summary>
    private async Task<UnitResult<EVaultError>> ChangePassword(string currentPassword, string newPassword, CancellationToken cancellationToken, Func<byte[], CancellationToken, Task<bool>>? beforeSave, Func<CancellationToken, Task>? onSaveFailed)
    {
        var open = _open;
        if (open is null)
            return EVaultError.Locked;

        // O mesmo caminho da revelação da senha de uma conexão: uma derivação com o sal e os parâmetros do ARQUIVO, e a mesma contagem de erros.
        // Nada vem antes dela, nem a comparação com a senha nova: a resposta de senha errada custa o que custa uma entrada errada (RN-COFRE-013).
        var matched = CheckPassword(open, currentPassword);
        if (matched.IsFailure)
            return matched.Error;

        if (!matched.Value)
            return EVaultError.CurrentPasswordInvalid;

        if (string.Equals(currentPassword, newPassword, StringComparison.Ordinal))
            return EVaultError.PasswordUnchanged;

        var newJournalKey = VaultCrypto.NewKey();
        if (beforeSave is not null && !await beforeSave(newJournalKey, cancellationToken))
        {
            CryptographicOperations.ZeroMemory(newJournalKey);

            return EVaultError.Unavailable;
        }

        // RN-COFRE-003 e 013: chave do cofre nova, do mesmo gerador da criação. Quem tem a senha antiga e uma cópia antiga do arquivo tira dela a chave
        // ANTIGA, que não decifra nada do que for gravado daqui para a frente. E RN-COFRE-002 e 013: sal novo e parâmetros nunca mais fracos que os do arquivo
        // (campo a campo, o maior entre o do arquivo e o das opções): um cofre criado com parâmetros mais fracos passa a ter os atuais, e um criado com parâmetros
        // mais fortes não é rebaixado.
        var key = newKey();
        var kdf = NewKdf(open.File.Kdf);
        var associatedData = VaultCrypto.AssociatedData(open.File.Version, kdf);
        var passwordKey = deriveKey(newPassword, kdf);
        var wrappedKey = VaultCrypto.Seal(passwordKey, key, associatedData);
        CryptographicOperations.ZeroMemory(passwordKey);

        var oldJournalKey = open.Document.Journal?.Key;
        var updatedDocument = open.Document with { Journal = new VaultJournalRecord(newJournalKey, DateTimeOffset.UtcNow) };
        var file = open.File with { Kdf = kdf, WrappedKey = wrappedKey, Payload = Seal(key, updatedDocument, associatedData) };

        // Gravação de sempre (RN-COFRE-005): atômica, e a versão anterior vai para o `.bak`. Se ela falha, a chave nova nunca chega ao `_open`: o disco e a
        // memória seguem com a chave e a senha antigas.
        if (client.Write(open.UserName, file, cancellationToken).IsFailure)
        {
            CryptographicOperations.ZeroMemory(key);
            if (onSaveFailed is not null)
                await onSaveFailed(cancellationToken);

            CryptographicOperations.ZeroMemory(newJournalKey);

            return EVaultError.Unavailable;
        }

        // A geração e o aviso `Locked` ficam como estão: o cofre aberto é o mesmo, e as sessões com os bancos não caem. A chave
        // antiga é zerada só depois de o `_open` valer com a nova. A troca já valeu aqui, no disco e na memória.
        _open = open with { Key = key, File = file, Document = updatedDocument };
        CryptographicOperations.ZeroMemory(open.Key);
        if (oldJournalKey is not null)
            CryptographicOperations.ZeroMemory(oldJournalKey);

        // RN-COFRE-013: a segunda gravação do MESMO arquivo. O `File.Replace` dela deixa o `.bak` igual ao principal novo; sem ela o `.bak` seria o principal
        // de antes, com a chave e o embrulho antigos, e se o principal sumisse (RN-COFRE-005 promove o `.bak`) a senha antiga voltaria a abrir o cofre. Se
        // só ela falha, a troca continua valendo (sucesso) e o aviso diz o que se sabe: a cópia pode não estar atualizada (a falha pode ter parado entre as duas
        // trocas de nome, e então o `.bak` já é o novo), e a próxima entrada a refaz (`HealBackup`). O aviso leva só a classe da falha, sem aspas: nenhuma senha,
        // nenhum nome de usuário e nenhuma exceção (RN-LOG-001).
        var refreshed = client.Write(open.UserName, file, cancellationToken);
        if (refreshed.IsFailure)
            _logger.Warning("A cópia de segurança do cofre pode não estar atualizada depois da troca de senha ({Failure:l}); será refeita na próxima entrada.", refreshed.Error.ToString());

        return UnitResult.Success<EVaultError>();
    }

    /// <summary>
    /// RN-CONN-002 e 003: a única conferência da senha do usuário contra o cofre aberto, com o semáforo tomado. A senha certa é a que abre a chave do
    /// cofre gravada no cabeçalho, derivada com os parâmetros dele. Sucesso com `true` quando confere (zera a contagem de erros seguidos), com `false`
    /// quando não confere (conta o erro), e falha `Locked` no quinto erro seguido, já com o cofre fechado. Quem a usa é a revelação da senha de uma
    /// conexão, a troca da senha do usuário e a gravação que marca ou desmarca o somente leitura (RN-PROT-003, `SaveWithPassword`): uma contagem só, e
    /// nenhum segundo jeito de conferir.
    /// </summary>
    private Result<bool, EVaultError> CheckPassword(OpenVault open, string password)
    {
        var key = OpenKey(open.File, password, VaultCrypto.AssociatedData(open.File.Version, open.File.Kdf));
        if (key.IsSuccess)
        {
            CryptographicOperations.ZeroMemory(key.Value);
            _failedVerifications = 0;

            return true;
        }

        // RN-CONN-003 e RN-AUDIT-004: o quinto erro seguido é gravado no diário antes de o cofre fechar, e a resposta passa a ser a de cofre fechado.
        if (++_failedVerifications < MaxFailedVerifications)
            return false;

        FifthFailedVerification?.Invoke();
        Close();

        return EVaultError.Locked;
    }

    /// <summary>
    /// Os parâmetros de derivação de um embrulho novo (RN-COFRE-002): os atuais das opções e um sal aleatório de 16 bytes (a criação, a troca de senha e a derivação
    /// de mentira da entrada). Com <paramref name="floor"/> (os do arquivo, na troca de senha), nunca mais fracos que ele: o maior de cada campo. A relação do Argon2
    /// entre memória e paralelismo (8 KiB por linha) se mantém, porque cada campo vem de um conjunto que já a cumpria.
    /// </summary>
    private VaultKdf NewKdf(VaultKdf? floor = null)
        => new(VaultCrypto.Algorithm, Math.Max(_options.MemoryKiB, floor?.MemoryKiB ?? 0), Math.Max(_options.Iterations, floor?.Iterations ?? 0), Math.Max(_options.Parallelism, floor?.Parallelism ?? 0), RandomNumberGenerator.GetBytes(VaultCrypto.SaltSize));

    /// <summary>
    /// Troca o cofre aberto. A geração sobe DEPOIS de o `_open` valer: quem leu a geração antes do dado e a compara depois não pode
    /// ver a mesma geração com o dado de outro cofre. (Subir antes deixaria um leitor ler a geração nova com o documento velho.)
    /// </summary>
    private void Open(OpenVault open)
    {
        _open = open;
        Interlocked.Increment(ref _generation);
        _openedSinceLastRelease = true;
    }

    private UnitResult<EVaultError> Save(Func<VaultDocument, VaultDocument> change, CancellationToken cancellationToken)
    {
        var open = _open;
        if (open is null)
            return EVaultError.Locked;

        var document = change(open.Document);

        // A mesma instância é "nada a gravar": quem recusa dentro da função devolve o documento que recebeu. Regravar faria o `.bak` igual
        // ao arquivo atual e perderia a versão anterior, que é para isso que ele existe (RN-COFRE-005).
        if (ReferenceEquals(document, open.Document))
            return UnitResult.Success<EVaultError>();

        return Write(open, document, cancellationToken);
    }

    /// <summary>
    /// RN-PROT-003. Tudo com o semáforo tomado: a alteração, a pergunta se ela pede a senha, a conferência e a gravação são do mesmo cofre aberto e do
    /// documento mais recente. A conferência é a de sempre (`CheckPassword`, com a contagem de erros da revelação e da troca de senha); a senha que
    /// falta não é derivada nem contada, e a que vem sem ser pedida não é conferida.
    /// </summary>
    private Result<EPasswordCheck, EVaultError> SaveWithPassword(Func<VaultDocument, VaultDocument> change, Func<VaultDocument, VaultDocument, bool> needsPassword, string? password, CancellationToken cancellationToken)
    {
        var open = _open;
        if (open is null)
            return EVaultError.Locked;

        var document = change(open.Document);
        if (ReferenceEquals(document, open.Document))
            return EPasswordCheck.NotNeeded;

        var check = EPasswordCheck.NotNeeded;
        if (needsPassword(open.Document, document))
        {
            if (string.IsNullOrEmpty(password))
                return EPasswordCheck.Missing;

            var matched = CheckPassword(open, password);
            if (matched.IsFailure)
                return matched.Error;

            if (!matched.Value)
                return EPasswordCheck.Wrong;

            check = EPasswordCheck.Matched;
        }

        var written = Write(open, document, cancellationToken);

        return written.IsSuccess ? check : written.Error;
    }

    /// <summary>A gravação de um documento novo no cofre aberto, com o semáforo tomado: o que o `Save` e o `SaveWithPassword` fazem depois de decidir gravar.</summary>
    private UnitResult<EVaultError> Write(OpenVault open, VaultDocument document, CancellationToken cancellationToken)
    {
        var file = open.File with { Payload = Seal(open.Key, document, VaultCrypto.AssociatedData(open.File.Version, open.File.Kdf)) };

        // A gravação termina aqui, antes de o documento novo valer: se o disco falha, o que estava
        // gravado continua sendo o que o cofre aberto mostra (seção 7 da especificação).
        if (client.Write(open.UserName, file, cancellationToken).IsFailure)
            return EVaultError.Unavailable;

        _open = open with { File = file, Document = document };

        return UnitResult.Success<EVaultError>();
    }

    /// <summary>Deriva a chave da senha com os parâmetros do arquivo (RN-COFRE-004) e tenta abrir com ela a chave do cofre.</summary>
    private Result<byte[], EVaultFileError> OpenKey(VaultFile file, string password, byte[] associatedData)
    {
        var passwordKey = deriveKey(password, file.Kdf);
        var key = client.Open(passwordKey, file.WrappedKey, associatedData);
        CryptographicOperations.ZeroMemory(passwordKey);

        return key;
    }

    /// <summary>RN-COFRE-003: nonce novo a cada gravação (o `Seal` sorteia). O JSON em claro só existe neste buffer, zerado em seguida.</summary>
    private static VaultSealedBox Seal(byte[] key, VaultDocument document, byte[] associatedData)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(document);
        var box = VaultCrypto.Seal(key, plaintext, associatedData);
        CryptographicOperations.ZeroMemory(plaintext);

        return box;
    }

    /// <summary>
    /// RN-COFRE-008, com o semáforo tomado: zera a chave e descarta o documento. O aviso a quem assina
    /// `Locked` sai no `Leave`, depois que o semáforo é liberado.
    /// </summary>
    private bool Close()
    {
        var open = _open;
        if (open is null)
            return false;

        _open = null;
        Interlocked.Increment(ref _generation);
        _failedVerifications = 0;
        CryptographicOperations.ZeroMemory(open.Key);
        _closedSinceLastRelease = true;

        return true;
    }

    /// <summary>O cofre aberto: a chave, o arquivo como está no disco (o cabeçalho é regravado igual a cada gravação) e o documento em claro.</summary>
    private sealed record OpenVault(string UserName, byte[] Key, VaultFile File, VaultDocument Document);

    private readonly struct Exit(VaultService service) : IDisposable
    {
        public void Dispose()
            => service.Leave();
    }
}
