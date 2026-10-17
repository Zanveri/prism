using Prism.Application.DatabaseSessions.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Services;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// As recusas das rotas da importação de dados (seção 36, "Rotas e respostas"). `IMPORT_OPTIONS_INVALID`, `IMPORT_MAPPING_INVALID` e
/// `CONNECTION_CREDENTIALS_MISSING` vêm na forma do erro de campo (`errors` e `errorCodes`), com o caminho do campo em camelCase (`reader.nullText`,
/// `mapping[3].source`, `userName`). `IMPORT_FILE_UNREADABLE` leva `reason` e `line` (ou nulo). Os `IMPORT_*` daqui são os da importação de dados; os da
/// importação de conexões (seção 34) são outros, numa rota só dela, e nenhum nome se repete.
/// </summary>
internal static class ImportErrors
{
    public const string OptionsInvalidCode = "IMPORT_OPTIONS_INVALID";
    public const string MappingInvalidCode = "IMPORT_MAPPING_INVALID";

    /// <summary>RN-IMPORT-013 e 017: o arquivo não está mais na pasta (a tela o soltou, a API reiniciou).</summary>
    public static ApiErrorDto FileMissing()
        => ApiErrorDto.CreateNotFound("Arquivo da importação não localizado.", "IMPORT_FILE_MISSING", "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo.");

    /// <summary>RN-IMPORT-008: o arquivo passa de 2 GiB.</summary>
    public static ApiErrorDto FileTooLarge(string message)
        => ApiErrorDto.CreateUnprocessableEntity("Arquivo grande demais.", "IMPORT_FILE_TOO_LARGE", message);

    /// <summary>RN-IMPORT-004 a 008: a leitura que não segue, com o motivo e a linha (ou nulo), e a frase da regra, sem caminho.</summary>
    public static ApiErrorDto Unreadable(ImportReadFailure failure)
        => ApiErrorDto.CreateUnprocessableEntity("O arquivo não pôde ser lido.", "IMPORT_FILE_UNREADABLE", failure.Message, new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["reason"] = ReasonText(failure.Reason),
            ["line"] = failure.Line
        });

    /// <summary>RN-IMPORT-009: a tabela de destino não existe mais.</summary>
    public static ApiErrorDto TableNotFound(string message)
        => ApiErrorDto.CreateNotFound("Tabela não localizada.", "IMPORT_TABLE_NOT_FOUND", message);

    /// <summary>RN-IMPORT-009: o que não é uma tabela comum, com o motivo nos termos da edição.</summary>
    public static ApiErrorDto NotATable(string message)
        => ApiErrorDto.CreateUnprocessableEntity("O destino não é uma tabela.", "IMPORT_TARGET_NOT_TABLE", message);

    /// <summary>RN-IMPORT-009: a posição além das colunas do arquivo, a coluna que a tabela não tem, a calculada pelo banco e a de um tipo que não se importa.</summary>
    public static ApiErrorDto MappingInvalid(string field, string message)
        => ApiErrorDto.CreateUnprocessableEntityOnField("Mapeamento inválido.", MappingInvalidCode, field, message);

    /// <summary>RN-PROT-002 e RN-IMPORT-009: a conexão de destino é somente leitura, e nada foi ao banco.</summary>
    public static ApiErrorDto ReadOnly()
        => ApiErrorDto.CreateUnprocessableEntity("Conexão somente leitura.", "CONNECTION_READ_ONLY", "A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco.");

    /// <summary>
    /// RN-IMPORT-014: a tabela de destino já recebe linhas de outra importação ou cópia em andamento (a mesma tabela pela regra da própria origem,
    /// RN-IMPORT-023).
    /// </summary>
    public static ApiErrorDto TargetBusy(bool copy, string schema, string table)
        => ApiErrorDto.CreateConflict("Tabela ocupada.", "IMPORT_TARGET_BUSY", $"Já há uma {(copy ? "cópia" : "importação")} para {schema}.{table} em andamento. Espere ela terminar, ou cancele-a na barra de status.");

    /// <summary>RN-IMPORT-013 e RN-EXPORT-015: a conexão sem usuário ou sem senha, no campo que falta, com "importe de novo".</summary>
    public static ApiErrorDto CredentialsMissing(bool userNameMissing)
        => userNameMissing
            ? ApiErrorDto.CreateUnprocessableEntityOnField("Conexão sem usuário ou sem senha.", "CONNECTION_CREDENTIALS_MISSING", "userName", "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e importe de novo.")
            : ApiErrorDto.CreateUnprocessableEntityOnField("Conexão sem usuário ou sem senha.", "CONNECTION_CREDENTIALS_MISSING", "password", "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e importe de novo.");

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
