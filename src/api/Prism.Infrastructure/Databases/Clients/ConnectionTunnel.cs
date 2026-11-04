using Prism.Infrastructure.Databases.Models;
using Renci.SshNet;
using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// Túnel de rede de uma conexão com banco de dados: encaminhamento de porta por SSH (`SSH.NET`, opcionalmente através de
/// proxy SOCKS5) ou encaminhamento local para proxy SOCKS5 direto (RFC 1928 / RFC 1929).
/// </summary>
internal sealed class ConnectionTunnel : IAsyncDisposable
{
    private readonly SshClient? _sshClient;
    private readonly ForwardedPortLocal? _forwardedPort;
    private readonly TcpListener? _socksListener;

    private ConnectionTunnel(string boundHost, int boundPort, SshClient? sshClient, ForwardedPortLocal? forwardedPort, TcpListener? socksListener)
    {
        BoundHost = boundHost;
        BoundPort = boundPort;
        _sshClient = sshClient;
        _forwardedPort = forwardedPort;
        _socksListener = socksListener;
    }

    public string BoundHost { get; }

    public int BoundPort { get; }

    public static async Task<ConnectionTunnel> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
    {
        if (settings.Ssh is { } ssh)
            return await OpenSshAsync(settings, ssh, cancellationToken);

        if (settings.Proxy is { } proxy)
            return await OpenSocksAsync(settings.Host, settings.Port, proxy, cancellationToken);

        return new ConnectionTunnel(settings.Host, settings.Port, null, null, null);
    }

    private static async Task<ConnectionTunnel> OpenSshAsync(ConnectionSettings settings, ConnectionSshSettings ssh, CancellationToken cancellationToken)
    {
        var authMethod = CreateAuthMethod(ssh);
        var connectionInfo = settings.Proxy is { } proxy
            ? new ConnectionInfo(ssh.Host, ssh.Port, ssh.UserName, ProxyTypes.Socks5, proxy.Host, proxy.Port, proxy.UserName ?? string.Empty, ProxyPasswordOf(proxy), authMethod)
            : new ConnectionInfo(ssh.Host, ssh.Port, ssh.UserName, authMethod);

        if (ssh.TunnelTimeoutMs > 0)
            connectionInfo.Timeout = TimeSpan.FromMilliseconds(ssh.TunnelTimeoutMs);

        var client = new SshClient(connectionInfo);
        if (ssh.KeepAliveIntervalMs > 0)
            client.KeepAliveInterval = TimeSpan.FromMilliseconds(ssh.KeepAliveIntervalMs);

        // O SSH.NET confia em qualquer chave se ninguém disser o contrário: sem "Ignorar verificação de host", só a impressão digital informada passa.
        string? refusedKey = null;
        client.HostKeyReceived += (_, args) =>
        {
            args.CanTrust = HostKeyIsTrusted(ssh, args.FingerPrintSHA256);
            if (!args.CanTrust)
                refusedKey = $"SHA256:{args.FingerPrintSHA256}";
        };

        var connecting = client.ConnectAsync(cancellationToken);
        await connecting.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        if (!connecting.IsCompletedSuccessfully)
        {
            client.Dispose();
            if (refusedKey is not null)
                throw new InvalidOperationException(ssh.HostKeyFingerprint is null
                    ? $"A chave do servidor SSH não foi verificada. A impressão digital dela é {refusedKey}: confira com quem administra o servidor (ssh-keygen -lf) e informe-a em \"Impressão digital do host\", ou marque \"Ignorar verificação de host\"."
                    : $"A chave do servidor SSH ({refusedKey}) não confere com a impressão digital informada. Pode haver outro servidor no caminho: confirme com quem administra o servidor antes de trocar a impressão digital.");

            await connecting;
        }

        var boundHost = string.IsNullOrWhiteSpace(ssh.LocalHost) ? "127.0.0.1" : ssh.LocalHost.Trim();
        var localPort = ssh.LocalPort > 0 ? (uint)ssh.LocalPort : 0u;
        var remoteHost = string.IsNullOrWhiteSpace(ssh.RemoteHost) ? settings.Host : ssh.RemoteHost.Trim();
        var remotePort = ssh.RemotePort > 0 ? (uint)ssh.RemotePort : (uint)settings.Port;

        var forwardedPort = new ForwardedPortLocal(boundHost, localPort, remoteHost, remotePort);
        client.AddForwardedPort(forwardedPort);
        forwardedPort.Start();

        return new ConnectionTunnel(forwardedPort.BoundHost, (int)forwardedPort.BoundPort, client, forwardedPort, null);
    }

    /// <summary>
    /// A chave do servidor vale com "Ignorar verificação de host" ou quando confere com a impressão digital informada. `presentedSha256` vem como o SSH.NET
    /// a dá (base64 sem `=` e sem `SHA256:`); a informada aceita os dois. Base64 diferencia maiúsculas: a comparação é exata.
    /// </summary>
    internal static bool HostKeyIsTrusted(ConnectionSshSettings ssh, string presentedSha256)
        => ssh.IgnoreHostVerification || (ssh.HostKeyFingerprint is { } expected && string.Equals(BareFingerprint(expected), BareFingerprint(presentedSha256), StringComparison.Ordinal));

