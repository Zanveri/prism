using Prism.Application.ConnectionTransfers.Models.Dtos;

namespace Prism.Application.DbeaverImports.Models.Dtos;

/// <summary>
/// RN-DBEAVER-007 e a nota da contagem (`scan`): o lugar da cópia (`standard`, `flatpak`, `snap`, `env` ou `chosen`) e, de cada projeto, o que o "Comece por aqui"
/// e o seletor do projeto mostram. A contagem não confere os limites de conexões, pastas e níveis. RN-LOG-001: nada disto vai a log.
/// </summary>
public sealed record DbeaverScanDto
{
    public string Where { get; init; } = string.Empty;
    public IReadOnlyList<DbeaverScanProjectDto> Projects { get; init; } = [];

    public override string ToString()
        => nameof(DbeaverScanDto);
}

/// <summary>
/// Um projeto da contagem. `Name` é o nome da pasta do projeto no DBeaver, ou `Projeto N` (pela posição no manifesto) quando o nome não serve; `Connections`, quantas
/// conexões ele tem (as de fonte externa não contam); `Importable`, quantas o Prism importa; `WithPassword`, quantas destas têm senha; `Protected`, o `secureProject`
/// (o projeto não é lido); `NameInvalid`, o nome que o Prism não aceita; `CredentialsUnreadable`, o `credentials-config` que não pôde ser lido; e
/// `CredentialsProtected`, o `useProjectPassword`.
/// </summary>
public sealed record DbeaverScanProjectDto
{
    public string Name { get; init; } = string.Empty;
    public int Connections { get; init; }
    public int Importable { get; init; }
    public int WithPassword { get; init; }
    public bool Protected { get; init; }
    public bool NameInvalid { get; init; }
    public bool CredentialsUnreadable { get; init; }
    public bool CredentialsProtected { get; init; }

    public override string ToString()
        => nameof(DbeaverScanProjectDto);
}

/// <summary>
/// RN-DBEAVER-015: a prévia. `Folders` e `Connections` são os da prévia da seção 34 com os campos do DBeaver; `Notes`, os avisos. A senha nunca vem (RN-CONN-001):
/// só `HasPassword`. RN-LOG-001: a prévia não vai a log.
/// </summary>
public sealed record DbeaverPreviewDto
{
    public IReadOnlyList<DbeaverPreviewFolderDto> Folders { get; init; } = [];
    public IReadOnlyList<DbeaverPreviewConnectionDto> Connections { get; init; } = [];
    public DbeaverNotesDto Notes { get; init; } = new();

    public override string ToString()
        => nameof(DbeaverPreviewDto);
}

/// <summary>A pasta da prévia (a do DBeaver ou a que o projeto cria), com `NameCut`: o nome do DBeaver tinha mais de 60 caracteres e foi cortado (RN-DBEAVER-011).</summary>
public sealed record DbeaverPreviewFolderDto : ImportPreviewFolderDto
{
    public DbeaverPreviewFolderDto(ImportPreviewFolderDto original) : base(original)
    {
    }

    public bool NameCut { get; init; }

    public sealed override string ToString()
        => nameof(DbeaverPreviewFolderDto);
}

/// <summary>
/// A conexão da prévia: os campos da seção 34 (`VerificationQuery` sempre nula, o DBeaver não tem consulta de verificação) mais os do DBeaver. `Server` é o
/// `INFORMIXSERVER` (nulo fora do Informix e sem ele); `DbeaverPort` é a porta SQLI que o DBeaver guarda no Informix (nulo nos outros), enquanto `Port` é a que a
/// conexão terá; `DrdaPort`, a porta DRDA do servidor que a pessoa preencheu e que `Port` já é (nulo sem ela, e então a conexão leva a marca "porta do DBeaver");
/// `AuthModel`, o modelo de autenticação do DBeaver quando não é o `native`; `DbeaverType`, o nome do tipo de conexão no DBeaver (RN-DBEAVER-012); `Existing`, a
/// conexão do Prism que tem a mesma origem (RN-DBEAVER-017); `Overwrite`, o que sobrescrevê-la mudaria; e `LeftOut`, os códigos do que o Prism não grava (RN-DBEAVER-013).
/// </summary>
public sealed record DbeaverPreviewConnectionDto : ImportPreviewConnectionDto
{
    public DbeaverPreviewConnectionDto(ImportPreviewConnectionDto original) : base(original)
    {
    }

