using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.DbeaverImports.Features.ImportFromDbeaver;
using Prism.Application.DbeaverImports.Features.PreviewDbeaverImport;
using Prism.Application.DbeaverImports.Features.ScanDbeaver;
using Prism.Application.DbeaverImports.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Application.DbeaverImports.Repositories;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.DbeaverSources.Clients;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Dbeaver;
using Serilog.Core;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// O ambiente dos testes das rotas do DBeaver: a pasta de dados temporária (a `transfers` de verdade), o serviço da cópia de verdade e um cofre que roda a função do
/// `SaveAsync` contra o documento que guarda, como o serviço do cofre faz. Os dados são os do DBeaver SINTÉTICO (`DbeaverWorkspace`).
/// </summary>
internal sealed class DbeaverImportFixtures : IDisposable
{
    public static readonly DateTime Now = new(2026, 10, 20, 14, 32, 0, DateTimeKind.Utc);

    private readonly string _data = Directory.CreateTempSubdirectory("prism-dbeaver-handlers-").FullName;
    private long _generation = 1;

    public DbeaverImportFixtures()
    {
        Directory.CreateDirectory(Transfers);
        Vault.Setup(v => v.Generation).Returns(() => _generation);
        Vault.Setup(v => v.Read()).Returns(() => Result.Success<VaultDocument, EVaultError>(Document));
        Vault.Setup(v => v.SaveAsync(It.IsAny<Func<VaultDocument, VaultDocument>>(), It.IsAny<CancellationToken>()))
            .Returns((Func<VaultDocument, VaultDocument> change, CancellationToken _) =>
            {
                Saves++;
                var changed = change(Document);
                LastSaveKeptTheDocument = ReferenceEquals(changed, Document);
                Document = changed;

                return Task.FromResult(UnitResult.Success<EVaultError>());
            });
        Source = new DbeaverSourceService(new DbeaverSourceClient(TransferSettings.For(_data), Logger.None), Vault.Object);
        Clock = new FixedClock(Now);
    }

    public string Transfers => Path.Combine(_data, "transfers");

    public Mock<IVaultService> Vault { get; } = new();
    public Mock<IDatabaseSessionService> Sessions { get; } = new();
    public DbeaverSourceService Source { get; }
    public TimeProvider Clock { get; }
    public VaultDocument Document { get; set; } = new("marina.costa", [], [], [], VaultWorkspaceRecord.Empty, []);
    public int Saves { get; private set; }
    public bool LastSaveKeptTheDocument { get; private set; }

    public void Dispose()
    {
        Source.Dispose();
        Directory.Delete(_data, recursive: true);
    }

    /// <summary>O cofre que mudou (outro usuário entrou): a geração sobe.</summary>
    public void ChangeGeneration()
        => _generation++;

    public DbeaverCopyBuilder Builder()
        => new(Transfers);

    /// <summary>A cópia do DBeaver sintético da especificação, com os cinco projetos.</summary>
    public (Guid SourceId, string Folder) Workspace()
    {
        var builder = DbeaverWorkspace.Add(Builder());

        return (builder.Build(), builder.Folder);
    }

    public bool CopyExists(Guid sourceId)
        => Directory.Exists(Path.Combine(Transfers, $"{sourceId:D}.dbeaver"));

    public Task<Result<Prism.Application.DbeaverImports.Models.Dtos.DbeaverScanDto, Prism.Core.Api.Models.Dtos.ApiErrorDto>> Scan(Guid sourceId)
        => new ScanDbeaverHandler(Source, Logger.None).Handle(new ScanDbeaverCommand { SourceId = sourceId.ToString("D") }, CancellationToken.None);

    public Task<Result<DbeaverPreviewDto, Prism.Core.Api.Models.Dtos.ApiErrorDto>> Preview(Guid sourceId, string? project = null, Guid? target = null, bool? withPasswords = null, IReadOnlyList<DbeaverDrdaPortDto?>? drdaPorts = null)
        => new PreviewDbeaverImportHandler(Vault.Object, Source, Sessions.Object, Clock, Logger.None).Handle(
            new PreviewDbeaverImportCommand { SourceId = sourceId.ToString("D"), Project = project, TargetFolderID = target, WithPasswords = Bool(withPasswords), DrdaPorts = drdaPorts }, CancellationToken.None);

    public Task<Result<ImportedDbeaverDto, Prism.Core.Api.Models.Dtos.ApiErrorDto>> Import(
        Guid sourceId, IReadOnlyList<string?> items, string? project = null, Guid? target = null, bool? withPasswords = null, IReadOnlyList<DbeaverDrdaPortDto?>? drdaPorts = null,
        string? onConflict = null, IReadOnlyList<string?>? overwrite = null)
        => new ImportFromDbeaverHandler(Vault.Object, Source, new DbeaverImportRepository(Vault.Object), Clock, Logger.None).Handle(
            new ImportFromDbeaverCommand { SourceId = sourceId.ToString("D"), Project = project, TargetFolderID = target, WithPasswords = Bool(withPasswords), DrdaPorts = drdaPorts, Items = items, OnConflict = onConflict, Overwrite = overwrite }, CancellationToken.None);

    /// <summary>As chaves de tudo o que a prévia diz que pode ser importado (pastas e conexões), como a tela marca por padrão.</summary>
    public static List<string?> Importable(DbeaverPreviewDto preview)
        => [.. preview.Folders.Where(folder => folder.Invalid is null).Select(folder => (string?)folder.Key), .. preview.Connections.Where(connection => connection.Invalid is null).Select(connection => (string?)connection.Key)];

    public static DbeaverPreviewConnectionDto Connection(DbeaverPreviewDto preview, string name)
        => preview.Connections.Single(connection => connection.Name == name);

    private static JsonElement? Bool(bool? value)
        => value is null ? null : JsonDocument.Parse(value.Value ? "true" : "false").RootElement.Clone();

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow()
            => new(now);
    }
}
