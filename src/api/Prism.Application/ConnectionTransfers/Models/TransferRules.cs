using FluentValidation;
using Prism.Application.Common.Texts;
using System.Text;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>As regras dos pedidos de exportação e de importação que valem antes do handler, sem ler o cofre nem derivar nada (RN-TRANSF-004, 006, 008, 010 e 014).</summary>
internal static class TransferRules
{
    /// <summary>RN-TRANSF-003 e seção 34: `none`, `user` ou `userAndPassword`, como a API os escreve; ausente ou nulo é `none`.</summary>
    public static bool CredentialsAreValid(string? credentials)
        => credentials is null or "none" or "user" or "userAndPassword";

    public static ETransferCredentials CredentialsOf(string? credentials)
        => credentials switch
        {
            "user" => ETransferCredentials.User,
            "userAndPassword" => ETransferCredentials.UserAndPassword,
            _ => ETransferCredentials.None
        };

    /// <summary>RN-TRANSF-012: `rename` ou `skip`; ausente ou nulo é `rename`.</summary>
    public static bool ConflictIsValid(string? onConflict)
        => onConflict is null or "rename" or "skip";

    public static EImportConflict ConflictOf(string? onConflict)
        => onConflict == "skip" ? EImportConflict.Skip : EImportConflict.Rename;

    /// <summary>RN-TRANSF-010, etapa 1: o texto do arquivo tem até 5 MiB (5.242.880 bytes em UTF-8), conferido antes de qualquer leitura.</summary>
    public static IRuleBuilderOptions<T, string> MustFitTheImportLimit<T>(this IRuleBuilder<T, string> rule)
        => rule.Must(content => Encoding.UTF8.GetByteCount(content ?? string.Empty) <= TransferLimits.MaxFileBytes).WithMessage(TransferErrors.ImportLimitsMessage).WithErrorCode("IMPORT_LIMITS_EXCEEDED");

    /// <summary>RN-TRANSF-010, etapa 2: a senha de exportação da importação, sem derivar nada.</summary>
    public static IRuleBuilderOptions<T, string> MustBeAnImportPassphrase<T>(this IRuleBuilder<T, string> rule)
        => rule.MustPass(PassphraseRules.ImportRefusal).WithErrorCode("IMPORT_PASSPHRASE_INVALID");
}
