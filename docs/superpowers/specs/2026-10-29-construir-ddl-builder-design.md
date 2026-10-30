# Construir — modelar tabelas e gerar o DDL — Design

**Data:** 2026-10-29
**Escopo:** um segundo modo do Prism, ao lado da Área de trabalho, para desenhar tabelas, chaves estrangeiras, índices e restrições (como no dbdiagram ou no drawdb), editar o mesmo modelo por formulário, por SQL ou por DBML, salvar o modelo no cofre e gerar o DDL do PostgreSQL, do Db2 ou do Informix. O modelo pode partir do zero ou ler as tabelas de um banco conectado; as tabelas lidas podem receber FKs das novas e também ser alteradas, e o DDL traz **tudo** ou **só as diferenças** em relação ao banco, como o usuário escolher.
**Canvas:** `docs/design/canvas/Construir*.dc.html` (seção "4 · Construir" do `canvas.json`). Onde esta especificação e o canvas divergirem, vale a especificação (seção 9 da especificação da fatia 1).

---

## 1. Intenção e motivação

Quem trabalha com Informix, Db2 e PostgreSQL hoje desenha tabela nova em outra ferramenta (dbdiagram, drawdb, papel) e depois escreve o DDL à mão, conferindo nome de coluna e tipo das tabelas que já existem, e escreve à mão também o `ALTER TABLE` de cada coluna que precisou mudar numa tabela antiga. O erro aparece na hora de rodar: FK com tipo diferente, coluna referenciada com outro nome, `varchar` acima do limite do Informix, `DROP COLUMN` onde era para ser `RENAME`.

O Construir junta tudo no Prism: o usuário lê as tabelas reais de um esquema (sem alterar o banco), desenha as novas ligadas a elas, mexe nas existentes, vê os problemas antes de rodar e leva para uma aba da Área de trabalho o DDL pronto — o esquema inteiro, ou só a migração —, onde valem as proteções que já existem.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- O botão "Área de trabalho" da barra superior vira um seletor de modo com duas opções: **Área de trabalho** (a principal) e **Construir** (ícone de martelo com bigorna).
- No Construir, a barra lateral mostra as tabelas do modelo aberto: as **novas** e as **existentes** (lidas de um banco), com as existentes alteradas marcadas.
- Editar o modelo de três formas, sobre o mesmo modelo: **Simplificado** (formulário por tabela, como o drawdb), **SQL** (DDL do banco de destino) e **DBML**.
- Diagrama com as tabelas, as FKs (seta para a tabela referenciada), arrastar para posicionar e arrastar uma coluna até outra tabela para criar a FK.
- Validar o modelo (erros que impedem o DDL e avisos que não impedem).
- Gerar o DDL do modelo para o banco de destino: **tudo** (o esquema do zero) ou **só as diferenças** (`CREATE` das novas e `ALTER`/`DROP` do que mudou nas existentes). A pergunta aparece na primeira vez que um modelo com base gera o DDL; a resposta fica no modelo e pode ser trocada depois.
- Salvar o modelo no cofre e reabrir depois; exportar `.dbml`, `.sql` e `.png`; abrir um `.sql` ou `.dbml` como modelo novo.
- Começar do zero (esquema ou banco inteiro novo) ou a partir de um banco conectado.

**Não-objetivos desta entrega**
- Executar o DDL a partir do Construir. O script vai para uma aba de consulta e só roda quando o usuário executa (RN-CONSTRUIR-090).
- Converter o modelo de um banco para outro. O destino é fixo; para outro banco, duplica-se o modelo e ajusta-se os tipos.
- Em tabela existente: trocar a chave primária, ligar ou desligar AI numa coluna que já existe, mudar a tabela de esquema. O editor não oferece; o texto lido com isso vira erro (RN-CONSTRUIR-061).
- Perceber uma renomeação feita no texto SQL ou DBML: lá, nome novo é coluna nova e nome que sumiu é coluna removida. Renomear com dados preservados é pelo Simplificado (RN-CONSTRUIR-035).
- Views, sequências, procedures, triggers, grants, enums do DBML, `TableGroup`, tabelas particionadas, `DROP SCHEMA`.
- `CREATE DATABASE`. O modelo cria esquemas e o que há dentro deles, num banco que já existe.
- Ler comentários de coluna do catálogo (a API não os entrega hoje); comentários de tabela são lidos.
- Edição simultânea do mesmo modelo por duas janelas (RN-CONSTRUIR-081 só evita que uma apague a outra).
- Atalho a partir das abas de Diagrama existentes ("construir a partir deste esquema"): é um bom próximo passo, fica fora.

**Anti-objetivos (o que tornaria isto um fracasso mesmo funcionando)**
- O Construir mexer no banco sem o usuário pedir: ler o catálogo é a única coisa que ele faz numa conexão.
- Gerar DDL que o banco de destino rejeita por regra que o Prism conhecia (tipo, limite de nome, ação de FK, sintaxe de `ALTER`) sem ter avisado.
- Um `DROP` que o usuário não viu: toda remoção numa tabela existente aparece riscada no editor e como aviso antes do DDL.
- Perder trabalho: o modelo some ao trocar de modo, ao bloquear o cofre por inatividade ou ao fechar a janela.
- Três editores que brigam entre si, sobrescrevendo o que o usuário acabou de digitar.

## 3. Restrições

- Zero dependências novas em `src/client/package.json` e na API. Nada de `@dbml/core`, biblioteca de diagrama ou de arrastar: o Prism já desenha diagramas em SVG próprio (`diagram-canvas.tsx`) e lê SQL com o leitor de dialetos (`sql-statements.ts`).
- As decisões da raiz `AGENTS.md` valem: sem banco do produto (o modelo mora no cofre), tokens só em `globals.css`, textos em português em `.copy.ts`, identificadores em inglês.
- Testes do cliente sem DOM (marcação e funções puras): toda regra mora em `_lib/*.ts`; os componentes são finos.
- Bancos de destino: só PostgreSQL (engine 1), Db2 (2) e Informix (3). Conexões de outros motores não aparecem como base.

## 4. Relação com o que já existe

| Já existe | O que muda |
| --- | --- |
| `NavLink` "Área de trabalho" na `TopBar` | Vira o seletor de modo (RN-CONSTRUIR-001). |
| Abas de Diagrama da tabela, do esquema e do banco (RN-TABELA-004, RN-ESQUEMA-003, RN-BANCO-001) | Continuam como estão: são uma vista do catálogo vivo, só leitura. O Construir é um modelo, editável, que não precisa de conexão aberta para ser editado. |
| DDL aproximado da aba de tabela (`table-ddl.ts`, RN-TABELA-008) | Continua. O gerador do Construir é outro: parte do modelo e precisa ser exato para o destino. Os dois podem compartilhar a escrita de nome entre aspas, se couber. |
| Scripts salvos (RN-SCRIPT-*) | O modelo segue o mesmo desenho: registro no cofre, rotas `api/user/...`, nome único por usuário. |
| Rotas de catálogo de `api/user/database-sessions/{id}` (RN-CAT-*) | São a leitura das tabelas existentes: `…/schemas/{schema}/diagram`, `…/objects?kind=tables`, e por tabela `…/columns`, `…/indexes` e `…/checks`. |
| `openQueryTab(connectionId, sql, database)` em `workbench-state.tsx` | É o caminho do DDL para a Área de trabalho. |

## 5. Abordagens consideradas

