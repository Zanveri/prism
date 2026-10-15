using FluentValidation;
using Prism.Application.DatabaseSessions.Models.Dtos;

namespace Prism.Application.DatabaseSessions.Models;

/// <summary>
/// RN-EDIT-004 e seção 22: o que todo pedido de edição precisa ter, recusado com 422 `EDIT_INVALID` no campo antes de chegar ao
/// registro de sessões. Se a alteração se aplica ao resultado (a tabela, a chave, as colunas) é o registro quem diz, com a posição dela.
/// </summary>
internal static class EditChangeRules
{
    public const string ErrorCode = "EDIT_INVALID";

    private static readonly string[] Kinds = ["update", "delete", "insert"];

    public static void MustNameTheResult<T>(this IRuleBuilder<T, Guid> rule)
        => rule.NotEqual(Guid.Empty).WithMessage("Informe o resultado (resultID) da página que está sendo editada.").WithErrorCode(ErrorCode);

    public static void MustBeChanges<T>(this IRuleBuilder<T, IReadOnlyList<EditChangeDto>?> rule)
    {
        rule.Must(changes => changes is { Count: > 0 }).WithMessage("Informe ao menos uma alteração.").WithErrorCode(ErrorCode);
        rule.ForEach(change => change.ChildRules(item => item.RuleFor(dto => dto.Kind).Must(kind => Kinds.Contains(kind, StringComparer.Ordinal)).WithMessage("O tipo da alteração deve ser update, delete ou insert.").WithErrorCode(ErrorCode)));
    }
}
