namespace Prism.Infrastructure.Databases.Models;

/// <param name="Tables">RN-CAT-010: quantos objetos `objects?kind=tables` lista neste esquema. `Views` e `Routines`, o mesmo para visões e rotinas.</param>
public sealed record SchemaInfo(string Name, bool IsSystem, int Tables, int Views, int Routines);
