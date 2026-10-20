using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Text;

namespace Prism.Infrastructure.Transfers.Writers;

/// <summary>
/// RN-EXPORT-006 a 013: o que um escritor de formato recebe: as colunas marcadas, na ordem do resultado; o nome da origem (o da tabela ou da visão,
/// sem o esquema, ou `resultado`), que o título do HTML, a chave do JSON, a variável do PHP, a raiz do XML e a planilha do XLSX usam; o banco da
/// origem, que decide os literais do SQL; e as opções do formato.
/// </summary>
internal sealed record ExportWriterContext(IReadOnlyList<ExportColumn> Columns, string SourceName, EDatabaseEngine Engine, ExportFormatOptions Options)
{
    public override string ToString()
        => nameof(ExportWriterContext);
}

/// <summary>
/// RN-EXPORT-006 a 013: um formato da exportação de dados, escrito em fluxo. Quem o usa (o client do arquivo temporário, que tem o único `try` do
/// disco) chama <see cref="Begin"/> uma vez, <see cref="Write"/> a cada linha, na ordem da origem, e <see cref="End"/> no fim; <see cref="Flush"/> a cada
/// lote, para o tamanho do arquivo acompanhar o progresso. O escritor não guarda as linhas (o TXT guarda um lote, RN-EXPORT-008), não lê o banco e não
/// abre arquivo: escreve no fluxo que recebeu, que é o arquivo temporário ou a entrada do .zip. Uma exceção dele é falha de disco, e quem a pega é o client.
///
/// Um formato novo é uma classe daqui e uma linha em <see cref="ExportFormats"/>; as opções dele, um record em `ExportOptions` e um ramo no
/// `ExportOptionsReader`. O que um formato não escreve inteiro conta em <see cref="Counts"/>.
/// </summary>
internal abstract class ExportWriter(ExportWriterContext context)
{
    protected ExportWriterContext Context => context;

    protected IReadOnlyList<ExportColumn> Columns => context.Columns;

    public ExportCounts Counts { get; } = new();

    /// <summary>O começo do arquivo: a declaração, o cabeçalho, o que vem antes da primeira linha.</summary>
    public abstract void Begin();

    /// <summary>Uma linha, com uma célula por coluna de <see cref="ExportWriterContext.Columns"/>, na mesma ordem.</summary>
    public abstract void Write(IReadOnlyList<ExportCell> row);

    /// <summary>O fim do arquivo, também sem nenhuma linha (RN-EXPORT-006: o resultado vazio não é erro). Deixa tudo escrito no fluxo.</summary>
    public abstract void End();

    /// <summary>Manda ao fluxo o que o escritor tem guardado no buffer dele.</summary>
    public abstract void Flush();
}

/// <summary>
/// Um formato de texto: escreve em UTF-8, sem BOM (o BOM, quando pedido, é do arquivo, e vem antes, RN-EXPORT-014). O par substituto solto, que o UTF-8
/// não escreve, sai como U+FFFD nos formatos que não o tiram nem o escapam (RN-EXPORT-006).
/// </summary>
internal abstract class TextExportWriter(ExportWriterContext context, Stream output) : ExportWriter(context)
{
    protected TextWriter Output { get; } = new StreamWriter(output, ExportEncoding.Utf8, bufferSize: 64 * 1024, leaveOpen: true);

    public override void Flush()
        => Output.Flush();

    /// <summary>A célula como texto (o binário em hexadecimal), ou nulo.</summary>
    protected static string? TextOf(ExportCell cell)
        => ExportText.Of(cell);
}

/// <summary>
/// O UTF-8 dos formatos de texto, sem BOM. O par substituto solto sai como U+FFFD, a troca padrão do `UTF8Encoding` do .NET (e não `?`, nem exceção):
/// o `ExportWritersTests` confere os bytes.
/// </summary>
internal static class ExportEncoding
{
    public static readonly Encoding Utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    /// <summary>RN-EXPORT-014: o U+FEFF no começo do arquivo, que faz o Excel ler o CSV em UTF-8.</summary>
    public static ReadOnlySpan<byte> Bom => [0xEF, 0xBB, 0xBF];
}
