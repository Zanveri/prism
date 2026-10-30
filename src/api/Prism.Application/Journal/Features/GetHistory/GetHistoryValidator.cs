using FluentValidation;

namespace Prism.Application.Journal.Features.GetHistory;

public sealed class GetHistoryValidator : AbstractValidator<GetHistoryCommand>
{
    public GetHistoryValidator()
    {
        RuleFor(x => x.ConnectionId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O identificador da conexão é inválido.");

        RuleFor(x => x.Before)
            .GreaterThan(0)
            .When(x => x.Before.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O cursor de paginação deve ser positivo.");

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 200)
            .When(x => x.Limit.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O limite do histórico deve estar entre 1 e 200.");
    }
}
