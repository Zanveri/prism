using FluentValidation;
using Prism.Application.Workspaces.Models;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Workspaces.Features.SaveWorkspace;

public sealed class SaveWorkspaceValidator : AbstractValidator<SaveWorkspaceCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>SaveWorkspaceValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(SaveWorkspaceValidator));

    public SaveWorkspaceValidator()
    {
        // Seção 24: a forma de cada aba e o índice dentro da lista são 422 `WORKSPACE_INVALID`; o texto de uma aba acima de 1 MB, 422 `WORKSPACE_TOO_LARGE`.
        RuleForEach(request => request.Tabs).NotNull().WithMessage(_ => Texts.Get("TabNull")).WithErrorCode(WorkspaceRules.InvalidCode);
        RuleForEach(request => request.Tabs).ChildRules(tab =>
        {
            tab.RuleFor(item => item).Must(WorkspaceRules.HasTheShapeOfItsKind).WithMessage(_ => Texts.Get("TabShape")).WithErrorCode(WorkspaceRules.InvalidCode);
            tab.RuleFor(item => item.Database).Must(WorkspaceRules.IsValidDatabase).WithMessage(_ => Texts.Get("DatabaseInvalid", WorkspaceRules.MaxDatabaseLength)).WithErrorCode(WorkspaceRules.InvalidCode);
            tab.RuleFor(item => item.Sql).Must(WorkspaceRules.FitsTheLimit).WithMessage(_ => Texts.Get("TabTooLarge")).WithErrorCode(WorkspaceRules.TooLargeCode);
        });
        RuleFor(request => request.ActiveIndex).Must((request, activeIndex) => WorkspaceRules.IsInTheList(activeIndex, request.Tabs.Count)).WithMessage(_ => Texts.Get("ActiveIndexInvalid")).WithErrorCode(WorkspaceRules.InvalidCode);
    }
}
