using CSharpFunctionalExtensions;
using System.Data;

namespace Prism.Infrastructure.Databases.Models;

/// <summary>Um comando do "Salvar" (RN-EDIT-005), pronto para ir ao banco, com os valores como parâmetros, nunca dentro do texto.</summary>
/// <param name="Change">A posição da alteração no pedido, para a recusa apontar qual falhou.</param>
public sealed record EditCommand(int Change, string Sql, IReadOnlyList<EditParameter> Parameters);

/// <param name="Value">O valor já convertido (Db2 e Informix) ou o texto (PostgreSQL, em que quem converte é o banco); nulo é NULL.</param>
/// <param name="Type">O tipo do parâmetro, quando o valor sozinho não o diz (a data, que no C# é uma data e hora).</param>
public sealed record EditParameter(object? Value, DbType? Type = null);

/// <summary>
/// RN-EDIT-005, 020 e 021: o "Salvar" planejado: a coluna inteira, quando há (executada primeiro), e depois os comandos por linha, na ordem da regra.
/// </summary>
public sealed record EditPlan(WholeColumnPlan? WholeColumn, IReadOnlyList<EditCommand> Commands);

/// <summary>
/// RN-EDIT-020: a coluna inteira pronta para ir ao banco. Na forma direta e na forma pela chave, `CountSql` é a contagem e `Update`, o `UPDATE` de um
/// comando só; no caminho por lotes do Informix, `CountSql` é o próprio comando do resultado, de que se leem as colunas `KeyColumns` (pela posição no
/// resultado), e `Batches` monta, das chaves lidas (os textos como a grade os escreve), os `UPDATE` de até 1.000 chaves cada.
/// </summary>
/// <param name="Change">A posição da alteração no pedido.</param>
/// <param name="Rows">O número de linhas que a pessoa confirmou; nulo na contagem da pergunta, que ainda não o tem.</param>
public sealed record WholeColumnPlan(int Change, long? Rows, string CountSql, EditCommand? Update, IReadOnlyList<int>? KeyColumns = null, Func<IReadOnlyList<IReadOnlyList<string>>, Result<IReadOnlyList<WholeColumnBatch>, DatabaseFailure>>? Batches = null)
{
    /// <summary>O caminho por lotes: a contagem lê as chaves, e o `UPDATE` vai por elas.</summary>
    public bool ReadsKeys => KeyColumns is not null;

    /// <summary>RN-LOG-001: o comando e os valores não se imprimem.</summary>
    public override string ToString()
        => nameof(WholeColumnPlan);
}

/// <summary>Um lote do caminho por chaves (RN-EDIT-020): o `UPDATE` e quantas chaves ele leva, que é quantas linhas ele tem de alterar.</summary>
public sealed record WholeColumnBatch(EditCommand Command, int Keys)
{
    public override string ToString()
        => nameof(WholeColumnBatch);
}
