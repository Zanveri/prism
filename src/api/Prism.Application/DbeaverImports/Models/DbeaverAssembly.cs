using CSharpFunctionalExtensions;
using Prism.Application.Common.Texts;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using Prism.Infrastructure.Databases.Models;
using System.Text.Json;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-007: o que foi lido, posto na forma do conteúdo do arquivo do Prism (as pastas e as conexões da RN-TRANSF-007) para seguir pela mesma análise, pela
/// mesma colocação e pela mesma gravação do "Importar conexões". As chaves são geradas aqui, na ordem dos projetos do manifesto, das pastas pelo caminho e das conexões
/// pela ordem do arquivo (`p{n}` para cada projeto que vira pasta, `f{n}_{i}` e `c{n}_{i}`, com `n` a posição do projeto no manifesto e `i` a ordem dentro dele): estáveis para a mesma cópia
/// com as mesmas escolhas, que é o que a importação refaz, e as mesmas de um projeto em "Todos os projetos" e escolhido sozinho, para as marcas da tela continuarem (RN-DBEAVER-014).
/// O ID do DBeaver é a origem (RN-DBEAVER-018), nunca a chave.
/// </summary>
internal sealed class DbeaverAssembly
{
    public DbeaverAssembly(ImportedFile file, IReadOnlyDictionary<string, DbeaverItem> items, IReadOnlySet<string> cutFolders, int connectionCount, int folderCount)
    {
        File = file;
        Items = items;
        CutFolders = cutFolders;
        ConnectionCount = connectionCount;
        FolderCount = folderCount;
    }

    public ImportedFile File { get; }

    /// <summary>De cada conexão do arquivo montado, pela chave: de que projeto veio e a conexão traduzida.</summary>
    public IReadOnlyDictionary<string, DbeaverItem> Items { get; }

    /// <summary>As chaves das pastas cujo nome do DBeaver tinha mais de 60 caracteres e foi cortado (RN-DBEAVER-011).</summary>
    public IReadOnlySet<string> CutFolders { get; }

    public int ConnectionCount { get; }
    public int FolderCount { get; }

    public override string ToString()
        => nameof(DbeaverAssembly);

    /// <param name="projects">Os projetos que entram (lidos, não protegidos, com o nome que o Prism aceita), na ordem do manifesto.</param>
    /// <param name="withPasswords">"Levar as senhas": desligada, as conexões vêm só com o usuário.</param>
    /// <param name="drdaPorts">A porta DRDA de cada servidor Informix do DBeaver que a pessoa preencheu (a adição à RN-DBEAVER-010).</param>
    /// <param name="manyProjectsInSource">Há mais de um projeto na origem: a frase do limite pede para escolher um só.</param>
    /// <param name="checkLimits">Falso na contagem (`scan`), que não confere os limites de conexões, pastas e níveis (RN-DBEAVER-007): ela só diz quantas conexões o Prism importa de cada projeto.</param>
    public static Result<DbeaverAssembly, ApiErrorDto> Build(IReadOnlyList<DbeaverProjectModel> projects, bool withPasswords, IReadOnlyList<DbeaverDrdaPort> drdaPorts, bool manyProjectsInSource, bool checkLimits = true)
    {
        var totalConnections = projects.Sum(project => project.Connections.Count);
        var totalFolders = projects.Sum(project => project.FolderPaths.Count + (project.IsGeneral ? 0 : 1));

        // RN-TRANSF-010 e RN-DBEAVER-007: até 2.000 conexões e 2.000 pastas no total (as pastas dos projetos contam); os 32 níveis, contados do lugar escolhido,
        // abaixo, pelo caminho de cada pasta. O projeto com um caminho grande demais para ser aberto em pais (`PathsOverLimit`) também passa dos limites.
        if (checkLimits && (totalConnections > TransferLimits.MaxConnections || totalFolders > TransferLimits.MaxFolders || projects.Any(project => project.PathsOverLimit)))
            return DbeaverErrors.LimitsExceeded(manyProjectsInSource);

        var folders = new List<ImportedFolder>();
        var connections = new List<ImportedConnection>();
        var items = new Dictionary<string, DbeaverItem>(StringComparer.Ordinal);
        var cut = new HashSet<string>(StringComparer.Ordinal);
        var drda = drdaPorts.ToDictionary(entry => (entry.Host, entry.Port, entry.Server));

        foreach (var project in projects)
        {
            // Os contadores recomeçam em cada projeto: a chave de um item não depende de quais outros projetos entraram.
            var folderCounter = 0;
            var connectionCounter = 0;

            // O projeto que não é o `General` vira uma pasta com o nome dele, também quando é o único escolhido: assim a mesma importação dá a mesma árvore.
            string? projectKey = null;
            if (!project.IsGeneral)
            {
                projectKey = $"p{project.Position}";
                folders.Add(NewFolder(projectKey, null, project.Name, cut));
            }

            var keys = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var path in project.FolderPaths)
            {
                var segments = path.Split('/');
                if (checkLimits && (projectKey is null ? 0 : 1) + segments.Length > TransferLimits.MaxDepth)
                    return DbeaverErrors.LimitsExceeded(manyProjectsInSource);

                var parentKey = segments.Length == 1 ? projectKey : keys[string.Join('/', segments[..^1])];
                var key = $"f{project.Position}_{++folderCounter}";
                keys[path] = key;
                folders.Add(NewFolder(key, parentKey, segments[^1], cut));
            }

            foreach (var model in project.Connections)
            {
                var key = $"c{project.Position}_{++connectionCounter}";
                var drdaPort = DrdaPortOf(model, drda);
                items[key] = new DbeaverItem(key, project.Name, model, drdaPort);
                connections.Add(NewConnection(key, model.FolderPath.Length == 0 ? projectKey : keys[model.FolderPath], model, withPasswords, drdaPort));
            }
        }

