using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using System.Resources;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// As recusas das rotas de `api/user/transfers` (seção 6 e RN-EXPORT-015 e 016). `EXPORT_OPTIONS_INVALID` e `CONNECTION_CREDENTIALS_MISSING` vêm na forma do
/// erro de campo (`errors` e `errorCodes`), com o caminho do campo em camelCase (`options.rowsPerStatement`, `userName`): a tela o lê como está. Os
/// `EXPORT_*` daqui são os da exportação de dados; os da exportação de conexões (seção 34) são outros, numa rota só dela.
/// </summary>
internal static class TransferJobErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>TransferJobErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(TransferJobErrors));

    public const string OptionsInvalidCode = "EXPORT_OPTIONS_INVALID";

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "TRANSFER_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    /// <summary>RN-EXPORT-016: o limite é de todas as transferências (seção 36), e a recusa diz isso.</summary>
    public static ApiErrorDto LimitReached()
        => ApiErrorDto.CreateConflict(Texts.Get("LimitReachedTitle"), "TRANSFER_LIMIT_REACHED", Texts.Get("LimitReachedDetail"));

    /// <summary>RN-EXPORT-015: a conexão sem usuário ou sem senha, no campo que falta, com a frase do assistente.</summary>
    public static ApiErrorDto CredentialsMissing(bool userNameMissing)
        => userNameMissing
            ? ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CredentialsMissingTitle"), "CONNECTION_CREDENTIALS_MISSING", "userName", Texts.Get("UserNameMissingDetail"))
            : ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("CredentialsMissingTitle"), "CONNECTION_CREDENTIALS_MISSING", "password", Texts.Get("PasswordMissingDetail"));

    /// <summary>RN-ARVORE-006: o banco de dados pedido fora da regra da abertura de uma sessão.</summary>
    public static ApiErrorDto DatabaseNameInvalid()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("DatabaseNameInvalidTitle"), "DATABASE_NAME_INVALID", Texts.Get("DatabaseNameInvalidDetail"));

    /// <summary>RN-EXPORT-011: o Informix não aceita várias linhas num `INSERT … VALUES`.</summary>
    public static ApiErrorDto InformixRowsPerStatement()
        => ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("OptionsInvalidTitle"), OptionsInvalidCode, "options.rowsPerStatement", Texts.Get("InformixRowsDetail"));

    /// <summary>
    /// RN-VAR-032: os `source.params` que não servem ao comando montado, antes do trabalho: os marcadores do texto não batem com os valores (422
    /// `QUERY_PARAMETERS_MISMATCH`, com `markers` e `values`) ou um valor que o banco da conexão não guarda (o código de opções da rota, `invalidCode`, no campo
    /// `source.params[i].value`).
    /// </summary>
    public static ApiErrorDto From(DatabaseFailure failure, string invalidCode)
        => failure.Kind == EDatabaseFailure.ParametersMismatch
            ? ApiErrorDto.CreateUnprocessableEntity(Texts.Get("MarkersMismatchTitle"), "QUERY_PARAMETERS_MISMATCH", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal) { ["markers"] = failure.Markers, ["values"] = failure.Values })
            : ApiErrorDto.CreateUnprocessableEntityOnField(Texts.Get("OptionsInvalidTitle"), invalidCode, failure.Field ?? "source.params", failure.Message);

    /// <summary>RN-EXPORT-002 e 016: o comando recusado pelo texto, antes do trabalho: mais de um comando, o filtro, o que não é leitura.</summary>
    public static ApiErrorDto From(ExportSqlRefusal refusal)
        => refusal.Kind switch
        {
            EExportSqlRefusal.MultipleStatements => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("MultipleStatementsTitle"), "MULTIPLE_STATEMENTS_NOT_SUPPORTED", refusal.Reason),
            EExportSqlRefusal.FilterInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("FilterInvalidTitle"), "FILTER_INVALID", refusal.Reason),
            EExportSqlRefusal.NotRead => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("NotReadTitle"), "EXPORT_SOURCE_NOT_READ", Texts.Get("NotReadDetail", refusal.Reason), new Dictionary<string, object?>(StringComparer.Ordinal) { ["reason"] = refusal.Reason }),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
