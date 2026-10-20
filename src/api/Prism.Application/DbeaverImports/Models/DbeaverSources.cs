using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.Infrastructure.DbeaverSources.Services;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>A cópia lida: de onde veio (`standard`, `flatpak`, `snap`, `env` ou `chosen`), quantos projetos o manifesto tem e os projetos lidos, na ordem dele.</summary>
internal sealed record DbeaverRead(string Where, int ProjectsInSource, IReadOnlyList<DbeaverProjectModel> Projects)
{
    public override string ToString()
        => nameof(DbeaverRead);
}

/// <summary>Tudo o que a prévia e a importação precisam, igual nas duas: a leitura, os projetos que entram, o arquivo montado e a análise dele.</summary>
internal sealed record DbeaverPrepared(DbeaverRead Read, IReadOnlyList<DbeaverProjectModel> Included, DbeaverAssembly Assembly, ImportAnalysis Analysis, bool ProjectChosen)
{
    public override string ToString()
        => nameof(DbeaverPrepared);
}

/// <summary>
/// RN-DBEAVER-006 e 007: abrir a cópia pelo `sourceId`, ler os projetos e escolher quais entram (o projeto pedido, ou todos os que podem ser lidos). Cada pedido lê a
/// cópia e decifra de novo; a API não guarda nada entre um pedido e outro.
/// </summary>
internal static class DbeaverSources
{
    /// <param name="onlyProject">O nome (exato) do projeto escolhido: só ele é lido. Nulo lê todos.</param>
    public static Result<DbeaverRead, ApiErrorDto> Read(IDbeaverSourceService source, Guid sourceId, string? onlyProject)
    {
        var opened = source.Open(sourceId);
        if (opened.IsFailure)
            return opened.Error == EDbeaverSourceError.Missing ? DbeaverErrors.SourceMissing() : DbeaverErrors.SourceInvalid();

        var projects = opened.Value.Projects
            .Where(project => onlyProject is null || string.Equals(project.Name, onlyProject, StringComparison.Ordinal))
            .Select(project => DbeaverProjects.Read(source, project))
            .ToList();

        return new DbeaverRead(opened.Value.Where, opened.Value.Projects.Count, projects);
    }

    /// <summary>
    /// Os projetos que entram. Com o projeto pedido: ele, se está na cópia, não é protegido por senha de projeto nem tem o nome que o Prism não aceita (senão 404
    /// `DBEAVER_PROJECT_NOT_FOUND`), e se foi lido (senão `DBEAVER_SOURCE_INVALID`). Sem ele, todos os que foram lidos; nenhum é `DBEAVER_SOURCE_INVALID`.
    /// </summary>
    public static Result<IReadOnlyList<DbeaverProjectModel>, ApiErrorDto> Choose(DbeaverRead read, string? project)
    {
        if (project is not null)
        {
            var chosen = read.Projects.FirstOrDefault(candidate => string.Equals(candidate.Name, project, StringComparison.Ordinal));
            if (chosen is null || chosen.Protected || chosen.NameInvalid)
                return DbeaverErrors.ProjectNotFound();

            return chosen.Readable ? Result.Success<IReadOnlyList<DbeaverProjectModel>, ApiErrorDto>([chosen]) : DbeaverErrors.SourceInvalid();
        }

        var included = read.Projects.Where(candidate => candidate.Included).ToList();

        return included.Count > 0 ? Result.Success<IReadOnlyList<DbeaverProjectModel>, ApiErrorDto>(included) : DbeaverErrors.SourceInvalid();
    }

    /// <summary>
    /// A leitura, a escolha, o arquivo montado (com os limites da RN-DBEAVER-007) e a análise dele (RN-TRANSF-010, etapa 7, e RN-TRANSF-014): o mesmo caminho da prévia e
    /// da importação. Os 32 níveis que a análise confere dão o mesmo `DBEAVER_LIMITS_EXCEEDED`.
    /// </summary>
    public static Result<DbeaverPrepared, ApiErrorDto> Prepare(IDbeaverSourceService source, Guid sourceId, string? project, bool withPasswords, IReadOnlyList<DbeaverDrdaPort> drdaPorts)
    {
        var read = Read(source, sourceId, project);
        if (read.IsFailure)
            return read.Error;

        var included = Choose(read.Value, project);
        if (included.IsFailure)
            return included.Error;

        var many = project is null && read.Value.ProjectsInSource > 1;
        var assembly = DbeaverAssembly.Build(included.Value, withPasswords, drdaPorts, many);
        if (assembly.IsFailure)
            return assembly.Error;

        var analysis = ImportAnalysis.Analyze(assembly.Value.File);
        if (analysis.IsFailure)
            return analysis.Error.Type == "IMPORT_LIMITS_EXCEEDED" ? DbeaverErrors.LimitsExceeded(many) : DbeaverErrors.SourceInvalid();

        return new DbeaverPrepared(read.Value, included.Value, assembly.Value, analysis.Value, project is not null);
    }

    /// <summary>
    /// RN-DBEAVER-015: os avisos da prévia. Os projetos protegidos (`secureProject`) só são avisados em "Todos os projetos" (com um escolhido, ele é o único que
    /// vale); as senhas que não puderam ser lidas, as protegidas e os arquivos ilegíveis, dos projetos que entram; e as contagens das conexões importáveis sem
    /// "Salvar senha" no DBeaver (`WithoutSavedPassword`) e com "Salvar senha" mas sem a senha no arquivo (`SavedPasswordMissing`, RN-DBEAVER-008).
    /// </summary>
    public static DbeaverNotesDto Notes(DbeaverPrepared prepared)
    {
        var projects = prepared.Read.Projects;
        var byName = prepared.Included.ToDictionary(project => project.Name, StringComparer.Ordinal);
        var withoutSavedPassword = 0;
        var savedPasswordMissing = 0;

        foreach (var item in prepared.Analysis.Connections.Where(connection => connection.Candidate is not null))
        {
            var dbeaver = prepared.Assembly.Items[item.Key];
            var model = dbeaver.Model;

            // O login que não é do arquivo (`auth-model`) e a senha que o DBeaver trouxe não entram na conta.
            if (model.AuthModel is not null || model.PasswordFound)
                continue;

            var project = byName[dbeaver.ProjectName];
            if (!model.SavePassword)
                withoutSavedPassword++;
            else if (!project.CredentialsUnreadable && !project.CredentialsProtected)
                savedPasswordMissing++;
        }

        return new DbeaverNotesDto
        {
            ProtectedProjects = prepared.ProjectChosen ? [] : [.. projects.Where(project => project.Protected && !project.NameInvalid).Select(project => project.DisplayName)],
            CredentialsUnreadable = [.. prepared.Included.Where(project => project.CredentialsUnreadable).Select(project => project.DisplayName)],
            CredentialsProtected = [.. prepared.Included.Where(project => project.CredentialsProtected).Select(project => project.DisplayName)],
            UnreadableFiles = [.. projects.Where(project => !project.NameInvalid && !project.Protected && (project.UnreadableFiles > 0 || !project.Readable)).Select(project => project.DisplayName)],
            UnreadableProjects = [.. projects.Where(project => !project.NameInvalid && !project.Protected && !project.Readable).Select(project => project.DisplayName)],
            WithoutSavedPassword = withoutSavedPassword,
            SavedPasswordMissing = savedPasswordMissing
        };
    }
}
