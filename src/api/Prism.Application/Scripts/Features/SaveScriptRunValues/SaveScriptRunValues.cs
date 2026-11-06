using CSharpFunctionalExtensions;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Models;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Prism.Application.Scripts.Features.SaveScriptRunValues;

/// <summary>
/// RN-VAR-028: `PUT api/user/scripts/{id}/run-values` `{ values, connectionID?, database? }` grava os valores lembrados do "Executar com valores…" no registro do
/// script, no cofre, no lugar dos de antes. `values` vai como veio (a API não interpreta os valores; o validator confere a forma); `connectionID` e `database` são a
/// conexão e o banco escolhidos no script genérico, como no script (RN-SCRIPT-005): sem conexão não há banco, e o banco vazio é o da conexão. O mapa vazio sem
/// conexão não tem o que lembrar e esquece os valores (`runValues` volta nulo): é o "Esquecer os valores deste script".
/// </summary>
public sealed record SaveScriptRunValuesCommand : IRequest<UnitResult<ApiErrorDto>>
{
    /// <summary>Da rota, e não do corpo.</summary>
    [JsonIgnore]
    public Guid ID { get; init; }

    public JsonElement? Values { get; init; }
    public Guid? ConnectionID { get; init; }
    public string? Database { get; init; }

    /// <summary>RN-VAR-036: os valores são dados da pessoa.</summary>
    public override string ToString() => nameof(SaveScriptRunValuesCommand);
}

internal sealed class SaveScriptRunValuesHandler(IScriptRepository scriptRepository, TimeProvider timeProvider) : IRequestHandler<SaveScriptRunValuesCommand, UnitResult<ApiErrorDto>>
{
    public Task<UnitResult<ApiErrorDto>> Handle(SaveScriptRunValuesCommand request, CancellationToken cancellationToken)
    {
        // O validator já recusou o que não é um objeto.
        var values = request.Values!.Value;
        var database = request.ConnectionID is null || string.IsNullOrEmpty(request.Database) ? null : request.Database;
        var runValues = request.ConnectionID is null && !values.EnumerateObject().Any()
            ? null
            : new VaultScriptRunValuesRecord(values.Clone(), request.ConnectionID, database, timeProvider.GetUtcNow().UtcDateTime);

        return scriptRepository.SaveRunValues(request.ID, runValues, cancellationToken);
    }
}
