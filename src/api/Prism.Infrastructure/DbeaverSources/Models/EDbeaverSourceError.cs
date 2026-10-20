namespace Prism.Infrastructure.DbeaverSources.Models;

/// <summary>
/// As recusas da leitura da cópia do DBeaver (RN-DBEAVER-006). `Missing`: a cópia não existe (apagada, de outra execução, ou com o manifesto ausente), 404
/// `DBEAVER_SOURCE_MISSING`. `Invalid`: o manifesto não é o que o processo principal escreve, e nenhum projeto da cópia pôde ser lido.
/// </summary>
public enum EDbeaverSourceError
{
    Missing,
    Invalid
}

/// <summary>As recusas de decifrar o `credentials-config.json` (RN-DBEAVER-008): nenhuma impede a importação, e as conexões vêm só com o usuário.</summary>
public enum EDbeaverCredentialsError
{
    /// <summary>Menos de 32 bytes, um tamanho que não é múltiplo de 16, ou o preenchimento que não confere (o arquivo não é o que o DBeaver cifra com a chave dele).</summary>
    Undecryptable,

    /// <summary>Decifrou, mas o conteúdo não é um JSON na forma que o Prism lê.</summary>
    Invalid
}
