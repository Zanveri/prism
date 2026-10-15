namespace Prism.Infrastructure.Databases.Models;

/// <summary>RN-ARVORE-006: um banco do servidor a que a conta pode se conectar.</summary>
/// <param name="Name">O nome como o servidor o guarda.</param>
/// <param name="IsCurrent">Se é o banco da sessão que listou: o da conexão, que a árvore marca como o padrão.</param>
public sealed record DatabaseInfo(string Name, bool IsCurrent);
