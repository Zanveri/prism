using FluentValidation;
using Prism.Application.Common.Texts;
using Prism.Application.ConnectionTransfers.Models;

namespace Prism.Application.ConnectionTransfers.Features.ExportConnections;

/// <summary>
/// RN-TRANSF-004, 006 e 008, nesta ordem: o pedido vazio (`EXPORT_EMPTY`), o malformado (`EXPORT_INVALID`: a escolha fora da lista, o mesmo ID duas vezes
/// em `connections`), as listas acima de 2.000 IDs (`EXPORT_LIMITS_EXCEEDED`) e a senha de exportação (`EXPORT_PASSPHRASE_INVALID`, no campo `passphrase`),
/// com a mesma regra da tela. Nada aqui lê o cofre nem deriva: o que depende do cofre e da senha do Prism é do handler.
/// </summary>
public sealed class ExportConnectionsValidator : AbstractValidator<ExportConnectionsCommand>
{
    public ExportConnectionsValidator()
    {
        RuleFor(request => request.Connections).Must((request, connections) => (request.FolderIDs?.Count ?? 0) + (connections?.Count ?? 0) > 0).WithMessage(TransferErrors.ExportEmptyMessage).WithErrorCode("EXPORT_EMPTY");

        RuleFor(request => request.Connections).Must(connections => connections is null || connections.All(choice => choice is not null && TransferRules.CredentialsAreValid(choice.Credentials))).WithMessage("Escolha o que vai de cada conexão: sem usuário e senha, só o usuário, ou usuário e senha.").WithErrorCode("EXPORT_INVALID");
        RuleFor(request => request.Connections).Must(connections => connections is null || connections.Where(choice => choice is not null).Select(choice => choice!.ID).Distinct().Count() == connections.Count(choice => choice is not null)).WithMessage("A mesma conexão foi marcada duas vezes.").WithErrorCode("EXPORT_INVALID");

        RuleFor(request => request.FolderIDs).Must(folderIDs => folderIDs is null || folderIDs.Count <= TransferLimits.MaxFolders).WithMessage(TransferErrors.ExportLimitsMessage).WithErrorCode("EXPORT_LIMITS_EXCEEDED");
        RuleFor(request => request.Connections).Must(connections => connections is null || connections.Count <= TransferLimits.MaxConnections).WithMessage(TransferErrors.ExportLimitsMessage).WithErrorCode("EXPORT_LIMITS_EXCEEDED");

        RuleFor(request => request.Passphrase).MustPass(PassphraseRules.ExportRefusal).WithErrorCode("EXPORT_PASSPHRASE_INVALID");
    }
}
