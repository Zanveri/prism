using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using System.Globalization;

namespace Prism.Infrastructure.Journal.Clients;

internal sealed class SignInAttemptsFile(IOptions<VaultOptions> options) : ISignInAttemptsFile
{
    private readonly string _dataDirectory = options.Value.DataDirectory;
    private readonly object _gate = new();

    public void Add(string userName, DateTimeOffset at)
    {
        if (!VaultFileName.IsAllowed(userName))
            return;

        lock (_gate)
        {
            try
            {
                var dir = Path.Combine(_dataDirectory, "journal");
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, $"{userName}.attempts");
                File.AppendAllText(path, at.ToString("O", CultureInfo.InvariantCulture) + Environment.NewLine);
            }
            catch
            {
                // A falha de disco num arquivo auxiliar nunca impede a resposta da entrada.
            }
        }
    }

    public IReadOnlyList<DateTimeOffset> Take(string userName)
    {
        if (!VaultFileName.IsAllowed(userName))
            return [];

        lock (_gate)
        {
            try
            {
                var path = Path.Combine(_dataDirectory, "journal", $"{userName}.attempts");
                if (!File.Exists(path))
                    return [];

                var lines = File.ReadAllLines(path);
                File.Delete(path);

                var attempts = new List<DateTimeOffset>(lines.Length);
                foreach (var line in lines)
                {
                    if (DateTimeOffset.TryParse(line, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
                        attempts.Add(parsed);
                }

                return attempts;
            }
            catch
            {
                return [];
            }
        }
    }
}
