namespace Prism.TestingCore.Fakers.Dbeaver;

/// <summary>
/// O DBeaver SINTÉTICO da especificação (seção "Testes e sondas"), escrito à mão: um workspace com `General` e mais projetos, pastas aninhadas, os três bancos por
/// campos e por URL, um MySQL, um Informix com servidor, um `prod`, um tipo criado, uma cor da conexão, um túnel, um `save-password` falso, um `save-password` verdadeiro
/// sem senha no arquivo, um `pgpass`, uma variável, um `data-sources-2.json` com o par dele, um `data-sources-backup.json` com um ID repetido, um `credentials-config.json`
/// ausente e um de 0 byte, um `project-settings.json` com `secureProject` e outro com só `useProjectPassword`, um tipo com `permission-restrictions`,
/// `provider-properties` só com chaves `@dbeaver-`, uma pasta com mais de 60 caracteres e uma URL que não casa com `;password=` nela. Hosts no domínio reservado
/// `.invalid`; as senhas são inventadas e cada uma tem uma marca própria, para os testes procurarem nas respostas e nos logs.
/// </summary>
public static class DbeaverWorkspace
{
    /// <summary>Uma marca em todo texto sensível: o teste do log procura por ela.</summary>
    public const string Mark = "marca-dbeaver-7f3a";

    public const string PgPassword = $"senha-pg-{Mark}";
    public const string InformixPassword = $"senha-ifx-{Mark}";
    public const string InlinePassword = $"senha-inline-{Mark}";
    public const string Db2Password = $"senha-db2-{Mark}";
    public const string UrlSecret = $"segredo-na-url-{Mark}";
    public const string SalesPassword = $"senha-vendas-{Mark}";

    public const string PgFields = "postgres-jdbc-1a0d49eb651-aaaa000000000001";
    public const string PgUrl = "postgres-jdbc-1a0d49eb651-aaaa000000000002";
    public const string Db2Fields = "db2-1b1e5af0762-bbbb000000000003";
    public const string Db2Url = "db2-1b1e5af0762-bbbb000000000004";
    public const string InformixFields = "informix-1999a18bee0-cccc000000000005";
    public const string InformixUrl = "informix-1999a18bee0-cccc000000000006";
    public const string MySql = "mysql8-1c2f6b01873-dddd000000000007";
    public const string NoSavedPassword = "postgres-jdbc-1a0d49eb651-aaaa000000000008";
    public const string SavedPasswordMissing = "postgres-jdbc-1a0d49eb651-aaaa000000000009";
    public const string PgPass = "postgres-jdbc-1a0d49eb651-aaaa00000000000a";
    public const string Variable = "postgres-jdbc-1a0d49eb651-aaaa00000000000b";
    public const string BadUrl = "informix-1999a18bee0-cccc00000000000c";
    public const string Restricted = "postgres-jdbc-1a0d49eb651-aaaa00000000000d";
    public const string External = "postgres-jdbc-1a0d49eb651-aaaa00000000000e";
    public const string Inline = "postgres-jdbc-1a0d49eb651-aaaa00000000000f";
    public const string SalesMain = "postgres-jdbc-1a0d49eb651-eeee000000000010";
    public const string SalesSecond = "postgres-jdbc-1a0d49eb651-eeee000000000011";
    public const string SalesBackupDuplicate = "backup-duplicate-id";

    public const string LongFolderName = "Pasta com um nome muito comprido, bem mais do que sessenta caracteres no total";

