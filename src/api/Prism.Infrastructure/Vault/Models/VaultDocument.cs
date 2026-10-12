namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// O conteúdo de um cofre aberto: é o que vai cifrado no `payload` do arquivo. Não muda no lugar: quem
/// altera entrega um documento novo ao `SaveAsync` do serviço.
/// </summary>
public sealed record VaultDocument(string UserName, IReadOnlyList<VaultFolderRecord> Folders, IReadOnlyList<VaultConnectionRecord> Connections);
