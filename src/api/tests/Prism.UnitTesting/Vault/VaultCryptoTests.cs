using Bogus;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Xunit.Abstractions;

namespace Prism.UnitTesting.Vault;

public sealed class VaultCryptoTests(ITestOutputHelper output)
{
    private readonly Faker _faker = new();

    [Trait("VaultCrypto", "DeriveKey")]
    [Fact(DisplayName = "Mesma senha e mesmo sal dão a mesma chave de 32 bytes")]
    public void DeriveKey_SamePasswordAndSalt_ReturnsSameKey()
    {
        //Arrange
        var password = _faker.Internet.Password(length: 16);
        var kdf = VaultFakers.CreateKdf();

        //Act
        var first = VaultCrypto.DeriveKey(password, kdf);
        var second = VaultCrypto.DeriveKey(password, kdf);

        //Assert
        Assert.Equal(32, first.Length);
        Assert.Equal(first, second);
    }

    /// <summary>
    /// Quem entra com a senha em branco precisa de um 401 como qualquer senha errada, com a mesma
    /// derivação (RN-COFRE-006), e o Argon2 da biblioteca recusa senha vazia com exceção.
    /// </summary>
    [Trait("VaultCrypto", "DeriveKey")]
    [Fact(DisplayName = "Senha vazia também deriva uma chave de 32 bytes, diferente da de uma senha qualquer")]
    public void DeriveKey_EmptyPassword_ReturnsAKeyInsteadOfThrowing()
    {
        //Arrange
        var kdf = VaultFakers.CreateKdf();

        //Act
        var empty = VaultCrypto.DeriveKey(string.Empty, kdf);
        var other = VaultCrypto.DeriveKey(_faker.Internet.Password(length: 16), kdf);

        //Assert
        Assert.Equal(32, empty.Length);
        Assert.NotEqual(empty, other);
    }

    [Trait("VaultCrypto", "DeriveKey")]
    [Fact(DisplayName = "Outro sal dá outra chave para a mesma senha")]
    public void DeriveKey_DifferentSalt_ReturnsDifferentKey()
    {
        //Arrange
        var password = _faker.Internet.Password(length: 16);

        //Act
        var first = VaultCrypto.DeriveKey(password, VaultFakers.CreateKdf());
        var second = VaultCrypto.DeriveKey(password, VaultFakers.CreateKdf());

        //Assert
        Assert.NotEqual(first, second);
    }

    /// <summary>
    /// Vetor da implementação de referência do Argon2 (phc-winner-argon2, `test.c`, Argon2id v1.3):
    /// prova que memória em KiB, passadas e paralelismo chegam à biblioteca no lugar certo, e que a
    /// chave é a de qualquer outro Argon2id com os mesmos parâmetros.
    /// </summary>
    [Trait("VaultCrypto", "DeriveKey")]
    [Fact(DisplayName = "A chave é a do vetor de teste da implementação de referência do Argon2id")]
    public void DeriveKey_ReferenceVector_ReturnsTheKnownKey()
    {
        //Arrange
        var kdf = new VaultKdf("argon2id", 65536, 2, 1, Encoding.UTF8.GetBytes("somesalt"));

        //Act
        var key = VaultCrypto.DeriveKey("password", kdf);

        //Assert
        Assert.Equal("09316115D5CF24ED5A15A31A3BA326E5CF32EDC24702987C02B6566F61913CF7", Convert.ToHexString(key));
    }

