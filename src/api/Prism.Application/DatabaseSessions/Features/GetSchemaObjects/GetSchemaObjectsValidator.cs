using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.DatabaseSessions.Features.GetSchemaObjects;

public sealed class GetSchemaObjectsValidator : AbstractValidator<GetSchemaObjectsCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>GetSchemaObjectsValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GetSchemaObjectsValidator));

    public GetSchemaObjectsValidator()
    {
        // Seção 6 da especificação: a rota lista tabelas, visões, rotinas ou sequências, e só. O valor é o da query string, e a comparação é exata.
        RuleFor(request => request.Kind).Must(kind => kind is "tables" or "views" or "routines" or "sequences").WithMessage(_ => Texts.Get("ObjectKindInvalid")).WithErrorCode("OBJECT_KIND_INVALID");
    }
}
