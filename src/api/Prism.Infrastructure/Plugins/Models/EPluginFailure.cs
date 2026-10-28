namespace Prism.Infrastructure.Plugins.Models;

public enum EPluginFailure
{
    SourceInvalid,
    ManifestInvalid,
    AlreadyInstalled,
    GitFailed,
    BundleUnavailable
}
