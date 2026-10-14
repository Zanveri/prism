using FluentValidation;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Features.GetResultCells;

/// <summary>
/// RN-SQL-017: de 1 a 10.000 células por pedido, cada uma com linha e coluna não negativas; senão 422 `CELLS_INVALID` no campo. A
/// célula além das linhas entregues ou das colunas do resultado é o registro de sessões quem recusa, com o mesmo código.
/// </summary>
public sealed class GetResultCellsValidator : AbstractValidator<GetResultCellsCommand>
{
    private const string ErrorCode = "CELLS_INVALID";

    public GetResultCellsValidator()
    {
        RuleFor(request => request.Cells).Must(cells => cells is { Count: > 0 and <= QueryPaging.MaxCellsPerRequest }).WithMessage($"Peça de 1 a {QueryPaging.MaxCellsPerRequest} células.").WithErrorCode(ErrorCode);
        RuleForEach(request => request.Cells).Must(cell => cell is { Row: >= 0, Column: >= 0 }).WithMessage("A linha e a coluna de cada célula contam de zero.").WithErrorCode(ErrorCode);
    }
}
