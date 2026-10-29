using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.BuildModels.Models;

/// <summary>Erros das rotas <c>api/user/build-models</c> (seção 7 da especificação). O detalhe nunca leva o corpo do modelo (RN-LOG-001).</summary>
internal static class BuildModelErrors
{
    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Modelo não localizado.", "BUILD_MODEL_NOT_FOUND", $"Não existe um modelo com o ID {id}.");

    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict("Modelo já existe.", "BUILD_MODEL_ALREADY_EXISTS", $"Já existe um modelo chamado {name}. O nome não pode se repetir, nem com outras maiúsculas e minúsculas.");

    public static ApiErrorDto Changed(Guid id)
        => ApiErrorDto.CreateConflict("Este modelo mudou em outra janela.", "BUILD_MODEL_CHANGED", $"O modelo {id} foi salvo depois da versão lida por esta janela.");
}