1. **O modelo estruturado é a fonte da verdade; SQL e DBML são vistas que, enquanto estão em uso, escrevem no modelo — escolhida.** O formulário e o diagrama mexem em objetos, sem reescrever texto; o texto é refeito a partir do modelo ao abrir a vista SQL ou DBML. Custo: comentários soltos e a formatação de quem digitou não sobrevivem à troca de vista (o canvas diz isso na barra do DBML).
2. **O texto DBML é a fonte da verdade, como no dbdiagram — descartada.** Arrastar no diagrama e editar no formulário obrigariam a reescrever o texto preservando a formatação; o usuário pediu SQL também, em três dialetos; e o texto não guarda o estado original das tabelas existentes, de que o DDL de diferenças precisa.
3. **Diferenças calculadas contra o banco na hora de gerar — descartada.** Exigiria a conexão aberta para gerar o DDL e faria o resultado mudar sozinho. O modelo guarda a leitura (a `origin` de cada tabela existente) e compara com ela; "Reler do banco" atualiza essa leitura quando o usuário pede.
4. **Gerar o DDL na API — descartada nesta entrega.** O gerador é puro, precisa responder enquanto se digita e não depende de driver; o cliente já gera o DDL aproximado. As fixtures de ouro (seção 9) deixam o gerador portável se um dia ele for para o C#.

## 6. Regras

### 6.1. Modo e navegação

- **RN-CONSTRUIR-001.** Na `TopBar`, o item "Área de trabalho" vira um botão de menu (`aria-haspopup="menu"`, `aria-expanded`), no mesmo lugar e com a mesma aparência de item ativo (`bg-selected text-ink`). O botão mostra o ícone e o nome do modo atual e uma seta. O menu (o `ContextMenu` existente, aberto em `rect.left, rect.bottom + 2`, como em `result-place-button.tsx`) tem dois itens, cada um com ícone, nome e uma linha de dica (`hint`):
  - **Área de trabalho** — "Navegar nos bancos, rodar SQL e editar dados" (`WorkbenchIcon`).
  - **Construir** — "Desenhar tabelas, relações e índices e gerar o DDL" (`BuildIcon`, novo: martelo e bigorna, 16 × 16, traço 1,5, como os demais de `icons.tsx`).
  - O modo atual fica marcado (`aria-checked`); como os itens têm ícone, o `ContextMenu` passa a mostrar o visto depois do texto quando o item marcado tem ícone. Escolher um modo navega para a rota dele; escolher o atual fecha o menu.
  - Em Configurações (que desenha o próprio cabeçalho) nada muda.
- **RN-CONSTRUIR-002.** A rota do Construir é `/build` (`pathsConfig.build`). A página monta a própria `TopBar`, com o botão de mostrar e esconder a barra lateral em `leading` (Ctrl+B, como RN-NAV-008, com a preferência em `prism:build-layout:<usuário>`).
- **RN-CONSTRUIR-003.** O Construir fica montado depois da primeira visita e só se esconde (`hidden` e `inert`) quando a rota é outra, como a `WorkbenchSlot` faz com a Área de trabalho. Trocar de modo não perde nada (cursor, desfazer, rolagem do diagrama), e o bloqueio por inatividade não o remonta: ele fica fora do `RemountOnLock` (o invariante de `routes-lock.test.ts` continua: um único `RemountOnLock`, em volta do `Outlet`).
- **RN-CONSTRUIR-004.** Os modelos abertos são abas próprias do Construir (não entram nas abas da Área de trabalho, cujo formato o servidor valida em `WorkspaceRules.cs`). Quais estão abertos e qual está ativo fica em `localStorage` (`prism:build-tabs:<usuário>`); ao voltar ao Construir noutro dia, os mesmos modelos reabrem. Sem modelo aberto, o Construir mostra a lista de modelos salvos (`ConstruirModelos.dc.html`).

### 6.2. O modelo

- **RN-CONSTRUIR-010.** O formato, em TypeScript (validado com Zod no cliente):

```ts
type BuildEngine = "postgresql" | "db2" | "informix";
type FkAction = "noAction" | "restrict" | "cascade" | "setNull";
type Identity = "always" | "byDefault" | null;

type BuildModel = {
  version: 1;
  engine: BuildEngine;                       // fixo depois de criado
  defaultSchema: string;                     // esquema das tabelas novas; no Informix, o dono (pode ser "")
  schemas: { name: string; create: boolean }[]; // os esquemas do modelo; `create` = sai `CREATE SCHEMA` no DDL
  base: {
    connectionId: string; database: string | null; readAt: string;
    knownSchemas: string[];                  // os esquemas que a base tinha na leitura
    knownTables: string[];                   // "esquema.tabela" de todas as tabelas desses esquemas, lidas ou não
  } | null;
  tables: ModelTable[];
  layout: Record<string, { x: number; y: number; pinned: boolean }>; // chave "esquema.tabela" (nome atual)
  ddl: { scope: "changes" | "full" | null; constraintNames: boolean; comments: boolean; foreignKeysAtEnd: boolean; dropNewFirst: boolean };
  ignoredWarnings: string[];                 // "código:alvo", RN-CONSTRUIR-060
};

type TableShape = {
  schema: string; name: string; exactName: boolean; comment: string | null;
  columns: ModelColumn[];
  primaryKey: { name: string | null; columns: string[] } | null;
  uniques: { name: string | null; columns: string[] }[];
  checks: { name: string | null; expression: string }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  foreignKeys: {
    name: string | null; columns: string[];
    target: { schema: string; table: string; columns: string[] };
    onDelete: FkAction; onUpdate: FkAction;
  }[];
};

type ModelTable = TableShape & {
  origin: TableShape | null;   // como a tabela estava no banco na leitura; null = tabela nova
  dropInDatabase: boolean;     // existente marcada para DROP TABLE no DDL de diferenças
};

type ModelColumn = {
  name: string; exactName: boolean;
  originName: string | null;   // o nome da coluna em `origin`; null = coluna nova
  type: string; nullable: boolean; default: string | null; identity: Identity; comment: string | null;
};
```

- **RN-CONSTRUIR-011. Tabelas novas e existentes.** Uma tabela com `origin` é **existente**: veio do banco, e o que mudar nela em relação a `origin` vira `ALTER` no DDL de diferenças. Sem `origin`, é **nova**. Numa existente:
  - uma coluna de `origin` que nenhuma coluna atual aponta por `originName` foi **removida** (vira `DROP COLUMN`) e aparece riscada no editor com "Restaurar";
  - uma coluna atual sem `originName` foi **acrescentada**; com `originName` diferente de `name`, foi **renomeada**; com tipo, nulo, padrão ou comentário diferentes, foi **alterada**;
  - restrições e índices se comparam pelo nome: mesmo nome com outra definição é removido e criado de novo; nome que sumiu é removido; nome novo é criado;
  - `dropInDatabase` marca a tabela inteira para `DROP TABLE` (cartão riscado, "Restaurar").
  "Desfazer as mudanças desta tabela" volta a tabela a ser igual a `origin`.
- **RN-CONSTRUIR-012. Nomes.** As ligações são por nome. Renomear uma tabela ou coluna atualiza, no mesmo passo, a PK, os únicos, os índices, as FKs que saem dela e as que chegam nela, e a chave do `layout`. Excluir uma coluna tira-a de PK, únicos e índices; uma FK que fica sem coluna é removida e uma notificação com "Desfazer" diz quantas foram junto. Nomes se comparam como o destino compara: sem aspas, PostgreSQL e Informix em minúsculas, Db2 em maiúsculas; com `exactName` (nome que só existe entre aspas no banco, RN-CONSTRUIR-078), exatamente.
- **RN-CONSTRUIR-013. Limites.** Nome de modelo: de 1 a 200 caracteres, sem caractere de controle, único por usuário sem diferenciar maiúsculas (como RN-SCRIPT-004). O corpo serializado passa de 4 MB → recusado (cabe um esquema de algumas centenas de tabelas com a `origin` de cada uma).
- **RN-CONSTRUIR-014. Desfazer e refazer.** Cada alteração do modelo (formulário, diagrama, aplicação de texto, correção sugerida, releitura) empilha o modelo anterior, até 100 passos por modelo aberto, só em memória. Ctrl+Z e Ctrl+Shift+Z (ou Ctrl+Y) agem no modelo quando o foco não está num editor de texto; dentro do SQL e do DBML, vale o desfazer do CodeMirror, e cada aplicação do texto ao modelo (RN-CONSTRUIR-041) é um passo só.

