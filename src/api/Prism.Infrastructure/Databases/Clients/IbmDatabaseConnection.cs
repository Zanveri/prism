#if PRISM_IBM_DRIVER
using IBM.Data.Db2;
using IBM.Data.DB2Types;
using Prism.Infrastructure.Databases.Models;
using System.Data.Common;
using System.Runtime.InteropServices;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// O que o Db2 e o Informix têm em comum: os dois são atendidos pelo driver da IBM (`IBM.Data.Db2`, sobre o `clidriver` nativo), o
/// Informix pela porta DRDA. Este arquivo só existe nas plataformas para as quais a IBM publica o driver (`PRISM_IBM_DRIVER`, no
/// `.csproj`).
///
/// A conexão do driver fica em auto-commit o tempo todo (RN-SESSAO-005), e o Prism nunca abre transação nela: nenhum dos dois bancos
/// tem uma transação só de leitura que sirva para todo banco de dados (o Db2 não tem nenhuma; a do Informix não existe em banco sem
/// log). Por isso quem diz se um comando grava é o texto dele (<see cref="SqlText.IsSingleRead"/>): só uma leitura só fica com o
/// cursor aberto entre as páginas; o resto roda até o fim e está confirmado quando a resposta sai (RN-SQL-013).
///
/// Três coisas do driver que a base precisa saber:
///
/// - é síncrono: as chamadas `Async` só voltam quando o banco responde;
/// - divide o envio em cada `;` e executa os pedaços um por um, cada um com a própria confirmação, e só roda o seguinte quando o
///   leitor avança: o envio com mais de um comando é recusado antes de chegar a ele (RN-SQL-001), o comando vai sem os `;` soltos
///   em volta, e a base lê todos os resultados antes de responder;
/// - o `Cancel` que chega durante a execução lança (o banco desfaz o comando); o que chega durante a leitura, ou com o cursor
///   parado, fecha o cursor em silêncio, e as linhas só param de vir.
/// </summary>
internal abstract class IbmDatabaseConnection(ConnectionSettings settings, ILogger logger) : AdoDatabaseConnection(logger)
{
    /// <summary>O mesmo prazo de conexão que o driver do PostgreSQL usa por padrão: o do `clidriver` é o do sistema, que passa de um minuto num host que não responde.</summary>
    private const int ConnectTimeoutSeconds = 15;

    /// <summary>De quanto em quanto tempo o pedido de cancelamento se repete enquanto a execução do comando não volta.</summary>
    private static readonly TimeSpan CancelRetryInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>
    /// No Linux e no macOS o driver gerenciado pede a biblioteca nativa só pelo nome (`libdb2.so`, `libdb2.dylib`), e o sistema não a
    /// procura numa pasta `clidriver/lib`: sem ajuda, quem inicia a API teria de acertar `LD_LIBRARY_PATH` antes. No Windows o próprio
    /// driver a encontra, ao lado do assembly dele.
    ///
    /// Este resolvedor é o de quando o pacote da IBM punha a `clidriver` ao lado da API. Ela não fica mais lá (RN-DRIVER-001: o driver
    /// é baixado pelo usuário e fica em `PRISM_DATA_DIR/drivers`), então aqui nada é achado, a resposta é "não sei" (zero), e a busca
    /// do .NET segue até o gancho `ResolvingUnmanagedDll` do `DriverPackageClient`, que carrega a biblioteca da pasta do driver
    /// instalado. Os dois convivem porque só pode haver um `SetDllImportResolver` por assembly, e o evento vem depois dele.
    /// </summary>
    static IbmDatabaseConnection()
    {
        if (!OperatingSystem.IsWindows())
            NativeLibrary.SetDllImportResolver(typeof(DB2Connection).Assembly, (name, _, _) => name.StartsWith("libdb2.", StringComparison.Ordinal) && NativeLibrary.TryLoad(Path.Combine(AppContext.BaseDirectory, "clidriver", "lib", name), out var library) ? library : IntPtr.Zero);
    }

    protected abstract ESqlDialect Dialect { get; }

    protected override ESqlDialect QueryDialect => Dialect;

    /// <summary>
    /// RN-VAR-017 e 032: o parâmetro do comando do usuário, com o tipo do driver que a sonda S-VAR-1 provou (<see cref="QueryParameterBinding"/>): o decimal pelo
    /// `DB2Decimal` do driver (até 31 dígitos, exato, que o `System.Decimal` não guarda), o `bool` do Db2 como `DbType.Boolean` (o `DB2Type.Boolean` lança), o
    /// resto com o `DB2Type` do nome. O `DbType` vai antes do valor, e o `DB2Type` depois.
    /// </summary>
    protected override void BindQueryParameter(DbParameter parameter, BoundQueryParameter bound)
    {
        var ibm = (DB2Parameter)parameter;
        if (bound.DbType is { } dbType)
            ibm.DbType = dbType;

        ibm.Value = bound.Ibm == EIbmParameterType.Decimal ? DB2Decimal.Parse((string)bound.Value!) : bound.Value ?? DBNull.Value;
        if (bound.Ibm != EIbmParameterType.None)
            ibm.DB2Type = bound.Ibm switch
            {
                EIbmParameterType.BigInt => DB2Type.BigInt,
                EIbmParameterType.Decimal => DB2Type.Decimal,
                EIbmParameterType.Double => DB2Type.Double,
                EIbmParameterType.LongVarChar => DB2Type.LongVarChar,
                EIbmParameterType.Clob => DB2Type.Clob,
                EIbmParameterType.Date => DB2Type.Date,
                EIbmParameterType.Timestamp => DB2Type.Timestamp,
                _ => DB2Type.VarChar
            };
    }

