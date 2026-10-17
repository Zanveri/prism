using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-005 e 008: os comandos do "Salvar" a partir das pendências. Primeiro as exclusões, depois as alterações, depois as linhas
/// novas, cada grupo na ordem em que foi feito; cada alteração e exclusão pela chave; os valores sempre como parâmetros, e os nomes
/// entre aspas duplas. O que não se aplica ao resultado é recusado antes de qualquer comando ir ao banco, apontando a alteração e a
/// coluna.
/// </summary>
public sealed class EditPlannerTests
{
    private static readonly QueryColumn[] Result = [new("id", "integer", "number"), new("status", "text", "text"), new("total", "numeric", "number"), new("dobro", "integer", "number")];

    private static readonly EditTarget Target = new(
        [new EditTable("loja", "pedido", [0], true, null, EditTableKind.Table, ["id"])],
        [new EditColumn(0, "id", true, null, false, null, "integer"), new EditColumn(0, "status", true, null, true, null, "text"), new EditColumn(0, "total", false, "gerada pelo banco", false, ColumnGeneration.Always, "numeric"), new EditColumn(null, null, false, "coluna calculada", true, null, null)],
        RowOperations: true,
        OneAtATime: false);

    [Trait("EditPlanner", "Plan")]
    [Fact(DisplayName = "OK no PostgreSQL cada pendência vira um comando pela chave, com os valores em parâmetros, exclusões antes de alterações e de linhas novas")]
    public void Plan_ShouldBuildOneCommandPerChangeInTheOrderOfTheRule()
    {
        //Arrange
        EditChange[] changes =
        [
            new(EEditKind.Insert, 0, [], [new EditValue(0, "7"), new EditValue(1, null)]),
            new(EEditKind.Update, 0, ["1"], [new EditValue(1, "fechada")]),
            new(EEditKind.Delete, 0, ["2"], []),
            new(EEditKind.Update, 0, ["3"], [new EditValue(0, "30"), new EditValue(1, "it's")])
        ];

        //Act
        var commands = Plan(ESqlDialect.PostgreSql, changes);

        //Assert
        Assert.Equal([2, 1, 3, 0], commands.Select(command => command.Change));
        Assert.Equal(
        [
            "DELETE FROM \"loja\".\"pedido\" WHERE \"id\" = $1",
            "UPDATE \"loja\".\"pedido\" SET \"status\" = $1 WHERE \"id\" = $2",
            "UPDATE \"loja\".\"pedido\" SET \"id\" = $1, \"status\" = $2 WHERE \"id\" = $3",
            "INSERT INTO \"loja\".\"pedido\" (\"id\", \"status\") VALUES ($1, $2)"
        ], commands.Select(command => command.Sql));
        Assert.Equal([["2"], ["fechada", "1"], ["30", "it's", "3"], ["7", null]], commands.Select(command => command.Parameters.Select(parameter => (string?)parameter.Value).ToArray()));
    }

    [Trait("EditPlanner", "Plan")]
    [Fact(DisplayName = "OK no Db2 e no Informix o marcador é ?, o valor já vai convertido, e o nome com aspas dentro tem a aspa dobrada")]
    public void Plan_ShouldUseTheIbmMarkersAndConvertedValues()
    {
        //Arrange
        var target = new EditTarget(
            [new EditTable("LOJA", "PE\"DIDO", [0], true, null, EditTableKind.Table, ["ID"])],
            [new EditColumn(0, "ID", true, null, false, null, "INTEGER"), new EditColumn(0, "VALOR", true, null, true, null, "DECIMAL(12,2)")],
            true,
            false);

        //Act
        var commands = Plan(ESqlDialect.Db2, [new EditChange(EEditKind.Update, 0, ["10"], [new EditValue(1, "12.50")])], target, [new("ID", "INTEGER", "number"), new("VALOR", "DECIMAL", "text")]);

        //Assert
        var command = Assert.Single(commands);
        Assert.Equal("UPDATE \"LOJA\".\"PE\"\"DIDO\" SET \"VALOR\" = ? WHERE \"ID\" = ?", command.Sql);
        Assert.Equal([12.50m, 10], command.Parameters.Select(parameter => parameter.Value));
    }

