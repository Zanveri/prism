using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Serilog.Core;

namespace Prism.UnitTesting.Transfers.Imports;

/// <summary>
/// RN-IMPORT-008 e 017: o arquivo da importação na pasta `transfers`, numa pasta temporária de verdade: o `&lt;fileID&gt;.in` aberto só para leitura, pelo
/// nome tirado só do identificador, que pode ser renomeado e apagado enquanto está aberto; o que falta e o que passa de 2 GiB.
/// </summary>
public sealed class ImportFileClientTests : IDisposable
{
    private readonly string _data = Directory.CreateTempSubdirectory("prism-imports-").FullName;

    public ImportFileClientTests()
        => Directory.CreateDirectory(Folder);

    private string Folder => Path.Combine(_data, "transfers");

    public void Dispose()
        => Directory.Delete(_data, recursive: true);

    private ImportFileClient CreateClient()
        => new(TransferSettings.For(_data), Logger.None);

    private string PathOf(Guid fileID)
        => Path.Combine(Folder, $"{fileID:D}.in");

    /// <summary>RN-IMPORT-014 e 017: o começo da importação toma o arquivo, que passa a ter o nome do trabalho, também com uma prévia atrasada lendo.</summary>
    [Trait("ImportFileClient", "Take")]
    [Fact(DisplayName = "OK o arquivo é tomado pelo trabalho, mesmo aberto por uma prévia, e o que sumiu é Missing")]
    public void Take_ShouldRenameToTheJob()
    {
        //Arrange
        var fileID = Guid.NewGuid();
        var jobID = Guid.CreateVersion7();
        File.WriteAllText(PathOf(fileID), "id;nome\n1;Ana\n");
        var client = CreateClient();
        using var preview = client.Open(fileID).Value;

        //Act
        var taken = client.Take(fileID, jobID);
        var missing = client.Take(Guid.NewGuid(), Guid.CreateVersion7());

        //Assert
        Assert.Null(taken);
        Assert.False(File.Exists(PathOf(fileID)));
        Assert.True(File.Exists(PathOf(jobID)));
        Assert.Equal(EImportFileRefusal.Missing, missing!.Kind);
    }

    [Trait("ImportFileClient", "Open")]
    [Fact(DisplayName = "OK o arquivo abre só para leitura, e pode ser renomeado e apagado enquanto está aberto")]
    public void Open_ShouldReadAndLetTheFileBeTaken()
    {
        //Arrange
        var fileID = Guid.NewGuid();
        File.WriteAllText(PathOf(fileID), "id;nome\n1;Ana\n");

        //Act
        var opened = CreateClient().Open(fileID);

        //Assert
        Assert.True(opened.IsSuccess);
        using var stream = opened.Value;
        Assert.False(stream.CanWrite);
        var taken = Path.Combine(Folder, $"{Guid.NewGuid():D}.in");
        File.Move(PathOf(fileID), taken);
        File.Delete(taken);
        Assert.Equal((byte)'i', stream.ReadByte());
    }

    [Trait("ImportFileClient", "Check")]
    [Fact(DisplayName = "ERRO o arquivo que não está na pasta é o que falta, e a pasta que sumiu também")]
    public void Check_MissingFile_ShouldBeMissing()
    {
        //Act
        var missing = CreateClient().Check(Guid.NewGuid());
        Directory.Delete(Folder);
        var noFolder = CreateClient().Check(Guid.NewGuid());

        //Assert
        Assert.Equal(EImportFileRefusal.Missing, missing!.Kind);
        Assert.Equal(EImportFileRefusal.Missing, noFolder!.Kind);
    }

    [Trait("ImportFileClient", "Check")]
    [Fact(DisplayName = "ERRO o arquivo acima de 2 GiB, com o tamanho dele; o de 2 GiB passa")]
    public void Check_FileAbove2GiB_ShouldBeTooLarge()
    {
        //Arrange
        var limit = Guid.NewGuid();
        var above = Guid.NewGuid();
        using (var stream = File.Create(PathOf(limit)))
            stream.SetLength(ImportFileClient.MaxBytes);

        using (var stream = File.Create(PathOf(above)))
            stream.SetLength(ImportFileClient.MaxBytes + 1);

        //Act
        var fits = CreateClient().Check(limit);
        var refusal = CreateClient().Check(above);

        //Assert
        Assert.Null(fits);
        Assert.Equal(EImportFileRefusal.TooLarge, refusal!.Kind);
        Assert.Equal(ImportFileClient.MaxBytes + 1, refusal.Size);
        Assert.Equal("O arquivo tem 2,1 GB, e o Prism importa até 2 GB.", ImportText.TooLarge(refusal.Size));
    }
}