### 6.3. A tela

Desenho em `Construir.dc.html`. De cima para baixo:

- **RN-CONSTRUIR-020. Barra lateral "Tabelas do modelo".** Botões "Nova tabela" (Alt+N) e "Importar tabelas de um banco"; filtro por nome de tabela ou coluna. Grupos:
  - um por esquema, com a marca "novo esquema" quando o DDL o cria; os esquemas que vieram da base levam a marca tracejada "existente";
  - em cada um, as tabelas com a contagem de colunas, a marca "alterada" nas existentes que mudaram, o risco nas marcadas para excluir, e um ponto âmbar quando têm aviso, vermelho quando têm erro; a dica de uma existente diz "Existe em <conexão> / <banco>. O que você mudar nela vira ALTER.";
  - "Relações" e "Índices" (recolhidos), com a contagem;
  - no pé, o resumo dos problemas ("2 avisos no modelo"), que abre a vista do DDL.
  Clicar numa tabela seleciona-a no diagrama e no editor; duplo clique centraliza o diagrama nela.
- **RN-CONSTRUIR-021. Abas dos modelos abertos**, com o ícone do Construir, o nome e, quando a base é uma conexão com ambiente, a pílula do ambiente (como as abas de consulta). "+" abre o "Novo modelo"; "Modelos salvos" abre a lista.
- **RN-CONSTRUIR-022. Barra do modelo:** o destino (marca do banco e nome, só leitura), a base (conexão / banco, com a pílula do ambiente; o menu dela tem "Trocar a base…", RN-CONSTRUIR-058), "Reler do banco", desfazer e refazer, o estado do salvamento ("Salvo no cofre há 4 s", "Salvando…", "Não foi possível salvar: <motivo>" com "Tentar de novo"), "Exportar" (menu: DBML, DDL, diagrama em PNG) e o botão principal "Gerar DDL".
- **RN-CONSTRUIR-023. Editor** (à esquerda do diagrama), com as abas Simplificado, SQL e DBML no estilo das abas do resultado ("Resultado | Mensagens"). A aba escolhida é lembrada por modelo, em memória.
- **RN-CONSTRUIR-024. Diagrama** (à direita), na grade pontilhada do `DiagramaER.dc.html`: no topo, o resumo (esquema, tabelas novas, existentes e quantas alteradas, FKs) e o zoom (−, 100%, +, Ajustar, Organizar); embaixo, a legenda.
- **RN-CONSTRUIR-025. Rodapé:** destino, base e data da leitura, contagens, problemas e o cofre aberto.

### 6.4. Simplificado

Desenho na aba Simplificado de `Construir.dc.html` (tabela nova) e em `ConstruirExistente.dc.html` (tabela existente).

- **RN-CONSTRUIR-030.** Mostra a tabela selecionada: nome, esquema (lista dos esquemas do modelo; digitar um novo cria-o; desabilitado numa existente, com a dica "Uma tabela existente não muda de esquema") e o menu da tabela: Duplicar e Excluir numa nova; numa existente, "Copiar como tabela nova", "Tirar do modelo" (some do modelo; nada vai para o DDL) e "Excluir no banco…" (marca `dropInDatabase`, pede confirmação com o nome da tabela).
- **RN-CONSTRUIR-031. Colunas**, uma por linha: alça de arrastar (reordenar), nome, tipo (campo com sugestões do catálogo do destino, `<datalist>`, aceita qualquer texto), e quatro botões de liga e desliga com `aria-pressed`: **PK** (chave primária), **NN** (não aceita nulo), **UQ** (único), **AI** (gerado pelo banco). Ligar PK liga NN e o trava. Ligar AI usa `always`; os detalhes deixam escolher "sempre" ou "quando não informado" (`byDefault`). Uma coluna que é FK mostra a marca "FK" azul dentro do campo do nome.
  - A seta da linha abre os detalhes: padrão, check da coluna (vira um check de tabela com o nome da coluna), gerado pelo banco (sempre / quando não informado), comentário, "Duplicar coluna" e "Excluir coluna".
  - "Adicionar coluna" cria uma linha vazia no fim, com o foco no nome; Enter no nome da última coluna faz o mesmo.
  - PK de várias colunas: ligar PK em mais de uma coluna forma uma chave composta, na ordem das colunas.
- **RN-CONSTRUIR-032. Chaves estrangeiras:** uma linha por FK com "coluna(s) → esquema.tabela (coluna(s))", "Ao excluir" (impedir, cascata, anular, nada — só as que o destino aceita, RN-CONSTRUIR-077) e remover. "Nova FK" abre a escolha das colunas daqui, da tabela de destino (novas e existentes) e das colunas dela, sugerindo a PK do destino. Numa existente, uma FK para uma tabela fora do modelo aparece com "<tabela> não está no modelo; a FK continua como está no banco".
- **RN-CONSTRUIR-033. Índices:** nome (sugerido `ix_<tabela>_<colunas>`), as colunas em ordem (fichas removíveis e "+ coluna") e UQ.
- **RN-CONSTRUIR-034. Comentário da tabela.**
- **RN-CONSTRUIR-035. Tabela existente** (`ConstruirExistente.dc.html`):
  - no topo, "Existe em <base>", a marca "alterada" quando há mudança, "O que você mudar aqui vira ALTER no DDL de diferenças" e "Desfazer as mudanças desta tabela";
  - coluna renomeada ou alterada: ponto âmbar na alça, campos com borda âmbar e, embaixo, "Era <nome> <tipo>" com "Voltar como era"; renomear aqui guarda `originName` e vira `RENAME COLUMN`, preservando os dados;
  - coluna removida: a linha fica riscada, com "Restaurar";
  - coluna nova: "+" na alça e a marca "NOVA" no campo; índice ou FK novos, borda verde e "NOVO";
  - PK e AI das colunas que já existiam ficam desabilitados, com a dica "Trocar a chave primária de uma tabela existente não é suportado nesta versão" (e o mesmo para AI);
  - no fim, "O que esta tabela vai gerar": os comandos do DDL de diferenças só desta tabela, com a linha de um `DROP` destacada e o aviso de que ele apaga dados.

### 6.5. SQL e DBML

