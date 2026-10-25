using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// As recusas do "Importar do DBeaver" (seções 6 e 40 da especificação), num lugar só. As que a tela mostra num campo vêm na forma do erro de campo (`errors` e
/// `errorCodes`, com o nome da propriedade em PascalCase): `SourceId`, `WithPasswords`, `DrdaPorts`, `Items` e `Overwrite`. O detalhe é sempre uma frase do
/// Prism: nenhuma recusa repete o conteúdo da cópia, um nome de projeto, uma conexão, um usuário ou uma senha do DBeaver (RN-LOG-001).
/// </summary>
internal static class DbeaverErrors
{
    /// <summary>RN-DBEAVER-007: a frase do limite, e o que se acrescenta quando há mais de um projeto na origem.</summary>
    public const string LimitsMessage = "O DBeaver tem mais do que o Prism importa de uma vez: até 2.000 conexões, 2.000 pastas e 32 níveis de pastas.";

    public const string LimitsMessageWithManyProjects = LimitsMessage + " Escolha um projeto só.";

    /// <summary>Nota de seção 6: a cópia que não existe (apagada, de outra execução, ou com o manifesto ausente). A tela pede outra origem sozinha.</summary>
    public static ApiErrorDto SourceMissing()
        => ApiErrorDto.CreateNotFound("Cópia do DBeaver não localizada.", "DBEAVER_SOURCE_MISSING", "A cópia do DBeaver não existe mais. Procure o DBeaver de novo.");

    /// <summary>Nenhum projeto da cópia pôde ser lido: os `data-sources*.json` malformados, ou todos os projetos protegidos ou com nome que o Prism não aceita.</summary>
    public static ApiErrorDto SourceInvalid()
        => ApiErrorDto.CreateUnprocessableEntity("Cópia do DBeaver ilegível.", "DBEAVER_SOURCE_INVALID", "O Prism não conseguiu ler as conexões deste DBeaver.");

    /// <summary>O projeto que não está no manifesto, ou está protegido por senha de projeto, ou tem o nome que o Prism não aceita.</summary>
    public static ApiErrorDto ProjectNotFound()
        => ApiErrorDto.CreateNotFound("Projeto do DBeaver não localizado.", "DBEAVER_PROJECT_NOT_FOUND", "Este projeto não está na cópia do DBeaver, ou está protegido por senha de projeto.");

    public static ApiErrorDto LimitsExceeded(bool manyProjects)
        => ApiErrorDto.CreateUnprocessableEntity("DBeaver além dos limites.", "DBEAVER_LIMITS_EXCEEDED", manyProjects ? LimitsMessageWithManyProjects : LimitsMessage);

    public static ApiErrorDto SourceIdInvalid()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "IMPORT_INVALID", "SourceId", "O identificador da cópia do DBeaver não é válido.");

    /// <summary>RN-DBEAVER-016: uma chave marcada que a cópia não tem. A tela não deixa chegar a isso.</summary>
    public static ApiErrorDto UnknownItem()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "IMPORT_INVALID", "Items", "Uma chave marcada não está na cópia do DBeaver.");

    /// <summary>RN-DBEAVER-017: uma chave de `overwrite` que não é de uma conexão marcada (a que não está em `items`, ou é de pasta).</summary>
    public static ApiErrorDto UnknownOverwrite()
        => ApiErrorDto.CreateUnprocessableEntityOnField("Erro ao enviar dados para a API.", "IMPORT_INVALID", "Overwrite", "Só se sobrescreve uma conexão marcada.");
}
