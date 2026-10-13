using FluentValidation;
using Prism.Application.Workspaces.Models;

namespace Prism.Application.Workspaces.Features.SaveWorkspace;

public sealed class SaveWorkspaceValidator : AbstractValidator<SaveWorkspaceCommand>
{
    public SaveWorkspaceValidator()
    {
        // Seção 24: a forma de cada aba e o índice dentro da lista são 422 `WORKSPACE_INVALID`; o texto de uma aba acima de 1 MB, 422 `WORKSPACE_TOO_LARGE`.
        RuleForEach(request => request.Tabs).NotNull().WithMessage("Cada aba da lista tem de ser uma aba.").WithErrorCode(WorkspaceRules.InvalidCode);
        RuleForEach(request => request.Tabs).ChildRules(tab =>
        {
            tab.RuleFor(item => item).Must(WorkspaceRules.HasTheShapeOfItsKind).WithMessage("A aba não tem a forma de uma aba de consulta nem de uma aba de tabela.").WithErrorCode(WorkspaceRules.InvalidCode);
            tab.RuleFor(item => item.Database).Must(WorkspaceRules.IsValidDatabase).WithMessage($"O nome do banco deve ter de 1 a {WorkspaceRules.MaxDatabaseLength} caracteres, sem caractere de controle.").WithErrorCode(WorkspaceRules.InvalidCode);
            tab.RuleFor(item => item.Sql).Must(WorkspaceRules.FitsTheLimit).WithMessage("O texto de uma aba passa de 1 MB.").WithErrorCode(WorkspaceRules.TooLargeCode);
        });
        RuleFor(request => request.ActiveIndex).Must((request, activeIndex) => WorkspaceRules.IsInTheList(activeIndex, request.Tabs.Count)).WithMessage("A aba ativa tem de ser uma das abas da lista.").WithErrorCode(WorkspaceRules.InvalidCode);
    }
}
