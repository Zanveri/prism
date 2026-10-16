namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>As regras do pedido de exportação que valem antes do handler, sem ler o cofre nem derivar nada (RN-TRANSF-003 e 008).</summary>
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
}