- **RN-CONSTRUIR-040.** Ao abrir a aba SQL ou DBML, o texto é escrito a partir do modelo: primeiro as tabelas novas, depois, sob o comentário "existentes em <base>", as existentes como estão no modelo (as marcadas para excluir ficam de fora). O SQL é o `CREATE TABLE` do destino com a PK e as FKs na linha da coluna quando são de uma coluna, sem cabeçalho; o DBML usa `Table`, `Indexes`, `checks`, `Note` e `Ref`.
- **RN-CONSTRUIR-041.** Enquanto o usuário digita, o texto é lido de novo 400 ms depois da última tecla. Lido sem erro, ele **substitui as tabelas do modelo** e o diagrama atualiza; as posições se mantêm para as tabelas com o mesmo `esquema.nome`. Com erro, nada muda no modelo: a linha fica marcada, a barra embaixo diz a linha e o motivo e "o diagrama segue com a última versão válida". O texto digitado nunca é reescrito enquanto a aba está aberta.
- **RN-CONSTRUIR-042. O que o texto não escreve é mantido.** Ao aplicar o texto:
  - uma tabela do texto com o mesmo `esquema.nome` de uma existente continua existente (mesma `origin`); as colunas se casam pelo nome atual, e o `originName` delas é mantido; uma coluna da existente que sumiu do texto passa a removida (aviso W10); uma existente que sumiu do texto inteiro sai do modelo, sem `DROP`;
  - o que o formato não sabe escrever é mantido do modelo quando o objeto continua lá: no DBML, o nome da FK (casada pelas colunas e pelo destino), o tipo de AI (`increment` mantém `always` ou `byDefault`; um `increment` novo é `always`) e o único de várias colunas (o DBML só escreve índice único; se havia um único com as mesmas colunas, ele continua único); no SQL do Informix, os comentários de tabela e de coluna; em ambos, `exactName`.
- **RN-CONSTRUIR-043. SQL aceito** (dialeto do destino, lido com o leitor de `sql-statements.ts`, que respeita texto, comentários, `$tag$` e `{ }` do Informix):
  - `CREATE SCHEMA nome`;
  - `CREATE TABLE [IF NOT EXISTS] [esquema.]nome (…)` com colunas (tipo com parâmetros, `NOT NULL`, `NULL`, `DEFAULT expr`, `PRIMARY KEY`, `UNIQUE`, `REFERENCES t (c) [ON DELETE …] [ON UPDATE …]`, `CHECK (expr)`, `GENERATED ALWAYS AS IDENTITY` → `always`, `GENERATED BY DEFAULT AS IDENTITY` → `byDefault`, tipos `serial`, `bigserial`, `serial8` e `smallserial` → o inteiro correspondente com `byDefault`) e restrições de tabela (`[CONSTRAINT n] PRIMARY KEY | UNIQUE | FOREIGN KEY … REFERENCES … | CHECK`, inclusive a forma do Informix com `CONSTRAINT n` depois);
  - `CREATE [UNIQUE] INDEX n ON t (colunas)`;
  - `ALTER TABLE t ADD [CONSTRAINT n] {PRIMARY KEY | UNIQUE | FOREIGN KEY | CHECK} …`;
  - `COMMENT ON TABLE | COLUMN … IS '…'`.
  Qualquer outro comando (view, função, grant, `INSERT`, `ALTER` de coluna…) não é erro: vira o aviso W8 "linha N: <tipo de comando> ignorado" e o resto é aplicado.
- **RN-CONSTRUIR-044. DBML aceito:** `Project` (o `database_type`, se diferente do destino, vira aviso W8), `Table [esquema.]nome { … }` com colunas `nome tipo [configurações]` (`pk`, `primary key`, `increment`, `not null`, `null`, `unique`, `default: valor | 'texto' | \`expressão\``, `note: '…'`, `ref: > | < | - destino`, `check: \`expressão\``), `Indexes { coluna | (a, b) [pk, unique, name: '…'] }`, `checks { \`expressão\` [name: '…'] }` (os checks de tabela), `Note: '…'` (comentário da tabela), `Ref [nome]: a.b > c.d [delete: …, update: …]` (inclusive colunas compostas, `a.(x, y)`), comentários `//` e `/* */`.
  - `>` e `<` são muitos-para-um nos dois sentidos; `-` é um-para-um (FK mais um único nas colunas da FK); `<>` é erro: "muitos-para-muitos não vira FK; crie a tabela de ligação".
  - `Enum`, `TableGroup`, índice por expressão e alias de tabela viram aviso W8.
- **RN-CONSTRUIR-045. Ida e volta.** Escrever o modelo em DBML ou no SQL do destino e lê-lo de novo dá o mesmo modelo (com RN-CONSTRUIR-042). As fixtures (seção 9) cobrem isso.

### 6.6. Diagrama

- **RN-CONSTRUIR-050.**
  - Cada tabela é um cartão com o nome em negrito e as colunas (nome, tipo, `PK` âmbar, `FK` azul). As existentes têm borda tracejada e o esquema antes do nome, em tom mais apagado; a alterada leva a marca "alterada"; coluna nova numa existente tem "+" verde e fundo verde claro; coluna removida aparece riscada; tabela marcada para excluir, cabeçalho riscado e cartão esmaecido. As novas têm borda cheia; a selecionada, borda e halo da cor de destaque. Aviso ou erro: o ponto da cor dele no cabeçalho.
  - A FK é uma linha com seta que sai da coluna da FK e chega na coluna referenciada; FKs para a mesma coluna se juntam antes de chegar.
  - Arrastar o cartão muda a posição e o marca como fixado (`pinned`); "Organizar" refaz a disposição só das que não foram fixadas, com o mesmo algoritmo de `layoutSchemaDiagram`; tabelas sem posição (recém-criadas, vindas de texto ou da importação) recebem posição por ele.
  - Arrastar uma coluna até outra tabela cria a FK para a PK dela (se a PK tiver uma coluna; se não, abre a "Nova FK" já preenchida).
  - Clicar seleciona; Delete exclui a tabela nova selecionada (com "Desfazer"); numa existente, Delete não faz nada (as saídas são as do menu, RN-CONSTRUIR-030).
  - Zoom de 25% a 200% com Ctrl+roda e os botões; "Ajustar" enquadra tudo. Teclado: Tab percorre as tabelas na ordem da barra lateral e Enter abre a selecionada no editor.

### 6.7. Começar, importar e reler

Desenho em `ConstruirNovoModelo.dc.html`.

- **RN-CONSTRUIR-055. Novo modelo:** nome, ponto de partida e o esquema das tabelas novas (com "Criar o esquema no DDL", ligado por padrão quando o esquema não está em `knownSchemas`).
  - **Do zero:** escolha do destino entre PostgreSQL, Db2 e Informix. Modelo vazio, sem base.
  - **A partir de um banco:** conexão (PostgreSQL, Db2 ou Informix; uma desconectada se conecta pelo mesmo caminho do navegador, com as mesmas perguntas), banco, e a árvore de esquemas e tabelas com caixas de marcar (o desenho da `CheckTreeView` das conexões), com "Marcar todas" e "Desmarcar". O destino é o motor da conexão. As tabelas marcadas entram como **existentes**; o diálogo diz "recebem FKs das novas e também podem ser alteradas. Ao gerar o DDL, você escolhe se ele traz tudo ou só as diferenças."
  - "O Prism só lê o catálogo. Nada muda no banco."
- **RN-CONSTRUIR-056. Leitura.** Por esquema marcado: `…/schemas/{schema}/diagram` (tabelas, colunas, PK e FKs) e `…/objects?kind=tables` (comentário de cada tabela, e a lista que vai para `knownTables`). Por tabela marcada: `…/columns` (o `columnSchema` do cliente passa a ler o `defaultValue` que a API já entrega), `…/indexes` (sem o índice que só sustenta a PK, isto é, o único com exatamente as colunas da PK) e `…/checks` (rota que hoje não tem quem chame no cliente). Até 4 pedidos ao mesmo tempo, com progresso "Lendo 4 de 12 tabelas" e cancelar. Falha de uma tabela não perde as outras: o modelo é criado, a tabela entra só com o que veio do `diagram` e a falha vira aviso com "Tentar de novo".
  - Mapeamento: `Generated` `always`/`byDefault` → `identity`; no Informix, `serial`/`serial8`/`bigserial` → o inteiro correspondente com `byDefault`; no PostgreSQL, uma coluna `serial` (padrão `nextval(...)`) fica com o padrão como veio e `identity` nulo (aviso W14 no DDL completo).
  - A `origin` de cada tabela é a cópia do que foi lido; as colunas atuais nascem iguais, com `originName` igual ao nome.
