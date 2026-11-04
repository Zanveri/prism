using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// As recusas do "Importar do DBeaver" (seções 6 e 40 da especificação), num lugar só. As que a tela mostra num campo vêm na forma do erro de campo (`errors` e
/// `errorCodes`, com o nome da propriedade em PascalCase): `SourceId`, `WithPasswords`, `DrdaPorts`, `Items` e `Overwrite`. O detalhe é sempre uma frase do
/// Prism: nenhuma recusa repete o conteúdo da cópia, um nome de projeto, uma conexão, um usuário ou uma senha do DBeaver (RN-LOG-001).
/// </summary>
internal static class DbeaverErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>DbeaverErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(DbeaverErrors));

    /// <summary>RN-DBEAVER-007: a frase do limite, e o que se acrescenta quando há mais de um projeto na origem.</summary>
    public static string LimitsMessage => Texts.Get("LimitsMessage");

    public static string LimitsMessageWithManyProjects => Texts.Get("LimitsMessageManyProjects");

    /// <summary>As frases de `IMPORT_INVALID` que os validators do "Importar do DBeaver" dão ao campo.</summary>
    public static string SourceIdInvalidMessage => Texts.Get("SourceIdInvalidMessage");

    public static string WithPasswordsInvalidMessage => Texts.Get("WithPasswordsInvalidMessage");

    public static string DrdaPortsInvalidMessage => Texts.Get("DrdaPortsInvalidMessage");

    public static string OverwriteInvalidMessage => Texts.Get("OverwriteInvalidMessage");

    /// <summary>Nota de seção 6: a cópia que não existe (apagada, de outra execução, ou com o manifesto ausente). A tela pede outra origem sozinha.</summary>
    public static ApiErrorDto SourceMissing()
        => ApiErrorDto.CreateNotFound(Texts.Get("SourceMissingTitle"), "DBEAVER_SOURCE_MISSING", Texts.Get("SourceMissingDetail"));

    /// <summary>Nenhum projeto da cópia pôde ser lido: os `data-sources*.json` malformados, ou todos os projetos protegidos ou com nome que o Prism não aceita.</summary>
    public static ApiErrorDto SourceInvalid()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("SourceInvalidTitle"), "DBEAVER_SOURCE_INVALID", Texts.Get("SourceInvalidDetail"));

    /// <summary>O projeto que não está no manifesto, ou está protegido por senha de projeto, ou tem o nome que o Prism não aceita.</summary>
    public static ApiErrorDto ProjectNotFound()
        => ApiErrorDto.CreateNotFound(Texts.Get("ProjectNotFoundTitle"), "DBEAVER_PROJECT_NOT_FOUND", Texts.Get("ProjectNotFoundDetail"));

    public static ApiErrorDto LimitsExceeded(bool manyProjects)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("LimitsExceededTitle"), "DBEAVER_LIMITS_EXCEEDED", manyProjects ? LimitsMessageWithManyProjects : LimitsMessage);

    public static ApiErrorDto SourceIdInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("InvalidTitle"), "IMPORT_INVALID", "SourceId", SourceIdInvalidMessage);

    /// <summary>RN-DBEAVER-016: uma chave marcada que a cópia não tem. A tela não deixa chegar a isso.</summary>
    public static ApiErrorDto UnknownItem()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("InvalidTitle"), "IMPORT_INVALID", "Items", Texts.Get("UnknownItemDetail"));

    /// <summary>RN-DBEAVER-017: uma chave de `overwrite` que não é de uma conexão marcada (a que não está em `items`, ou é de pasta).</summary>
    public static ApiErrorDto UnknownOverwrite()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("InvalidTitle"), "IMPORT_INVALID", "Overwrite", Texts.Get("UnknownOverwriteDetail"));
}