    /// <summary>A pasta `Producao/Informix` aninhada, a vazia, a antiga com `parent` e a de nome longo.</summary>
    private const string GeneralDataSources = """
        {
          "folders": {
            "Producao": {"description": "descrição que fica de fora"},
            "Producao/Informix": {},
            "Vazia": {},
            "Pasta com um nome muito comprido, bem mais do que sessenta caracteres no total": {},
            "Antiga": {"parent": "Producao"}
          },
          "connection-types": {
            "prod": {"name": "Production", "color": "250,207,207", "confirm-execute": true, "confirm-data-change": true},
            "qa": {"name": "QA Homologação", "color": "10,20,30", "confirm-execute": false, "confirm-data-change": true},
            "restrito": {"name": "Restrito", "color": "255,255,255", "security": {"permission-restrictions": ["edit.data", "edit.meta"]}}
          },
          "virtual-models": {"x": {}},
          "connections": {
            "postgres-jdbc-1a0d49eb651-aaaa000000000001": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Pedidos PG", "save-password": true, "folder": "Producao",
              "configuration": {"host": "pg-dev.exemplo.invalid", "port": "5432", "database": "pedidos", "type": "dev",
                "provider-properties": {"@dbeaver-show-non-default-db@": "true"}}
            },
            "postgres-jdbc-1a0d49eb651-aaaa000000000002": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Faturas por URL", "save-password": true, "folder": "Producao",
              "configuration": {"configurationType": "URL", "url": "jdbc:postgresql://pg-url.exemplo.invalid:6543/faturas?ssl=true", "type": "test"}
            },
            "db2-1b1e5af0762-bbbb000000000003": {
              "provider": "db2", "driver": "db2", "name": "Cadastro Db2", "save-password": true, "folder": "Producao",
              "configuration": {"host": "db2-dev.exemplo.invalid", "port": 50000, "database": "cadastro", "type": "prod"}
            },
            "db2-1b1e5af0762-bbbb000000000004": {
              "provider": "db2", "driver": "db2", "name": "Cadastro Db2 por URL", "save-password": true,
              "configuration": {"configurationType": "URL", "url": "jdbc:db2://db2-url.exemplo.invalid:50001/cadastro:currentSchema=APP;", "type": "prod"}
            },
            "informix-1999a18bee0-cccc000000000005": {
              "provider": "generic", "driver": "informix", "name": "USER MIGRATION STOCK MANAGER", "save-password": true, "folder": "Producao/Informix",
              "configuration": {"host": "central.exemplo.invalid", "port": "55080", "server": "far_ewm_001_dev_tcp", "database": "tramon", "type": "qa", "color": "100,150,200",
                "handlers": {"ssh_tunnel": {"type": "TUNNEL", "enabled": true, "properties": {"host": "bastion.exemplo.invalid"}}}}
            },
            "informix-1999a18bee0-cccc000000000006": {
              "provider": "generic", "driver": "informix", "name": "Estoque por URL", "save-password": true, "folder": "Producao/Informix",
              "configuration": {"configurationType": "URL", "url": "jdbc:informix-sqli://ifx-url.exemplo.invalid:55081/estoque:INFORMIXSERVER=ifx_url_tcp"}
            },
            "mysql8-1c2f6b01873-dddd000000000007": {
              "provider": "mysql", "driver": "mysql8", "name": "Legado MySQL", "folder": "Antiga",
              "configuration": {"host": "mysql.exemplo.invalid", "port": "3306", "database": "legado"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa000000000008": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Sem salvar senha", "save-password": false, "folder": "Antiga",
              "configuration": {"host": "pg-nosave.exemplo.invalid", "port": "5432", "database": "x"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa000000000009": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Senha no cofre do sistema", "save-password": true, "folder": "Antiga",
              "configuration": {"host": "pg-missing.exemplo.invalid", "port": "5432", "database": "x"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa00000000000a": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Com pgpass", "folder": "Antiga",
              "configuration": {"host": "pg-pgpass.exemplo.invalid", "port": "5432", "database": "x", "auth-model": "postgres_pgpass"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa00000000000b": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Com variável",
              "configuration": {"host": "${host_do_ambiente}", "port": "5432", "database": "x"}
            },
            "informix-1999a18bee0-cccc00000000000c": {
              "provider": "generic", "driver": "informix", "name": "URL que não casa",
              "configuration": {"configurationType": "URL", "url": "jdbc:informix-sqli:INFORMIXSERVER=ifx_dev_tcp;user=fulano;password=segredo-na-url-marca-dbeaver-7f3a"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa00000000000d": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Restrita", "read-only": false,
              "configuration": {"host": "pg-restrita.exemplo.invalid", "port": "5432", "database": "x", "type": "restrito"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa00000000000e": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "De fonte externa", "origin": {"type": "externa"},
              "configuration": {"host": "pg-externa.exemplo.invalid", "port": "5432", "database": "x"}
            },
            "postgres-jdbc-1a0d49eb651-aaaa00000000000f": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Com credenciais no arquivo", "read-only": true,
              "configuration": {"host": "pg-inline.exemplo.invalid", "port": "5432", "database": "x", "user": "usuario-inline", "password": "senha-inline-marca-dbeaver-7f3a"}
            }
          }
        }
        """;