- **RN-CONSTRUIR-057. Importar num modelo aberto:** o mesmo diálogo, sem nome nem destino, travado na conexão e no banco da base (num modelo sem base, a primeira importação define a base). Tabela que já está no modelo com o mesmo `esquema.nome` aparece marcada e desabilitada ("já está no modelo").
- **RN-CONSTRUIR-058. Reler do banco e trocar a base.** "Reler do banco" lê de novo as tabelas existentes (RN-CONSTRUIR-056) e troca a `origin` de cada uma pela leitura nova; `readAt`, `knownSchemas` e `knownTables` mudam. O que o usuário mudou é refeito sobre a leitura nova, casando as colunas por `originName`:
  - coluna que o usuário não tinha mexido e mudou no banco: acompanha o banco;
  - coluna nova no banco que o modelo não tinha: entra no modelo (sem isso, o DDL de diferenças a removeria);
  - coluna de `originName` que sumiu do banco: passa a coluna nova (`originName` nulo);
  - tabela existente que sumiu do banco: passa a tabela nova (`origin` nulo);
  - cada um desses casos vira o aviso W13, que diz o que mudou.
  "Trocar a base…" (menu da base) escolhe outra conexão do mesmo motor e outro banco e faz a mesma releitura contra eles, casando as tabelas pelo `esquema.nome`. Sem a conexão aberta, conecta como RN-CONSTRUIR-055.
- **RN-CONSTRUIR-059. Abrir arquivo:** na lista de modelos, "Abrir arquivo .sql ou .dbml" cria um modelo novo, sem base, com o conteúdo lido (todas as tabelas novas; o nome vem do arquivo). Para `.sql`, pergunta o destino; para `.dbml`, usa o `database_type` do `Project` quando for um dos três e pergunta quando não houver. Erros de leitura aparecem antes de criar, com a linha.

### 6.8. Problemas

- **RN-CONSTRUIR-060.** A validação roda a cada mudança do modelo (e da escolha do escopo) e alimenta a barra lateral, os cartões, o rodapé e a lista da vista do DDL. **Erros** impedem "Abrir na Área de trabalho", "Copiar" e "Salvar .sql" (o DDL aparece, com as linhas dos erros marcadas); **avisos** não impedem e podem ser ignorados por modelo ("Ignorar neste modelo", guardado em `ignoredWarnings`); **informações** só explicam. Cada problema diz o que acontece no banco, a tabela e a coluna, a linha do DDL quando há e, quando dá, uma correção de um clique.
- **RN-CONSTRUIR-061. Lista:**

| Código | Tipo | Quando | Correção |
| --- | --- | --- | --- |
| E1 | erro | nome de tabela, coluna, restrição ou índice vazio ou com caractere de controle | — |
| E2 | erro | nome repetido (RN-CONSTRUIR-012): tabela no esquema, coluna na tabela, restrição ou índice no esquema | — |
| E3 | erro | tabela sem colunas | — |
| E4 | erro | coluna sem tipo | — |
| E5 | erro | FK nova ou alterada para tabela ou coluna que não existe no modelo (inclusive uma que sumiu ao reler) | "Remover a FK" |
| E6 | erro | FK com número de colunas diferente do destino | — |
| E7 | erro | FK para colunas de tabela nova que não são a PK nem um único dela | "Criar único em …" |
| E8 | erro | índice sem colunas ou com coluna que não existe | — |
| E9 | erro | nome acima do limite do destino (PostgreSQL 63 bytes, Db2 128, Informix 128) | — |
| E10 | erro | AI em coluna que não é inteira (`smallint`, `integer`, `bigint`; no Db2 também `decimal(p,0)`) | — |
| E11 | erro | ação de FK que o destino não aceita (RN-CONSTRUIR-077) | "Usar <ação aceita>" |
| E12 | erro | Informix: `varchar(n)` com n acima de 255 | "Trocar para lvarchar(n)" |
| E13 | erro | tabela marcada para excluir que outra tabela que fica ainda referencia | "Remover as FKs" |
| E14 | erro | existente com a PK trocada, AI ligado ou desligado numa coluna que já existia, ou mudada de esquema (só pelo texto; o editor não deixa) | "Voltar como era" |
| W1 | aviso | tabela nova sem PK | "Criar coluna id" |
| W2 | aviso | FK com tipo diferente da coluna referenciada (tipo normalizado: nome e tamanho) | "Usar <tipo do destino>" |
| W3 | aviso | PostgreSQL e Db2: colunas de FK que não começam nenhum índice, PK ou único (o Informix cria o índice sozinho). **Um aviso só para o modelo**, com a lista | "Criar os N índices" |
| W4 | aviso | nome que precisa de aspas no destino (RN-CONSTRUIR-078); no Informix, lembra que aspas exigem `DELIMIDENT` | — |
| W5 | aviso | tipo que não está no catálogo do destino (pode ser domínio ou tipo de extensão), com a sugestão mais próxima | "Usar <sugestão>" |
| W6 | aviso | FK para colunas de existente que não são a PK nem um índice único dela | — |
| W7 | aviso | tabela nova com o mesmo `esquema.nome` de uma tabela de `knownTables` que não está no modelo | — |
| W8 | aviso | comando ou construção ignorada ao ler SQL ou DBML (RN-CONSTRUIR-043 e 044) | — |
| W10 | aviso | DDL de diferenças com comando que apaga dados: `DROP TABLE`, `DROP COLUMN`, tipo que encolhe (tamanho ou precisão menor) ou troca de família | "Restaurar" |
| W11 | aviso | DDL de diferenças que falha se houver linhas: `NOT NULL` ligado numa coluna existente, ou coluna nova `NOT NULL` sem padrão numa existente | "Dar um padrão" |
| W12 | aviso | DDL completo: FK de existente para tabela que não está no modelo (ela precisa existir no destino antes) | "Ler <tabela> do banco" |
| W13 | aviso | a releitura (RN-CONSTRUIR-058) mudou o modelo: diz o quê | — |
| W14 | aviso | DDL completo: padrão que usa uma sequência que o script não cria (`nextval(...)`) | "Trocar por AI" |
| I1 | informação | a base é de um ambiente marcado (Produção etc.): o que "Abrir na Área de trabalho" faz | — |
| I2 | informação | data da leitura das existentes | "Reler do banco" |
| I3 | informação | DDL completo de um modelo com existentes: na própria base ele falha no primeiro `CREATE`; é para outro banco | — |

### 6.9. DDL

Desenho em `ConstruirEscopo.dc.html` e `ConstruirDDL.dc.html`.

- **RN-CONSTRUIR-070. O que o DDL traz.** Num modelo com base, a primeira vez que o usuário clica em "Gerar DDL" (`ddl.scope` nulo), o diálogo "O que o DDL deve trazer?" oferece:
  - **Só as diferenças** (marcada ao abrir) — "CREATE das tabelas novas e ALTER do que você mudou nas existentes. As existentes sem mudança ficam de fora. Para rodar em <base>.", com a contagem de comandos;
  - **Tudo** — "O esquema inteiro, do zero: CREATE de todas as tabelas, novas e existentes, como estão no modelo. Para criar em outro banco; na própria <base>, falha no primeiro CREATE.", com a contagem;
  - "A escolha fica guardada no modelo. Dá para trocar depois, no topo do DDL." Cancelar não grava nada; "Gerar DDL" grava a escolha e abre a vista.
  Num modelo sem base não há pergunta: o DDL é sempre o completo, e a escolha não aparece.
