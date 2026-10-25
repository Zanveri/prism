namespace Prism.Infrastructure.DbeaverSources.Models;

/// <summary>
/// RN-DBEAVER-006: a cópia que o processo principal fez dos arquivos do DBeaver (`transfers/&lt;sourceId&gt;.dbeaver/`), como a API a lê: de onde veio
/// (`Where`: `standard`, `flatpak`, `snap`, `env` ou `chosen`) e os projetos, na ordem do manifesto. Os arquivos trazem as senhas do DBeaver na cifra dele
/// (RN-DBEAVER-008): nada daqui vai a log, e o `ToString()` gerado imprimiria o conteúdo.
/// </summary>
public sealed record DbeaverSource(string Where, IReadOnlyList<DbeaverProjectFiles> Projects)
{
    public override string ToString()
        => nameof(DbeaverSource);
}

/// <summary>
/// Um projeto da cópia: a posição dele no manifesto (de 1, o que dá o "Projeto 2" do nome que não serve, RN-DBEAVER-006), o nome da pasta dele no DBeaver
/// (como o manifesto o escreveu) e os arquivos conhecidos que a cópia tem dele, em ordem ordinal do nome.
/// </summary>
public sealed record DbeaverProjectFiles(int Position, string Name, IReadOnlyList<DbeaverFile> Files)
{
    public override string ToString()
        => nameof(DbeaverProjectFiles);
}

/// <summary>
/// Um arquivo da `.dbeaver` copiado (`data-sources.json`, `data-sources-&lt;sufixo&gt;.json`, `credentials-config.json`, `credentials-config-&lt;sufixo&gt;.json`
/// ou `project-settings.json`). `Content` é nulo quando o arquivo não pôde ser lido (passa de 5 MiB, é um atalho, ou o sistema não deixou): quem lê trata como
/// o arquivo que não abriu. Quem usa as credenciais zera o `Content` depois de decifrá-lo.
/// </summary>
public sealed record DbeaverFile(string Name, byte[]? Content)
{
    public override string ToString()
        => nameof(DbeaverFile);
}
