namespace Prism.Infrastructure.Drivers.Models;

/// <summary>O que o gerenciador de drivers recusa na hora, sem começar nada (seção 16 da especificação). A Application traduz cada um para o erro da API.</summary>
public enum EDriverFailure
{
    NotFound,

    /// <summary>O fabricante não publica o driver para esta plataforma, ou o Prism ainda não conecta nesse banco.</summary>
    Unavailable,

    /// <summary>Já está instalado, vem embutido, ou foi removido e a remoção ainda espera o reinício da API.</summary>
    AlreadyInstalled,

    /// <summary>RN-DRIVER-004: uma instalação por driver de cada vez.</summary>
    InstallInProgress,

    /// <summary>RN-DRIVER-003: sem o aceite da licença do fabricante nada é baixado.</summary>
    LicenseNotAccepted,

    NotInstalling,
    NotInstalled,

    /// <summary>A pasta de drivers não pôde ser gravada (disco). A seção 16 não tem código para isto: a Application responde o erro interno genérico.</summary>
    StoreUnavailable
}

/// <summary>Como uma instalação que começou pode terminar sem instalar (RN-DRIVER-003 e 004).</summary>
public enum EDriverInstallFailure
{
    /// <summary>A rede, o servidor ou o disco: o pacote não chegou inteiro à pasta de drivers. O usuário pode tentar de novo.</summary>
    DownloadFailed,

    /// <summary>O que chegou não é o pacote do catálogo (tamanho ou SHA-512), ou o conteúdo dele não é o esperado. Nada é extraído para a pasta do driver.</summary>
    IntegrityFailed,

    /// <summary>O usuário cancelou, ou a API está encerrando. Não é erro: o driver volta a `Available`.</summary>
    Canceled
}

/// <summary>
/// O motivo de uma instalação que falhou, para a tela: `Detail` é uma frase do próprio Prism, em português, sem caminho de arquivo, sem
/// cabeçalho e sem corpo de resposta (RN-LOG-001). A exceção e os detalhes dela ficam no log.
/// </summary>
public sealed record DriverInstallFailure(EDriverInstallFailure Kind, string Detail);
