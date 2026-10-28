# Sistema de Plugins de Terceiros e Plugin SitDescriptions — Especificação de Design

**Data:** 2026-10-28  
**Escopo:** Suporte a plugins de terceiros no Prism (com consentimento explícito no modelo do Obsidian e instalação via repositórios Git HTTPS/SSH ou pastas locais no modelo do Claude Marketplace) + criação do primeiro plugin interno `SitDescriptions` em `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`.

---

## 1. Visão Geral e Objetivos

1. **Consentimento Explícito e Isenção de Responsabilidade (Modo Restrito):**
   - Por padrão, plugins de terceiros ficam desabilitados (*Modo restrito ativo*).
   - Para utilizar ou instalar plugins de terceiros, o usuário deve aceitar explicitamente um termo de responsabilidade nas Configurações do Prism, declarando ciência de que plugins de terceiros executam código e consultas SQL por conta e risco do usuário e isentando o autor do Prism de qualquer responsabilidade.
   - O consentimento e a lista de plugins instalados/vinculados são persistidos no cofre cifrado do usuário (`VaultDocument.Plugins`).

2. **Distribuição via Git (Público ou Privado via HTTPS/SSH) e Pasta Local:**
   - O usuário pode instalar plugins informando:
     - Uma **URL de repositório Git** (`https://...`, `git@...`, `ssh://...`), clonada pela API local do Prism usando o binário `git` e as credenciais/chaves SSH da própria máquina do usuário para `<PRISM_DATA_DIR>/plugins/<id>`.
     - Um **caminho de pasta local** (ex.: `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`), vinculado diretamente para desenvolvimento ou uso local.
   - Repositórios públicos funcionam imediatamente para qualquer usuário; repositórios privados (como uma instância interna do GitLab) funcionam para os usuários que possuem acesso SSH/HTTPS configurado na própria máquina.

3. **Extensibilidade da Interface e Consultas na Sessão Ativa (`PrismPlugin` SDK):**
   - Plugins ativos são carregados no front-end e recebem um objeto `prism` que permite:
     - Executar consultas SQL na sessão de banco aberta (`prism.db.query(sessionId, sql, params)`).
     - Registrar enriquecedores da visualização de estrutura de tabelas (`prism.ui.registerTableStructureEnricher(enricher)`), adicionando descrição da tabela no cabeçalho, colunas extras na grade de estrutura (como `Formato` e `Descrição`) e painel lateral de detalhes do atributo selecionado.

4. **Plugin `SitDescriptions`:**
   - Criado em `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions` com `manifest.json`, `main.js` e `README.md`.
   - Consulta as tabelas de dicionário de dados `diadic` e `diadii` no Informix para exibir:
     - A descrição da tabela ao lado do nome da tabela no cabeçalho da aba Estrutura.
     - As colunas `Formato` (`def_format` da `diadic`) e `Descrição` (`diidescr` da `diadii`) ao lado das colunas da tabela.
     - O painel lateral `Inf. do atributo (<coluna>)` ao selecionar um atributo na tabela.

---

## 2. Persistência no Cofre (`Prism.Infrastructure/Vault`)

Sem alterar o número de versão do formato do cofre (mantendo o formato 4 e compatibilidade retroativa, exatamente como `VaultDocument.Dbeaver`), `VaultDocument` recebe um parâmetro opcional ao final:

```csharp
public sealed record VaultDocument(
    string UserName,
    IReadOnlyList<VaultFolderRecord> Folders,
    IReadOnlyList<VaultConnectionRecord> Connections,
    IReadOnlyList<VaultScriptRecord> Scripts,
    VaultWorkspaceRecord Workspace,
    IReadOnlyList<VaultScriptFolderRecord> ScriptFolders,
    VaultDbeaverRecord? Dbeaver = null,
    VaultPluginsRecord? Plugins = null);

public sealed record VaultPluginsRecord(
    DateTimeOffset? ConsentedAt,
    IReadOnlyList<VaultPluginItemRecord> Items);

public sealed record VaultPluginItemRecord(
    string ID,
    string SourceType, // "git" | "local"
    string Source,     // URL git ou caminho absoluto local
    bool Enabled,
    DateTimeOffset InstalledAt,
    DateTimeOffset UpdatedAt);
```

- Quando o cofre é bloqueado ou quando `ConsentedAt` é `null`, nenhum plugin é executado nem entregue como ativo.

---

## 3. Contratos da API (`Prism.Api`, `Prism.Application`, `Prism.Infrastructure`)

Todas as rotas ficam sob `api/user/plugins` (protegidas pelo `LaunchTokenMiddleware` e `VaultGateMiddleware`):

