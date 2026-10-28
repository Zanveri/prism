using CSharpFunctionalExtensions;
using Prism.Infrastructure.Plugins.Models;

namespace Prism.Infrastructure.Plugins.Clients;

public interface IPluginSourceClient
{
    Result<PluginManifest, PluginFailure> InspectLocal(string folderPath);

    Task<Result<PluginManifest, PluginFailure>> CloneFromGitAsync(string gitUrl, Func<string, bool> isAlreadyInstalled, CancellationToken cancellationToken);

    Task<Result<PluginManifest, PluginFailure>> PullGitAsync(string pluginID, CancellationToken cancellationToken);

    Result<string, PluginFailure> ReadBundle(string pluginID, string sourceKind, string source);

    void DeleteInstalledDirectory(string pluginID);
}
