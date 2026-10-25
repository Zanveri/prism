using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Prism.Application.ConnectionTransfers.Repositories;
using Prism.Application.DbeaverImports.Repositories;
using Prism.Application.Connections.Queries;
using Prism.Application.Connections.Repositories;
using Prism.Application.Folders.Queries;
using Prism.Application.Folders.Repositories;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Application.Scripts.Repositories;
using Prism.Application.Workspaces.Repositories;
using Prism.Core.Mediator;
using System.Reflection;

namespace Prism.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var currentAssembly = Assembly.GetExecutingAssembly();

        services.AddMediator(currentAssembly);

        // O relógio dos handlers que carimbam datas. TryAdd: o host de teste que registra um relógio falso por último continua mandando.
        services.TryAddSingleton(TimeProvider.System);

        services.AddRepositories();
        services.AddQueries();

        return services;
    }

    // Transient: repositories e queries não guardam estado. O que é de vida longa (o cofre aberto) fica no IVaultService, Singleton.
    private static IServiceCollection AddRepositories(this IServiceCollection services)
    {
        services.AddTransient<IConnectionImportRepository, ConnectionImportRepository>();
        services.AddTransient<IConnectionRepository, ConnectionRepository>();
        services.AddTransient<IDbeaverImportRepository, DbeaverImportRepository>();
        services.AddTransient<IFolderRepository, FolderRepository>();
        services.AddTransient<IScriptFolderRepository, ScriptFolderRepository>();
        services.AddTransient<IScriptRepository, ScriptRepository>();
        services.AddTransient<IWorkspaceRepository, WorkspaceRepository>();

        return services;
    }

    private static IServiceCollection AddQueries(this IServiceCollection services)
    {
        services.AddTransient<IConnectionQueries, ConnectionQueries>();
        services.AddTransient<IFolderQueries, FolderQueries>();

        return services;
    }
}
