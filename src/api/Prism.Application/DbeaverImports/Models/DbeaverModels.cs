using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-007: um projeto da cópia, lido (ou não): o nome inteiro da pasta dele no DBeaver (a origem das conexões, RN-DBEAVER-018) e o nome que a tela mostra
/// (`Projeto N` pela posição no manifesto quando o nome não serve, RN-DBEAVER-006), se está protegido por senha de projeto (`secureProject`: não é lido), se o
/// `credentials-config` está protegido (`useProjectPassword`) ou não pôde ser lido, quantos `data-sources*.json` não puderam ser lidos, as pastas (os caminhos,
/// com os pais) e as conexões. `Readable` é ter lido ao menos um arquivo de conexões. `PathsOverLimit` é ter um caminho de pastas grande demais para ser aberto em pais
/// (<see cref="DbeaverProjects.MaxPathSegments"/>, <see cref="DbeaverProjects.MaxPathLength"/>), ou pastas demais: a prévia e a importação o recusam como além dos limites. Guarda usuários e senhas do DBeaver: o `ToString()` não os imprime.
/// </summary>
internal sealed record DbeaverProjectModel(
    int Position, string Name, string DisplayName, bool NameInvalid, bool Protected, bool Readable, bool CredentialsProtected, bool CredentialsUnreadable, int UnreadableFiles,
    IReadOnlyList<string> FolderPaths, IReadOnlyList<DbeaverConnectionModel> Connections, bool PathsOverLimit = false)
{
    /// <summary>O projeto que entra na prévia e na importação: lido, não protegido e com o nome que o Prism aceita.</summary>
    public bool Included
        => Readable && !Protected && !NameInvalid;

    /// <summary>O projeto padrão do DBeaver: vai para o lugar escolhido, sem pasta (RN-DBEAVER-011).</summary>
    public bool IsGeneral
        => string.Equals(Name, "General", StringComparison.OrdinalIgnoreCase);

    public override string ToString()
        => nameof(DbeaverProjectModel);
}

/// <summary>
/// Uma conexão do DBeaver já traduzida (RN-DBEAVER-009 a 013), nos campos da forma do arquivo do Prism (`FileValue`, como o `ImportedFile` os lê) para seguir pela
/// mesma análise. `Refusal` é o motivo de não ser importável que só o DBeaver conhece (o banco que o Prism não tem, a URL que não casa, a variável…); as regras de
/// campo da criação a análise aplica. A senha só existe aqui até a resposta ou a gravação (RN-DBEAVER-008): o `ToString()` não a imprime.
/// </summary>
/// <param name="ID">O ID da conexão no DBeaver (a origem dela, RN-DBEAVER-018).</param>
/// <param name="FolderPath">O caminho da pasta do DBeaver, com `/`, ou vazio sem pasta.</param>
/// <param name="Engine">O banco que o Prism conhece; nulo no que não conhece (`Refusal` o explica).</param>
/// <param name="SqliPort">No Informix, a porta que o DBeaver guarda (a do protocolo SQLI); o `Port` do modelo é ela, até a porta DRDA do servidor trocá-la.</param>
/// <param name="Server">No Informix, o `INFORMIXSERVER`; nulo sem ele.</param>
/// <param name="DbeaverType">O nome do tipo de conexão no DBeaver, cortado em 30; nulo quando tem caractere de controle ou de direção do texto.</param>
/// <param name="AuthModel">O modelo de autenticação do DBeaver quando não é o `native`, cortado em 60.</param>
/// <param name="LeftOut">Os códigos do que ficou de fora (RN-DBEAVER-013), na ordem da especificação.</param>
/// <param name="SavePassword">O "Salvar senha" da conexão no DBeaver.</param>
/// <param name="PasswordFound">O DBeaver trouxe a senha (e o usuário, sem o qual ela não vem), antes de "Levar as senhas".</param>
internal sealed record DbeaverConnectionModel(
    string ID, string FolderPath, string? Refusal, EDatabaseEngine? Engine,
    FileValue Name, FileValue EngineValue, FileValue Host, FileValue Port, FileValue Database, FileValue UserName, FileValue Password,
    FileValue EnvironmentName, FileValue EnvironmentColor, FileValue ConfirmCommands, FileValue ReadOnly,
    int? SqliPort, string? Server, string? DbeaverType, string? AuthModel, IReadOnlyList<string> LeftOut, bool SavePassword, bool PasswordFound)
{
    public override string ToString()
        => nameof(DbeaverConnectionModel);
}

/// <summary>O usuário e a senha de uma conexão no `credentials-config.json` (o nó `#connection`); o que não veio é nulo.</summary>
internal sealed record DbeaverLogin(string? User, string? Password)
{
    public override string ToString()
        => nameof(DbeaverLogin);
}

/// <summary>Um tipo de conexão do DBeaver (RN-DBEAVER-012): o que o `connection-types` do arquivo diz, ou os valores dos três do próprio DBeaver.</summary>
internal sealed record DbeaverType(string ID, string? Name, string? Color, bool? ConfirmExecute, bool? ConfirmDataChange, bool PermissionRestricted);

/// <summary>Os códigos do que fica de fora (RN-DBEAVER-013 e 012), como a prévia os escreve.</summary>
internal static class DbeaverLeftOut
{
    public const string InformixServer = "informixServer";
    public const string SshTunnel = "sshTunnel";
    public const string Proxy = "proxy";
    public const string DriverProperties = "driverProperties";
    public const string Bootstrap = "bootstrap";
    public const string AutocommitOff = "autocommitOff";
    public const string Events = "events";
    public const string AuthModel = "authModel";
    public const string ConfirmDataChange = "confirmDataChange";
    public const string Permissions = "permissions";
    public const string NavigatorFilters = "navigatorFilters";
    public const string EnvironmentCut = "environmentCut";
    public const string EnvironmentInvalid = "environmentInvalid";
}
