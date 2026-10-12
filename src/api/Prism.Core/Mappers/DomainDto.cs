using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Reflection;

namespace Prism.Core.Mappers;


/// <summary>
/// Projeta uma entidade de domínio em um DTO por convenção: propriedades
/// públicas de mesmo nome e tipo compatível são copiadas. Propriedades que
/// existem apenas no domínio (ou apenas no DTO) são ignoradas.
///
/// Os genéricos ficam no método, não no tipo. Isso permite que o domínio seja
/// 'internal' e o DTO 'public' — o tipo de domínio só aparece como argumento
/// de tipo no call site, nunca em uma declaração pública.
///
/// Requisitos do DTO: construtor público sem parâmetros e propriedades com
/// setter público ('set' ou 'init'). Membros 'required' e records posicionais
/// não são suportados pela restrição new().
/// </summary>
public static class DomainDto
{
    private const BindingFlags PropertyFlags = BindingFlags.Public | BindingFlags.Instance;

    private static readonly ConcurrentDictionary<(Type Domain, Type Dto), Delegate> Maps = new();

    /// <summary>
    /// Cria um DTO a partir de uma instância do domínio.
    /// </summary>
    public static TDto ToDto<TDomain, TDto>(TDomain source)
        where TDomain : class
        where TDto : new()
    {
        ArgumentNullException.ThrowIfNull(source);

        var map = (Action<TDomain, TDto>)Maps.GetOrAdd(
            (typeof(TDomain), typeof(TDto)),
            static _ => BuildMap<TDomain, TDto>());

        var dto = new TDto();
        map(source, dto);
        return dto;
    }

    /// <summary>
    /// Cria uma lista de DTOs a partir de uma coleção do domínio.
    /// </summary>
    public static IReadOnlyList<TDto> ToDto<TDomain, TDto>(IEnumerable<TDomain> source)
        where TDomain : class
        where TDto : new()
    {
        ArgumentNullException.ThrowIfNull(source);

        return source.Select(item => ToDto<TDomain, TDto>(item)).ToList();
    }

    /// <summary>
    /// Propriedades graváveis do DTO que não encontraram origem no domínio.
    /// Use em um teste de guarda para não descobrir um rename em produção.
    /// </summary>
    public static IReadOnlyList<string> GetUnmappedProperties<TDomain, TDto>()
    {
        var domainProperties = IndexDomainProperties(typeof(TDomain));

        return typeof(TDto)
            .GetProperties(PropertyFlags)
            .Where(p => p.SetMethod is { IsPublic: true } && p.GetIndexParameters().Length == 0)
            .Where(p => !domainProperties.TryGetValue(p.Name, out var origin)
                        || !IsCompatible(origin.PropertyType, p.PropertyType))
            .Select(p => p.Name)
            .ToList();
    }

    private static Action<TDomain, TDto> BuildMap<TDomain, TDto>()
    {
        var domainProperties = IndexDomainProperties(typeof(TDomain));

        var source = Expression.Parameter(typeof(TDomain), "source");
        var target = Expression.Parameter(typeof(TDto), "target");
        var assignments = new List<Expression>();

        foreach (var dtoProperty in typeof(TDto).GetProperties(PropertyFlags))
        {
            if (dtoProperty.GetIndexParameters().Length > 0)
                continue;

            // Sem setter público não há como preencher.
            // 'init' passa aqui: a restrição de init-only é do compilador C#,
            // não do CLR, então a atribuição via expression tree funciona.
            if (dtoProperty.SetMethod is not { IsPublic: true })
                continue;

            // Não existe no domínio: pula.
            if (!domainProperties.TryGetValue(dtoProperty.Name, out var domainProperty))
                continue;

            // Mesmo nome, tipos incompatíveis: pula em vez de estourar.
            if (!IsCompatible(domainProperty.PropertyType, dtoProperty.PropertyType))
                continue;

            Expression value = Expression.Property(source, domainProperty);

            // Cobre upcast de referência e int -> int?, por exemplo.
            if (domainProperty.PropertyType != dtoProperty.PropertyType)
                value = Expression.Convert(value, dtoProperty.PropertyType);

            assignments.Add(Expression.Assign(Expression.Property(target, dtoProperty), value));
        }

        if (assignments.Count == 0)
            return static (_, _) => { };

        return Expression
            .Lambda<Action<TDomain, TDto>>(Expression.Block(assignments), source, target)
            .Compile();
    }

    /// <summary>
    /// Índice das propriedades legíveis do domínio, por nome (case-sensitive).
    /// TryAdd protege contra shadowing com 'new' na hierarquia — GetProperties
    /// devolve a declaração mais derivada primeiro.
    /// </summary>
    private static Dictionary<string, PropertyInfo> IndexDomainProperties(Type domainType)
    {
        var properties = new Dictionary<string, PropertyInfo>(StringComparer.Ordinal);

        foreach (var property in domainType.GetProperties(PropertyFlags))
        {
            if (!property.CanRead || property.GetIndexParameters().Length > 0)
                continue;

            properties.TryAdd(property.Name, property);
        }

        return properties;
    }

    private static bool IsCompatible(Type from, Type to)
    {
        if (to.IsAssignableFrom(from))
            return true;

        // T -> Nullable<T>
        var underlying = Nullable.GetUnderlyingType(to);
        return underlying is not null && underlying.IsAssignableFrom(from);
    }
}