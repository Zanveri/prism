using FluentValidation;
using Prism.Application.DatabaseSessions.Models;

namespace Prism.Application.DatabaseSessions.Features.CountWholeColumn;

/// <summary>RN-EDIT-023: o que vale para os outros pedidos da edição; a recusa da alteração que não é a coluna inteira é do registro de sessões, com o `change` dela.</summary>
public sealed class CountWholeColumnValidator : AbstractValidator<CountWholeColumnCommand>
{
    public CountWholeColumnValidator()
    {
        RuleFor(request => request.ResultID).MustNameTheResult();
        RuleFor(request => request.Changes).MustBeChanges();
    }
}
