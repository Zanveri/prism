using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Scripts.Models;

namespace Prism.Application.Scripts.Features.SaveScriptRunValues;

/// <summary>RN-VAR-028: a forma de `values`, com `SCRIPT_RUN_VALUES_INVALID` no campo (`values`, `values.cliente.type`, `values.status.items[1].value`).</summary>
public sealed class SaveScriptRunValuesValidator : AbstractValidator<SaveScriptRunValuesCommand>
{
    public SaveScriptRunValuesValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            foreach (var (field, message) in ScriptVariablesRules.RunValuesRefusals(request.Values))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ScriptVariablesRules.InvalidCode });
        });
}
