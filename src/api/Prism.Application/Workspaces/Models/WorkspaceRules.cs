using Prism.Application.Scripts.Models;
using Prism.Application.Workspaces.Domain;
using Prism.Application.Workspaces.Models.Dtos;

namespace Prism.Application.Workspaces.Models;

/// <summary>
/// RN-ABAS-006 e a tabela de rotas da seção 24: a forma de cada aba que o `PUT api/user/workspace` aceita (422 `WORKSPACE_INVALID`) e o teto do texto dela
/// (422 `WORKSPACE_TOO_LARGE`). A recusa derruba a gravação inteira, e a tela grava sozinha, sem a pessoa ver: por isso as regras recusam só o que a tela nunca
/// manda (a forma errada, um nome absurdo), e não um nome de tabela incomum que o catálogo do banco devolveu.
/// </summary>
internal static class WorkspaceRules
{
    public const string InvalidCode = "WORKSPACE_INVALID";
    public const string TooLargeCode = "WORKSPACE_TOO_LARGE";

    /// <summary>O teto do nome de outro banco é o da abertura de sessão (seção 6 e RN-ARVORE-006): a aba só tem um banco que já abriu uma sessão.</summary>
    public const int MaxDatabaseLength = 128;

    /// <summary>Esquema e tabela vêm do catálogo do banco (63 bytes no PostgreSQL, 128 no Db2 e no Informix): o teto é só para recusar o que nenhum banco tem.</summary>
    public const int MaxNameLength = 1024;

    private static readonly string[] Views = ["data", "structure", "diagram"];

    /// <summary>
    /// A aba de consulta tem o texto (vazio, quando passava de 1 MB e não foi gravado) e nada de tabela; a de uma tabela tem a conexão, o esquema (que pode ser
    /// vazio), a tabela e uma das três vistas, e nada de texto nem de script. Outro tipo, ou os maiúsculos, não é aba.
    /// </summary>
    public static bool HasTheShapeOfItsKind(WorkspaceTabDto tab)
        => tab.Kind switch
        {
            WorkspaceTab.QueryKind => tab.Sql is not null && (!tab.SqlTooLarge || tab.Sql.Length == 0) && tab is { Schema: null, Table: null, View: null },
            WorkspaceTab.TableKind => tab is { ConnectionID: not null, Schema: not null, Table: { Length: > 0 }, View: not null, Sql: null, ScriptID: null, Dirty: false, SqlTooLarge: false }
                && tab.Schema.Length <= MaxNameLength && tab.Table.Length <= MaxNameLength && Views.Contains(tab.View, StringComparer.Ordinal),
            _ => false,
        };

    /// <summary>Sem o campo vale o banco da conexão; com ele, a regra da abertura de sessão: de 1 a 128 caracteres, sem caractere de controle.</summary>
    public static bool IsValidDatabase(string? database)
        => database is null || (!string.IsNullOrWhiteSpace(database) && database.Length <= MaxDatabaseLength && !database.Any(char.IsControl));

    /// <summary>O texto de cada aba vai até 1 MB (RN-SCRIPT-004), a mesma conta dos scripts: 1.048.576 bytes de UTF-8.</summary>
    public static bool FitsTheLimit(string? sql)
        => ScriptRules.FitsTheLimit(sql);

    /// <summary>A aba ativa é uma das abas da lista, ou nenhuma.</summary>
    public static bool IsInTheList(int? activeIndex, int count)
        => activeIndex is null || (activeIndex >= 0 && activeIndex < count);
}
