namespace Prism.Infrastructure.Vault.Models;

/// <summary>
/// Um script salvo como fica gravado dentro do cofre (RN-SCRIPT-002): o nome, o texto do SQL e o lugar em que ele foi salvo, a conexão e o banco da aba
/// (RN-SCRIPT-003). `ConnectionID` pode apontar para uma conexão que já não existe: o script continua do usuário, e a tela pede outra conexão ao abri-lo.
/// `Database` nulo é o banco da própria conexão.
///
/// O ícone e a cor (RN-SCRIPT-006) vieram depois, no mesmo formato do cofre (RN-VERSAO-005): a leitura entrega nulo ao campo que o JSON de antes não tem,
/// e nulo é o ícone padrão e "sem cor", então o script gravado antes abre como estava. Por isso os dois ficam no fim, com o padrão nulo.
///
/// A pasta de scripts (`FolderID`, RN-SCRIPT-007) veio com o formato 4 (RN-SCRIPT-011), no fim do registro e nula na raiz da seção Scripts: o script gravado
/// antes abre na raiz.
///
/// Os valores lembrados (`RunValues`, RN-VAR-028) vieram com a seção 41 sem subir o formato (RN-VERSAO-005), no fim do registro e nulos no script que nunca
/// rodou pelo "Executar com valores…": o cofre gravado antes os lê nulos, e a versão anterior que abre o cofre gravado por esta ignora o campo (a leitura do
/// documento usa as opções padrão do `JsonSerializer`, que pulam o membro desconhecido).
/// </summary>
public sealed record VaultScriptRecord(Guid ID, string Name, string Sql, Guid? ConnectionID, string? Database, DateTime CreatedAt, DateTime UpdatedAt, string? Icon = null, string? Color = null, Guid? FolderID = null, VaultScriptRunValuesRecord? RunValues = null)
{
    /// <summary>RN-LOG-001: o `ToString()` gerado imprimiria o texto do SQL onde quer que o record fosse parar.</summary>
    public override string ToString()
        => nameof(VaultScriptRecord);
}
