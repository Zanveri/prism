namespace Prism.Infrastructure.Databases.Models;

/// <summary>Os bancos que o Prism conecta. O número é o que fica gravado no cofre e o que a tela manda: não se renumera.</summary>
public enum EDatabaseEngine : short
{
    PostgreSql = 1,
    Db2 = 2,
    Informix = 3
}