        return new DbeaverAssembly(new ImportedFile(folders, connections), items, cut, totalConnections, totalFolders);
    }

    /// <summary>
    /// A porta DRDA que a pessoa preencheu para o servidor do DBeaver desta conexão Informix (o host, a porta SQLI e o `INFORMIXSERVER`, comparados como vêm), ou nulo.
    /// Só a conexão que pode ser importada recebe: a que não pode não tem porta.
    /// </summary>
    private static int? DrdaPortOf(DbeaverConnectionModel model, IReadOnlyDictionary<(string Host, int Port, string? Server), DbeaverDrdaPort> drda)
    {
        if (model.Engine != EDatabaseEngine.Informix || model.Refusal is not null || model.SqliPort is not { } sqli || model.Host.Text is not { } host)
            return null;

        return drda.TryGetValue((host, sqli, model.Server), out var entry) ? entry.DrdaPort : null;
    }

    private static ImportedFolder NewFolder(string key, string? parentKey, string name, HashSet<string> cut)
    {
        // RN-DBEAVER-011: o nome com mais de 60 caracteres é cortado em 60, sem partir um par de substitutos; a pasta diz que foi cortado.
        var normalized = name.NormalizeName();
        var shown = normalized;
        if (normalized.Length > FolderRules.NameMaxLength)
        {
            shown = TextRules.Cut(normalized, FolderRules.NameMaxLength).TrimEnd();
            cut.Add(key);
        }

        return new ImportedFolder(
            key, parentKey, new FileValue(JsonValueKind.String, shown), FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent,
            new FileEffective(JsonValueKind.Undefined, FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent));
    }

    private static ImportedConnection NewConnection(string key, string? folderKey, DbeaverConnectionModel model, bool withPasswords, int? drdaPort)
        => new(
            key, folderKey, model.Name, model.EngineValue, model.Host,
            drdaPort is { } port ? new FileValue(JsonValueKind.Number, port.ToString(System.Globalization.CultureInfo.InvariantCulture)) : model.Port,
            model.Database, model.UserName, withPasswords ? model.Password : FileValue.Absent,
            model.EnvironmentName, model.EnvironmentColor, model.ConfirmCommands, model.ReadOnly,
            FileValue.Absent, FileValue.Absent, FileValue.Absent,
            new FileEffective(JsonValueKind.Undefined, FileValue.Absent, FileValue.Absent, FileValue.Absent, FileValue.Absent),
            model.Refusal);
}

/// <summary>Uma conexão do arquivo montado: a chave, o nome inteiro do projeto de onde veio (a origem, RN-DBEAVER-018), a conexão traduzida e a porta DRDA aplicada, quando houve.</summary>
internal sealed record DbeaverItem(string Key, string ProjectName, DbeaverConnectionModel Model, int? DrdaPort)
{
    public override string ToString()
        => nameof(DbeaverItem);
}

/// <summary>A porta DRDA de um servidor Informix do DBeaver, preenchida na tabela "Porta DRDA do Informix" do diálogo: o servidor é o host, a porta SQLI e o `INFORMIXSERVER` (nulo sem ele).</summary>
internal sealed record DbeaverDrdaPort(string Host, int Port, string? Server, int DrdaPort)
{
    public override string ToString()
        => nameof(DbeaverDrdaPort);
}