    /// <summary>
    /// O único teste com os parâmetros de produção (RN-COFRE-002): o tempo medido aqui é o que a pessoa
    /// espera ao entrar, e vai para o relatório da tarefa. Os demais usam os parâmetros pequenos do faker.
    /// </summary>
    [Trait("VaultCrypto", "DeriveKey")]
    [Fact(DisplayName = "Com os parâmetros padrão (64 MiB, 3 passadas, paralelismo 4) deriva em menos de dois segundos")]
    public void DeriveKey_WithDefaultParameters_TakesUnderTwoSeconds()
    {
        //Arrange
        var defaults = new VaultOptions();
        var kdf = new VaultKdf("argon2id", defaults.MemoryKiB, defaults.Iterations, defaults.Parallelism, _faker.Random.Bytes(16));
        var stopwatch = Stopwatch.StartNew();

        //Act
        var key = VaultCrypto.DeriveKey(_faker.Internet.Password(length: 16), kdf);
        stopwatch.Stop();

        //Assert
        output.WriteLine($"Argon2id com {kdf.MemoryKiB} KiB, {kdf.Iterations} passadas e paralelismo {kdf.Parallelism}: {stopwatch.ElapsedMilliseconds} ms");
        Assert.Equal((65536, 3, 4), (kdf.MemoryKiB, kdf.Iterations, kdf.Parallelism));
        Assert.Equal(32, key.Length);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2), $"A derivação levou {stopwatch.ElapsedMilliseconds} ms.");
    }

    [Trait("VaultCrypto", "AssociatedData")]
    [Fact(DisplayName = "O dado autenticado é o cabeçalho, no formato que os cofres já gravados usam")]
    public void AssociatedData_ShouldFollowTheHeaderFormat()
    {
        //Arrange
        var salt = _faker.Random.Bytes(16);
        var kdf = new VaultKdf("argon2id", 65536, 3, 4, salt);

        //Act
        var associatedData = VaultCrypto.AssociatedData(1, kdf);

        //Assert
        Assert.Equal($"prism-vault|1|argon2id|65536|3|4|{Convert.ToBase64String(salt)}", Encoding.UTF8.GetString(associatedData));
    }

    [Trait("VaultCrypto", "Seal")]
    [Fact(DisplayName = "O que foi cifrado abre com a mesma chave e o mesmo dado autenticado")]
    public void Seal_ThenOpen_ReturnsOriginalBytes()
    {
        //Arrange
        var key = RandomNumberGenerator.GetBytes(32);
        var plaintext = _faker.Random.Bytes(200);
        var associatedData = _faker.Random.Bytes(40);

        //Act
        var box = VaultCrypto.Seal(key, plaintext, associatedData);
        var opened = VaultCrypto.Open(key, box, associatedData);

        //Assert
        Assert.Equal(plaintext, opened);
        Assert.NotEqual(plaintext, box.Ciphertext);
        Assert.Equal(12, box.Nonce.Length);
        Assert.Equal(16, box.Tag.Length);
    }

    [Trait("VaultCrypto", "Seal")]
    [Fact(DisplayName = "Cada cifragem sorteia um nonce novo")]
    public void Seal_Twice_UsesDifferentNonces()
    {
        //Arrange
        var key = RandomNumberGenerator.GetBytes(32);
        var plaintext = _faker.Random.Bytes(200);
        var associatedData = _faker.Random.Bytes(40);

        //Act
        var first = VaultCrypto.Seal(key, plaintext, associatedData);
        var second = VaultCrypto.Seal(key, plaintext, associatedData);

        //Assert
        Assert.NotEqual(first.Nonce, second.Nonce);
        Assert.NotEqual(first.Ciphertext, second.Ciphertext);
    }

    /// <summary>
    /// O `AesGcm` só sabe recusar por exceção, e aqui ela sai como veio: quem a transforma em falha é o
    /// `Send` do client (`VaultFileClientTests.Open_WithWrongKey_ReturnsCorrupt`).
    /// </summary>
    [Trait("VaultCrypto", "Open")]
    [Fact(DisplayName = "Erro outra chave não abre")]
    public void Open_WithWrongKey_Fails()
    {
        //Arrange
        var associatedData = _faker.Random.Bytes(40);
        var box = VaultCrypto.Seal(RandomNumberGenerator.GetBytes(32), _faker.Random.Bytes(200), associatedData);

        //Act
        var exception = Record.Exception(() => VaultCrypto.Open(RandomNumberGenerator.GetBytes(32), box, associatedData));

        //Assert
        Assert.IsType<AuthenticationTagMismatchException>(exception);
    }

    [Trait("VaultCrypto", "Open")]
    [Fact(DisplayName = "Erro dado autenticado alterado não abre")]
    public void Open_WithChangedAssociatedData_Fails()
    {
        //Arrange
        var key = RandomNumberGenerator.GetBytes(32);
        var associatedData = _faker.Random.Bytes(40);
        var box = VaultCrypto.Seal(key, _faker.Random.Bytes(200), associatedData);
        associatedData[0] ^= 0x01;

        //Act
        var exception = Record.Exception(() => VaultCrypto.Open(key, box, associatedData));

        //Assert
        Assert.IsType<AuthenticationTagMismatchException>(exception);
    }
}
