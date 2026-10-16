using Prism.Core.Api.Models.Dtos;

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

    public const string ExportEmptyMessage = "Marque ao menos uma conexão ou pasta para exportar.";

    /// <summary>RN-TRANSF-006: as contagens e os níveis, que se sabem com o cofre lido, e o tamanho, que se sabe com o arquivo montado.</summary>
    public static ApiErrorDto ExportLimitsExceeded()
        => ApiErrorDto.CreateUnprocessableEntity("Exportação além dos limites.", "EXPORT_LIMITS_EXCEEDED", ExportLimitsMessage);

    /// <summary>RN-TRANSF-005: a senha do Prism é pedida (vai ao menos uma senha de banco), e não veio. Nada foi conferido nem contado.</summary>
    public static ApiErrorDto UserPasswordRequired()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha do usuário necessária.", "USER_PASSWORD_REQUIRED", "UserPassword", "Para exportar senhas de banco, informe a sua senha do Prism.");

    /// <summary>RN-TRANSF-004: a senha de exportação igual à senha do Prism que veio no pedido e conferiu.</summary>
    public static ApiErrorDto PassphraseEqualsUserPassword()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Senha de exportação inválida.", "EXPORT_PASSPHRASE_INVALID", "Passphrase", "Use uma senha de exportação diferente da sua senha do Prism.");
}
