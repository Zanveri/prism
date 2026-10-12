using FluentValidation;
using FluentValidation.Results;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace Prism.Core.Mediator;

/// <summary>
/// Validação e depois handler, nessa ordem. Scoped: o handler é resolvido no escopo de quem pede o mediador,
/// que é o da requisição, e por isso pode depender de serviço Scoped sem que o Singleton o capture.
/// </summary>
internal sealed class RequestMediator(IServiceProvider services, ILogger<RequestMediator> logger) : IMediator
{
    // Um despachante por par (pedido, resposta): o tipo do pedido só se conhece em tempo de execução.
    private static readonly ConcurrentDictionary<(Type Request, Type Response), object> Dispatchers = new();

    public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var dispatcher = (Dispatcher<TResponse>)Dispatchers.GetOrAdd((request.GetType(), typeof(TResponse)), key => Activator.CreateInstance(typeof(Dispatcher<,>).MakeGenericType(key.Request, key.Response))!);

        return dispatcher.Send(services, logger, request, cancellationToken);
    }

    private abstract class Dispatcher<TResponse>
    {
        public abstract Task<TResponse> Send(IServiceProvider services, ILogger logger, IRequest<TResponse> request, CancellationToken cancellationToken);
    }

    private sealed class Dispatcher<TRequest, TResponse> : Dispatcher<TResponse> where TRequest : IRequest<TResponse>
    {
        public override async Task<TResponse> Send(IServiceProvider services, ILogger logger, IRequest<TResponse> request, CancellationToken cancellationToken)
        {
            var typed = (TRequest)request;

            // Todos os validators do pedido rodam, e os erros de todos vão numa exceção só: o filtro de validação da API a traduz em 422.
            var failures = new List<ValidationFailure>();
            foreach (var validator in services.GetServices<IValidator<TRequest>>())
                failures.AddRange((await validator.ValidateAsync(typed, cancellationToken)).Errors);

            if (failures.Count > 0)
                throw new ValidationException(failures);

            var handler = services.GetService<IRequestHandler<TRequest, TResponse>>() ?? throw new InvalidOperationException($"Não há handler registrado para {typeof(TRequest).Name}. Registre um IRequestHandler<{typeof(TRequest).Name}, {typeof(TResponse).Name}>.");

            try
            {
                return await handler.Handle(typed, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // RN-LOG-001: só o nome do tipo e a exceção. O pedido nunca vai ao log, nem por `{@...}` nem por `ToString()`: command leva senha e SQL.
                logger.LogError(exception, "O handler de {Command} lançou uma exceção.", typeof(TRequest).Name);

                throw;
            }
        }
    }
}
