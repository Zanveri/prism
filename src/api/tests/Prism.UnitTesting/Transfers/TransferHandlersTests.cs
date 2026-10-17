using Moq;
using Prism.Application.Transfers.Features.DeleteTransfer;
using Prism.Application.Transfers.Features.GetTransfer;
using Prism.Application.Transfers.Features.GetTransfers;
using Prism.Application.Transfers.Models.Dtos;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using System.Net;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-016 e seção 6: a consulta, a lista e o `DELETE` dos trabalhos, e o item da rota em texto: toda chave vem, nula quando não se aplica, e o que
/// o registro não conhece é 404 `TRANSFER_NOT_FOUND`.
/// </summary>
public sealed class TransferHandlersTests
{
    private static readonly DateTimeOffset Started = new(2026, 10, 16, 14, 30, 5, TimeSpan.FromHours(-3));

    private readonly Mock<ITransferService> _transferService = new();

    private static TransferInfo Done(Guid id)
        => new(id, ETransferKind.Export, Guid.CreateVersion7(), null, 2, ETransferState.Done, ETransferPhase.Finishing, 120, null, 120, 4096, null, false,
            new TransferSummary(120, 4096, null, 1, 2, 0), null, null, Started, Started.AddSeconds(3));

    [Trait("GetTransferHandler", "GetTransferCommand")]
    [Fact(DisplayName = "OK o trabalho vem com as chaves da rota, as datas em UTC")]
    public async Task Get_ShouldReturnTheTransfer()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        var info = Done(id);
        _transferService.Setup(service => service.Get(id)).Returns(info);

        //Act
        var result = await new GetTransferHandler(_transferService.Object).Handle(new GetTransferCommand(id), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(new TransferDto
        {
            ID = id,
            Kind = "export",
            ConnectionID = info.ConnectionID,
            WindowID = 2,
            State = "done",
            Phase = "finishing",
            Rows = 120,
            Total = 120,
            Bytes = 4096,
            Summary = new TransferSummaryDto(120, 4096, null, 1, 2, 0, 0, false, 0, 0, 0, 0),
            StartedAt = new DateTime(2026, 10, 16, 17, 30, 5, DateTimeKind.Utc),
            FinishedAt = new DateTime(2026, 10, 16, 17, 30, 8, DateTimeKind.Utc)
        }, result.Value);
        Assert.Equal(DateTimeKind.Utc, result.Value.StartedAt.Kind);
    }

