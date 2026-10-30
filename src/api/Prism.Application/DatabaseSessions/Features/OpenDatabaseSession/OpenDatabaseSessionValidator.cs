using FluentValidation;
using Prism.Infrastructure.Databases.Models;

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

        // RN-ISOL-001 e 003: qualquer nível conhecido passa aqui; a compatibilidade com o motor e o modo de log da sessão é conferida na sessão.
        RuleFor(request => request.IsolationLevel)
            .Must(level => level is null || IsolationLevels.IsKnown(level))
            .WithMessage("O nível de isolamento informado não é válido.")
            .WithErrorCode("ISOLATION_LEVEL_INVALID");
    }
}