    protected override string? BeginReadOnlySql => null;

    protected override bool CancelReturnsEmptyResult => true;

    protected override bool BlocksTheCallingThread => true;

    protected override bool TriesAsRead(string sql)
        => SqlText.IsSingleRead(sql, Dialect);

    protected override bool IsTransactionControl(string sql)
        => SqlText.IsTransactionControl(sql, Dialect);

    protected override bool HasSeveralStatements(string sql)
        => SqlText.HasSeveralStatements(sql, Dialect);

    /// <summary>Sem transação só de leitura, a subconsulta do "contar total" gravaria se o comando gravasse: só a leitura só é contada.</summary>
    protected override bool MayBeCounted(string sql)
        => SqlText.IsSingleRead(sql, Dialect);

    /// <summary>O comando vai sem os `;` soltos em volta dele: o driver mandaria ao banco, como comando, cada pedaço vazio (<see cref="SqlText.Statement"/>).</summary>
    protected override void ConfigureUserCommand(DbCommand command)
        => command.CommandText = SqlText.Statement(command.CommandText, Dialect);

    /// <summary>
    /// RN-SQL-010. O `Cancel` do driver só interrompe o comando que já está executando no banco: o pedido que chega um instante
    /// antes, quando o comando ainda está saindo da API, não tem efeito, e o comando rodaria até o fim. Enquanto a execução não
    /// volta, o pedido se repete. Passa pelo `TryAsync` porque roda fora do comando, e ali nada pode lançar; e roda na própria
    /// thread do temporizador, sem esperar por outra: o `Cancel` do driver não espera o banco. O descarte do temporizador só
    /// termina com o pedido em andamento concluído: depois que o leitor é devolvido, nenhum `Cancel` daqui alcança o cursor nem o
    /// comando seguinte.
    /// </summary>
    protected override async Task<DbDataReader> ExecuteReaderAsync(DbCommand command, CancellationToken cancellationToken)
    {
        // ponytail: um temporizador por comando enviado. Se pesar, ou se o driver passar a aceitar o cancelamento que chega antes
        // da execução, basta um pedido só, registrado na fonte de cancelamento.
        await using var retry = new Timer(state =>
        {
            if (cancellationToken.IsCancellationRequested)
                _ = TryAsync(nameof(Cancel), () =>
                {
                    command.Cancel();

                    return Task.CompletedTask;
                }, onThisThread: true);
        }, null, CancelRetryInterval, CancelRetryInterval);

        return await command.ExecuteReaderAsync(cancellationToken);
    }

    /// <summary>
    /// RN-SQL-010 e RN-EDIT-021: o comando interrompido dentro da transação do driver (a do "Salvar" e a da carga) às vezes chega sem o
    /// erro da interrupção (57014 no Db2, -213 no Informix): o driver lança a exceção sem nenhum erro ("ERROR - no error information
    /// available"). No Db2 a sonda da trava da coluna inteira mostrou quando: com o `Cancel` em dobro (o do registro do `CancellationToken`
    /// no `ExecuteReaderAsync` do ADO.NET e o do <see cref="AdoDatabaseConnection.Cancel"/>), dentro da transação, em 3 de 40
    /// cancelamentos; com um `Cancel` só na transação, e com os dois em auto-commit, nunca (40 de 40 vieram com o 57014). Depois dela o
    /// banco já tinha encerrado o comando (a espera sumiu do `SYSIBMADM.MON_LOCKWAITS`, com a trava ainda presa pela outra sessão), o que
    /// a transação tinha antes dele continuava nela, e o `ROLLBACK` do fim passava.
    /// </summary>
    protected override bool CameWithoutErrorInformation(Exception exception)
        => exception is DB2Exception { Errors.Count: 0 };

    /// <summary>Não há tentativa em transação só de leitura para o banco recusar.</summary>
    protected override bool IsWriteRefusal(DatabaseFailure failure)
        => false;

    /// <summary>
    /// O driver separa os dados da conexão por `;`, e as aspas que o construtor põe em volta de um valor não o isolam: a senha com
    /// `;` nunca conecta, e o que o driver responde ("Invalid argument") não diz por quê. A recusa sai daqui, com o nome do campo e
    /// sem o valor, para o host, a senha, o banco e o usuário.
    /// </summary>
    protected override string? SettingsRefusal
        => new[] { (Value: settings.Host, Field: "no host"), (Value: settings.Password, Field: "na senha"), (Value: settings.Database, Field: "no nome do banco"), (Value: settings.UserName, Field: "no usuário") }
            .Where(setting => setting.Value.Contains(';'))
            .Select(setting => $"O driver da IBM não aceita `;` {setting.Field}: é o caractere com que ele separa os dados da conexão.")
            .FirstOrDefault();

