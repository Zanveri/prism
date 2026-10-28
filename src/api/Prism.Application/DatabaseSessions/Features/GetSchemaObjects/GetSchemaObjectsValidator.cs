using FluentValidation;

namespace Prism.Application.DatabaseSessions.Features.GetSchemaObjects;

public sealed class GetSchemaObjectsValidator : AbstractValidator<GetSchemaObjectsCommand>
{
    public GetSchemaObjectsValidator()
    {
        // Seção 6 da especificação: a rota lista tabelas, visões, rotinas ou sequências, e só. O valor é o da query string, e a comparação é exata.
        RuleFor(request => request.Kind).Must(kind => kind is "tables" or "views" or "routines" or "sequences").WithMessage("O tipo de objeto deve ser tables, views, routines ou sequences.").WithErrorCode("OBJECT_KIND_INVALID");
    }
}
