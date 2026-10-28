namespace Prism.Infrastructure.Plugins.Models;

/// <summary>
/// A recusa da leitura, clonagem ou atualização de um plugin de terceiro, com uma mensagem pronta para a tela e sem caminhos do sistema de arquivos da máquina (RN-LOG-001).
/// </summary>
public sealed record PluginFailure(EPluginFailure Kind, string Message);
