namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O que o client do arquivo distingue numa falha. "Não existe" não está aqui: é resposta esperada, e
/// volta como sucesso vazio.
/// </summary>
public enum EVaultFileError
{
    /// <summary>
    /// O arquivo não é um cofre legível (JSON quebrado, campo faltando, base64 inválido, parâmetro fora
    /// da faixa) ou a cifra não autenticou. A cifra não distingue chave errada de conteúdo adulterado.
    /// </summary>
    Corrupt,

    /// <summary>Falha de disco: I/O, acesso negado.</summary>
    Unavailable,

    /// <summary>
    /// O cabeçalho declara um número de formato maior que o conhecido (RN-VERSAO-005). Não é `Corrupt`: o arquivo
    /// pode estar perfeito, só é de uma versão mais nova do Prism, e nada nele é aberto, promovido nem regravado.
    /// </summary>
    NewerFormat
}
