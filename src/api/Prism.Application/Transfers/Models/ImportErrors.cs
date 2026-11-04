using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Services;
using System.Resources;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// As recusas das rotas da importação de dados (seção 36, "Rotas e respostas"). `IMPORT_OPTIONS_INVALID`, `IMPORT_MAPPING_INVALID` e
/// `CONNECTION_CREDENTIALS_MISSING` vêm na forma do erro de campo (`errors` e `errorCodes`), com o caminho do campo em camelCase (`reader.nullText`,
/// `mapping[3].source`, `userName`). `IMPORT_FILE_UNREADABLE` leva `reason` e `line` (ou nulo). Os `IMPORT_*` daqui são os da importação de dados; os da
/// importação de conexões (seção 34) são outros, numa rota só dela, e nenhum nome se repete.
/// </summary>
internal static class ImportErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>ImportErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ImportErrors));

    public const string OptionsInvalidCode = "IMPORT_OPTIONS_INVALID";
    public const string MappingInvalidCode = "IMPORT_MAPPING_INVALID";

    /// <summary>RN-IMPORT-013 e 017: o arquivo não está mais na pasta (a tela o soltou, a API reiniciou).</summary>
    public static ApiErrorDto FileMissing()
        => ApiErrorDto.CreateNotFound(Texts.Get("FileMissingTitle"), "IMPORT_FILE_MISSING", Texts.Get("FileMissingDetail"));

    /// <summary>RN-IMPORT-008: o arquivo passa de 2 GiB.</summary>
    public static ApiErrorDto FileTooLarge(string message)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("FileTooLargeTitle"), "IMPORT_FILE_TOO_LARGE", message);

    /// <summary>RN-IMPORT-004 a 008: a leitura que não segue, com o motivo e a linha (ou nulo), e a frase da regra, sem caminho.</summary>
    public static ApiErrorDto Unreadable(ImportReadFailure failure)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("UnreadableTitle"), "IMPORT_FILE_UNREADABLE", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["reason"] = ReasonText(failure.Reason),
            ["line"] = failure.Line
        });

    /// <summary>RN-IMPORT-009: a tabela de destino não existe mais.</summary>
    public static ApiErrorDto TableNotFound(string message)
        => ApiErrorDto.CreateNotFound(Texts.Get("TableNotFoundTitle"), "IMPORT_TABLE_NOT_FOUND", message);

    /// <summary>RN-IMPORT-009: o que não é uma tabela comum, com o motivo nos termos da edição.</summary>
    public static ApiErrorDto NotATable(string message)
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("NotATableTitle"), "IMPORT_TARGET_NOT_TABLE", message);

    /// <summary>RN-IMPORT-009: a posição além das colunas do arquivo, a coluna que a tabela não tem, a calculada pelo banco e a de um tipo que não se importa.</summary>
    public static ApiErrorDto MappingInvalid(string field, string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("MappingInvalidTitle"), MappingInvalidCode, field, message);

    /// <summary>RN-PROT-002 e RN-IMPORT-009: a conexão de destino é somente leitura, e nada foi ao banco.</summary>
    public static ApiErrorDto ReadOnly()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ReadOnlyTitle"), "CONNECTION_READ_ONLY", Texts.Get("ReadOnlyDetail"));

    /// <summary>
    /// RN-IMPORT-014: a tabela de destino já recebe linhas de outra importação ou cópia em andamento (a mesma tabela pela regra da própria origem,
    /// RN-IMPORT-023).
    /// </summary>
    public static ApiErrorDto TargetBusy(bool copy, string schema, string table)
        => ApiErrorDto.CreateConflict(Texts.Get("TargetBusyTitle"), "IMPORT_TARGET_BUSY", Texts.Get(copy ? "TargetBusyCopyDetail" : "TargetBusyImportDetail", schema, table));

    /// <summary>RN-IMPORT-023: a tabela de destino da cópia é a própria origem: a leitura veria as linhas que a cópia grava.</summary>
    public static ApiErrorDto TargetIsSource()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("TargetIsSourceTitle"), "IMPORT_TARGET_IS_SOURCE", Texts.Get("TargetIsSourceDetail"));

    /// <summary>RN-IMPORT-025: a conexão de origem ou de destino da cópia sem usuário ou sem senha, no campo dela (`source.userName`, `target.password`).</summary>
    public static ApiErrorDto CopyCredentialsMissing(bool source, bool userNameMissing)
    {
        var side = source ? "source" : "target";
        var title = Texts.Get("CredentialsMissingTitle");

        return userNameMissing
            ? ApiErrorDto.CreateUnprocessableEntityOnField(title, "CONNECTION_CREDENTIALS_MISSING", $"{side}.userName", Texts.Get(source ? "SourceUserNameMissingDetail" : "TargetUserNameMissingDetail"))
            : ApiErrorDto.CreateUnprocessableEntityOnField(title, "CONNECTION_CREDENTIALS_MISSING", $"{side}.password", Texts.Get(source ? "SourcePasswordMissingDetail" : "TargetPasswordMissingDetail"));
    }

    /// <summary>RN-IMPORT-013 e RN-EXPORT-015: a conexão sem usuário ou sem senha, no campo que falta, com "importe de novo".</summary>
    public static ApiErrorDto CredentialsMissing(bool userNameMissing)
        => userNameMissing
            ? ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CredentialsMissingTitle"), "CONNECTION_CREDENTIALS_MISSING", "userName", Texts.Get("UserNameMissingDetail"))
            : ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CredentialsMissingTitle"), "CONNECTION_CREDENTIALS_MISSING", "password", Texts.Get("PasswordMissingDetail"));

    /// <summary>O arquivo copiado que não pôde ser lido e não trouxe o motivo (RN-IMPORT-004 a 008).</summary>
    public static string CopiedFileUnreadable()
        => Texts.Get("CopiedFileUnreadable");

    public static ApiErrorDto From(ImportPreviewFailure failure)
        => failure.Kind switch
        {
            EImportPreviewFailure.FileMissing => FileMissing(),
            EImportPreviewFailure.FileTooLarge => FileTooLarge(failure.Message),
            EImportPreviewFailure.Unreadable => Unreadable(failure.Read!),
            EImportPreviewFailure.Database => DatabaseSessionErrors.From(failure.Database!),
            EImportPreviewFailure.TableNotFound => TableNotFound(failure.Message),
            EImportPreviewFailure.NotATable => NotATable(failure.Message),
            EImportPreviewFailure.MappingInvalid => MappingInvalid(failure.Field!, failure.Message),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    /// <summary>As notas da seção 36: o motivo de `IMPORT_FILE_UNREADABLE` em camelCase.</summary>
    public static string ReasonText(EImportReadReason reason)
        => reason switch
        {
            EImportReadReason.Encoding => "encoding",
            EImportReadReason.Format => "format",
            EImportReadReason.Sheet => "sheet",
            EImportReadReason.Limits => "limits",
            EImportReadReason.System => "system",
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    /// <summary>RN-IMPORT-008: o tamanho grande demais, na frase da regra.</summary>
    public static ApiErrorDto FileTooLarge(ImportFileRefusal refusal)
        => FileTooLarge(ImportText.TooLarge(refusal.Size));
}