    private static string BareFingerprint(string fingerprint)
    {
        var value = fingerprint.Trim();
        if (value.StartsWith("SHA256:", StringComparison.OrdinalIgnoreCase))
            value = value[7..];

        return value.TrimEnd('=');
    }

    private static string MissingSecret(string what)
        => $"{what} não está gravada nesta conexão. Informe-a em \"Editar conexão\" e tente de novo: sem \"Salvar credenciais\", ela fica só na memória até o Prism ser bloqueado ou fechado.";

    private static string ProxyPasswordOf(ConnectionProxySettings proxy)
        => proxy.UserName is not null && string.IsNullOrEmpty(proxy.Password) ? throw new InvalidOperationException(MissingSecret("A senha do proxy")) : proxy.Password ?? string.Empty;

    private static AuthenticationMethod CreateAuthMethod(ConnectionSshSettings ssh)
    {
        if (string.Equals(ssh.AuthMethod, "privateKey", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(ssh.PrivateKeyPath))
                throw new InvalidOperationException("Informe o caminho da chave privada SSH.");

            var keyFile = string.IsNullOrEmpty(ssh.Secret)
                ? new PrivateKeyFile(ssh.PrivateKeyPath)
                : new PrivateKeyFile(ssh.PrivateKeyPath, ssh.Secret);

            return new PrivateKeyAuthenticationMethod(ssh.UserName, keyFile);
        }

        // RN-REDE-003: sem a senha o SSH.NET responderia "Value cannot be null. (Parameter 's')": a conexão gravada sem "Salvar credenciais", sem a senha digitada desde que o cofre abriu.
        if (string.IsNullOrEmpty(ssh.Secret))
            throw new InvalidOperationException(MissingSecret("A senha do túnel SSH"));

        return new PasswordAuthenticationMethod(ssh.UserName, ssh.Secret);
    }

    /// <summary>
    /// O proxy SOCKS sem SSH: uma porta local em loopback, e cada conexão aceita nela faz a própria passagem pelo proxy. O driver abre mais de uma (o
    /// cancelamento do PostgreSQL é outra conexão com o servidor). A primeira passagem é feita aqui, antes de devolver o túnel: a recusa do proxy (senha
    /// errada, destino inalcançável) chega ao teste e à abertura com a mensagem do SOCKS, e não como a conexão local fechada.
    /// </summary>
    private static async Task<ConnectionTunnel> OpenSocksAsync(string targetHost, int targetPort, ConnectionProxySettings proxy, CancellationToken cancellationToken)
    {
        var first = await ConnectThroughSocksAsync(targetHost, targetPort, proxy, cancellationToken);

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        _ = AcceptThroughSocksAsync(listener, first, targetHost, targetPort, proxy);

        return new ConnectionTunnel("127.0.0.1", ((IPEndPoint)listener.LocalEndpoint).Port, null, null, listener);
    }

    /// <summary>Uma conexão com o destino pelo proxy, já negociada. Na falha, o socket é descartado e a exceção sobe como veio.</summary>
    private static async Task<TcpClient> ConnectThroughSocksAsync(string targetHost, int targetPort, ConnectionProxySettings proxy, CancellationToken cancellationToken)
    {
        var client = new TcpClient();
        var negotiating = NegotiateAsync(client, targetHost, targetPort, proxy, cancellationToken);
        await negotiating.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        if (!negotiating.IsCompletedSuccessfully)
        {
            client.Dispose();
            await negotiating;
        }

        return client;
    }

    private static async Task NegotiateAsync(TcpClient client, string targetHost, int targetPort, ConnectionProxySettings proxy, CancellationToken cancellationToken)
    {
        await client.ConnectAsync(proxy.Host, proxy.Port, cancellationToken);
        await HandshakeSocks5Async(client.GetStream(), targetHost, targetPort, proxy, cancellationToken);
    }

    /// <summary>Aceita até o túnel ser descartado (o `Stop` do listener encerra a espera). A primeira conexão aceita usa a passagem já feita na abertura.</summary>
    private static async Task AcceptThroughSocksAsync(TcpListener listener, TcpClient first, string targetHost, int targetPort, ConnectionProxySettings proxy)
    {
        TcpClient? ready = first;
        while (true)
        {
            var accepting = listener.AcceptTcpClientAsync();
            await ((Task)accepting).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            if (!accepting.IsCompletedSuccessfully)
            {
                ready?.Dispose();
                return;
            }

            _ = BridgeThroughSocksAsync(accepting.Result, ready, targetHost, targetPort, proxy);
            ready = null;
        }
    }

