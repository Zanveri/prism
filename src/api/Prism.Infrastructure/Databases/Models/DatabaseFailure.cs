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
    DriverNotInstalled
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
/// </summary>
public sealed record DatabaseFailure(EDatabaseFailure Kind, string Message, string? SqlState = null, int? Position = null, string? DriverID = null, ECancelOutcome? Outcome = null, bool Executed = false);