    public string? Server { get; init; }
    public int? DbeaverPort { get; init; }
    public int? DrdaPort { get; init; }
    public string? AuthModel { get; init; }
    public string? DbeaverType { get; init; }
    public DbeaverExistingDto? Existing { get; init; }
    public DbeaverOverwriteDto? Overwrite { get; init; }
    public IReadOnlyList<string> LeftOut { get; init; } = [];

    public sealed override string ToString()
        => nameof(DbeaverPreviewConnectionDto);
}

/// <summary>A conexão do Prism que já veio deste DBeaver: o ID, o nome, o caminho das pastas dela (`Estoque / Produção`, vazio na raiz) e se está conectada em alguma janela.</summary>
public sealed record DbeaverExistingDto
{
    public Guid ConnectionID { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Path { get; init; } = string.Empty;
    public bool Connected { get; init; }

    public override string ToString()
        => nameof(DbeaverExistingDto);
}

/// <summary>
/// RN-DBEAVER-017: o que sobrescrever mudaria na conexão que já existe, cada campo verdadeiro quando muda. `Port` é falso no Informix sem a porta DRDA preenchida;
/// `KeepsName`, o nome novo que já está tomado na pasta dela (ela fica com o dela); `DropsPassword`, o host, a porta ou o usuário que mudam sem a senha vir do
/// DBeaver (a conexão fica sem senha).
/// </summary>
public sealed record DbeaverOverwriteDto
{
    public bool Name { get; init; }
    public bool Engine { get; init; }
    public bool Host { get; init; }
    public bool Port { get; init; }
    public bool Database { get; init; }
    public bool UserName { get; init; }
    public bool Password { get; init; }
    public bool Environment { get; init; }
    public bool KeepsName { get; init; }
    public bool DropsPassword { get; init; }

    public override string ToString()
        => nameof(DbeaverOverwriteDto);
}

/// <summary>
/// RN-DBEAVER-015: os avisos da prévia. Os nomes são os dos projetos: `ProtectedProjects` (o `secureProject` que "Todos os projetos" deixou de fora),
/// `CredentialsUnreadable`, `CredentialsProtected` (o `useProjectPassword`), `UnreadableFiles` (os que têm algum `data-sources*.json` ilegível) e `UnreadableProjects`
/// (os que ficaram de fora porque nenhum arquivo deles pôde ser lido; também estão em `UnreadableFiles`). `WithoutSavedPassword` e `SavedPasswordMissing` são
/// contagens de conexões importáveis (RN-DBEAVER-008).
/// </summary>
public sealed record DbeaverNotesDto
{
    public IReadOnlyList<string> ProtectedProjects { get; init; } = [];
    public IReadOnlyList<string> CredentialsUnreadable { get; init; } = [];
    public IReadOnlyList<string> CredentialsProtected { get; init; } = [];
    public IReadOnlyList<string> UnreadableFiles { get; init; } = [];
    public IReadOnlyList<string> UnreadableProjects { get; init; } = [];
    public int WithoutSavedPassword { get; init; }
    public int SavedPasswordMissing { get; init; }

    public override string ToString()
        => nameof(DbeaverNotesDto);
}

/// <summary>RN-DBEAVER-016: a resposta da importação, a da seção 34 mais `UpdatedIDs`, os IDs das conexões sobrescritas.</summary>
public sealed record ImportedDbeaverDto : ImportedConnectionsDto
{
    public IReadOnlyList<Guid> UpdatedIDs { get; init; } = [];
}
