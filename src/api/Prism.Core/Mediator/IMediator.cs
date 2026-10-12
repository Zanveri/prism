namespace Prism.Core.Mediator;

public interface IMediator
{
    /// <summary>Valida o pedido com os validators dele e, passando, entrega ao handler do tipo dele.</summary>
    Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default);
}