- **RN-CONSTRUIR-071. Vista do DDL.** "Gerar DDL" troca o editor e o diagrama pela vista do DDL (só leitura, com cores do SQL e números de linha) e a lista de problemas ao lado; "Voltar ao diagrama" retorna. No topo, a escolha "Só as diferenças | Tudo" (só num modelo com base), a contagem de comandos e de linhas. Opções, guardadas no modelo: `CREATE SCHEMA` por esquema (as caixas de `schemas[].create`), nomes das restrições, comentários, FKs em `ALTER TABLE` no fim, `DROP` das novas antes de criar (desligado por padrão). Ações: "Copiar", "Salvar .sql" e "Abrir na Área de trabalho". Exportar `.sql` (RN-CONSTRUIR-082) usa a escolha guardada.
- **RN-CONSTRUIR-072. Ordem do DDL completo**, sempre a mesma para o mesmo modelo:
  1. cabeçalho em comentário: modelo, destino, versão do Prism, data e hora, e "Tudo: o esquema inteiro, do zero";
  2. com "DROP das novas antes de criar": `DROP TABLE` das tabelas novas na ordem inversa de dependência;
  3. `CREATE SCHEMA` dos esquemas com `create` (não no Informix);
  4. `CREATE TABLE` de todas as tabelas, existentes e novas, como estão no modelo (sem as marcadas para excluir), em ordem de dependência (uma tabela vem depois das que ela referencia; empate por esquema e nome). As FKs ficam dentro do `CREATE TABLE`, salvo com "FKs em `ALTER TABLE` no fim" ou quando fazem parte de um ciclo: essas saem como `ALTER TABLE … ADD CONSTRAINT` depois de todas as tabelas;
  5. `CREATE INDEX`, na ordem das tabelas;
  6. comentários (`COMMENT ON`, só PostgreSQL e Db2).
- **RN-CONSTRUIR-073. Ordem do DDL de diferenças:**
  1. cabeçalho em comentário: modelo, destino, versão, data e hora, "Só as diferenças em relação a <base>, lida em <readAt>" e a lista das existentes sem mudança, "fora daqui";
  2. `DROP CONSTRAINT` das FKs removidas ou alteradas, e das que dependem de coluna que vai ser removida ou mudar de tipo;
  3. `DROP INDEX` dos índices removidos ou alterados;
  4. `DROP TABLE` das existentes marcadas para excluir;
  5. renomeações: de tabela, depois de coluna;
  6. `CREATE SCHEMA` dos esquemas com `create` que não estão em `knownSchemas`;
  7. com "DROP das novas antes de criar": `DROP TABLE` das novas; depois `CREATE TABLE` das novas, como no completo;
  8. `ALTER TABLE` de cada existente alterada, por esquema e nome: removidos os únicos e checks que saíram ou mudaram; acrescentadas as colunas novas; alteradas as colunas que mudaram; removidas as colunas que saíram; acrescentados os únicos e checks novos;
  9. no Db2, `CALL SYSPROC.ADMIN_CMD('REORG TABLE esquema.tabela')` de cada tabela que um comando do passo 8 deixou pendente de reorganização (remoção de coluna, troca de tipo, troca de nulo), com um comentário dizendo por quê;
  10. `ADD CONSTRAINT` das FKs novas ou alteradas em existentes, e das FKs adiadas por ciclo;
  11. `CREATE INDEX` dos índices novos ou alterados;
  12. comentários novos ou alterados (`COMMENT ON`, só PostgreSQL e Db2).
  Sem nenhuma diferença, o DDL é só o cabeçalho e a linha "Nada mudou em relação a <base>.", e as ações ficam desabilitadas com essa dica.
- **RN-CONSTRUIR-074. Nomes das restrições** quando o modelo não dá: `pk_<tabela>`, `fk_<tabela>_<tabela destino>`, `uq_<tabela>_<colunas>`, `ck_<tabela>_<coluna>` (ou `_<n>`). Repetido, ganha `_2`, `_3`…; acima do limite do destino, é cortado e ganha o sufixo. Com "nomes das restrições" desligado, o DDL não escreve `CONSTRAINT` nas restrições sem nome e o banco escolhe. As restrições das existentes sempre têm o nome do catálogo.
- **RN-CONSTRUIR-075. Criar, por destino:**

| | PostgreSQL | Db2 | Informix |
| --- | --- | --- | --- |
| Esquema | `esquema.tabela`; `CREATE SCHEMA` | `esquema.tabela`; `CREATE SCHEMA` | sem esquema: `dono.tabela` quando o dono é dado; sem `CREATE SCHEMA` |
| AI | `GENERATED ALWAYS AS IDENTITY` ou `GENERATED BY DEFAULT AS IDENTITY` | idem | `integer` → `SERIAL`, `bigint`/`int8` → `BIGSERIAL` (o tipo de AI não muda o resultado) |
| Nome de restrição | `CONSTRAINT n PRIMARY KEY (…)` | `CONSTRAINT n PRIMARY KEY (…)` | `PRIMARY KEY (…) CONSTRAINT n` (o nome vem depois) |
| Comentários | `COMMENT ON` | `COMMENT ON` | `-- ` antes da tabela e da coluna |
| `DROP` | `DROP TABLE IF EXISTS …;` | `DROP TABLE …;` com o comentário de que falha se a tabela não existir | `DROP TABLE IF EXISTS …;` |

- **RN-CONSTRUIR-076. Alterar, por destino** (o `t` é `esquema.tabela`, ou `dono.tabela` no Informix):

| Mudança | PostgreSQL | Db2 | Informix |
| --- | --- | --- | --- |
| Renomear tabela | `ALTER TABLE t RENAME TO n` | `RENAME TABLE t TO n` | `RENAME TABLE t TO n` |
| Renomear coluna | `ALTER TABLE t RENAME COLUMN a TO b` | `ALTER TABLE t RENAME COLUMN a TO b` | `RENAME COLUMN t.a TO b` |
| Acrescentar coluna | `ALTER TABLE t ADD COLUMN c tipo […]` | `ALTER TABLE t ADD COLUMN c tipo […]` | `ALTER TABLE t ADD (c tipo […])` |
| Remover coluna | `ALTER TABLE t DROP COLUMN c` | `ALTER TABLE t DROP COLUMN c` (+ reorganizar) | `ALTER TABLE t DROP (c)` |
| Tipo | `ALTER TABLE t ALTER COLUMN c TYPE x`, com `USING c::x` quando muda a família do tipo | `ALTER TABLE t ALTER COLUMN c SET DATA TYPE x` (+ reorganizar) | `ALTER TABLE t MODIFY (c x [DEFAULT …] [NOT NULL])`, que redefine a coluna inteira |
| Nulo | `ALTER COLUMN c SET NOT NULL` / `DROP NOT NULL` | `ALTER COLUMN c SET NOT NULL` / `DROP NOT NULL` (+ reorganizar) | `MODIFY`, como acima |
| Padrão | `ALTER COLUMN c SET DEFAULT x` / `DROP DEFAULT` | `ALTER COLUMN c SET DEFAULT x` / `DROP DEFAULT` | `MODIFY`, como acima |
| Restrição | `ADD CONSTRAINT n …` / `DROP CONSTRAINT n` | `ADD CONSTRAINT n …` / `DROP CONSTRAINT n` (FK: `DROP FOREIGN KEY n`) | `ADD CONSTRAINT … CONSTRAINT n` / `DROP CONSTRAINT n` |
| Índice | `CREATE INDEX n ON t (…)` / `DROP INDEX esquema.n` | `CREATE INDEX esquema.n ON t (…)` / `DROP INDEX esquema.n` | `CREATE INDEX n ON t (…)` / `DROP INDEX n` |

  Várias mudanças da mesma coluna saem juntas: no Informix, num só `MODIFY`; nos outros, um `ALTER COLUMN` por propriedade, na ordem tipo, padrão, nulo.