    [Trait("GetTransferHandler", "GetTransferCommand")]
    [Fact(DisplayName = "Erro o trabalho que o registro não conhece é 404")]
    public async Task Get_Unknown_ShouldReturnNotFound()
    {
        //Act
        var result = await new GetTransferHandler(_transferService.Object).Handle(new GetTransferCommand(Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal((HttpStatusCode.NotFound, "TRANSFER_NOT_FOUND"), (result.Error.StatusCode, result.Error.Type));
    }

    [Trait("GetTransfersHandler", "GetTransfersCommand")]
    [Fact(DisplayName = "OK a lista traz os trabalhos do registro, na ordem dele")]
    public async Task List_ShouldReturnEveryTransfer()
    {
        //Arrange
        var first = Done(Guid.CreateVersion7());
        var second = first with { ID = Guid.CreateVersion7(), State = ETransferState.Running, Phase = ETransferPhase.Reading, Summary = null, FinishedAt = null };
        _transferService.Setup(service => service.List()).Returns([first, second]);

        //Act
        var result = await new GetTransfersHandler(_transferService.Object).Handle(new GetTransfersCommand(), CancellationToken.None);

        //Assert
        Assert.Equal([(first.ID, "done"), (second.ID, "running")], result.Value.Select(transfer => (transfer.ID, transfer.State)));
    }

    [Trait("DeleteTransferHandler", "DeleteTransferCommand")]
    [Fact(DisplayName = "OK o DELETE cancela ou esquece o trabalho")]
    public async Task Delete_ShouldCancelOrForgetTheTransfer()
    {
        //Arrange
        var id = Guid.CreateVersion7();
        _transferService.Setup(service => service.DeleteAsync(id)).ReturnsAsync(true);

        //Act
        var result = await new DeleteTransferHandler(_transferService.Object).Handle(new DeleteTransferCommand(id), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        _transferService.Verify(service => service.DeleteAsync(id), Times.Once);
    }

    [Trait("DeleteTransferHandler", "DeleteTransferCommand")]
    [Fact(DisplayName = "Erro o DELETE do trabalho que o registro não conhece é 404")]
    public async Task Delete_Unknown_ShouldReturnNotFound()
    {
        //Act
        var result = await new DeleteTransferHandler(_transferService.Object).Handle(new DeleteTransferCommand(Guid.CreateVersion7()), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal((HttpStatusCode.NotFound, "TRANSFER_NOT_FOUND"), (result.Error.StatusCode, result.Error.Type));
    }

    [Trait("TransferMappings", "ToDto")]
    [Theory(DisplayName = "OK a falha vai com o código da rota, a mensagem e o SQLSTATE")]
    [InlineData(ETransferError.DatabaseConnectionFailed, "DATABASE_CONNECTION_FAILED")]
    [InlineData(ETransferError.SqlExecutionFailed, "SQL_EXECUTION_FAILED")]
    [InlineData(ETransferError.ColumnsChanged, "EXPORT_COLUMNS_CHANGED")]
    [InlineData(ETransferError.ValueTooLarge, "EXPORT_VALUE_TOO_LARGE")]
    [InlineData(ETransferError.Stalled, "EXPORT_STALLED")]
    [InlineData(ETransferError.ClipboardTooLarge, "EXPORT_CLIPBOARD_TOO_LARGE")]
    [InlineData(ETransferError.WriteFailed, "EXPORT_WRITE_FAILED")]
    public void ToDto_Failed_ShouldMapTheError(ETransferError code, string text)
    {
        //Arrange
        var info = Done(Guid.CreateVersion7()) with { State = ETransferState.Failed, Phase = ETransferPhase.Reading, Summary = null, Error = new TransferFailure(code, "relation \"pedido\" does not exist", "42P01") };

        //Act
        var dto = info.ToDto();

        //Assert
        Assert.Equal(("failed", "reading", new TransferErrorDto(text, "relation \"pedido\" does not exist", "42P01", null, null, null, null, null)), (dto.State, dto.Phase, dto.Error));
    }

    /// <summary>As notas da seção 36: os códigos da importação e da cópia.</summary>
    [Trait("TransferMappings", "ToDto")]
    [Theory(DisplayName = "OK os códigos da importação e da cópia vão em texto")]
    [InlineData(ETransferError.ImportValueInvalid, "IMPORT_VALUE_INVALID")]
    [InlineData(ETransferError.ImportValueTooLarge, "IMPORT_VALUE_TOO_LARGE")]
    [InlineData(ETransferError.ImportFileUnreadable, "IMPORT_FILE_UNREADABLE")]
    [InlineData(ETransferError.ImportTableNotFound, "IMPORT_TABLE_NOT_FOUND")]
    [InlineData(ETransferError.ImportTargetNotTable, "IMPORT_TARGET_NOT_TABLE")]
    [InlineData(ETransferError.ImportTableChanged, "IMPORT_TABLE_CHANGED")]
    [InlineData(ETransferError.ImportMappingInvalid, "IMPORT_MAPPING_INVALID")]
    [InlineData(ETransferError.ImportStalled, "IMPORT_STALLED")]
    [InlineData(ETransferError.ImportSourceGrowing, "IMPORT_SOURCE_GROWING")]
    [InlineData(ETransferError.Unexpected, "INTERNAL_SERVER_ERROR")]
    public void ErrorCode_Imports_ShouldMap(ETransferError code, string text)
        => Assert.Equal(text, TransferMappings.ErrorCode(code));

    /// <summary>
    /// RN-IMPORT-014, 016 e 027: o item da importação e da cópia, com o destino, as confirmadas, o tamanho, a dúvida e o erro com a linha, a coluna, o lado,
    /// as confirmadas e a dúvida; na cópia, `bytes` nulo.
    /// </summary>
    [Trait("TransferMappings", "ToDto")]
    [Fact(DisplayName = "OK o item da importação e o da cópia têm os campos da seção 36")]
    public void ToDto_LoadJobs_ShouldCarryTheNewFields()
    {
        //Arrange
        var target = Guid.CreateVersion7();
        var failure = new TransferFailure(ETransferError.SqlExecutionFailed, "duplicate key", "23505") { Line = 12, Column = "id", Side = ETransferSide.Target, Committed = 10, Uncertain = true };
        var import = Done(Guid.CreateVersion7()) with { Kind = ETransferKind.Import, TargetConnectionID = target, State = ETransferState.Failed, Phase = ETransferPhase.Loading, Committed = 10, Size = 9000, Uncertain = true, Summary = null, Error = failure };
        var copy = Done(Guid.CreateVersion7()) with { Kind = ETransferKind.Copy, TargetConnectionID = target, Phase = ETransferPhase.Committing, Committed = 120, Summary = new TransferSummary(120, 0, null, 0, 0, 0) { Committed = 120, Emptied = true } };

        //Act
        var importDto = import.ToDto();
        var copyDto = copy.ToDto();

        //Assert
        Assert.Equal(("import", (Guid?)target, "loading", (long?)10, (long?)9000, true), (importDto.Kind, importDto.TargetConnectionID, importDto.Phase, importDto.Committed, importDto.Size, importDto.Uncertain));
        Assert.Equal(new TransferErrorDto("SQL_EXECUTION_FAILED", "duplicate key", "23505", 12, "id", "target", 10, true), importDto.Error);
        Assert.Equal(("copy", "committing", (long?)null), (copyDto.Kind, copyDto.Phase, copyDto.Bytes));
        Assert.Equal(new TransferSummaryDto(120, 0, null, 0, 0, 0, 120, true, 0, 0, 0, 0), copyDto.Summary);
    }

    [Trait("TransferMappings", "ToDto")]
    [Theory(DisplayName = "OK o cancelado diz por quê, e cada fase e tipo vai em texto")]
    [InlineData(ETransferCancelReason.Person, ETransferPhase.Connecting, "person", "connecting")]
    [InlineData(ETransferCancelReason.ConnectionDeleted, ETransferPhase.Counting, "connectionDeleted", "counting")]
    [InlineData(ETransferCancelReason.ReadOnly, ETransferPhase.Emptying, "readOnly", "emptying")]
    [InlineData(ETransferCancelReason.Person, ETransferPhase.Checking, "person", "checking")]
    public void ToDto_Canceled_ShouldMapTheReason(ETransferCancelReason reason, ETransferPhase phase, string reasonText, string phaseText)
    {
        //Arrange
        var info = Done(Guid.CreateVersion7()) with { State = ETransferState.Canceled, Phase = phase, Summary = null, Reason = reason };

        //Act
        var dto = info.ToDto();

        //Assert
        Assert.Equal(("canceled", phaseText, reasonText, (TransferSummaryDto?)null, (TransferErrorDto?)null), (dto.State, dto.Phase, dto.Reason, dto.Summary, dto.Error));
    }

    [Trait("TransferMappings", "ToDto")]
    [Theory(DisplayName = "OK a importação e a cópia levam os campos delas")]
    [InlineData(ETransferKind.Import, "import")]
    [InlineData(ETransferKind.Copy, "copy")]
    public void ToDto_ImportOrCopy_ShouldMapTheirFields(ETransferKind kind, string text)
    {
        //Arrange
        var target = Guid.CreateVersion7();
        var info = Done(Guid.CreateVersion7()) with { Kind = kind, TargetConnectionID = target, Committed = 100, Size = 8192, Uncertain = true };

        //Act
        var dto = info.ToDto();

        //Assert
        Assert.Equal((text, (Guid?)target, (long?)100, (long?)8192, true), (dto.Kind, dto.TargetConnectionID, dto.Committed, dto.Size, dto.Uncertain));
    }

    [Trait("TransferMappings", "ToDto")]
    [Fact(DisplayName = "OK a falha não imprime a mensagem do banco")]
    public void TransferErrorDto_ToString_ShouldNotPrintTheMessage()
        => Assert.DoesNotContain("pedido", new TransferErrorDto("SQL_EXECUTION_FAILED", "relation \"pedido\" does not exist", "42P01", 12, "pedido", "target", 0, false).ToString(), StringComparison.Ordinal);
}