    /// <summary>Liga a conexão local à passagem pelo proxy até um dos lados fechar. Sem passagem (o proxy recusou), a conexão local fecha, e o driver diz por quê.</summary>
    private static async Task BridgeThroughSocksAsync(TcpClient local, TcpClient? ready, string targetHost, int targetPort, ConnectionProxySettings proxy)
    {
        using (local)
        {
            var connecting = ready is null ? ConnectThroughSocksAsync(targetHost, targetPort, proxy, CancellationToken.None) : Task.FromResult(ready);
            await ((Task)connecting).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            if (!connecting.IsCompletedSuccessfully)
                return;

            using var upstream = connecting.Result;
            var localStream = local.GetStream();
            var upstreamStream = upstream.GetStream();
            await Task.WhenAny(localStream.CopyToAsync(upstreamStream), upstreamStream.CopyToAsync(localStream));
        }
    }

    private static async Task HandshakeSocks5Async(NetworkStream stream, string targetHost, int targetPort, ConnectionProxySettings proxy, CancellationToken cancellationToken)
    {
        var hasAuth = !string.IsNullOrWhiteSpace(proxy.UserName) || !string.IsNullOrEmpty(proxy.Password);
        byte[] greeting = hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00];
        await stream.WriteAsync(greeting, cancellationToken);

        var greetingReply = new byte[2];
        await stream.ReadExactlyAsync(greetingReply, cancellationToken);

        if (greetingReply[0] != 0x05)
            throw new InvalidOperationException("Resposta inválida do servidor proxy SOCKS5.");

        if (greetingReply[1] == 0x02)
        {
            var userBytes = Encoding.UTF8.GetBytes(proxy.UserName ?? string.Empty);
            var passBytes = Encoding.UTF8.GetBytes(ProxyPasswordOf(proxy));
            var authPacket = new byte[3 + userBytes.Length + passBytes.Length];
            authPacket[0] = 0x01;
            authPacket[1] = (byte)userBytes.Length;
            userBytes.CopyTo(authPacket, 2);
            authPacket[2 + userBytes.Length] = (byte)passBytes.Length;
            passBytes.CopyTo(authPacket, 3 + userBytes.Length);

            await stream.WriteAsync(authPacket, cancellationToken);

            var authReply = new byte[2];
            await stream.ReadExactlyAsync(authReply, cancellationToken);
            if (authReply[1] != 0x00)
                throw new InvalidOperationException("O proxy SOCKS5 recusou o usuário ou a senha.");
        }
        else if (greetingReply[1] != 0x00)
        {
            throw new InvalidOperationException("O proxy SOCKS5 não aceitou o método de autenticação.");
        }

        var connectPacket = BuildSocks5ConnectPacket(targetHost, targetPort);
        await stream.WriteAsync(connectPacket, cancellationToken);

        var replyHeader = new byte[4];
        await stream.ReadExactlyAsync(replyHeader, cancellationToken);
        if (replyHeader[1] != 0x00)
            throw new InvalidOperationException($"O proxy SOCKS5 não conseguiu conectar ao destino (código {replyHeader[1]}).");

        var remainingBytes = replyHeader[3] switch
        {
            0x01 => 4 + 2,
            0x04 => 16 + 2,
            0x03 => await ReadDomainLengthAsync(stream, cancellationToken) + 2,
            _ => throw new InvalidOperationException("Tipo de endereço inválido na resposta do proxy SOCKS5.")
        };

        var discard = new byte[remainingBytes];
        await stream.ReadExactlyAsync(discard, cancellationToken);
    }

    private static async Task<int> ReadDomainLengthAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var lengthByte = new byte[1];
        await stream.ReadExactlyAsync(lengthByte, cancellationToken);

        return lengthByte[0];
    }

    private static byte[] BuildSocks5ConnectPacket(string host, int port)
    {
        if (IPAddress.TryParse(host, out var ip))
        {
            var addressBytes = ip.GetAddressBytes();
            var atyp = ip.AddressFamily == AddressFamily.InterNetworkV6 ? (byte)0x04 : (byte)0x01;
            var packet = new byte[6 + addressBytes.Length];
            packet[0] = 0x05;
            packet[1] = 0x01;
            packet[2] = 0x00;
            packet[3] = atyp;
            addressBytes.CopyTo(packet, 4);
            BinaryPrimitives.WriteUInt16BigEndian(packet.AsSpan(4 + addressBytes.Length), (ushort)port);

            return packet;
        }

        var hostBytes = Encoding.UTF8.GetBytes(host);
        var domainPacket = new byte[7 + hostBytes.Length];
        domainPacket[0] = 0x05;
        domainPacket[1] = 0x01;
        domainPacket[2] = 0x00;
        domainPacket[3] = 0x03;
        domainPacket[4] = (byte)hostBytes.Length;
        hostBytes.CopyTo(domainPacket, 5);
        BinaryPrimitives.WriteUInt16BigEndian(domainPacket.AsSpan(5 + hostBytes.Length), (ushort)port);

        return domainPacket;
    }

    public ValueTask DisposeAsync()
    {
        if (_forwardedPort is { IsStarted: true })
            _forwardedPort.Stop();

        _forwardedPort?.Dispose();

        if (_sshClient is { IsConnected: true })
            _sshClient.Disconnect();

        _sshClient?.Dispose();
        // As conexões já ligadas fecham com o driver, que é descartado antes do túnel.
        _socksListener?.Stop();

        return ValueTask.CompletedTask;
    }
}
