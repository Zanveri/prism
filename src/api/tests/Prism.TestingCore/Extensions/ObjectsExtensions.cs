using System.Text.Json;

namespace Prism.TestingCore.Extensions;

public static class ObjectsExtensions
{
    /// <summary>
    /// Compara dois objetos pelo JSON, propriedade por propriedade, sem um assert para cada uma. É o
    /// que serve aos tipos do cofre: um record com `byte[]` ou com lista compara a referência, e não o
    /// conteúdo.
    /// </summary>
    public static bool JsonEquals(this object firstObject, object secondObject)
        => JsonSerializer.Serialize(firstObject).Equals(JsonSerializer.Serialize(secondObject));
}
