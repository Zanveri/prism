namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-CAT-005: uma restrição de conferência (`CHECK`) da tabela.</summary>
/// <param name="Expression">A condição, como o banco a descreve.</param>
public sealed record CheckConstraintInfo(string Name, string Expression);