    [Trait("EditPlanner", "Plan")]
    [Theory(DisplayName = "OK a pendência que não se aplica ao resultado é recusada com a alteração e a coluna")]
    [InlineData("update-calculada", 3, "A coluna não se edita: coluna calculada.")]
    [InlineData("update-gerada", 2, "A coluna não se edita: gerada pelo banco.")]
    [InlineData("update-fora", 9, "A coluna não existe no resultado.")]
    [InlineData("update-vazia", null, "A alteração não tem nenhuma coluna.")]
    [InlineData("update-repetida", 1, "A mesma coluna aparece duas vezes na alteração.")]
    [InlineData("chave-curta", null, "A chave da linha não tem os valores das colunas da chave.")]
    [InlineData("chave-nula", null, "A chave da linha não tem os valores das colunas da chave.")]
    [InlineData("tabela", null, "A tabela da alteração não existe neste resultado.")]
    [InlineData("linha-nova-vazia", null, "A linha nova não tem nenhuma coluna preenchida.")]
    public void Plan_ShouldRefuseAChangeThatDoesNotApply(string change, int? column, string message)
    {
        //Arrange
        var edit = change switch
        {
            "update-calculada" => new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(3, "2")]),
            "update-gerada" => new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(2, "2")]),
            "update-fora" => new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(9, "2")]),
            "update-vazia" => new EditChange(EEditKind.Update, 0, ["1"], []),
            "update-repetida" => new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(1, "a"), new EditValue(1, "b")]),
            "chave-curta" => new EditChange(EEditKind.Delete, 0, [], []),
            "chave-nula" => new EditChange(EEditKind.Delete, 0, [null], []),
            "tabela" => new EditChange(EEditKind.Delete, 1, ["1"], []),
            _ => new EditChange(EEditKind.Insert, 0, [], [])
        };

        //Act
        var planned = EditPlanner.Plan(ESqlDialect.PostgreSql, Target, Result, [new EditChange(EEditKind.Delete, 0, ["5"], []), edit]);

        //Assert
        Assert.True(planned.IsFailure);
        Assert.Equal((EDatabaseFailure.EditInvalid, 1, column, message), (planned.Error.Kind, planned.Error.Change, planned.Error.Column, planned.Error.Message));
    }

    [Trait("EditPlanner", "Plan")]
    [Fact(DisplayName = "OK sem linha nova e excluir linha no resultado, a criação e a exclusão são recusadas")]
    public void Plan_ShouldRefuseRowOperationsWhenTheResultHasNone()
    {
        //Act
        var planned = EditPlanner.Plan(ESqlDialect.PostgreSql, Target with { RowOperations = false }, Result, [new EditChange(EEditKind.Delete, 0, ["1"], [])]);

        //Assert
        Assert.Equal((EDatabaseFailure.EditInvalid, 0, "Este resultado não aceita linha nova nem exclusão de linha."), (planned.Error.Kind, planned.Error.Change, planned.Error.Message));
    }

    [Trait("EditPlanner", "Plan")]
    [Fact(DisplayName = "OK no Db2 o texto que não converte é recusado na célula, também o da chave")]
    public void Plan_ShouldRefuseTextThatDoesNotConvertOnTheCell()
    {
        //Arrange
        var target = new EditTarget([new EditTable("LOJA", "PEDIDO", [0], true, null, EditTableKind.Table, ["ID"])], [new EditColumn(0, "ID", true, null, false, null, "INTEGER"), new EditColumn(0, "DIA", true, null, true, null, "DATE")], true, false);
        QueryColumn[] result = [new("ID", "INTEGER", "number"), new("DIA", "DATE", "datetime")];

        //Act
        var value = EditPlanner.Plan(ESqlDialect.Db2, target, result, [new EditChange(EEditKind.Update, 0, ["1"], [new EditValue(1, "amanhã")])]);
        var key = EditPlanner.Plan(ESqlDialect.Db2, target, result, [new EditChange(EEditKind.Delete, 0, ["um"], [])]);

        //Assert
        Assert.Equal((0, 1, "«amanhã» não é uma data no formato aaaa-mm-dd."), (value.Error.Change, value.Error.Column, value.Error.Message));
        Assert.Equal((0, 0, "«um» não é um número inteiro."), (key.Error.Change, key.Error.Column, key.Error.Message));
    }

    /// <summary>RN-EDIT-002 e 005: numa junção, as alterações de uma linha da grade em duas tabelas são dois comandos, cada um pela chave da sua tabela.</summary>
    [Trait("EditPlanner", "Preview")]
    [Fact(DisplayName = "OK numa junção cada tabela tem o seu UPDATE pela sua chave, e a coluna de outra tabela é recusada")]
    public void Preview_ShouldWriteOneUpdatePerTableOfAJoin()
    {
        //Arrange
        var target = new EditTarget(
            [new EditTable("loja", "pedido", [0], true, null, EditTableKind.Table, ["id"]), new EditTable("loja", "cliente", [2], true, null, EditTableKind.Table, ["id"])],
            [new EditColumn(0, "id", false, "coluna da chave numa junção", false, null, "integer"), new EditColumn(0, "status", true, null, true, null, "text"), new EditColumn(1, "id", false, "coluna da chave numa junção", false, null, "integer"), new EditColumn(1, "nome", true, null, true, null, "text")],
            RowOperations: false,
            OneAtATime: false);
        QueryColumn[] result = [new("id", "integer", "number"), new("status", "text", "text"), new("id", "integer", "number"), new("nome", "text", "text")];

        //Act
        var preview = EditPlanner.Preview(ESqlDialect.PostgreSql, target, result, [new(EEditKind.Update, 0, ["1"], [new EditValue(1, "paga")]), new(EEditKind.Update, 1, ["7"], [new EditValue(3, "Ana")])]);
        var other = EditPlanner.Plan(ESqlDialect.PostgreSql, target, result, [new(EEditKind.Update, 1, ["7"], [new EditValue(1, "paga")])]);
        var key = EditPlanner.Plan(ESqlDialect.PostgreSql, target, result, [new(EEditKind.Update, 1, ["7"], [new EditValue(2, "8")])]);

        //Assert
        Assert.Equal(["UPDATE \"loja\".\"pedido\" SET \"status\" = 'paga' WHERE \"id\" = 1", "UPDATE \"loja\".\"cliente\" SET \"nome\" = 'Ana' WHERE \"id\" = 7"], preview.Value.Statements.Select(statement => statement.Sql));
        Assert.Equal((EDatabaseFailure.EditInvalid, 0, 1, "A coluna não é da tabela da alteração."), (other.Error.Kind, other.Error.Change, other.Error.Column, other.Error.Message));
        Assert.Equal((2, "A coluna não se edita: coluna da chave numa junção."), (key.Error.Column, key.Error.Message));
    }

    [Trait("EditPlanner", "Preview")]
    [Fact(DisplayName = "OK o Ver SQL escreve os valores como literais, e o que não tem literal vai como ? com o valor ao lado")]
    public void Preview_ShouldWriteTheLiteralsAndMarkWhatHasNone()
    {
        //Arrange
        EditChange[] changes = [new(EEditKind.Update, 0, ["1"], [new EditValue(1, "linha 1\nlinha 2")]), new(EEditKind.Insert, 0, [], [new EditValue(0, "8"), new EditValue(1, "it's")])];

        //Act
        var preview = EditPlanner.Preview(ESqlDialect.PostgreSql, Target with { OneAtATime = true }, Result, changes);

        //Assert
        Assert.True(preview.IsSuccess);
        Assert.True(preview.Value.OneAtATime);
        Assert.Equal(["UPDATE \"loja\".\"pedido\" SET \"status\" = ? WHERE \"id\" = 1", "INSERT INTO \"loja\".\"pedido\" (\"id\", \"status\") VALUES (8, 'it''s')"], preview.Value.Statements.Select(statement => statement.Sql));
        Assert.Equal([["linha 1\nlinha 2"], []], preview.Value.Statements.Select(statement => statement.Values.ToArray()));
    }

    private static IReadOnlyList<EditCommand> Plan(ESqlDialect dialect, IReadOnlyList<EditChange> changes, EditTarget? target = null, IReadOnlyList<QueryColumn>? result = null)
    {
        var planned = EditPlanner.Plan(dialect, target ?? Target, result ?? Result, changes);
        Assert.True(planned.IsSuccess, planned.IsFailure ? planned.Error.Message : null);

        return planned.Value;
    }
}
