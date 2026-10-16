using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.ConnectionFiles.Models;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// As recusas da exportação e da importação de conexões (seções 6 e 34 da especificação), num lugar só. As que a tela mostra num campo vêm na forma do erro
/// de campo (`errors` e `errorCodes`, com o nome da propriedade em PascalCase, como o filtro de validação os devolve): `Passphrase` para a senha de
/// exportação, `UserPassword` para a do Prism, `Content` para o arquivo e `Items` para as chaves marcadas. O detalhe é sempre uma frase do Prism: nenhuma
/// recusa repete o conteúdo do arquivo nem uma senha.
/// </summary>
internal static class TransferErrors
{
    /// <summary>RN-TRANSF-006: uma frase só, para um código só: exportar em partes resolve as contagens e o tamanho, e mover resolve os níveis.</summary>
    public const string ExportLimitsMessage = "O arquivo passaria dos limites da importação: até 2.000 conexões, 2.000 pastas, 5 MiB e 32 níveis de pastas a partir da raiz. Exporte em partes; o que está a mais de 32 níveis da raiz só sai se for movido para mais perto dela.";

    /// <summary>RN-TRANSF-010: a frase das etapas 1 e 7, e a que a tela mostra quando recusa o arquivo grande antes de lê-lo.</summary>
    public const string ImportLimitsMessage = "Este arquivo passa dos limites da importação: até 5 MiB, 2.000 conexões, 2.000 pastas e 32 níveis de pastas.";

    public const string ExportEmptyMessage = "Marque ao menos uma conexão ou pasta para exportar.";

    public const string ImportEmptyMessage = "Marque ao menos uma conexão ou pasta para importar.";

    /// <summary>RN-TRANSF-006: as contagens e os níveis, que se sabem com o cofre lido, e o tamanho, que se sabe com o arquivo montado.</summary>
    public static ApiErrorDto ExportLimitsExceeded()
        => ApiErrorDto.CreateUnprocessableEntity("Exportação além dos limites.", "EXPORT_LIMITS_EXCEEDED", ExportLimitsMessage);

    /// <summary>RN-TRANSF-005: a senha do Prism é pedida (vai ao menos uma senha de banco), e não veio. Nada foi conferido nem contado.</summary>
    public static ApiErrorDto UserPasswordRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha do usuário necessária.", "USER_PASSWORD_REQUIRED", "UserPassword", "Para exportar senhas de banco, informe a sua senha do Prism.");

    /// <summary>RN-TRANSF-004: a senha de exportação igual à senha do Prism que veio no pedido e conferiu.</summary>
    public static ApiErrorDto PassphraseEqualsUserPassword()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha de exportação inválida.", "EXPORT_PASSPHRASE_INVALID", "Passphrase", "Use uma senha de exportação diferente da sua senha do Prism.");

    /// <summary>RN-TRANSF-010: as recusas da leitura do arquivo, na API, traduzidas do client do arquivo.</summary>
    public static ApiErrorDto From(EConnectionFileError error)
        => error switch
        {
            EConnectionFileError.Invalid => FileInvalid(),
            EConnectionFileError.Newer => ApiErrorDto.CreateConflict("Arquivo de uma versão mais nova do Prism.", "IMPORT_FILE_NEWER", "Este arquivo foi exportado por uma versão mais nova do Prism. Atualize o Prism para importá-lo."),
            // O AES-GCM não distingue a senha errada do arquivo alterado, e dizer qual seria ajudar quem altera.
            EConnectionFileError.WrongPassphrase => ApiErrorDto.CreateUnprocessableEntityOnField("Senha de exportação incorreta.", "IMPORT_PASSPHRASE_WRONG", "Passphrase", "A senha de exportação não confere, ou o arquivo foi alterado."),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };

    public static ApiErrorDto FileInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Arquivo inválido.", "IMPORT_FILE_INVALID", "Content", "Este arquivo não é uma exportação de conexões do Prism, ou está danificado.");

    public static ApiErrorDto ImportLimitsExceeded()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Arquivo além dos limites.", "IMPORT_LIMITS_EXCEEDED", "Content", ImportLimitsMessage);

    /// <summary>RN-TRANSF-014: uma chave marcada que o arquivo não tem; só se sabe depois de abri-lo. A tela não deixa chegar a isso.</summary>
    public static ApiErrorDto UnknownItem()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "IMPORT_INVALID", "Items", "Uma chave marcada não está no arquivo.");
}
