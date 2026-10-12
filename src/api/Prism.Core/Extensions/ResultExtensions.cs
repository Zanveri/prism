using CSharpFunctionalExtensions;
using Microsoft.AspNetCore.Mvc;
using Prism.Core.Api.Models.Dtos;

namespace Prism.Core.Extensions;

public static class ResultExtensions
{
    public static IActionResult ToIActionResult<T>(this Result<T, ApiErrorDto> result)
    {
        if (!result.IsFailure)
            throw new Exception("Não é possível definir o tipo de IActionResult de sucesso.");

        return ToIActionResult(result.Error);
    }

    /// <summary>
    /// Mesma tradução para os comandos que não têm o que devolver — remoções, por
    /// exemplo. O sucesso deles não carrega objeto, mas a falha continua sendo o
    /// mesmo ApiErrorDto, e é ela que o controller precisa traduzir.
    /// </summary>
    public static IActionResult ToIActionResult(this UnitResult<ApiErrorDto> result)
    {
        if (!result.IsFailure)
            throw new Exception("Não é possível definir o tipo de IActionResult de sucesso.");

        return ToIActionResult(result.Error);
    }

    /// <summary>
    /// O status já está no próprio erro, então não há tabela de tradução: cada
    /// código novo — 401, 403, 503 — passaria a estourar um 500 aqui até alguém
    /// lembrar de acrescentá-lo, e o cliente veria erro de servidor no lugar da
    /// resposta que o domínio escolheu.
    ///
    /// É pública porque nem todo erro nasce de um handler: o controller que
    /// recusa um corpo malformado responde no mesmo formato, e não numa segunda
    /// forma de erro só dele.
    /// </summary>
    public static IActionResult ToIActionResult(this ApiErrorDto error)
        => new ObjectResult(error) { StatusCode = (int)error.StatusCode };
}
