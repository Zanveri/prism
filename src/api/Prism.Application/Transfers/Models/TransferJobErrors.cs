using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Databases.Clients;

namespace Prism.Application.Transfers.Models;

/// <summary>
/// As recusas das rotas de `api/user/transfers` (seção 6 e RN-EXPORT-015 e 016). `EXPORT_OPTIONS_INVALID` e `CONNECTION_CREDENTIALS_MISSING` vêm na forma do
/// erro de campo (`errors` e `errorCodes`), com o caminho do campo em camelCase (`options.rowsPerStatement`, `userName`): a tela o lê como está. Os
/// `EXPORT_*` daqui são os da exportação de dados; os da exportação de conexões (seção 34) são outros, numa rota só dela.
/// </summary>
internal static class TransferJobErrors
{
    public const string OptionsInvalidCode = "EXPORT_OPTIONS_INVALID";

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Transferência não localizada.", "TRANSFER_NOT_FOUND", $"Não existe uma transferência com o ID {id}: ela terminou e foi esquecida, foi abandonada, ou é de outro cofre.");

    /// <summary>RN-EXPORT-016: o limite é de todas as transferências (seção 36), e a recusa diz isso.</summary>
    public static ApiErrorDto LimitReached()
        => ApiErrorDto.CreateConflict("Limite de transferências.", "TRANSFER_LIMIT_REACHED", "Já há 3 transferências em andamento (exportações, importações ou cópias para outro banco). Espere uma terminar, ou cancele uma na barra de status.");

    /// <summary>RN-EXPORT-015: a conexão sem usuário ou sem senha, no campo que falta, com a frase do assistente.</summary>
    public static ApiErrorDto CredentialsMissing(bool userNameMissing)
        => userNameMissing
            ? ApiErrorDto.CreateUnprocessableEntityOnField("Conexão sem usuário ou sem senha.", "CONNECTION_CREDENTIALS_MISSING", "userName", "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e exporte de novo.")
            : ApiErrorDto.CreateUnprocessableEntityOnField("Conexão sem usuário ou sem senha.", "CONNECTION_CREDENTIALS_MISSING", "password", "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e exporte de novo.");

    /// <summary>RN-ARVORE-006: o banco de dados pedido fora da regra da abertura de uma sessão.</summary>
    public static ApiErrorDto DatabaseNameInvalid()
        => ApiErrorDto.CreateUnprocessableEntity("Nome de banco inválido.", "DATABASE_NAME_INVALID", "O nome do banco deve ter de 1 a 128 caracteres, sem caractere de controle.");

    /// <summary>RN-EXPORT-011: o Informix não aceita várias linhas num `INSERT … VALUES`.</summary>
    public static ApiErrorDto InformixRowsPerStatement()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", OptionsInvalidCode, "options.rowsPerStatement", "O Informix não aceita várias linhas num INSERT.");

    /// <summary>RN-EXPORT-002 e 016: o comando recusado pelo texto, antes do trabalho: mais de um comando, o filtro, o que não é leitura.</summary>
    public static ApiErrorDto From(ExportSqlRefusal refusal)
        => refusal.Kind switch
        {
            EExportSqlRefusal.MultipleStatements => ApiErrorDto.CreateUnprocessableEntity("Só um comando por exportação.", "MULTIPLE_STATEMENTS_NOT_SUPPORTED", refusal.Reason),
            EExportSqlRefusal.FilterInvalid => ApiErrorDto.CreateUnprocessableEntity("Filtro inválido.", "FILTER_INVALID", refusal.Reason),
            EExportSqlRefusal.NotRead => ApiErrorDto.CreateUnprocessableEntity("O comando não é só de leitura.", "EXPORT_SOURCE_NOT_READ", $"Exportar executa o comando de novo, e só se exporta uma leitura: {refusal.Reason}. Nada foi enviado ao banco.", new Dictionary<string, object?>(StringComparer.Ordinal) { ["reason"] = refusal.Reason }),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