    /// <summary>
    /// A string de conexão sai do construtor do driver, por propriedades, nunca de concatenação: host, banco, usuário e senha são
    /// texto de quem cadastrou a conexão, e nenhum deles chega aqui com `;` (<see cref="SettingsRefusal"/>). Um valor com aspas sai entre
    /// aspas do construtor; o servidor de destino é só o host e a porta (RN-CONN-004). Sem pool: cada sessão é dona da própria
    /// conexão.
    /// </summary>
    protected override DbConnection CreateConnection()
        => new DB2Connection(new DB2ConnectionStringBuilder { Server = $"{settings.Host}:{settings.Port}", Database = settings.Database, UserID = settings.UserName, Password = settings.Password, Pooling = false, Connect_Timeout = ConnectTimeoutSeconds }.ConnectionString);

    /// <summary>
    /// RN-SQL-006. O `;` do fim e o que vem depois dele saem: o driver dividiria o envio ali. As quebras de linha fazem um comentário
    /// `--` no fim do comando acabar antes do fecho da subconsulta. Só chega aqui o que é uma leitura só (<see cref="MayBeCounted"/>).
    /// </summary>
    protected override string CountSql(string sql)
        => $"SELECT COUNT(*) FROM (\n{SqlText.Statement(sql, Dialect)}\n) AS prism_total";

    /// <summary>A hora (`TIME`, `DATETIME HOUR TO ...`) chega como intervalo de tempo do C#, e a tela a alinha como as outras datas.</summary>
    protected override string ColumnKind(DbDataReader reader, int ordinal)
        => reader.GetFieldType(ordinal) == typeof(TimeSpan) ? "datetime" : base.ColumnKind(reader, ordinal);

    /// <summary>
    /// RN-SQL-011, onde o tipo do C# perde o que o banco guarda. `DECIMAL` e `DECFLOAT` vêm em texto: o `decimal` do C# tem 28 dígitos,
    /// e com 31 o driver corta as casas ou lança. `TIMESTAMP` do Db2 vai até 12 casas de segundo, e acima de 7 o driver lança ao
    /// convertê-lo: sai do tipo do próprio driver, no formato das outras datas. `DATE` sai só com a data. O resto é o que o driver
    /// entrega.
    ///
    /// O driver escreve esses textos com a cultura da thread (o separador decimal, os sinais e até o calendário da data): a base o
    /// chama com a cultura invariável (<see cref="AdoDatabaseConnection.BlocksTheCallingThread"/>), e aqui eles já vêm com ponto e
    /// no calendário gregoriano.
    /// </summary>
    protected override object ReadCell(DbDataReader reader, int ordinal, string kind)
    {
        if (reader.IsDBNull(ordinal))
            return DBNull.Value;

        // ponytail: o nome do tipo é perguntado ao driver a cada célula; se pesar numa página larga, guardar por coluna quando o resultado abre.
        return reader.GetDataTypeName(ordinal) switch
        {
            "DECIMAL" or "DECFLOAT" => reader.GetString(ordinal),
            "TIMESTAMP" => ToDateAndTime(((DB2DataReader)reader).GetDB2TimeStamp(ordinal).ToString()),
            "DATE" => DateOnly.FromDateTime(reader.GetDateTime(ordinal)),
            _ => reader.GetValue(ordinal)
        };
    }

    /// <summary>
    /// RN-SQL-009: a mensagem do banco, como o driver a entrega (com o prefixo que diz de onde ela veio, `[IBM][DB2/LINUXX8664]` ou
    /// `[IBM][CLI Driver]`), e o SQLSTATE do primeiro erro. O `SqlState` da própria exceção vem vazio, e a `Message` dela repete o
    /// SQLSTATE na frente. Os drivers da IBM não informam a posição do erro. O que não veio do banco fica com o texto da exceção.
    /// </summary>
    protected override DatabaseFailure ToFailure(EDatabaseFailure kind, Exception exception)
    {
        if (exception is not DB2Exception { Errors.Count: > 0 } refusal)
            return new DatabaseFailure(kind, exception.Message);

        var errors = refusal.Errors.Cast<DB2Error>().ToList();

        return new DatabaseFailure(kind, string.Join('\n', errors.Select(error => error.Message.Trim()).Distinct()), errors[0].SQLState is { Length: > 0 } sqlState ? sqlState : null);
    }

    /// <summary>O driver escreve `2026-10-09-13.05.07.123456`, com todas as casas que a coluna tem; a tela recebe `2026-10-09 13:05:07.123456`.</summary>
    private static string ToDateAndTime(string timestamp)
    {
        if (timestamp.Length < 19)
            return timestamp;

        var characters = timestamp.ToCharArray();
        characters[10] = ' ';
        characters[13] = ':';
        characters[16] = ':';

        return new string(characters);
    }
}
#endif