- **RN-CONSTRUIR-077. Ações de FK aceitas:** PostgreSQL, todas em `ON DELETE` e `ON UPDATE`; Db2, `ON DELETE` com todas e `ON UPDATE` só "nada" e "impedir"; Informix, só `ON DELETE CASCADE` ou nenhuma (que já impede). O formulário só oferece as aceitas; o texto lido com outra vira E11.
- **RN-CONSTRUIR-078. Aspas.** Um nome sai sem aspas quando é "simples" no destino — PostgreSQL `[a-z_][a-z0-9_$]*`, Db2 `[A-Za-z][A-Za-z0-9_]*`, Informix `[a-z_][a-z0-9_]*` — e não é palavra reservada; senão, entre aspas duplas (W4). No Db2, o nome digitado é guardado como foi digitado e sai sem aspas (o banco o guarda em maiúsculas); um nome lido do catálogo do Db2 que não está todo em maiúsculas só existe entre aspas, e por isso entra com `exactName` e sai sempre entre aspas. No PostgreSQL e no Informix, um nome lido com maiúsculas também entra com `exactName`.
- **RN-CONSTRUIR-079.** Os tipos e as expressões de padrão e de check saem como estão no modelo: sem conversão entre bancos (o destino é fixo).

### 6.10. Salvar e exportar

- **RN-CONSTRUIR-080.** O modelo se salva sozinho no cofre 1 s depois da última alteração (e na hora com Ctrl+S, que só mostra "Salvo"). Antes de o cofre fechar (bloqueio, Sair, fechar a janela), o que estiver pendente é gravado junto com as abas (RN-ABAS-006), no mesmo prazo, e a falha não impede a saída.
- **RN-CONSTRUIR-081.** O pedido de salvar leva o `updatedAt` da última versão lida; se outra janela salvou depois, a API recusa (409) e a barra mostra "Este modelo mudou em outra janela" com "Recarregar" (descarta as alterações daqui) e "Manter as minhas" (salva por cima).
- **RN-CONSTRUIR-082. Lista de modelos** (`ConstruirModelos.dc.html`): nome, destino, ponto de partida ("Do zero", "<conexão> / <banco> · <esquemas>", "Arquivo <nome>"), contagens ("3 novas · 3 existentes, 1 alterada"), data da alteração; "Abrir"; menu com Renomear, Duplicar, Exportar DBML (`.dbml`), Exportar DDL (`.sql`, só sem erros), Exportar diagrama (`.png`, o exportador de `diagram-export.ts`) e "Excluir modelo…" (confirma com o nome; fecha a aba se estiver aberta). Filtro pelo nome do modelo ou de uma tabela dele. As exportações usam o mesmo caminho de salvar arquivo que as outras do Prism.

### 6.11. Levar à Área de trabalho

- **RN-CONSTRUIR-090.** "Abrir na Área de trabalho" (só sem erros) abre uma aba de consulta nova com o DDL e muda para a Área de trabalho:
  - **só as diferenças:** na conexão e no banco da base;
  - **tudo**, ou modelo sem base: pergunta em qual conexão e banco (só as do motor do destino; a base aparece com "as existentes já estão aqui").
  Nada roda até o usuário executar; o script segue as regras de execução de script e a confirmação de comando irreversível, inclusive para os `DROP`, como qualquer aba.

## 7. API

Rotas sob `api/user/build-models` (com o `LaunchTokenMiddleware` e o `VaultGateMiddleware`, como os scripts). O corpo do modelo é um texto JSON que a API não interpreta: ela confere tamanho, que é um objeto JSON e o nome; quem valida o formato é o cliente (Zod).

| Método e rota | Corpo | Resposta |
| --- | --- | --- |
| `GET api/user/build-models` | — | 200, `[BuildModelDto]` com o corpo (a lista mostra contagens e destino, que estão nele) |
| `GET api/user/build-models/{id}` | — | 200 `BuildModelDto`; 404 `BUILD_MODEL_NOT_FOUND` |
| `POST api/user/build-models` | `{ name, body }` | 201 `BuildModelDto` |
| `PATCH api/user/build-models/{id}` | `{ name?, body?, expectedUpdatedAt }` | 200 `BuildModelDto`; 409 `BUILD_MODEL_CHANGED` quando o `UpdatedAt` do cofre é outro |
| `DELETE api/user/build-models/{id}` | — | 204 |

`BuildModelDto = { id, name, body, createdAt, updatedAt }`.

Erros: 422 `BUILD_MODEL_NAME_INVALID` ("O nome do modelo deve ter de 1 a 200 caracteres, sem caractere de controle."), 422 `BUILD_MODEL_TOO_LARGE` ("O modelo passa de 4 MB."), 422 `BUILD_MODEL_BODY_INVALID` ("O modelo não é um objeto JSON."), 409 `BUILD_MODEL_ALREADY_EXISTS`, 409 `BUILD_MODEL_CHANGED`, 404 `BUILD_MODEL_NOT_FOUND`, mais os do cofre (401 `VAULT_LOCKED`, 503 `VAULT_UNAVAILABLE`). O corpo do modelo nunca vai para log.

Cofre: `VaultBuildModelRecord(Guid ID, string Name, string Body, DateTime CreatedAt, DateTime UpdatedAt)` e `VaultDocument` ganha, no fim, `IReadOnlyList<VaultBuildModelRecord>? BuildModels = null`, sem subir o formato (como `Dbeaver` e `Plugins`); nulo é lista vazia.

Pastas, espelhando `Scripts`: `Prism.Application/BuildModels/{Features/{GetBuildModels,GetBuildModel,CreateBuildModel,UpdateBuildModel,DeleteBuildModel},Models/{BuildModelRules,BuildModelErrors,Dtos},Repositories/{IBuildModelRepository,BuildModelRepository}}` (o repositório grava pelo serviço do cofre, como `ScriptRepository`), `Prism.Infrastructure/Vault/Models/VaultBuildModelRecord.cs` e `Prism.Api/Controllers/UserBuildModelsController.cs`.

As rotas de catálogo não mudam. O cliente passa a chamar `…/checks` e a ler `defaultValue` de `…/columns`.

## 8. Cliente

- `src/client/src/app/build/` — `page.tsx`, `_components/` e `_lib/`, nas convenções de `src/client/AGENTS.md` (`.schema.ts`, `.service.ts`, `.copy.ts`).
- `_lib/` puro e testado: o modelo e as operações (com a renomeação em cascata e a comparação com `origin`), os catálogos por destino (tipos, palavras reservadas, limites, aspas, ações de FK), a validação, o gerador do DDL completo e o de diferenças, o leitor de SQL, o leitor e o escritor de DBML, a disposição do diagrama, a leitura e a releitura do banco e o serviço das rotas.
- `components/layout/mode-menu.tsx` (o seletor da `TopBar`) e `BuildIcon` em `components/ui/icons.tsx`.
- A página fica viva como a Área de trabalho (RN-CONSTRUIR-003): `WorkbenchSlot` vira uma vaga genérica por rota, ou ganha uma irmã; quem implementa escolhe, mantendo o que `routes.test.ts` e `routes-lock.test.ts` dizem hoje.

