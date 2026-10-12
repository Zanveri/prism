namespace Prism.Core.Mediator;

/// <summary>Um pedido ao mediador (command ou consulta) e o tipo da resposta que o handler dele devolve.</summary>
public interface IRequest<TResponse>;
