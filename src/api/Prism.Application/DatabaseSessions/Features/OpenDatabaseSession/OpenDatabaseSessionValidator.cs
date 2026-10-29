using FluentValidation;

namespace Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;

public sealed class OpenDatabaseSessionValidator : AbstractValidator<OpenDatabaseSessionCommand>
{
    /// <summary>O teto do nome de outro banco (seção 6 da especificação), em caracteres.</summary>
    private const int MaxDatabaseLength = 128;

    public OpenDatabaseSessionValidator()
    {
        // RN-ARVORE-006 e seção 6: sem o campo vale o banco da conexão; com ele, o nome não pode ser vazio, passar de 128 caracteres nem ter
        // caractere de controle. O resto (espaço, aspas, `@`, acento) vai ao driver como está, pelo construtor da string de conexão.
        RuleFor(request => request.Database)
            .Must(database => database is null || (!string.IsNullOrWhiteSpace(database) && database.Length <= MaxDatabaseLength && !database.Any(char.IsControl)))
            .WithMessage($"O nome do banco deve ter de 1 a {MaxDatabaseLength} caracteres, sem caractere de controle.")
            .WithErrorCode("DATABASE_NAME_INVALID");

        // Seção 22 da especificação: as mesmas recusas do `PATCH` da sessão.
        RuleFor(request => request.TransactionMode)
            .Must(mode => mode is null or "autoCommit" or "manual")
            .WithMessage("O modo de transação deve ser autoCommit ou manual.")
            .WithErrorCode("TRANSACTION_MODE_INVALID");

        RuleFor(request => request.IsolationLevel)
            .Must(level => level is null or "default")
            .WithMessage("O nível de isolamento deve ser default.")
            .WithErrorCode("ISOLATION_LEVEL_INVALID");
    }
}
