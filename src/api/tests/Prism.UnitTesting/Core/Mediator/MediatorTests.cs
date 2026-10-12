using CSharpFunctionalExtensions;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using System.Reflection;

namespace Prism.UnitTesting.Core.Mediator;

/// <summary>
/// O mediador do Prism: valida, chama o handler e, se ele lança, registra e relança sem escrever o command
/// (RN-LOG-001: command leva senha e SQL). Todo teste monta um contêiner de verdade, com o escopo validado,
/// porque o que importa aqui é o tempo de vida (o handler é da requisição, o `Singleton` é do processo).
/// </summary>
public sealed class MediatorTests
{
    public sealed record Ping(string Value) : IRequest<string>;
    public sealed record Strict(string Name) : IRequest<string>;
    public sealed record Twice(string First, string Second) : IRequest<string>;
    public sealed record Orphan : IRequest<string>;
    public sealed record Explodes(string Secret) : IRequest<string>;
    public sealed record WhoAmI : IRequest<Guid>;
    public sealed record Cancels : IRequest<string>;

    /// <summary>O que os handlers de mentira anotam, e a exceção que `Explodes` lança.</summary>
    public sealed class Calls
    {
        public List<string> Handled { get; } = [];
        public List<CancellationToken> Tokens { get; } = [];
        public InvalidOperationException Failure { get; } = new("A gravação falhou.");
    }

    /// <summary>`Scoped`: o handler tem de receber a instância do escopo de quem chamou o mediador.</summary>
    public sealed class ScopeMarker
    {
        public Guid ID { get; } = Guid.NewGuid();
    }

    internal sealed class PingHandler(Calls calls) : IRequestHandler<Ping, string>
    {
        public Task<string> Handle(Ping request, CancellationToken cancellationToken)
        {
            calls.Handled.Add(nameof(Ping));
            calls.Tokens.Add(cancellationToken);

            return Task.FromResult($"pong:{request.Value}");
        }
    }

    internal sealed class StrictHandler(Calls calls) : IRequestHandler<Strict, string>
    {
        public Task<string> Handle(Strict request, CancellationToken cancellationToken)
        {
            calls.Handled.Add(nameof(Strict));

            return Task.FromResult(request.Name);
        }
    }

    public sealed class StrictValidator : AbstractValidator<Strict>
    {
        public StrictValidator() => RuleFor(request => request.Name).NotEmpty().WithMessage("O nome é obrigatório.").WithErrorCode("NAME_REQUIRED");
    }

    internal sealed class TwiceHandler(Calls calls) : IRequestHandler<Twice, string>
    {
        public Task<string> Handle(Twice request, CancellationToken cancellationToken)
        {
            calls.Handled.Add(nameof(Twice));

            return Task.FromResult(request.First);
        }
    }

    public sealed class TwiceFirstValidator : AbstractValidator<Twice>
    {
        public TwiceFirstValidator() => RuleFor(request => request.First).NotEmpty().WithMessage("O primeiro é obrigatório.").WithErrorCode("FIRST_REQUIRED");
    }

    public sealed class TwiceSecondValidator : AbstractValidator<Twice>
    {
        public TwiceSecondValidator() => RuleFor(request => request.Second).NotEmpty().WithMessage("O segundo é obrigatório.").WithErrorCode("SECOND_REQUIRED");
    }

    internal sealed class ExplodesHandler(Calls calls) : IRequestHandler<Explodes, string>
    {
        public Task<string> Handle(Explodes request, CancellationToken cancellationToken)
        {
            calls.Handled.Add(nameof(Explodes));

            throw calls.Failure;
        }
    }

    internal sealed class CancelsHandler : IRequestHandler<Cancels, string>
    {
        public Task<string> Handle(Cancels request, CancellationToken cancellationToken) => throw new OperationCanceledException(cancellationToken);
    }

    internal sealed class WhoAmIHandler(ScopeMarker marker) : IRequestHandler<WhoAmI, Guid>
    {
        public Task<Guid> Handle(WhoAmI request, CancellationToken cancellationToken) => Task.FromResult(marker.ID);
    }

    public sealed record LogEntry(string Category, LogLevel Level, string Text, Exception? Exception);

    /// <summary>Guarda tudo o que o mediador escreve: mensagem, valores do modelo, escopos e a exceção.</summary>
    public sealed class LogCapture : ILoggerProvider
    {
        public List<LogEntry> Entries { get; } = [];

        public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, Entries);

