namespace Prism.Infrastructure.Databases.Models;

public enum EDatabaseFailure
{
    ConnectionFailed,
    ExecutionFailed,
    SessionNotFound,
    SessionBusy,
    NoOpenCursor,
    NoQueryToCount,

    /// <summary>O cofre aberto mudou entre a leitura das credenciais e a conexão ficar pronta: a sessão não é registrada.</summary>
    VaultChanged,

    /// <summary>RN-SQL-003: `BEGIN`, `COMMIT`, `ROLLBACK` e os demais comandos de controle de transação não são aceitos nesta fatia, em que toda sessão é auto-commit (RN-SESSAO-005).</summary>
    TransactionControlNotSupported,

    /// <summary>RN-SQL-001: no Db2 e no Informix cada execução leva um comando só; o envio com mais de um é recusado sem ir ao banco.</summary>
    MultipleStatementsNotSupported,

    /// <summary>RN-DRIVER-006: o driver do banco é baixado pelo usuário e não está instalado (ou foi instalado e ainda espera o reinício da API).</summary>
    DriverNotInstalled,

    /// <summary>RN-EDIT-002: o resultado pedido não é mais o da sessão (outro comando rodou), ou a tabela dele mudou no catálogo desde a consulta.</summary>
    ResultChanged,

    /// <summary>RN-EDIT-002: o resultado inteiro é só leitura; o motivo vai em `Reason`.</summary>
    ResultNotEditable,

    /// <summary>RN-EDIT-002 e 006: uma alteração que não se aplica ao resultado, ou um texto que não converte para o tipo da coluna; nada foi ao banco.</summary>
    EditInvalid,

    /// <summary>RN-EDIT-005: um comando do "Salvar" afetou zero linhas ou mais de uma; o "Salvar" foi desfeito (menos no Informix sem log, RN-EDIT-012).</summary>
    EditRowMismatch,

    /// <summary>RN-SQL-017: o resultado de que se pedem os valores completos não é mais o da sessão (outro comando rodou), ou nunca foi.</summary>
    ResultNotFound,

    /// <summary>RN-SQL-017: uma célula pedida está fora do resultado (linha que ainda não foi entregue, coluna que ele não tem).</summary>
    CellsInvalid,

    /// <summary>
    /// RN-GRADE-011: o filtro do resultado não se junta ao comando com segurança (`;`, aspas ou comentário sem fechar, comentário no fim,
    /// parênteses sem par, mais de um `ORDER BY`); nada foi ao banco. Pela rota, quem recusa antes é o validator, com o mesmo código.
    /// </summary>
    FilterInvalid,

    /// <summary>
    /// RN-PROT-002: a conexão é somente leitura (por ela ou por uma pasta acima), e o comando não é uma leitura (RN-PROT-005), ou a operação é da
    /// edição de registros. Nada foi ao banco, e o resultado anterior continua.
    /// </summary>
    ConnectionReadOnly
}

/// <summary>
/// RN-SQL-010: o desfecho de um comando que terminou em `ExecutionFailed` depois de um pedido de cancelamento para ele (a rota
/// `queries/cancel`, que vale também para a contagem e o "carregar mais", o fechamento da sessão e a requisição abortada). Sem esse
/// pedido não há desfecho: a mesma recusa é um erro comum do banco (o 57014 de um `statement_timeout`, por exemplo), e o erro do próprio
/// comando (uma restrição, uma divisão por zero) que chega com o cancelamento a caminho também não tem. A tela decide por ele, e nunca
/// pelo texto da mensagem (Ruling 135).
/// </summary>
public enum ECancelOutcome
{
    /// <summary>A API tem prova de que o comando não terminou e nada dele ficou: o banco disse que o interrompeu, ou ele nem foi enviado.</summary>
    Canceled,

    /// <summary>A API não sabe se o comando foi concluído: a sessão caiu sem resposta ao cancelamento, ou a prova não serve ao caso.</summary>
    Unknown,

    /// <summary>O cancelamento chegou enquanto o comando devolvia as linhas, e o que ele gravou até ali está confirmado.</summary>
    Partial
}

/// <summary>
/// A recusa de uma operação com um banco. Em `ConnectionFailed` e `ExecutionFailed` a mensagem é a do banco, como veio, com o detalhe e
/// a dica quando ele manda: num cliente de banco ela é o produto, e vai para a tela (decisão 4 do guia da raiz), nunca para o log
/// (RN-LOG-001). O SQLSTATE e a posição só existem quando o driver os informa (RN-SQL-009). `DriverID` só existe em
/// `DriverNotInstalled`: é o driver do catálogo que falta, para a tela levar a pessoa até ele (RN-DRIVER-006). `Outcome` é o desfecho
/// do cancelamento (<see cref="ECancelOutcome"/>), e só vai para a tela em `ExecutionFailed`. `Executed` só vale em
/// `TransactionControlNotSupported`: o comando rodou e o Prism desfez a transação que ele deixou aberta; sem ele, o comando foi
/// recusado antes de executar (RN-SESSAO-005).
///
/// Na edição (RN-EDIT-005 e 012): `Reason` é o motivo de o resultado ser só leitura; `Change` é a posição, no pedido, da alteração que
/// falhou, e `Column` a da coluna do resultado; `RowsAffected` é quantas linhas o comando dela afetou; `Applied` só vem no banco sem log
/// de transação, e diz quantas alterações já estavam gravadas, na ordem de execução, antes da que falhou.
///
/// Na carga da importação e da cópia (RN-IMPORT-016): `Change` é a posição, entre as linhas mandadas num comando (ou num lote), da linha que o banco
/// recusou, quando se sabe; e `ColumnName` é o nome da coluna da tabela que o banco diz no erro (no PostgreSQL, o campo `column`, que vem na recusa do
/// nulo), ou nulo.
/// </summary>
public sealed record DatabaseFailure(EDatabaseFailure Kind, string Message, string? SqlState = null, int? Position = null, string? DriverID = null, ECancelOutcome? Outcome = null, bool Executed = false, string? Reason = null, int? Change = null, int? Column = null, long? RowsAffected = null, int? Applied = null, string? ColumnName = null);
