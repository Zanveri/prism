using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.ConnectionFiles.Models;
using System.Resources;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// As recusas da exportação e da importação de conexões (seções 6 e 34 da especificação), num lugar só. As que a tela mostra num campo vêm na forma do erro
/// de campo (`errors` e `errorCodes`, com o nome da propriedade em PascalCase, como o filtro de validação os devolve): `Passphrase` para a senha de
/// exportação, `UserPassword` para a do Prism, `Content` para o arquivo e `Items` para as chaves marcadas. O detalhe é sempre uma frase do Prism: nenhuma
/// recusa repete o conteúdo do arquivo nem uma senha.
/// </summary>
internal static class TransferErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>TransferErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(TransferErrors));

    /// <summary>RN-TRANSF-006: uma frase só, para um código só: exportar em partes resolve as contagens e o tamanho, e mover resolve os níveis.</summary>
    public static string ExportLimitsMessage => Texts.Get("ExportLimitsMessage");

    /// <summary>RN-TRANSF-010: a frase das etapas 1 e 7, e a que a tela mostra quando recusa o arquivo grande antes de lê-lo.</summary>
    public static string ImportLimitsMessage => Texts.Get("ImportLimitsMessage");

    public static string ExportEmptyMessage => Texts.Get("ExportEmptyMessage");

    public static string ImportEmptyMessage => Texts.Get("ImportEmptyMessage");

    public static string ExportCredentialsInvalidMessage => Texts.Get("ExportCredentialsInvalidMessage");

    public static string ExportDuplicateMessage => Texts.Get("ExportDuplicateMessage");

    /// <summary>As formas de `IMPORT_INVALID` que o arquivo do Prism e a cópia do DBeaver têm em comum.</summary>
    public static string ImportItemsLimitMessage => Texts.Get("ImportItemsLimitMessage");

    public static string ImportItemsDuplicateMessage => Texts.Get("ImportItemsDuplicateMessage");

    public static string ImportConflictInvalidMessage => Texts.Get("ImportConflictInvalidMessage");

    /// <summary>RN-TRANSF-006: as contagens e os níveis, que se sabem com o cofre lido, e o tamanho, que se sabe com o arquivo montado.</summary>
    public static ApiErrorDto ExportLimitsExceeded()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ExportLimitsExceededTitle"), "EXPORT_LIMITS_EXCEEDED", ExportLimitsMessage);

    /// <summary>RN-TRANSF-005: a senha do Prism é pedida (vai ao menos uma senha de banco), e não veio. Nada foi conferido nem contado.</summary>
    public static ApiErrorDto UserPasswordRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("UserPasswordRequiredTitle"), "USER_PASSWORD_REQUIRED", "UserPassword", Texts.Get("UserPasswordRequiredDetail"));

    /// <summary>RN-TRANSF-004: a senha de exportação igual à senha do Prism que veio no pedido e conferiu.</summary>
    public static ApiErrorDto PassphraseEqualsUserPassword()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("PassphraseInvalidTitle"), "EXPORT_PASSPHRASE_INVALID", "Passphrase", Texts.Get("PassphraseEqualsUserPasswordDetail"));

    /// <summary>RN-TRANSF-010: as recusas da leitura do arquivo, na API, traduzidas do client do arquivo.</summary>
    public static ApiErrorDto From(EConnectionFileError error)
        => error switch
        {
            EConnectionFileError.Invalid => FileInvalid(),
            EConnectionFileError.Newer => ApiErrorDto.CreateConflict(Texts.Get("FileNewerTitle"), "IMPORT_FILE_NEWER", Texts.Get("FileNewerDetail")),
            // O AES-GCM não distingue a senha errada do arquivo alterado, e dizer qual seria ajudar quem altera.
            EConnectionFileError.WrongPassphrase => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("PassphraseWrongTitle"), "IMPORT_PASSPHRASE_WRONG", "Passphrase", Texts.Get("PassphraseWrongDetail")),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    public static ApiErrorDto FileInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("FileInvalidTitle"), "IMPORT_FILE_INVALID", "Content", Texts.Get("FileInvalidDetail"));

    public static ApiErrorDto ImportLimitsExceeded()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("ImportLimitsExceededTitle"), "IMPORT_LIMITS_EXCEEDED", "Content", ImportLimitsMessage);

    /// <summary>RN-TRANSF-014: uma chave marcada que o arquivo não tem; só se sabe depois de abri-lo. A tela não deixa chegar a isso.</summary>
    public static ApiErrorDto UnknownItem()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("InvalidTitle"), "IMPORT_INVALID", "Items", Texts.Get("UnknownItemDetail"));
}