## 9. Fixtures de ouro

`src/test-fixtures/build/`, escritas à mão, como as de exportação (RN-EXPORT-024) e de marcadores (RN-VAR-017): mudar uma regra é mudar a fixture; nunca se regeram a partir do código. Só os testes do cliente as leem (a API não gera DDL). O cabeçalho do DDL recebe a versão e a data já formatadas, para a fixture não depender de relógio nem de fuso.

- `models/manutencao.json` — o modelo do canvas (três novas, três existentes, `producao.maquina` com `ultima_revisao_em` acrescentada), base dos outros casos.
- `ddl-full/*.json` — `{ model, context, expected }`: o DDL completo exato. Pelo menos: o modelo do canvas nos três destinos; ciclo de FK; nomes que pedem aspas (com `exactName` do Db2); Informix com `SERIAL`, `lvarchar` e nome de restrição depois; "DROP das novas antes de criar".
- `ddl-changes/*.json` — `{ model, context, expected }`: o DDL de diferenças exato. Pelo menos, nos três destinos: coluna acrescentada, removida, renomeada, com tipo, nulo e padrão trocados (no Informix, num só `MODIFY`); índice e FK novos, alterados e removidos numa existente; existente marcada para excluir; o `REORG` do Db2; e o modelo sem diferença nenhuma.
- `sql/*.json` — `{ engine, sql, before, model, warnings }`: o texto, o modelo de antes (para RN-CONSTRUIR-042), o modelo lido e os avisos.
- `dbml/*.json` — `{ dbml, before, model, warnings }`, mais a ida e volta (RN-CONSTRUIR-045).
- `checks/*.json` — `{ model, scope, problems }`: um caso por código da tabela de RN-CONSTRUIR-061.
- `reread/*.json` — `{ model, catalog, expected, warnings }`: os casos de RN-CONSTRUIR-058.

A raiz `AGENTS.md` ganha a linha da pasta na tabela "Onde está o quê".

## 10. Critérios de aceite

1. Na Área de trabalho, o botão "Área de trabalho" abre o menu com os dois modos; "Construir" leva a `/build`, e o botão passa a mostrar o martelo com bigorna. Voltar à Área de trabalho encontra as abas de consulta como estavam, e voltar ao Construir encontra o modelo, a aba do editor e a rolagem do diagrama como estavam, inclusive depois de um bloqueio por inatividade.
2. Um modelo novo "do zero" para Informix, com duas tabelas ligadas por FK, gera um DDL que o Informix aceita sem edição (com `SERIAL` e o nome da restrição depois), e não pergunta "tudo ou só as diferenças".
3. Um modelo "a partir de um banco" com três tabelas de `producao` e três novas com FK para elas: o primeiro "Gerar DDL" pergunta o escopo; "Só as diferenças" gera os `CREATE TABLE` das novas e nenhum comando para as existentes sem mudança; "Tudo" gera os seis `CREATE TABLE`. A escolha volta igual ao reabrir o modelo.
4. Numa existente, renomear uma coluna pelo Simplificado gera `RENAME COLUMN`, não `DROP` e `ADD`; removê-la gera `DROP COLUMN`, a linha aparece riscada e o aviso W10 aparece; "Restaurar" desfaz.
5. Editar uma coluna no Simplificado, abrir o SQL e o DBML mostra a mudança; digitar uma tabela nova no DBML a faz aparecer no diagrama sem trocar de aba; um erro de sintaxe no SQL não muda o diagrama e diz a linha.
6. FK `integer` para `bigint` aparece como aviso W2 com "Usar bigint"; aplicada a correção, o aviso some e o DDL muda na linha.
7. Com um erro no modelo, "Abrir na Área de trabalho", "Copiar" e "Salvar .sql" ficam desabilitados com a dica do erro.
8. Alguém acrescenta uma coluna numa tabela existente no banco; "Reler do banco" a traz para o modelo, sem que o DDL de diferenças a remova, e o aviso W13 diz o que mudou.
9. Fechar o Prism e abrir de novo: o modelo está na lista, com as posições do diagrama; os modelos que estavam abertos reabrem.
10. Duas janelas com o mesmo modelo: a segunda a salvar vê "Este modelo mudou em outra janela" e não apaga o que a primeira gravou sem o usuário escolher.
11. "Abrir na Área de trabalho" com "Só as diferenças" de um modelo com base de Produção abre uma aba de consulta daquela conexão com o DDL, sem executar; executar pede as confirmações de sempre. Com "Tudo", pergunta a conexão antes.
12. Todas as fixtures de `src/test-fixtures/build/` passam.

## 11. O que ficou a cargo de quem implementa

- O desenho exato do componente de diagrama: estender `DiagramCanvas` (zoom, rolagem e busca já estão lá) com arrastar e selecionar, ou compor por fora dele.
- A forma do leitor de SQL sobre `sqlTokens` e `splitStatements` de `sql-statements.ts`, desde que continue respeitando texto, comentários, `$tag$` e `{ }`.
- O realce do DBML no CodeMirror (`StreamLanguage` do `@codemirror/language`, que já está instalado) e o do SQL (o mesmo do editor de consultas).
- O texto exato de cada problema, desde que diga o que acontece no banco.
- O algoritmo de ciclo e de ordem (qualquer ordenação topológica estável que bata com as fixtures).
- A normalização de tipo usada em W2 e W10 (sinônimos como `int4`/`integer`, `int8`/`bigint`), desde que as fixtures de `checks/` passem.

## 12. Decisões

**Do usuário (29/10/2026):**
- As tabelas lidas do banco são **editáveis**; "só as diferenças" gera `CREATE` das novas e `ALTER`/`DROP` do que mudou nas existentes.
- A pergunta "tudo ou só as diferenças" aparece **na primeira vez** que o modelo gera o DDL, fica guardada no modelo e pode ser trocada na vista do DDL.

**Minhas, para revisar:**
- Um **destino por modelo**, sem conversão de tipos entre bancos.
- O Construir **não executa**: o DDL vai para uma aba de consulta.
- **Sem `CREATE DATABASE`**: "criar o banco inteiro do zero" é criar todos os esquemas e tabelas num banco que já existe.
- Em existente, **não** se troca a PK, não se liga nem desliga AI e não se muda de esquema nesta entrega.
- O texto SQL e DBML é **refeito a partir do modelo** ao abrir a aba; o que o formato não escreve é mantido do modelo (RN-CONSTRUIR-042); renomear pelo texto é remover e acrescentar.
- Tipo desconhecido é **aviso** (W5), não erro, por causa dos domínios e tipos de extensão.
- W3 (FK sem índice) é **um aviso só** para o modelo, com a lista, para não afogar a lista de problemas.
- AI guarda `always` ou `byDefault`; o botão AI liga `always`. Uma `serial` do PostgreSQL lida do banco fica como está (padrão `nextval`), sem virar identity.
- **Uma base por modelo**; importar num modelo aberto fica travado nela; "Trocar a base…" relê tudo contra outra conexão do mesmo motor.
- `CREATE SCHEMA` é **por esquema** (`schemas[].create`), ligado por padrão para o que a base não tem.
- Comentários de coluna **não** são lidos do banco (a API não os entrega); os de tabela, sim.
- Salvar é **automático** (1 s), com Ctrl+S só para forçar; dois salvamentos de janelas diferentes se resolvem por `expectedUpdatedAt`.
- A rota é `/build` e as rotas da API são `api/user/build-models`, para não confundir "modelo" com as pastas `Models` do C#.
