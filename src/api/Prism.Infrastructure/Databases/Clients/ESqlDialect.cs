namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// De que banco é o comando que o <see cref="SqlText"/> lê: muda o que é comentário, o que é texto e o que é controle de transação.
/// É interno desta pasta, e não um modelo: só os drivers o informam.
/// </summary>
internal enum ESqlDialect
{
    PostgreSql,

    /// <summary>Comentário de bloco pode ter outro dentro, como no PostgreSQL; não há `$marca$`, e um comando que começa por `BEGIN` e continua é um bloco composto.</summary>
    Db2,

    /// <summary>Comentário também entre chaves (`{ ... }`); o de bloco não tem outro dentro, e não há `$marca$`.</summary>
    Informix
}
