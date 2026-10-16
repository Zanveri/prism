using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using Serilog.Core;
using System.IO.Compression;
using System.Text;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-014 e 018: o arquivo temporário da exportação na pasta `transfers`, numa pasta temporária de verdade: o nome só do identificador, o `.part`
/// que vira `.ready` depois de completo, o BOM, o .zip com o nome do arquivo dentro, o modo só do dono e a limpeza da partida.
/// </summary>
public sealed class TransferFileClientTests : IDisposable
{
    private static readonly ExportColumn[] Columns = [new("id", "int4", "number"), new("cliente", "text", "text")];

    private readonly string _data = Directory.CreateTempSubdirectory("prism-transfers-").FullName;

    private string Folder => Path.Combine(_data, "transfers");

    public void Dispose()
        => Directory.Delete(_data, recursive: true);

    private TransferFileClient CreateClient()
        => new(TransferSettings.For(_data), Logger.None);

    private static ExportWriterContext Context()
        => new(Columns, "pedido", EDatabaseEngine.PostgreSql, new CsvExportOptions(";", true, ECsvQuoting.Auto, true, "\r\n", string.Empty, EExportBinary.Hex));

    private static IReadOnlyList<IReadOnlyList<ExportCell>> Rows()
        => [[ExportCell.FromText("1"), ExportCell.FromText("Ana")], [ExportCell.FromText("2"), ExportCell.Null]];

    [Trait("TransferFileClient", "Prepare")]
    [Fact(DisplayName = "OK a partida cria a pasta só do dono e apaga o que sobrou nela")]
    public void Prepare_ShouldCreateTheFolder_AndDeleteTheLeftovers()
    {
        //Arrange
        Directory.CreateDirectory(Folder);
        File.WriteAllText(Path.Combine(Folder, $"{Guid.NewGuid()}.part"), "pela metade");
        File.WriteAllText(Path.Combine(Folder, $"{Guid.NewGuid()}.in"), "da importação");
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(Folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);

        //Act
        CreateClient().Prepare();

        //Assert
        Assert.Empty(Directory.GetFiles(Folder));
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(Folder));
    }

    [Trait("TransferFileClient", "Prepare")]
    [Fact(DisplayName = "OK a partida cria a pasta que falta")]
    public void Prepare_ShouldCreateAMissingFolder()
    {
        //Act
        CreateClient().Prepare();

        //Assert
        Assert.True(Directory.Exists(Folder));
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(Folder));
    }

    /// <summary>O `.part` só vira `.ready` depois de completo e fechado: o `.ready` é sempre um arquivo inteiro, com o nome tirado só do identificador.</summary>
    [Trait("TransferFileClient", "Complete")]
    [Fact(DisplayName = "OK o .part vira .ready, só do dono, com o BOM e as linhas")]
    public void Complete_ShouldTurnThePartIntoTheReadyFile()
    {
        //Arrange
        var client = CreateClient();
        var id = Guid.CreateVersion7();
        var file = client.CreateExport(id, ExportFormats.Csv, Context(), bom: true, zipEntryName: null).Value;

        //Act
        client.Begin(file);
        var partWhileWriting = File.Exists(Path.Combine(Folder, $"{id:D}.part"));
        client.Append(file, Rows());
        var bytes = client.Complete(file);

        //Assert
        var ready = Path.Combine(Folder, $"{id:D}.ready");
        Assert.True(partWhileWriting);
        Assert.False(File.Exists(Path.Combine(Folder, $"{id:D}.part")));
        Assert.Equal([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("id;cliente\r\n1;Ana\r\n2;\r\n")], File.ReadAllBytes(ready));
        Assert.Equal(new FileInfo(ready).Length, bytes.Value);
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(ready));
    }

    /// <summary>RN-EXPORT-014: com o .zip, o arquivo vai dentro dele com o nome que a tela mandou, compactado, e o BOM fica dentro da entrada.</summary>
    [Trait("TransferFileClient", "Complete")]
    [Fact(DisplayName = "OK com o .zip, o arquivo vai dentro dele com o nome dele")]
    public void Complete_WithZip_ShouldWriteTheFileInsideTheZip()
    {
        //Arrange
        var client = CreateClient();
        var id = Guid.CreateVersion7();
        var file = client.CreateExport(id, ExportFormats.Csv, Context(), bom: true, zipEntryName: "pedido_2026-10-16_143005.csv").Value;

        //Act
        client.Begin(file);
        client.Append(file, Rows());
        client.Complete(file);

        //Assert
        using var zip = ZipFile.OpenRead(Path.Combine(Folder, $"{id:D}.ready"));
        var entry = Assert.Single(zip.Entries);
        Assert.Equal("pedido_2026-10-16_143005.csv", entry.FullName);
        using var content = new MemoryStream();
        entry.Open().CopyTo(content);
        Assert.Equal([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("id;cliente\r\n1;Ana\r\n2;\r\n")], content.ToArray());
    }

    [Trait("TransferFileClient", "Delete")]
    [Fact(DisplayName = "OK apagar tira o .part e o .ready do trabalho, e só os dele")]
    public void Delete_ShouldRemoveTheFilesOfTheTransfer()
    {
        //Arrange
        var client = CreateClient();
        var id = Guid.CreateVersion7();
        var other = Guid.CreateVersion7();
        var file = client.CreateExport(id, ExportFormats.Csv, Context(), bom: false, zipEntryName: null).Value;
        client.Close(file);
        File.WriteAllText(Path.Combine(Folder, $"{id:D}.ready"), "pronto");
        File.WriteAllText(Path.Combine(Folder, $"{other:D}.ready"), "outro");

        //Act
        client.Delete(id);

        //Assert
        Assert.Equal([$"{other:D}.ready"], Directory.GetFiles(Folder).Select(Path.GetFileName));
    }

    /// <summary>RN-EXPORT-018: a falha do disco volta com o motivo, sem o caminho, e a pasta apagada com a API aberta é criada de novo.</summary>
    [Trait("TransferFileClient", "CreateExport")]
    [Fact(DisplayName = "Erro a falha do disco volta sem o caminho, e a pasta que sumiu é criada de novo")]
    public void CreateExport_ShouldFailWithoutThePath_AndRecreateAMissingFolder()
    {
        //Arrange
        var client = CreateClient();
        var id = Guid.CreateVersion7();
        Directory.CreateDirectory(Path.Combine(Folder, $"{id:D}.part"));

        //Act
        var refused = client.CreateExport(id, ExportFormats.Csv, Context(), bom: false, zipEntryName: null);
        Directory.Delete(Folder, recursive: true);
        var recreated = client.CreateExport(Guid.CreateVersion7(), ExportFormats.Csv, Context(), bom: false, zipEntryName: null);

        //Assert
        Assert.True(refused.IsFailure);
        Assert.False(refused.Error.DiskFull);
        Assert.DoesNotContain(_data, refused.Error.Reason, StringComparison.Ordinal);
        Assert.True(recreated.IsSuccess);
        client.Close(recreated.Value);
    }
}
