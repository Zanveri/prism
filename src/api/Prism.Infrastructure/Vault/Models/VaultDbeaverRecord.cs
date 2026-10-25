namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// RN-DBEAVER-018: o que o cofre do usuário guarda da importação do DBeaver. `InvitedAt` é quando o convite foi feito (o "Comece por aqui", o diálogo de
/// entrada ou uma importação), e `LastImportAt` é quando a última importação que gravou algo aconteceu; as duas em UTC, nulas até acontecerem. É do usuário
/// (segue o cofre dele), e não da instalação. Campo novo e opcional do documento (<see cref="VaultDocument.Dbeaver"/>): sem subir o formato do cofre.
/// </summary>
public sealed record VaultDbeaverRecord(DateTime? InvitedAt, DateTime? LastImportAt);
