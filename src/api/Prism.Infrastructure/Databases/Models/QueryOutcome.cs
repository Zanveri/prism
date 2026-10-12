namespace Prism.Infrastructure.Databases.Models;

/// <summary>O desfecho de um comando: a primeira página, quando ele devolve linhas, ou as linhas afetadas, quando não devolve (RN-SQL-008). Um dos dois sempre vem.</summary>
public sealed record QueryOutcome(QueryPage? Page, long? RowsAffected, long ElapsedMs);
