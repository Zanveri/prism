using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Prism.TestingCore.Fakers.Dbeaver;

/// <summary>
/// RN-DBEAVER-006 e a seção "Testes e sondas": monta, na pasta `transfers`, a cópia que o processo principal faria de um DBeaver SINTÉTICO (`&lt;sourceId&gt;.dbeaver/`
/// com o `manifest.json` e uma subpasta por projeto, `1`, `2`…). Tudo é inventado à mão: hosts do domínio reservado `.invalid`, usuários e senhas fictícios. O
/// `credentials-config.json` é cifrado aqui, no próprio teste, com a chave pública do DBeaver Community (a do comando `openssl` que a especificação cita; é uma cópia
/// independente da constante da API, de propósito: o teste prova que a API decifra o que o DBeaver cifra) e um IV conhecido ou sorteado. O arquivo de exemplo
/// real do dono não entra nunca, nem em fixture, nem em teste, nem em log.
/// </summary>
public sealed class DbeaverCopyBuilder(string transfersDirectory)
{
    /// <summary>A chave do comando `openssl aes-128-cbc -d -K …` da especificação (AES-128): pública, do código aberto do DBeaver.</summary>
    private const string KeyHex = "babb4a9f774ab853c96c2d653dfe544a";

    private readonly List<DbeaverProjectDraft> _projects = [];
    private string _where = "standard";

    public Guid SourceId { get; } = Guid.NewGuid();

    /// <summary>A pasta da cópia, `transfers/&lt;sourceId&gt;.dbeaver`.</summary>
    public string Folder
        => Path.Combine(transfersDirectory, $"{SourceId:D}.dbeaver");

    public DbeaverCopyBuilder Where(string where)
    {
        _where = where;

        return this;
    }

    public DbeaverCopyBuilder Project(string name, Action<DbeaverProjectDraft> configure)
    {
        var project = new DbeaverProjectDraft(name);
        configure(project);
        _projects.Add(project);

        return this;
    }

    /// <summary>Escreve a cópia e devolve o `sourceId`. O manifesto vai por último, como no processo principal.</summary>
    public Guid Build()
    {
        Directory.CreateDirectory(Folder);

        for (var index = 0; index < _projects.Count; index++)
        {
            var directory = Path.Combine(Folder, (index + 1).ToString());
            Directory.CreateDirectory(directory);
            foreach (var (name, content) in _projects[index].Files)
                File.WriteAllBytes(Path.Combine(directory, name), content);
        }

        var manifest = new
        {
            version = 1,
            where = _where,
            projects = _projects.Select((project, index) => new { folder = (index + 1).ToString(), name = project.Name })
        };
        File.WriteAllText(Path.Combine(Folder, "manifest.json"), JsonSerializer.Serialize(manifest));

        return SourceId;
    }

    /// <summary>O conteúdo cifrado como o DBeaver o grava: o IV (16 bytes, sorteado quando não vem) e depois o AES-128 em CBC com o preenchimento PKCS #7.</summary>
    public static byte[] Encrypt(string json, byte[]? iv = null)
    {
        iv ??= RandomNumberGenerator.GetBytes(16);
        using var aes = Aes.Create();
        aes.Key = Convert.FromHexString(KeyHex);
        var encrypted = aes.EncryptCbc(Encoding.UTF8.GetBytes(json), iv, PaddingMode.PKCS7);

        return [.. iv, .. encrypted];
    }

    /// <summary>`{ "&lt;ID&gt;": { "#connection": { "user": "…", "password": "…" } } }`; o que é nulo ou vazio não é escrito, como o DBeaver faz. Mais um nó de túnel e uma entrada de perfil, que a API ignora.</summary>
    public static string CredentialsJson(params (string Id, string? User, string? Password)[] entries)
    {
        var root = new Dictionary<string, object>();
        foreach (var (id, user, password) in entries)
        {
            var login = new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(user))
                login["user"] = user;

            if (!string.IsNullOrEmpty(password))
                login["password"] = password;

            root[id] = new Dictionary<string, object>
            {
                ["#connection"] = login,
                ["network/ssh_tunnel"] = new Dictionary<string, string> { ["user"] = "usuario-do-tunel", ["password"] = "senha-do-tunel-fictícia" }
            };
        }

        root["profile:perfil-qualquer"] = new Dictionary<string, object> { ["#connection"] = new Dictionary<string, string> { ["user"] = "usuario-de-perfil", ["password"] = "senha-de-perfil-fictícia" } };

        return JsonSerializer.Serialize(root);
    }
}

/// <summary>Os arquivos de um projeto da cópia, por nome, que o <see cref="DbeaverCopyBuilder"/> escreve na subpasta dele.</summary>
public sealed class DbeaverProjectDraft(string name)
{
    public string Name { get; } = name;

    public Dictionary<string, byte[]> Files { get; } = new(StringComparer.Ordinal);

    public DbeaverProjectDraft Add(string fileName, string text)
    {
        Files[fileName] = Encoding.UTF8.GetBytes(text);

        return this;
    }

    public DbeaverProjectDraft Add(string fileName, byte[] content)
    {
        Files[fileName] = content;

        return this;
    }

    /// <summary>`data-sources.json` (sufixo vazio) ou `data-sources-&lt;sufixo&gt;.json` (o sufixo com o hífen: `-2`).</summary>
    public DbeaverProjectDraft DataSources(string json, string suffix = "")
        => Add($"data-sources{suffix}.json", json);

    /// <summary>O `credentials-config` do par, cifrado com a chave pública do DBeaver e um IV sorteado.</summary>
    public DbeaverProjectDraft Credentials(string json, string suffix = "", byte[]? iv = null)
        => Add($"credentials-config{suffix}.json", DbeaverCopyBuilder.Encrypt(json, iv));

    public DbeaverProjectDraft Settings(string json)
        => Add("project-settings.json", json);
}
