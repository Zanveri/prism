using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Features.GetResultCells;

/// <summary>
/// RN-SQL-017: de 1 a 10.000 células por pedido, cada uma com linha e coluna não negativas; senão 422 `CELLS_INVALID` no campo. A
/// célula além das linhas entregues ou das colunas do resultado é o registro de sessões quem recusa, com o mesmo código.
/// </summary>
public sealed class GetResultCellsValidator : AbstractValidator<GetResultCellsCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>GetResultCellsValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GetResultCellsValidator));

    private const string ErrorCode = "CELLS_INVALID";

    public GetResultCellsValidator()
    {
        RuleFor(request => request.Cells).Must(cells => cells is { Count: > 0 and <= QueryPaging.MaxCellsPerRequest }).WithMessage(_ => Texts.Get("CellsCountInvalid", QueryPaging.MaxCellsPerRequest)).WithErrorCode(ErrorCode);
        RuleForEach(request => request.Cells).Must(cell => cell is { Row: >= 0, Column: >= 0 }).WithMessage(_ => Texts.Get("CellPositionInvalid")).WithErrorCode(ErrorCode);
    }
}