### 3.1. `GET api/user/plugins`
Retorna o estado atual do sistema de plugins do usuário:
```json
{
  "consented": true,
  "consentedAt": "2026-10-28T15:00:00Z",
  "plugins": [
    {
      "id": "sit-descriptions",
      "name": "SIT — Descrições de Tabelas e Atributos",
      "version": "1.0.0",
      "description": "Exibe descrições de tabelas, atributos e formatos com base nas tabelas diadic e diadii.",
      "author": "Automação Industrial",
      "sourceType": "local",
      "source": "c:\\Projetos\\Automação Industrial\\PrismPlugins\\SitDescriptions",
      "enabled": true,
      "available": true,
      "installedAt": "2026-10-28T15:01:00Z",
      "updatedAt": "2026-10-28T15:01:00Z",
      "error": null
    }
  ]
}
```

### 3.2. `PUT api/user/plugins/consent`
- Corpo: `{ "consented": true | false }`
- Se `consented = true`: grava `ConsentedAt = TimeProvider.GetUtcNow()`.
- Se `consented = false`: limpa `ConsentedAt = null` e desativa todos os plugins registrados (`Enabled = false`).
- Resposta: `200 OK` com o estado atualizado (`PluginStateDto`).

### 3.3. `POST api/user/plugins/install`
- Corpo: `{ "source": "<url-git-ou-caminho-local>" }`
- Regras:
  - Exige que `ConsentedAt != null`; caso contrário, retorna `422 PLUGIN_CONSENT_REQUIRED`.
  - Se `source` for um caminho de diretório local existente na máquina:
    - Lê e valida o `manifest.json` dentro da pasta (`id`, `name`, `version`, `description`, `author`, `main`).
    - Registra com `SourceType = "local"` e `Enabled = true`.
  - Se `source` for uma URL Git (`https://...`, `http://...`, `git@...`, `ssh://...`):
    - Clona em uma pasta temporária sob `<PRISM_DATA_DIR>/plugins/.staging-<guid>` via `git clone --depth 1 -- <source> <stagingDir>`.
    - Lê e valida o `manifest.json` clonado.
    - Move para `<PRISM_DATA_DIR>/plugins/<manifest.id>` e registra no cofre com `SourceType = "git"` e `Enabled = true`.
- Códigos de erro (422):
  - `PLUGIN_CONSENT_REQUIRED`: usuário ainda não aceitou o termo de responsabilidade.
  - `PLUGIN_SOURCE_INVALID`: fonte vazia, com caracteres de controle ou formato inválido.
  - `PLUGIN_GIT_FAILED`: falha ao executar `git clone` (ex.: sem permissão SSH, repositório inexistente), trazendo o motivo retornado pelo Git na mensagem de erro.
  - `PLUGIN_MANIFEST_INVALID`: `manifest.json` ausente, malformado ou sem o arquivo `main` apontado.

### 3.4. `POST api/user/plugins/{id}/update`
- Se `SourceType == "git"`: executa `git pull --ff-only` em `<PRISM_DATA_DIR>/plugins/{id}` e atualiza `UpdatedAt`.
- Se `SourceType == "local"`: relê o `manifest.json` da pasta local e atualiza `UpdatedAt`.
- Resposta: `200 OK` com o item atualizado (`PluginItemDto`).

### 3.5. `PUT api/user/plugins/{id}/enabled`
- Corpo: `{ "enabled": true | false }`
- Ativa ou desativa o plugin no cofre. Exige consentimento ativo para ativar.
- Resposta: `200 OK` com `PluginItemDto`.

### 3.6. `DELETE api/user/plugins/{id}`
- Remove o plugin do cofre e, se `SourceType == "git"`, apaga a pasta `<PRISM_DATA_DIR>/plugins/{id}`. (Se for `"local"`, nunca apaga a pasta original do usuário).
- Resposta: `204 No Content`.

### 3.7. `GET api/user/plugins/bundles`
- Retorna os pacotes (`id`, `manifest`, `code`) de todos os plugins atualmente ativos (`ConsentedAt != null` e `Enabled == true` e arquivo `main.js` legível), para que o cliente carregue e ative os plugins em memória.

---

## 4. Manifesto, Runtime de Plugins no Cliente e SDK (`prism`)

### 4.1. Manifesto (`manifest.json`)
- `id`: identificador único em kebab-case (`^[a-z0-9][a-z0-9._-]{0,63}$`, ex.: `sit-descriptions`).
- `name`: nome legível (1 a 120 caracteres).
- `version`: versão semântica (1 a 40 caracteres, ex.: `1.0.0`).
- `description`: resumo do plugin (até 500 caracteres).
- `author`: autor ou equipe (até 120 caracteres).
- `main`: arquivo de entrada relativo à raiz do plugin (padrão `"main.js"`, sem `..` ou caminhos absolutos).

### 4.2. SDK entregue ao `main.js`
O código do plugin pode exportar `activate(prism)` (CommonJS `module.exports = { activate }` ou retorno direto). O objeto `prism` fornece:

