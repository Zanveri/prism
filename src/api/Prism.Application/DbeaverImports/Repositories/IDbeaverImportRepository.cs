using CSharpFunctionalExtensions;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.DbeaverImports.Repositories;

/// <summary>Internal, como a `IConnectionImportRepository`: a assinatura trafega o que a importação conferiu, que é internal.</summary>
internal interface IDbeaverImportRepository
{
    /// <summary>
    /// RN-DBEAVER-016: a importação é UMA gravação do cofre (RN-COFRE-005), tudo ou nada, e o `.bak` fica com o cofre de antes dela. Dentro da gravação, contra o
    /// documento mais recente: a geração do cofre lida antes de abrir a cópia (`generation`, mudou: 401 `VAULT_LOCKED`), o lugar escolhido (excluído: 404
    /// `FOLDER_NOT_FOUND`), e a colocação com a reimportação (`DbeaverPlacement`): as novas, as sobrescritas, e a data da importação e o convite feito. Sem nada criado
    /// nem atualizado, nada é gravado. Falha também com o cofre fechado (401) e o disco (503).
    /// </summary>
    Task<Result<DbeaverPlacementResult, ApiErrorDto>> Import(ImportAnalysis analysis, DbeaverAssembly assembly, Guid? targetFolderID, IReadOnlySet<string> selected, IReadOnlySet<string> overwriteKeys, EImportConflict onConflict, long generation, DateTime now, CancellationToken cancellationToken);
}
