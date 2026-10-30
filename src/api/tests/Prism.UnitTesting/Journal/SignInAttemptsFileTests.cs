using Microsoft.Extensions.Options;
using Prism.Infrastructure.Journal.Clients;
using Prism.Infrastructure.Vault.Models;

namespace Prism.UnitTesting.Journal;

public sealed class SignInAttemptsFileTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("prism-attempts-").FullName;

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    [Trait("SignInAttemptsFile", "Journal")]
    [Fact(DisplayName = "O arquivo de tentativas guarda só os horários e é apagado ao ser lido")]
    public void AttemptsFile_HoldsOnlyTimes()
    {
        var sut = new SignInAttemptsFile(Options.Create(new VaultOptions { DataDirectory = _tempDir }));
        var t1 = new DateTimeOffset(2026, 10, 30, 14, 2, 0, TimeSpan.FromHours(-3));
        var t2 = new DateTimeOffset(2026, 10, 30, 14, 3, 0, TimeSpan.FromHours(-3));

        sut.Add("marina.costa", t1);
        sut.Add("marina.costa", t2);

        var filePath = Path.Combine(_tempDir, "journal", "marina.costa.attempts");
        Assert.True(File.Exists(filePath));

        var raw = File.ReadAllText(filePath);
        Assert.DoesNotContain("marina.costa", raw, StringComparison.OrdinalIgnoreCase);
        var lines = raw.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, lines.Length);
        foreach (var line in lines)
            Assert.True(DateTimeOffset.TryParse(line, out _));

        var taken = sut.Take("marina.costa");
        Assert.Equal([t1, t2], taken);
        Assert.False(File.Exists(filePath));
        Assert.Empty(sut.Take("marina.costa"));
    }
}
