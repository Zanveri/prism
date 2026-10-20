using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.Connections.Models;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-017: a conexão que já existe, e sobrescrever. A conexão do DBeaver "já existe no Prism" quando alguma conexão do cofre tem a mesma origem (o mesmo ID do
/// DBeaver e o mesmo projeto, pelo nome sem diferenciar maiúsculas), onde quer que ela esteja na árvore; com mais de uma, vale a primeira na ordem da árvore. A
/// conexão feita à mão no Prism, sem origem, com o mesmo nome no mesmo lugar, é o conflito de nome da RN-TRANSF-012, e nunca é sobrescrita.
/// </summary>
internal static class DbeaverReimport
{
    /// <summary>A chave da origem: o projeto sem diferenciar maiúsculas, e o ID do DBeaver como veio.</summary>
    public static string OriginKey(string project, string id)
        => $"{project.ToUpperInvariant()}\0{id}";

    /// <summary>
    /// As conexões do cofre que vieram do DBeaver, pela origem. Com mais de uma na mesma origem, a primeira na ordem da árvore do navegador: o caminho das pastas, o
    /// nome e, por fim, o ID, para a escolha não depender da ordem em que o cofre guarda.
    /// </summary>
    public static IReadOnlyDictionary<string, VaultConnectionRecord> Index(VaultDocument document)
    {
        var folders = ProtectionRules.FoldersOf(document);
        var index = new Dictionary<string, VaultConnectionRecord>(StringComparer.Ordinal);
        var paths = new Dictionary<Guid, string>();

        foreach (var record in document.Connections.Where(record => record.Origin is { Source: VaultConnectionOrigin.DbeaverSource }))
        {
            var key = OriginKey(record.Origin!.Project, record.Origin.ID);
            if (!index.TryGetValue(key, out var current) || IsBefore(record, current, folders, paths))
                index[key] = record;
        }

        return index;
    }

    /// <summary>O caminho das pastas da conexão, `Estoque / Produção` (vazio na raiz): é o que a prévia diz de onde ela está.</summary>
    public static string PathOf(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid? folderID)
    {
        var names = new List<string>();
        var visited = new HashSet<Guid>();
        var current = folderID;

        while (current is { } id && visited.Add(id) && folders.TryGetValue(id, out var folder))
        {
            names.Add(folder.Name);
            current = folder.ParentID;
        }

        names.Reverse();

        return string.Join(" / ", names);
    }

    private static bool IsBefore(VaultConnectionRecord candidate, VaultConnectionRecord current, IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Dictionary<Guid, string> paths)
    {
        var byPath = string.Compare(PathCached(candidate, folders, paths), PathCached(current, folders, paths), StringComparison.OrdinalIgnoreCase);
        if (byPath != 0)
            return byPath < 0;

        var byName = string.Compare(candidate.Name, current.Name, StringComparison.OrdinalIgnoreCase);

        return byName != 0 ? byName < 0 : candidate.ID.CompareTo(current.ID) < 0;
    }

    private static string PathCached(VaultConnectionRecord record, IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Dictionary<Guid, string> paths)
    {
        if (!paths.TryGetValue(record.ID, out var path))
            paths[record.ID] = path = PathOf(folders, record.FolderID);

        return path;
    }

    /// <summary>
    /// O que sobrescrever faz na conexão que já existe, e o que isso muda (RN-DBEAVER-017). Muda o nome (se ele não está tomado por outra conexão na pasta dela), o banco,
    /// o host, a porta (menos no Informix, a menos que a porta DRDA do servidor tenha sido preenchida), o banco de dados, o usuário, a senha (só a que vem do DBeaver; a
    /// do Prism só continua para o servidor e para o usuário para os quais foi gravada, RN-CONN-004) e o ambiente (o do DBeaver; sem ele, o do Prism fica). Fica o ID, a
    /// pasta, a verificação, a data de criação e a origem; a data de alteração é a da importação. As proteções nunca ficam mais fracas: o somente leitura fica ligado
    /// se estava num dos dois, e a confirmação é a mais forte das duas.
    /// </summary>
    /// <param name="drdaApplied">A porta do candidato é a DRDA que a pessoa preencheu: a porta do Informix é sobrescrita.</param>
    /// <param name="nameTaken">O nome novo já é de outra conexão na pasta da conexão do Prism.</param>
    public static OverwritePlan Plan(VaultConnectionRecord existing, ConnectionCandidate candidate, ImportOrigin origin, bool drdaApplied, bool nameTaken, DateTime now)
    {
        // A porta do DBeaver no Informix é a do protocolo SQLI, e a do Prism é a DRDA, que a pessoa pode ter trocado depois de importar: ela fica, a menos que a
        // pessoa tenha dado a DRDA do servidor. Se o banco da conexão do Prism não é Informix (o tipo da conexão mudou no DBeaver), a porta que ela tem não é DRDA.
        var keepsPort = existing.Engine == EDatabaseEngine.Informix && candidate.Engine == EDatabaseEngine.Informix && !drdaApplied;
        var port = keepsPort ? existing.Port : candidate.Port;

        var nameChanges = !string.Equals(existing.Name, candidate.Name, StringComparison.Ordinal);
        var keepsName = nameChanges && nameTaken;

        var serverChanges = !ConnectionRules.SameServer(existing.Host, existing.Port, candidate.Host, port);
        var userChanges = !string.Equals(existing.UserName.Trim(), candidate.UserName, StringComparison.Ordinal);
        var comesWithPassword = candidate.Password.Length > 0;
        var dropsPassword = !comesWithPassword && (serverChanges || userChanges) && existing.Password.Length > 0;

        var password = comesWithPassword ? candidate.Password : serverChanges || userChanges ? string.Empty : existing.Password;

        // O ambiente é gravado na própria conexão, como na importação; o DBeaver sem ambiente (o nome do tipo que o Prism não aceita) deixa o do Prism como está.
        var environmentName = candidate.EnvironmentName ?? existing.EnvironmentName;
        var environmentColor = candidate.EnvironmentName is null ? existing.EnvironmentColor : candidate.EnvironmentColor;
        var environmentChanges = candidate.EnvironmentName is not null && (!string.Equals(existing.EnvironmentName, candidate.EnvironmentName, StringComparison.Ordinal) || !string.Equals(existing.EnvironmentColor, candidate.EnvironmentColor, StringComparison.Ordinal));

        var updated = existing with
        {
            Name = keepsName || !nameChanges ? existing.Name : candidate.Name,
            Engine = candidate.Engine,
            Host = candidate.Host,
            Port = port,
            Database = candidate.Database,
            UserName = candidate.UserName,
            Password = password,
            EnvironmentName = environmentName,
            EnvironmentColor = environmentColor,
            ReadOnly = existing.ReadOnly == true || origin.ReadOnly ? true : existing.ReadOnly,
            ConfirmCommands = ProtectionRules.Rank(origin.ConfirmCommands) > ProtectionRules.Rank(existing.ConfirmCommands) ? origin.ConfirmCommands : existing.ConfirmCommands,
            UpdatedAt = now
        };

        var flags = new OverwriteFlags(
            Name: nameChanges && !keepsName,
            Engine: existing.Engine != candidate.Engine,
            Host: !string.Equals(existing.Host.Trim(), candidate.Host, StringComparison.Ordinal),
            Port: existing.Port != port,
            Database: !string.Equals(existing.Database.Trim(), candidate.Database, StringComparison.Ordinal),
            UserName: userChanges,
            Password: comesWithPassword && !string.Equals(existing.Password, candidate.Password, StringComparison.Ordinal),
            Environment: environmentChanges,
            KeepsName: keepsName,
            DropsPassword: dropsPassword);

        return new OverwritePlan(updated, flags);
    }
}

/// <summary>O que sobrescrever muda: cada campo verdadeiro quando muda (`KeepsName`: o nome novo está tomado e fica o do Prism; `DropsPassword`: a conexão fica sem senha).</summary>
internal sealed record OverwriteFlags(bool Name, bool Engine, bool Host, bool Port, bool Database, bool UserName, bool Password, bool Environment, bool KeepsName, bool DropsPassword);

/// <summary>A conexão como ficaria depois de sobrescrita, e o que mudou nela. O registro carrega a senha: o `ToString()` não a imprime.</summary>
internal sealed record OverwritePlan(VaultConnectionRecord Updated, OverwriteFlags Flags)
{
    public override string ToString()
        => nameof(OverwritePlan);
}
