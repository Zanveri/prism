using Prism.Infrastructure.Databases.Models;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-EDIT-005 e RN-TX-002 contra o banco de verdade, pelo registro de sessões: no Commit manual o "Salvar" entra na transação da aba, num ponto de
/// salvamento só dele, e fica pendente até o Commit. As linhas se conferem por outra conexão só depois do fim da transação: no Db2 e no Informix a
/// leitura de uma linha travada espera ou é recusada.
/// </summary>
public abstract partial class DatabaseEditContractTests
{
    private static readonly (string, string?)[] Seeded = [("1", "aberta"), ("2", "aberta"), ("3", "fechada")];

    /// <summary>RN-EDIT-005 e RN-TX-003: o "Salvar" fica na transação e conta um comando, e o Rollback o desfaz.</summary>
    [Test]
    public async Task ManualCommit_Save_StaysPendingUntilTheRollback()
    {
        var session = await OpenSessionAsync();
        Value(await Service.SetTransactionModeAsync(session, ETransactionMode.Manual, CancellationToken.None));
        var page = await EditableRecordsAsync(session, "pedido");

        Assert.That(Value(await Service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(Column(page, "status"), "paga")])], CancellationToken.None)), Is.EqualTo(1));

        var transaction = Service.TransactionOf(session)!;
        Assert.That((transaction.Mode, transaction.Open, transaction.Failed, transaction.Commands), Is.EqualTo((ETransactionMode.Manual, true, false, 2)));
        Assert.That(Value(await Service.RollbackAsync(session, CancellationToken.None)), Is.EqualTo(2));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(Seeded));
    }

    /// <summary>RN-EDIT-005: o "Salvar" que falha volta ao ponto de salvamento dele; o que estava pendente continua, e o Commit o confirma.</summary>
    [Test]
    public async Task ManualCommit_FailedSave_UndoesOnlyItself()
    {
        var session = await OpenSessionAsync();
        Value(await Service.SetTransactionModeAsync(session, ETransactionMode.Manual, CancellationToken.None));
        var page = await EditableRecordsAsync(session, "pedido");
        var status = Column(page, "status");

        Value(await Service.ApplyEditsAsync(session, page.ResultID!.Value, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(status, "paga")])], CancellationToken.None));
        var failed = await Service.ApplyEditsAsync(session, page.ResultID.Value, [new EditChange(EEditKind.Update, 0, ["2"], [new EditValue(status, "perdida")]), new EditChange(EEditKind.Update, 0, ["999"], [new EditValue(status, "sumiu")])], CancellationToken.None);

        Assert.That((failed.Error.Kind, failed.Error.Change), Is.EqualTo((EDatabaseFailure.EditRowMismatch, (int?)1)));
        Assert.That(Service.TransactionOf(session)!.Open && !Service.TransactionOf(session)!.Failed, Is.True);
        Value(await Service.CommitAsync(session, CancellationToken.None));
        Assert.That(await RowsAsync("pedido", "status"), Is.EqualTo(new[] { ("1", (string?)"paga"), ("2", "aberta"), ("3", "fechada") }));
    }

    /// <summary>RN-TX-005: com a transação aberta a aba não passa a Auto-commit; encerrada, passa.</summary>
    [Test]
    public async Task ManualCommit_ToAutoCommit_IsRefusedWithAnOpenTransaction()
    {
        var session = await OpenSessionAsync();
        Value(await Service.SetTransactionModeAsync(session, ETransactionMode.Manual, CancellationToken.None));
        await RecordsAsync(session, "pedido");

        var refused = await Service.SetTransactionModeAsync(session, ETransactionMode.AutoCommit, CancellationToken.None);
        Assert.That(refused.IsFailure && refused.Error.Kind == EDatabaseFailure.TransactionOpen, Is.True);

        Value(await Service.CommitAsync(session, CancellationToken.None));
        Assert.That(Value(await Service.SetTransactionModeAsync(session, ETransactionMode.AutoCommit, CancellationToken.None)).Mode, Is.EqualTo(ETransactionMode.AutoCommit));
    }
}
