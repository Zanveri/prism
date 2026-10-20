using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Services;

/// <summary>
/// O registro das sessões abertas com os bancos. É `Singleton` porque uma conexão aberta atravessa várias requisições (decisão 3 do
/// guia da raiz). Fecha tudo o que dependia de um cofre quando ele fecha (RN-COFRE-008) e quando a API encerra (RN-SESSAO-004).
/// </summary>
public interface IDatabaseSessionService
{
    /// <summary>
    /// Abre uma sessão com as credenciais lidas do cofre. `vaultGeneration` é a `IVaultService.Generation` lida ANTES das credenciais:
    /// se o cofre aberto mudou até a conexão ficar pronta, a conexão fecha, nenhuma sessão é registrada e a falha é `VaultChanged`.
    /// Falha ao conectar: `ConnectionFailed`, com a mensagem do banco (RN-SESSAO-003).
    /// </summary>
    Task<Result<DatabaseSessionInfo, DatabaseFailure>> OpenAsync(Guid connectionID, ConnectionSettings settings, long vaultGeneration, CancellationToken cancellationToken);

    /// <summary>RN-CONN-013: abre, roda a consulta de verificação do banco e fecha. Não registra sessão. Falha `ConnectionFailed`.</summary>
    Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, CancellationToken cancellationToken);

    /// <summary>
    /// RN-CONN-013 e RN-VERIF-001: o mesmo, com a consulta de verificação própria do formulário (já validada como uma leitura só) no lugar da do
    /// banco, quando ela vem. A falha dela é `ConnectionFailed`, com a mensagem do banco.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, string? verificationQuery, CancellationToken cancellationToken);

    /// <summary>
    /// RN-VERIF-002: roda a consulta de verificação (a própria, já validada, ou a do banco quando ela é nula) numa sessão já aberta da conexão, do cofre
    /// da geração `vaultGeneration`, e nunca numa nova: sem nenhuma, `NotConnected`. Nunca numa sessão com cursor aberto, que a consulta fecharia
    /// (RN-SQL-007), nem numa com comando em andamento: primeiro a sessão sem resultado (a da árvore) e depois a de uma aba sem cursor; com todas
    /// ocupadas, `Busy` na hora, sem esperar a vez. A falha do banco é `Failed`, e a sessão cuja conexão caiu sai do registro. Não é atividade:
    /// não mexe no tempo sem leitura do cursor (RN-SQL-007) nem no resultado da sessão.
    /// </summary>
    Task<ConnectionVerification> VerifyAsync(Guid connectionID, string? verificationQuery, long vaultGeneration, CancellationToken cancellationToken);

    /// <summary>
    /// RN-PROT-002 e 006: a conexão de que a sessão é, para quem decide as proteções dela a cada comando (as do cofre, que a Application lê). Nulo
    /// quando a sessão não existe: aí a operação pedida responde `SessionNotFound` por conta própria.
    /// </summary>
    Guid? ConnectionOf(Guid sessionID);

    /// <summary>
    /// Fecha a sessão, interrompendo o comando e a contagem que estiverem rodando nela. Espera o comando parar por no máximo dez
    /// segundos; se o banco não responde, abandona a conexão e volta.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> CloseAsync(Guid sessionID);

    /// <summary>RN-CONN-014: fecha as sessões da conexão excluída.</summary>
    Task CloseByConnectionAsync(Guid connectionID);

    Task CloseAllAsync();

    /// <summary>
    /// RN-DBEAVER-017: se a conexão está conectada, em qualquer janela (o registro de sessões é um só, seção 8, item 3): tem ao menos uma sessão aberta do cofre da
    /// geração <paramref name="vaultGeneration"/>. É o que a prévia do "Importar do DBeaver" diz da conexão que a reimportação sobrescreveria.
    /// </summary>
    bool HasSession(Guid connectionID, long vaultGeneration);

    /// <summary>RN-DRIVER-007: se há sessão aberta de algum destes bancos. O driver de um banco não é removido com sessão aberta dele.</summary>
    bool HasOpenSession(IReadOnlyCollection<EDatabaseEngine> engines);

    /// <summary>As consultas de catálogo esperam a vez na sessão (RN-SESSAO-002): a árvore pede vários níveis ao mesmo tempo.</summary>
    Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <param name="kind">`tables`, `views` ou `routines`.</param>
    Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(Guid sessionID, string schema, string kind, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-004: as chaves estrangeiras que apontam para a tabela, também as dela mesma.</summary>
    Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-005.</summary>
    Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-006.</summary>
    Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(Guid sessionID, string schema, string view, CancellationToken cancellationToken);

    /// <summary>RN-CAT-008: o diagrama do esquema inteiro, numa vez só da sessão.</summary>
    Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(Guid sessionID, string schema, CancellationToken cancellationToken);

    /// <summary>RN-CAT-010.</summary>
    Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>RN-ARVORE-006: os bancos do servidor da sessão, com o dela primeiro. Espera a vez, como as outras consultas de catálogo.</summary>
    Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>Executar e carregar mais não esperam: com outro comando rodando na sessão, `SessionBusy` (RN-SESSAO-002).</summary>
    /// <param name="pageSize">RN-SQL-016: as linhas da primeira página e de cada "carregar mais" do cursor que o comando abrir.</param>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, int pageSize, CancellationToken cancellationToken);

    /// <summary>
    /// RN-PROT-002: o mesmo, numa conexão que pode ser somente leitura, que é como a Application executa todo comando da pessoa (as proteções vêm
    /// do cofre a cada comando, RN-PROT-006). Com `readOnly`, o comando montado (com o filtro) que não é uma leitura (`ReadOnlySql`) é recusado com
    /// `ConnectionReadOnly`, antes de ir ao banco e sem tirar o resultado anterior; o que é leitura roda pelo `ExecuteReadOnlyAsync` da conexão, e a
    /// página diz que o resultado inteiro é só leitura (RN-EDIT-002). Sem `readOnly`, é o comando de sempre, e a sessão que estava no modo só de
    /// leitura do banco sai dele.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-024: o mesmo, com os resultados que a aba continua mostrando (`keep`, os `resultID` das abas do script). Quando o comando vai ao
    /// banco (dê certo ou não, também desfeito com `Executed`), a sessão guarda, entre o resultado atual e os já guardados, os da lista, só com o
    /// que a edição precisa (as colunas, a leitura do texto e o alvo, nunca as linhas nem os valores completos), e esquece os outros; o
    /// identificador que ela não conhece é ignorado. A recusa antes de ir ao banco não muda nada. É o que a Application usa; as sobrecargas sem
    /// `keep` esquecem os guardados, como a execução que não é do script.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, IReadOnlyCollection<Guid> keep, CancellationToken cancellationToken);

    /// <summary>
    /// RN-VAR-032 e 033: o mesmo, com os valores dos marcadores do comando (`params`), na ordem do texto. O texto montado (com o filtro) tem de ter exatamente esses
    /// marcadores (`ParametersMismatch`, com `Markers` e `Values`), e cada valor tem de caber no banco da sessão (`QueryInvalid`, no campo `params[i].value`); o
    /// filtro com marcador é `FilterInvalid`. Nada disso vai ao banco, e o resultado anterior continua. Os parâmetros ficam na memória da sessão com o texto do
    /// resultado (o atual e os guardados) e com o do "contar total", e vão de novo em tudo o que executa o comando outra vez (a contagem, a coluna inteira).
    /// Vazios, o comando vai como veio, sem parâmetros.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, bool readOnly, IReadOnlyCollection<Guid> keep, IReadOnlyList<QueryParameter> parameters, CancellationToken cancellationToken);

    /// <summary>
    /// RN-GRADE-011: o mesmo, com o filtro do resultado (condição, ordem ou as duas) junto ao comando, ou por fora dele quando ele não é
    /// um `SELECT` que a leitura do comando reconheça; a página diz como (`FilterApplied`), e o comando embrulhado é só leitura. O
    /// comando montado é o que roda, o que o "contar total" conta e o que a edição lê; a falha do banco vem sem a posição do erro, que
    /// seria a do comando montado. O filtro que não se junta com segurança: `FilterInvalid`; o comando de mais de um envio:
    /// `MultipleStatementsNotSupported`. Nos dois, nada vai ao banco. Sem filtro (nulo ou só espaços), é o comando sem filtro.
    /// </summary>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, string? filter, int pageSize, CancellationToken cancellationToken);

    /// <summary>
    /// RN-GRADE-011: por que o filtro não se junta ao comando, no banco da sessão (as aspas e os comentários de cada um), ou nulo quando
    /// ele se junta. Não toma a vez da sessão nem fala com o banco. Sem a sessão, nulo: quem responde é a execução.
    /// </summary>
    string? FilterRefusal(Guid sessionID, string? filter);

    /// <summary>RN-VAR-032: o mesmo, sabendo se o comando leva `params`: com eles, o filtro não pode ter marcador de parâmetro.</summary>
    string? FilterRefusal(Guid sessionID, string? filter, bool withParameters);

    Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-017: o valor completo de cada célula pedida do resultado `resultID`, na ordem pedida, pela linha no resultado inteiro;
    /// nulo na célula que não foi cortada ou que passou do teto da sessão. Lê só da memória, sem tomar a vez. Outro resultado na sessão:
    /// `ResultNotFound`; célula fora das linhas entregues ou das colunas: `CellsInvalid`.
    /// </summary>
    Result<IReadOnlyList<string?>, DatabaseFailure> GetCells(Guid sessionID, Guid resultID, IReadOnlyList<CellPosition> cells);

    /// <summary>
    /// RN-SQL-006: conta, por outra conexão, o último comando da sessão que devolveu linhas; o cursor da sessão continua como está. Sem
    /// comando desse tipo, `NoQueryToCount`. Se esse comando gravou (RN-SQL-013), o total já veio com a resposta dele e é o que volta
    /// aqui, sem ir ao banco: contar seria gravar de novo.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>RN-SQL-010: interrompe o comando e a contagem em andamento na sessão. Não afeta um cursor aberto e parado.</summary>
    UnitResult<DatabaseFailure> Cancel(Guid sessionID);

    /// <summary>
    /// RN-EDIT-002, 003 e 010: o que se edita no resultado `resultID` da sessão (o atual ou um guardado, RN-SQL-024), pelo catálogo, uma vez
    /// por resultado. A consulta vai na sessão `catalogSessionID` (a da árvore da mesma conexão e do mesmo banco), esperando a vez nela, ou
    /// numa conexão à parte, com prazo de espera de trava; nunca na sessão do resultado, cujo cursor continua aberto. Um resultado que não é o
    /// atual nem um guardado: `ResultChanged`; no Db2 e no Informix, também o guardado com uma tabela sem esquema depois de um comando que pode
    /// trocar o esquema atual da sessão (RN-SQL-024); o resultado inteiro só leitura: `ResultNotEditable`, com o motivo.
    /// </summary>
    Task<Result<EditTarget, DatabaseFailure>> GetEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, CancellationToken cancellationToken);

    /// <summary>
    /// RN-GRADE-020 e RN-PROT-002: o alvo do "Gerar SQL" (e do "Copiar como" do SQL e do DbUnit) numa conexão somente leitura. É resolvido como o da edição
    /// (<see cref="GetEditTargetAsync"/>, com as mesmas recusas), e volta com tudo só leitura pelo motivo `reason` (as tabelas, as colunas e as operações de
    /// linha). Ele NÃO fica guardado com o resultado: o "Salvar" continua recusado nessa conexão e, quando ela deixa de ser somente leitura, o `edit-target`
    /// da edição pergunta de novo. O alvo que a edição já tinha guardado serve, também só leitura.
    /// </summary>
    Task<Result<EditTarget, DatabaseFailure>> GetReadOnlyEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, string reason, CancellationToken cancellationToken);

    /// <summary>RN-EDIT-008: os comandos que o "Salvar" executaria, com os valores como literais, sem executar nada. O resultado é o atual ou um guardado, como no `edit-target`.</summary>
    Task<Result<EditPreview, DatabaseFailure>> PreviewEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-005, 011 e 012: o "Salvar", na sessão do resultado, sem esperar a vez (`SessionBusy`). Confere o catálogo dentro da
    /// transação: se a tabela mudou desde o `edit-target`, `ResultChanged`, e nada é executado. Devolve quantas alterações gravou. O resultado é
    /// o atual ou um guardado, como no `edit-target` (RN-SQL-024): o de um guardado fecha o cursor do atual, que continua o atual, com os
    /// valores completos dele, e os guardados continuam guardados.
    /// </summary>
    Task<Result<int, DatabaseFailure>> ApplyEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-019 e 023: a contagem da coluna inteira, na sessão do resultado, sem esperar a vez (`SessionBusy`), como o "Salvar" que ela começa: `changes`
    /// tem só a alteração da coluna inteira (`EditInvalid`, senão), conferida como no "Ver SQL"; a tabela que mudou na sessão é `ResultChanged`. Devolve
    /// quantas linhas o comando do resultado devolve agora.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken);
}