        public void Dispose()
        {
        }
    }

    private sealed class CaptureLogger(string category, List<LogEntry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            entries.Add(new LogEntry(category, LogLevel.None, $"escopo: {Describe(state)}", null));

            return null;
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => entries.Add(new LogEntry(category, logLevel, $"{formatter(state, exception)} | {Describe(state)}", exception));

        private static string Describe(object? state) => state is IEnumerable<KeyValuePair<string, object?>> pairs ? string.Join(", ", pairs.Select(pair => $"{pair.Key}={pair.Value}")) : state?.ToString() ?? string.Empty;
    }

    private static void Register(IServiceCollection services, Assembly assembly) => services.AddMediator(assembly);

    private static ServiceProvider Build(LogCapture logs, Calls calls)
    {
        var services = new ServiceCollection();
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Trace).AddProvider(logs));
        services.AddSingleton(calls);
        services.AddScoped<ScopeMarker>();
        Register(services, typeof(MediatorTests).Assembly);

        return services.BuildServiceProvider(validateScopes: true);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "OK chama o handler do tipo do command e devolve a resposta dele")]
    public async Task Send_CallsTheHandlerOfTheRequestType()
    {
        //Arrange
        var calls = new Calls();
        await using var provider = Build(new LogCapture(), calls);
        using var cancellation = new CancellationTokenSource();
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        var response = await mediator.Send(new Ping("a"), cancellation.Token);

        //Assert
        Assert.Equal("pong:a", response);
        Assert.Equal([nameof(Ping)], calls.Handled);
        Assert.Equal(cancellation.Token, Assert.Single(calls.Tokens));
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "Erro command inválido lança a exceção de validação e não chama o handler")]
    public async Task Send_WithInvalidCommand_ThrowsValidationException_AndDoesNotCallTheHandler()
    {
        //Arrange
        var calls = new Calls();
        await using var provider = Build(new LogCapture(), calls);
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        var exception = await Assert.ThrowsAsync<ValidationException>(() => mediator.Send(new Strict(" "), CancellationToken.None));

        //Assert
        var failure = Assert.Single(exception.Errors);
        Assert.Equal("Name", failure.PropertyName);
        Assert.Equal("NAME_REQUIRED", failure.ErrorCode);
        Assert.Equal("O nome é obrigatório.", failure.ErrorMessage);
        Assert.Empty(calls.Handled);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "OK command sem validator vai direto ao handler, e command válido passa pelo validator")]
    public async Task Send_WithoutValidator_CallsTheHandler()
    {
        //Arrange
        var calls = new Calls();
        await using var provider = Build(new LogCapture(), calls);
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        var withoutValidator = await mediator.Send(new Ping(string.Empty), CancellationToken.None);
        var valid = await mediator.Send(new Strict("pasta"), CancellationToken.None);

        //Assert
        Assert.Equal("pong:", withoutValidator);
        Assert.Equal("pasta", valid);
        Assert.Equal([nameof(Ping), nameof(Strict)], calls.Handled);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "Erro dois validators do mesmo command somam os erros dos dois numa exceção só")]
    public async Task Send_WithTwoValidators_ReportsTheErrorsOfBoth()
    {
        //Arrange
        var calls = new Calls();
        await using var provider = Build(new LogCapture(), calls);
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        var exception = await Assert.ThrowsAsync<ValidationException>(() => mediator.Send(new Twice(string.Empty, string.Empty), CancellationToken.None));

        //Assert
        // Cada erro uma vez só: o pacote de antes repetia os erros quando havia mais de um validator.
        Assert.Equal(["FIRST_REQUIRED", "SECOND_REQUIRED"], exception.Errors.Select(failure => failure.ErrorCode).Order().ToArray());
        Assert.Empty(calls.Handled);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "Erro command sem handler falha com mensagem que diz qual command")]
    public async Task Send_WithoutHandler_FailsWithAClearMessage()
    {
        //Arrange
        await using var provider = Build(new LogCapture(), new Calls());
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => mediator.Send(new Orphan(), CancellationToken.None));

        //Assert
        Assert.Contains(nameof(Orphan), exception.Message);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "Erro handler que lança é registrado com o tipo do command e a exceção, sem o command, e a exceção sobe igual")]
    public async Task Send_WhenTheHandlerThrows_LogsAndRethrows_WithoutTheCommandInTheLog()
    {
        //Arrange
        var logs = new LogCapture();
        var calls = new Calls();
        await using var provider = Build(logs, calls);
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();
        var command = new Explodes(Guid.NewGuid().ToString("N"));

        // O ToString() gerado do record imprime a senha: a prova só vale se o command a entregaria ao log.
        Assert.Contains(command.Secret, command.ToString());

        //Act
        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => mediator.Send(command, CancellationToken.None));

        //Assert
        Assert.Same(calls.Failure, exception);
        var entry = Assert.Single(logs.Entries, candidate => candidate.Exception is not null);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Same(calls.Failure, entry.Exception);
        Assert.Contains(nameof(Explodes), entry.Text);
        Assert.DoesNotContain(logs.Entries, candidate => candidate.Text.Contains(command.Secret));
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "Erro command inválido não vai para o log: é resposta 422, não falha")]
    public async Task Send_WithInvalidCommand_DoesNotLogAnError()
    {
        //Arrange
        var logs = new LogCapture();
        await using var provider = Build(logs, new Calls());
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();

        //Act
        await Assert.ThrowsAsync<ValidationException>(() => mediator.Send(new Strict(string.Empty), CancellationToken.None));

        //Assert
        Assert.DoesNotContain(logs.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "OK handler cancelado pela requisição sobe igual e não vira erro no log")]
    public async Task Send_WhenTheHandlerIsCanceled_Rethrows_WithoutLoggingAnError()
    {
        //Arrange
        var logs = new LogCapture();
        await using var provider = Build(logs, new Calls());
        var mediator = provider.CreateScope().ServiceProvider.GetRequiredService<IMediator>();
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        //Act
        var exception = await Assert.ThrowsAsync<OperationCanceledException>(() => mediator.Send(new Cancels(), cancellation.Token));

        //Assert
        Assert.Equal(cancellation.Token, exception.CancellationToken);
        Assert.DoesNotContain(logs.Entries, entry => entry.Level >= LogLevel.Warning);
    }

    [Trait("Mediator", "Send")]
    [Fact(DisplayName = "OK o handler é resolvido no escopo de quem chamou, uma instância por Send")]
    public async Task Send_ResolvesTheHandlerInTheScopeOfTheCaller()
    {
        //Arrange
        await using var provider = Build(new LogCapture(), new Calls());
        using var first = provider.CreateScope();
        using var second = provider.CreateScope();

        //Act
        var inFirst = await first.ServiceProvider.GetRequiredService<IMediator>().Send(new WhoAmI(), CancellationToken.None);
        var inSecond = await second.ServiceProvider.GetRequiredService<IMediator>().Send(new WhoAmI(), CancellationToken.None);

        //Assert
        Assert.Equal(first.ServiceProvider.GetRequiredService<ScopeMarker>().ID, inFirst);
        Assert.Equal(second.ServiceProvider.GetRequiredService<ScopeMarker>().ID, inSecond);
        Assert.NotEqual(inFirst, inSecond);
    }

    [Trait("Mediator", "AddMediator")]
    [Fact(DisplayName = "OK registra todo handler e todo validator do assembly, e o mediador, todos Scoped")]
    public void AddMediator_RegistersHandlersAndValidatorsOfTheAssembly()
    {
        //Arrange
        var services = new ServiceCollection();
        var assembly = typeof(CreateFolderCommand).Assembly;

        //Act
        Register(services, assembly);

        //Assert
        var handlers = assembly.GetTypes().Where(type => type is { IsClass: true, IsAbstract: false } && type.GetInterfaces().Any(contract => contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(IRequestHandler<,>))).ToArray();
        Assert.True(handlers.Length > 20, "o assembly da Application tem um handler por command");
        foreach (var handler in handlers)
        {
            var contract = handler.GetInterfaces().Single(candidate => candidate.IsGenericType && candidate.GetGenericTypeDefinition() == typeof(IRequestHandler<,>));
            var descriptor = Assert.Single(services, candidate => candidate.ServiceType == contract);
            Assert.Equal(handler, descriptor.ImplementationType);
            Assert.Equal(ServiceLifetime.Scoped, descriptor.Lifetime);
        }

        var validators = assembly.GetTypes().Where(type => type is { IsClass: true, IsAbstract: false } && type.GetInterfaces().Any(contract => contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(IValidator<>))).ToArray();
        Assert.True(validators.Length >= 8, "o assembly da Application tem oito validators");
        foreach (var validator in validators)
            Assert.Contains(services, candidate => candidate.ImplementationType == validator && candidate.ServiceType.IsGenericType && candidate.ServiceType.GetGenericTypeDefinition() == typeof(IValidator<>) && candidate.Lifetime == ServiceLifetime.Scoped);

        // Scoped, e não Singleton: o mediador entrega a requisição a handlers da requisição, e quem o pede da raiz tem de falhar.
        Assert.Equal(ServiceLifetime.Scoped, Assert.Single(services, candidate => candidate.ServiceType == typeof(IMediator)).Lifetime);
        Assert.Contains(services, candidate => candidate.ServiceType == typeof(IRequestHandler<CreateFolderCommand, Result<FolderDto, ApiErrorDto>>) && candidate.ImplementationType == typeof(CreateFolderHandler));
        Assert.Contains(services, candidate => candidate.ServiceType == typeof(IValidator<CreateFolderCommand>) && candidate.ImplementationType == typeof(CreateFolderValidator));
    }
}
