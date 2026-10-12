using CSharpFunctionalExtensions;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.Vault.Clients;

/// <summary>
/// O que no cofre pode falhar por fora do código: o disco e a abertura da cifra. Nenhuma exceção sai
/// daqui; a falha volta como <see cref="EVaultFileError"/>.
/// </summary>
public interface IVaultFileClient
{
    /// <summary>
    /// Lê o arquivo do cofre do usuário. Arquivo que não existe é sucesso vazio, e não falha; arquivo
    /// que existe e não é um cofre legível é `Corrupt`; `Unavailable` é só falha de disco. Um cofre que
    /// uma queda deixou só no `.bak` volta antes a ser o arquivo principal (RN-COFRE-005), então "não
    /// existe" quer dizer que não há nem um nem outro. Um cofre cujo cabeçalho declara um formato MAIS
    /// NOVO que o conhecido é `NewerFormat` (RN-VERSAO-005), conferido antes de tudo o mais: nada dele é
    /// promovido, aberto nem regravado, e o `.bak` de formato mais novo também fica onde está.
    /// </summary>
    Result<Maybe<VaultFile>, EVaultFileError> Read(string userName);

    /// <summary>
    /// RN-COFRE-013: lê o `.bak` do usuário, e só ele: não o promove, não o regrava e não olha o principal. É por onde o serviço confere, a cada entrada,
    /// se a cópia de segurança está embrulhada pela mesma senha do principal. Sem `.bak` é sucesso vazio; `Corrupt` é o que a leitura recusaria (JSON
    /// quebrado, forma errada, parâmetro acima do teto), e `NewerFormat` é o de formato mais novo que o conhecido (RN-VERSAO-005): nos dois o `.bak` fica onde está.
    /// </summary>
    Result<Maybe<VaultFile>, EVaultFileError> ReadBackup(string userName);

    /// <summary>
    /// RN-COFRE-005: grava o arquivo inteiro de forma atômica e guarda a versão anterior como `.bak`.
    /// Quando volta, a gravação já terminou: nada fica pendente para depois. Um arquivo que o
    /// <see cref="Read"/> recusaria (forma errada, parâmetro acima do teto) não é gravado, e volta `Corrupt`.
    /// RN-COFRE-013: quando outro programa segura o arquivo (antivírus, cópia de segurança), a gravação é tentada de novo, até cinco vezes e com
    /// espera crescente que soma menos de um segundo; o <paramref name="cancellationToken"/> pedido interrompe as novas tentativas (a primeira sempre acontece).
    /// </summary>
    UnitResult<EVaultFileError> Write(string userName, VaultFile file, CancellationToken cancellationToken = default);

    /// <summary>
    /// Abre o que <see cref="VaultCrypto.Seal"/> cifrou. Chave errada e conteúdo adulterado voltam como
    /// `Corrupt`: é por aqui, e não direto no <see cref="VaultCrypto"/>, que o serviço tenta uma senha.
    /// </summary>
    Result<byte[], EVaultFileError> Open(byte[] key, VaultSealedBox box, byte[] associatedData);
}
