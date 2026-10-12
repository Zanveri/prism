namespace Prism.Infrastructure.Databases.Models;

public sealed record DatabaseSessionInfo(Guid ID, Guid ConnectionID, EDatabaseEngine Engine, string Database, string ServerVersion);
