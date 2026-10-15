using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Scripts.Models;

/// <summary>Os códigos e os status são os da tabela de rotas da seção 23 da especificação. O detalhe nunca leva o SQL (RN-LOG-001); o nome, sim, porque é o que a pessoa digitou.</summary>
internal static class ScriptErrors
{
    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Script não localizado.", "SCRIPT_NOT_FOUND", $"Não existe um script com o ID {id}.");

    /// <summary>RN-SCRIPT-004.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict("Script já existe.", "SCRIPT_ALREADY_EXISTS", $"Já existe um script chamado {name}. O nome não pode se repetir, nem com outras maiúsculas e minúsculas.");
}
