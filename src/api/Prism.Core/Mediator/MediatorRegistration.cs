using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection;

namespace Prism.Core.Mediator;

public static class MediatorRegistration
{
    /// <summary>
    /// Registra o mediador e, por varredura do assembly, todo handler e todo validator, todos Scoped (o mediador
    /// também: pedido da raiz do contêiner, ele falha em vez de prender um handler da requisição para sempre).
    /// Inclui os tipos internos, que é como os handlers são declarados.
    /// </summary>
    public static IServiceCollection AddMediator(this IServiceCollection services, Assembly assembly)
    {
        services.AddScoped<IMediator, RequestMediator>();

        var registrations = assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false, ContainsGenericParameters: false })
            .SelectMany(type => type.GetInterfaces().Where(IsHandlerOrValidator).Select(contract => (Contract: contract, Implementation: type)));

        foreach (var (contract, implementation) in registrations)
            services.AddScoped(contract, implementation);

        return services;
    }

    private static bool IsHandlerOrValidator(Type contract) => contract.IsGenericType && contract.GetGenericTypeDefinition() is var definition && (definition == typeof(IRequestHandler<,>) || definition == typeof(IValidator<>));
}