    private const string SalesDataSources = """
        {
          "connections": {
            "postgres-jdbc-1a0d49eb651-eeee000000000010": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Vendas Principal", "save-password": true, "folder": "Relatorios",
              "configuration": {"host": "pg-vendas.exemplo.invalid", "port": "5432", "database": "vendas"}
            },
            "backup-duplicate-id": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "No arquivo principal", "configuration": {"host": "pg-vendas.exemplo.invalid", "port": "5432", "database": "vendas"}
            }
          }
        }
        """;

    private const string SalesSecondDataSources = """
        {
          "connections": {
            "postgres-jdbc-1a0d49eb651-eeee000000000011": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Vendas Extra", "save-password": true, "folder": "Relatorios/Extras",
              "configuration": {"host": "pg-extra.exemplo.invalid", "port": "5433", "database": "extra"}
            }
          }
        }
        """;

    private const string SalesBackupDataSources = """
        {
          "connections": {
            "backup-duplicate-id": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "No backup esquecido", "configuration": {"host": "pg-backup.exemplo.invalid", "port": "5432", "database": "velho"}
            }
          }
        }
        """;

    private const string LegacyDataSources = """
        {
          "connections": {
            "postgres-jdbc-1a0d49eb651-ffff000000000020": {
              "provider": "postgresql", "driver": "postgres-jdbc", "name": "Legado PG", "save-password": true,
              "configuration": {"host": "pg-legado.exemplo.invalid", "port": "5432", "database": "legado"}
            }
          }
        }
        """;

    /// <summary>
    /// Põe no construtor os cinco projetos: `General` (1), `Vendas` (2, com `data-sources-2.json` e o par, e o `data-sources-backup.json` com o ID repetido),
    /// `Legado` (3, com o `credentials-config.json` de 0 byte), `Seguro` (4, `secureProject`) e `Senha` (5, só `useProjectPassword`).
    /// </summary>
    public static DbeaverCopyBuilder Add(DbeaverCopyBuilder builder)
        => builder
            .Project("General", project => project
                .DataSources(GeneralDataSources)
                .Credentials(DbeaverCopyBuilder.CredentialsJson(
                    (PgFields, "usuario-pg", PgPassword), (PgUrl, "usuario-url", null), (Db2Fields, "usuario-db2", Db2Password), (Db2Url, "usuario-db2", Db2Password),
                    (InformixFields, "usuario-ifx", InformixPassword), (InformixUrl, "usuario-ifx", InformixPassword), (NoSavedPassword, "usuario-nosave", null),
                    (SavedPasswordMissing, "usuario-missing", null), (PgPass, "usuario-pgpass", "senha-que-o-pgpass-ignora"), (Variable, "usuario-var", null),
                    (BadUrl, "usuario-badurl", null), (Restricted, "usuario-restrita", null), (Inline, "usuario-do-arquivo", "senha-do-arquivo-que-perde")), iv: new byte[16]))
            .Project("Vendas", project => project
                .DataSources(SalesDataSources)
                .DataSources(SalesSecondDataSources, "-2")
                .DataSources(SalesBackupDataSources, "-backup")
                .Credentials(DbeaverCopyBuilder.CredentialsJson((SalesMain, "usuario-vendas", SalesPassword), ("backup-duplicate-id", "usuario-principal", null)))
                .Credentials(DbeaverCopyBuilder.CredentialsJson((SalesSecond, "usuario-extra", "senha-extra-fictícia")), "-2"))
            .Project("Legado", project => project.DataSources(LegacyDataSources).Add("credentials-config.json", Array.Empty<byte>()))
            .Project("Seguro", project => project.DataSources("não é lido").Settings("""{"secureProject": true, "useProjectPassword": true}"""))
            .Project("Senha", project => project
                .DataSources(LegacyDataSources.Replace("ffff000000000020", "ffff000000000030").Replace("Legado PG", "Protegida PG"))
                .Credentials(DbeaverCopyBuilder.CredentialsJson(("postgres-jdbc-1a0d49eb651-ffff000000000030", "usuario-protegida", "senha-protegida-fictícia")))
                .Settings("""{"useProjectPassword": true}"""));
}
