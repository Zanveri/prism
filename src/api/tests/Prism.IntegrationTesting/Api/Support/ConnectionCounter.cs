using System.Net;
using System.Net.Sockets;

namespace Prism.IntegrationTesting.Api.Support;

/// <summary>
/// Um servidor de mentira em 127.0.0.1: aceita cada conexão, fecha na hora e conta. Serve para provar que a API NÃO conectou: se ela
/// tivesse mandado a senha a algum lugar, o servidor de mentira teria visto a conexão. O teste confere o contador depois da resposta,
/// e a recusa vem antes de qualquer tentativa de conexão; para valer, o mesmo pedido com a senha digitada tem de fazer o contador subir.
/// </summary>
internal sealed class ConnectionCounter : IDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _stop = new();
    private int _accepted;

    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

    public int Accepted => Volatile.Read(ref _accepted);

    public ConnectionCounter()
    {
        _listener.Start();
        _ = AcceptAsync(_stop.Token);
    }

    private async Task AcceptAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            // O cancelamento do `Dispose` interrompe a espera lançando; a tarefa não é aguardada por ninguém.
            using var client = await _listener.AcceptTcpClientAsync(cancellationToken);
            Interlocked.Increment(ref _accepted);
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
        _stop.Dispose();
    }
}