```ts
export interface PrismPluginApi {
  db: {
    /**
     * Executa uma consulta SQL de leitura na sessão aberta e devolve as colunas e linhas como objetos/arrays.
     */
    query(
      sessionId: string,
      sql: string,
      params?: Array<{ type: string; value: string | null }>
    ): Promise<{
      columns: string[];
      rows: Array<Record<string, string | null>>;
    }>;
  };
  ui: {
    /**
     * Registra um enriquecedor para a aba de Estrutura de Tabela.
     */
    registerTableStructureEnricher(enricher: TableStructureEnricher): () => void;
  };
}
```

Onde `TableStructureEnricher` recebe:
```ts
export interface TableStructureContext {
  sessionId: string;
  schema: string;
  table: string;
  columns: Array<{
    position: number;
    name: string;
    type: string;
    nullable: boolean;
    keys: ("PK" | "FK")[];
  }>;
}

export interface TableStructureEnrichment {
  /** Descrição exibida ao lado do nome da tabela no cabeçalho (ex.: "descrição do dicionário de dados por idioma"). */
  tableDescription?: string | null;
  /** Colunas extras exibidas na grade de atributos (ex.: [{ key: "format", label: "Formato" }, { key: "description", label: "Descrição" }]). */
  extraColumns?: Array<{ key: string; label: string }>;
  /** Valores das colunas extras indexados pelo nome da coluna (case-insensitive). */
  columnValues?: Record<string, Record<string, string | null>>;
  /** Texto detalhado do atributo exibido no painel lateral "Inf. do atributo (<nome>)" ao selecionar a linha. */
  columnDetails?: Record<string, string | null>;
}
```

---

## 5. Interface do Usuário (`src/client`)

1. **Seção "Plugins" nas Configurações (`SettingsPage`):**
   - Adicionada em `settingsSections` (`id: "plugins"`, âncora `"cfg-plugins"`, rótulo `"Plugins"`).
   - **Estado Modo Restrito:** Exibe cartão explicando o modo restrito e botão **"Ativar plugins de terceiros…"**. Ao clicar, abre modal com o termo de isenção de responsabilidade e botões **"Cancelar"** e **"Compreendo os riscos e quero ativar"**.
   - **Estado Ativo:**
     - Permite voltar ao Modo Restrito a qualquer momento.
     - Campo para instalar plugin por **URL Git (`https://` ou `git@...`) ou caminho de pasta local** + botão de atalho para preencher/instalar ou atualizar.
     - Lista de plugins instalados com nome, versão, autor, origem (`Git` ou `Local`), descrição, chave Liga/Desliga, botão **Atualizar** (`git pull` / recarregar) e botão **Remover**.

2. **Aba de Estrutura (`StructureView` e `StructureSections`):**
   - `StructureView` consulta os enrichers registrados pelos plugins ativos através do hook `useTableStructureEnrichment`.
   - No cabeçalho da `StructureView`, se houver `tableDescription`, exibe ` — <tableDescription>` ao lado do nome da tabela.
   - Em `StructureSections` (seção `Colunas`):
     - Renderiza os cabeçalhos e células de `extraColumns` (como `Formato` e `Descrição`) ao lado das colunas existentes.
     - Quando houver `columnDetails`, clicar numa linha de atributo seleciona a linha e exibe à direita da grade de colunas o painel **`Inf. do atributo (<nome_da_coluna>)`** com a descrição completa, fiel à ferramenta anterior da empresa.

---

## 6. O Plugin `SitDescriptions` (`c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`)

- **Cálculo do sistema (`sissist`):** Primeiros 2 caracteres do nome da tabela em letras maiúsculas (ex.: `diaemp` → `'DI'`, `diadii` → `'DI'`).
- **Consultas executadas pelo plugin:**
  1. **Descrição da tabela (`diadii`):**
     ```sql
     SELECT diidescr, sissist
       FROM diadii
      WHERE diccod = ?
        AND sissist = ?
        AND diiidioma = 'P'
     UNION ALL
     SELECT diidescr, sissist
       FROM diadii
      WHERE diccod = ?
        AND sissist = ''
        AND diiidioma = 'P'
      ORDER BY sissist DESC
     ```
  2. **Formato das colunas (`diadic` via `systables` / `syscolumns`):**
     ```sql
     SELECT b.colname, b.coltype, b.collength, b.colno,
            NVL((SELECT c.dicformat FROM diadic c WHERE b.colname = c.diccod AND c.sissist = ?),
                (SELECT c.dicformat FROM diadic c WHERE b.colname = c.diccod AND c.sissist = '')) def_format
       FROM systables a, syscolumns b
      WHERE a.tabid = b.tabid
        AND a.tabname = ?
      ORDER BY b.colno
     ```
  3. **Descrição dos atributos (`diadii`):**
     Consulta as descrições dos atributos em `diadii` para o `sissist` da tabela e fallback `''` com `diiidioma = 'P'`, preenchendo:
     - Coluna `Formato` (`def_format`)
     - Coluna `Descrição` (`diidescr`)
     - Painel lateral `Inf. do atributo (<colname>)` ao clicar no atributo.
