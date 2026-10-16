using Prism.Infrastructure.Vault.Models;

namespace Prism.Infrastructure.ConnectionFiles.Models;

/// <summary>
/// RN-TRANSF-007: o arquivo da exportação de conexões como ele é escrito, um JSON em UTF-8 com o cabeçalho em claro (`kind`, `version`, `kdf`) e o conteúdo
/// cifrado (`payload`), com os bytes em base64, nos nomes e na forma do cabeçalho do cofre (por isso os mesmos `VaultKdf` e `VaultSealedBox`). Nada aqui é
/// segredo: o conteúdo só aparece cifrado. Um campo novo vai dentro do conteúdo, nunca aqui: do cabeçalho, só os campos do dado autenticado são conferidos
/// pela cifra (RN-VERSAO-002).
/// </summary>
public sealed record ConnectionFile(string Kind, int Version, VaultKdf Kdf, VaultSealedBox Payload);
