using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Workspaces.Domain;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Workspaces.Repositories;

/// <summary>
/// Grava a área de trabalho pelo serviço do cofre (RN-ABAS-006: cifrada como os scripts, RN-SCRIPT-002). Não há regra que uma requisição concorrente possa
/// quebrar: a gravada troca a anterior inteira, e a última a chegar ao semáforo é a que fica. A mesma área de trabalho de novo (a tela grava a cada mudança e
/// antes de o cofre fechar, e muitas vezes nada mudou) devolve o documento que recebeu, e o serviço não regrava por isso: o `.bak` continua com a versão
/// anterior de verdade.
/// </summary>
internal sealed class WorkspaceRepository(IVaultService vaultService) : IWorkspaceRepository
{
    public Task<UnitResult<ApiErrorDto>> Replace(Workspace workspace, CancellationToken cancellationToken)
        => vaultService.SaveOrRefuse(document =>
        {
            var record = ToRecord(workspace);
            if (IsTheSame(document.Workspace, record))
                return document;

            return document with { Workspace = record };
        }, cancellationToken);

    /// <summary>Os registros das abas são records só de valores (texto, Guid, booleano): a igualdade gerada compara campo a campo.</summary>
    private static bool IsTheSame(VaultWorkspaceRecord current, VaultWorkspaceRecord next)
        => current.ActiveIndex == next.ActiveIndex && current.Tabs.SequenceEqual(next.Tabs);

    private static VaultWorkspaceRecord ToRecord(Workspace workspace)
        => new([.. workspace.Tabs.Select(tab => new VaultWorkspaceTabRecord(tab.Kind, tab.ConnectionID, tab.Database, tab.Sql, tab.ScriptID, tab.Dirty, tab.SqlTooLarge, tab.Schema, tab.Table, tab.View))], workspace.ActiveIndex);
}
