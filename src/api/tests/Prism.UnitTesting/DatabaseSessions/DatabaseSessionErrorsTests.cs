using Prism.Application.DatabaseSessions.Models;
using Prism.Infrastructure.Databases.Models;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>Os códigos e os status são os da seção 6 da especificação; a mensagem do banco chega sem alteração (decisão 4 da seção 8).</summary>
public sealed class DatabaseSessionErrorsTests
{
    private const string DatabaseMessage = "duplicate key value violates unique constraint \"pk_cliente\"\nDETAIL: Key (id)=(1) already exists.";

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ConnectionFailed vira 422 DATABASE_CONNECTION_FAILED com a mensagem do banco")]
    public void From_ConnectionFailed_Is422DatabaseConnectionFailed()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, DatabaseMessage));

        //Assert
        Assert.Equal("DATABASE_CONNECTION_FAILED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal(DatabaseMessage, error.Detail);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ExecutionFailed vira 422 SQL_EXECUTION_FAILED com a mensagem, o SQLSTATE e a posição")]
    public void From_ExecutionFailed_Is422SqlExecutionFailed_WithSqlStateAndPosition()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, DatabaseMessage, "23505", 17));

        //Assert
        Assert.Equal("SQL_EXECUTION_FAILED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal(DatabaseMessage, error.Detail);
        Assert.Equal("23505", error.Extensions["sqlState"]);
        Assert.Equal(17, error.Extensions["position"]);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ExecutionFailed sem SQLSTATE nem posição não leva as extensões")]
    public void From_ExecutionFailed_WithoutSqlStateAndPosition_HasNoExtensions()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "O comando foi cancelado."));

        //Assert
        Assert.Equal("SQL_EXECUTION_FAILED", error.Type);
        Assert.Empty(error.Extensions);
    }

    /// <summary>
    /// RN-SQL-010 (Ruling 135): o desfecho do comando que terminou depois de um pedido de cancelamento vai na extensão `outcome`, ao lado
    /// do SQLSTATE e da posição quando o driver os informa. É o que a tela lê para dizer "Comando cancelado." só quando nada ficou.
    /// </summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Theory(DisplayName = "OK ExecutionFailed com desfecho leva a extensão outcome, ao lado do SQLSTATE quando há")]
    [InlineData(ECancelOutcome.Canceled, "57014", "canceled")]
    [InlineData(ECancelOutcome.Canceled, null, "canceled")]
    [InlineData(ECancelOutcome.Unknown, null, "unknown")]
    [InlineData(ECancelOutcome.Unknown, "57014", "unknown")]
    [InlineData(ECancelOutcome.Partial, null, "partial")]
    public void From_ExecutionFailed_WithOutcome_HasTheOutcomeExtension(ECancelOutcome outcome, string? sqlState, string expected)
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "O comando foi cancelado.", sqlState, Outcome: outcome));

        //Assert
        Assert.Equal("SQL_EXECUTION_FAILED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("O comando foi cancelado.", error.Detail);
        Assert.Equal(expected, error.Extensions["outcome"]);
        Assert.Equal(sqlState is not null, error.Extensions.ContainsKey("sqlState"));
    }

    /// <summary>Sem pedido de cancelamento não há desfecho: o 57014 de um `statement_timeout` é um erro comum do banco, só com o SQLSTATE.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ExecutionFailed sem desfecho não leva a extensão outcome")]
    public void From_ExecutionFailed_WithoutOutcome_HasNoOutcomeExtension()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "canceling statement due to statement timeout", "57014"));

        //Assert
        Assert.Equal("57014", error.Extensions["sqlState"]);
        Assert.False(error.Extensions.ContainsKey("outcome"));
    }

    /// <summary>Um valor novo de `ECancelOutcome` sem texto na resposta lançaria em produção: o teste percorre o enum inteiro.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK todo valor de ECancelOutcome tem o texto da extensão")]
    public void From_EveryCancelOutcome_IsMapped()
    {
        //Act
        var texts = Enum.GetValues<ECancelOutcome>().Select(outcome => DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "mensagem", Outcome: outcome)).Extensions["outcome"]).ToList();

        //Assert
        Assert.Equal(["canceled", "unknown", "partial"], texts);
    }

    /// <summary>O desfecho é extensão de `SQL_EXECUTION_FAILED` (seção 6 da especificação): a conexão que não abriu não o leva.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ConnectionFailed não leva a extensão outcome")]
    public void From_ConnectionFailed_WithOutcome_HasNoOutcomeExtension()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "O comando foi cancelado.", Outcome: ECancelOutcome.Canceled));

        //Assert
        Assert.Equal("DATABASE_CONNECTION_FAILED", error.Type);
        Assert.Empty(error.Extensions);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK SessionNotFound vira 404 DATABASE_SESSION_NOT_FOUND")]
    public void From_SessionNotFound_Is404DatabaseSessionNotFound()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.SessionNotFound, "A sessão com o banco não existe ou já foi fechada."));

        //Assert
        Assert.Equal("DATABASE_SESSION_NOT_FOUND", error.Type);
        Assert.Equal(HttpStatusCode.NotFound, error.StatusCode);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK SessionBusy vira 409 SESSION_BUSY")]
    public void From_SessionBusy_Is409SessionBusy()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.SessionBusy, "A sessão está ocupada com outro comando."));

        //Assert
        Assert.Equal("SESSION_BUSY", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK NoOpenCursor vira 409 NO_OPEN_CURSOR")]
    public void From_NoOpenCursor_Is409NoOpenCursor()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.NoOpenCursor, "Não há resultado aberto."));

        //Assert
        Assert.Equal("NO_OPEN_CURSOR", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK NoQueryToCount vira 409 NO_QUERY_TO_COUNT")]
    public void From_NoQueryToCount_Is409NoQueryToCount()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.NoQueryToCount, "Nenhum comando desta sessão devolveu linhas para contar."));

        //Assert
        Assert.Equal("NO_QUERY_TO_COUNT", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }

    /// <summary>RN-SESSAO-005: a recusa antes de executar não leva `executed`; o resultado anterior e o cursor dele continuam valendo.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK TransactionControlNotSupported vira 422 TRANSACTION_CONTROL_NOT_SUPPORTED, sem extensões na recusa antes de executar")]
    public void From_TransactionControlNotSupported_Is422TransactionControlNotSupported()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, "Controle de transação não é aceito."));

        //Assert
        Assert.Equal("TRANSACTION_CONTROL_NOT_SUPPORTED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Empty(error.Extensions);
    }

    /// <summary>
    /// RN-SESSAO-005 (Ruling 135): o comando rodou e o Prism desfez a transação que ele deixou aberta. O mesmo código e o mesmo texto da
    /// recusa, com `executed: true`: o cursor anterior já fechou, e a tela mostra o erro no lugar do resultado.
    /// </summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK TransactionControlNotSupported do comando que rodou leva executed: true")]
    public void From_TransactionControlNotSupported_AfterTheCommandRan_HasExecutedTrue()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, "Controle de transação não é aceito.", Executed: true));

        //Assert
        Assert.Equal("TRANSACTION_CONTROL_NOT_SUPPORTED", error.Type);
        Assert.Equal("Controle de transação não é aceito.", error.Detail);
        Assert.Equal(true, Assert.Single(error.Extensions, extension => extension.Key == "executed").Value);
        Assert.Single(error.Extensions);
    }

    /// <summary>RN-SQL-001: no Db2 e no Informix o envio com mais de um comando é recusado, com a mensagem que diz o que fazer.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK MultipleStatementsNotSupported vira 422 MULTIPLE_STATEMENTS_NOT_SUPPORTED")]
    public void From_MultipleStatementsNotSupported_Is422MultipleStatementsNotSupported()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.MultipleStatementsNotSupported, "Cada execução leva um comando só."));

        //Assert
        Assert.Equal("MULTIPLE_STATEMENTS_NOT_SUPPORTED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("Cada execução leva um comando só.", error.Detail);
    }

    /// <summary>RN-DRIVER-006 e seção 16: o detalhe traz o nome do driver que falta, e a extensão `driverID` leva a tela até ele.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK DriverNotInstalled vira 422 DRIVER_NOT_INSTALLED com o nome do driver no detalhe e a extensão driverID")]
    public void From_DriverNotInstalled_Is422DriverNotInstalled_WithDriverID()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.DriverNotInstalled, "O driver IBM Data Server não está instalado.", DriverID: "ibm-data-server"));

        //Assert
        Assert.Equal("DRIVER_NOT_INSTALLED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("O driver IBM Data Server não está instalado.", error.Detail);
        Assert.Equal("ibm-data-server", error.Extensions["driverID"]);
    }

    /// <summary>O cofre aberto mudou enquanto a sessão abria: para quem chamou, o cofre que ele usava fechou, e é o mesmo erro do cofre fechado.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK VaultChanged vira 401 VAULT_LOCKED")]
    public void From_VaultChanged_Is401VaultLocked()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.VaultChanged, "O cofre mudou enquanto a sessão era aberta."));

        //Assert
        Assert.Equal("VAULT_LOCKED", error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
    }

    /// <summary>RN-EDIT-002: outro comando rodou na sessão depois do resultado, ou a tabela dele mudou no catálogo.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ResultChanged vira 409 RESULT_CHANGED")]
    public void From_ResultChanged_Is409ResultChanged()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ResultChanged, "O resultado mudou."));

        //Assert
        Assert.Equal(("RESULT_CHANGED", HttpStatusCode.Conflict, "O resultado mudou."), (error.Type, error.StatusCode, error.Detail));
    }

    /// <summary>RN-SQL-017: o resultado de que se pedem os valores completos não é mais o da sessão (outro comando rodou), ou nunca foi.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ResultNotFound vira 404 RESULT_NOT_FOUND")]
    public void From_ResultNotFound_Is404ResultNotFound()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ResultNotFound, "O resultado não existe mais."));

        //Assert
        Assert.Equal(("RESULT_NOT_FOUND", HttpStatusCode.NotFound, "O resultado não existe mais."), (error.Type, error.StatusCode, error.Detail));
    }

    /// <summary>RN-SQL-017: uma linha ou uma coluna fora do resultado.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK CellsInvalid vira 422 CELLS_INVALID")]
    public void From_CellsInvalid_Is422CellsInvalid()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.CellsInvalid, "A linha 300 não está no resultado."));

        //Assert
        Assert.Equal(("CELLS_INVALID", HttpStatusCode.UnprocessableEntity, "A linha 300 não está no resultado."), (error.Type, error.StatusCode, error.Detail));
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ResultNotEditable vira 422 RESULT_NOT_EDITABLE com a extensão reason")]
    public void From_ResultNotEditable_Is422_WithTheReason()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ResultNotEditable, "Somente leitura: agrupamento.", Reason: "agrupamento"));

        //Assert
        Assert.Equal(("RESULT_NOT_EDITABLE", HttpStatusCode.UnprocessableEntity, "Somente leitura: agrupamento.", (object?)"agrupamento"), (error.Type, error.StatusCode, error.Detail, error.Extensions["reason"]));
    }

    /// <summary>RN-EDIT-006: a recusa aponta a alteração e a coluna; a que não é de uma coluna não leva `column`.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK EditInvalid vira 422 EDIT_INVALID com change e column")]
    public void From_EditInvalid_Is422_WithChangeAndColumn()
    {
        //Act
        var cell = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.EditInvalid, "«x» não é um número inteiro.", Change: 2, Column: 4));
        var row = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.EditInvalid, "A chave da linha não tem os valores das colunas da chave.", Change: 0));

        //Assert
        Assert.Equal(("EDIT_INVALID", HttpStatusCode.UnprocessableEntity, (object?)2, (object?)4), (cell.Type, cell.StatusCode, cell.Extensions["change"], cell.Extensions["column"]));
        Assert.Equal((object?)0, row.Extensions["change"]);
        Assert.False(row.Extensions.ContainsKey("column"));
    }

    /// <summary>RN-EDIT-005 e 012: as linhas que o comando afetou; `applied` só no banco sem log de transação.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK EditRowMismatch vira 422 EDIT_ROW_MISMATCH com change e rowsAffected, e applied quando vem")]
    public void From_EditRowMismatch_Is422_WithChangeAndRowsAffected()
    {
        //Act
        var transaction = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.EditRowMismatch, "A linha não existe mais.", Change: 1, RowsAffected: 0));
        var oneAtATime = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.EditRowMismatch, "A linha não existe mais.", Change: 1, RowsAffected: 0, Applied: 1));

        //Assert
        Assert.Equal(("EDIT_ROW_MISMATCH", HttpStatusCode.UnprocessableEntity, (object?)1, (object?)0L), (transaction.Type, transaction.StatusCode, transaction.Extensions["change"], transaction.Extensions["rowsAffected"]));
        Assert.False(transaction.Extensions.ContainsKey("applied"));
        Assert.Equal((object?)1, oneAtATime.Extensions["applied"]);
    }

    /// <summary>RN-EDIT-005: a recusa do banco num comando do "Salvar" é o `SQL_EXECUTION_FAILED` de sempre, com a mensagem dele e a alteração que falhou.</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ExecutionFailed de um Salvar leva change, e applied no banco sem log")]
    public void From_ExecutionFailedOfASave_CarriesTheChange()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "duplicate key value violates unique constraint", SqlState: "23505", Change: 3, Applied: 2));

        //Assert
        Assert.Equal(("SQL_EXECUTION_FAILED", (object?)"23505", (object?)3, (object?)2), (error.Type, error.Extensions["sqlState"], error.Extensions["change"], error.Extensions["applied"]));
    }

    /// <summary>
    /// Um membro novo de `EDatabaseFailure` (os drivers da IBM vêm aí) sem `case` no `From` cairia no `default` e viraria 500 em produção: este
    /// teste percorre o enum inteiro, e o membro sem mapeamento quebra aqui. Ele só acusa o membro porque o `default` lança, e é o teste
    /// seguinte que afirma isso: os dois andam juntos.
    /// </summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK todo valor de EDatabaseFailure tem mapeamento")]
    public void From_EveryDatabaseFailureKind_IsMapped()
    {
        //Act
        var unmapped = Enum.GetValues<EDatabaseFailure>().Where(kind => Record.Exception(() => DatabaseSessionErrors.From(new DatabaseFailure(kind, "mensagem"))) is not null).ToList();

        //Assert
        Assert.Empty(unmapped);
    }

    /// <summary>O `default` lança: um valor que ninguém mapeou é para o desenvolvedor ver, e não uma resposta enfeitada para o usuário (e é o que faz o teste acima acusar um membro novo).</summary>
    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "Erro valor do enum que ninguém mapeou")]
    public void From_UnmappedValue_Throws()
    {
        //Act
        var exception = Record.Exception(() => DatabaseSessionErrors.From(new DatabaseFailure((EDatabaseFailure)999, "x")));

        //Assert
        Assert.IsType<NotImplementedException>(exception);
    }
}
