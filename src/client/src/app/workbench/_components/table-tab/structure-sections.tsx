import { Fragment, useId, useRef, type ReactNode } from "react";

import { Button, RefreshIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { breakableParts, entryMark, structureSections, type EntryMark, type StructureSection } from "../../_lib/structure-sections";
import type { DdlState } from "../../_lib/table-ddl";
import type { LevelView, StructureColumn, StructureForeignKey, StructureIndex } from "../../_lib/table-structure";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { StructureNav, structurePanelId, structureTabId, type NavEntry } from "./structure-nav";
import { useNavOrientation } from "./use-nav-orientation";

const copy = workbenchCopy.tableTab;
const text = copy.structure;

/**
 * As células da tabela, na medida do canvas (`TabelaDetalhe`): cabeçalho de 36 px com o texto de 12 px, linhas de 36 px no mínimo. O cabeçalho fica fixo no topo
 * da rolagem da seção (`sticky`, o que pede `border-separate`: com `border-collapse` a borda de baixo dele rolaria embora).
 *
 * **Nada de barra horizontal na tabela, e nada cortado: o texto quebra.** As células de texto (nome, tipo, colunas, referência) levam `wrap-anywhere`, que
 * quebra nos espaços e, só se uma palavra sozinha não cabe, no meio dela; e é `anywhere`, e não `break-word`, porque só ele diminui a largura mínima da
 * célula, e então a tabela cabe no painel em vez de empurrá-lo. Escolhi quebrar, e não cortar com reticências e `title`, porque o que mais importa num
 * nome de restrição ou de índice é o fim dele (`..._system_id`, `..._systems_id`), e ele seria o que as reticências esconderiam. Os nomes ainda ganham um ponto
 * de quebra depois de cada `_` e `.` (`Breakable`), para a linha cair entre as palavras; o `anywhere` fica como último recurso. As células de uma palavra só e
 * de largura conhecida (o número, "sim" e "não", a marca de chave) não quebram.
 */
const headerCell = "sticky top-0 z-10 h-9 border-b border-border bg-raised px-4 text-left text-xs font-medium whitespace-nowrap text-muted";
const cell = "h-9 border-b border-selected px-4 py-2";
const textCell = cn(cell, "wrap-anywhere");
const mono = "font-mono";
/** A última linha não leva a divisória de baixo: o painel já tem a borda dele. */
const tableClass = "w-full border-separate border-spacing-0 text-sm [&_tbody_tr:last-child_td]:border-b-0";

/** Um nome com um ponto de quebra depois de cada `_` e `.` (`breakableParts`): ao quebrar, a linha cai entre as palavras. O `<wbr>` não é caractere, e o texto é o mesmo. */
function Breakable({ text: value }: { text: string }) {
  return breakableParts(value).map((part, index) =>
    index === 0 ? (
      part
    ) : (
      <Fragment key={index}>
        <wbr />
        {part}
      </Fragment>
    ),
  );
}

/** A marca de chave: a primária no acento, a estrangeira no azul do canvas (o mesmo do PostgreSQL: o canvas não tem outro). */
function Keys({ keys }: { keys: StructureColumn["keys"] }) {
  return (
    <span className="flex gap-2 font-mono text-xs font-semibold">
      {keys.map((key) => (
        <span key={key} title={text.keys[key]} className={key === "PK" ? "text-accent" : "text-postgres"}>
          {key}
        </span>
      ))}
    </span>
  );
}

/** O que a seção mostra no lugar da tabela: o carregando, o erro (a mensagem do banco, com "Tentar de novo") ou o vazio. Pronta, a tabela dela. */
function LevelBody({ view, empty, onRetry, children }: { view: LevelView; empty: string; onRetry: () => void; children: ReactNode }) {
  switch (view.kind) {
    case "loading":
      return (
        <p role="status" className="px-4 py-3 text-muted">
          {copy.loading}
        </p>
      );
    case "error":
      return (
        <div className="flex flex-col items-start gap-3 px-4 py-3">
          {/* A mensagem do banco, como veio (decisão 4 da seção 8): é texto, e pode ter várias linhas. */}
          <p className="break-words whitespace-pre-wrap text-danger">{view.message}</p>
          {view.sessionLost ? <p className="text-xs text-muted">{copy.sessionLost}</p> : null}
          <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onRetry}>
            {copy.retry}
          </Button>
        </div>
      );
    case "empty":
      return <p className="px-4 py-3 text-muted">{empty}</p>;
    case "ready":
      return children;
  }
}

/**
 * O corpo da seção DDL (RN-TABELA-008): o `CREATE TABLE` que o Prism monta do catálogo, com o aviso de que não é o DDL do banco. É texto para ler e copiar: o
 * Prism não o executa. O aviso fica sempre à vista, e a primeira linha do texto copiado o repete. Uma visão não tem `CREATE TABLE`: a seção diz que o Prism não
 * monta o DDL de visões. Sem saber se o objeto é tabela ou visão (a árvore da conexão ainda não o mostrou), o texto sai com o aviso de que pode ser uma visão.
 * As linhas compridas (a de uma chave estrangeira composta passa de 150 caracteres) quebram, em vez de rolar na horizontal: o botão copia o texto, e não a quebra.
 */
function DdlBody({ ddl }: { ddl: DdlState }) {
  const warningId = useId();

  return (
    <>
      <p id={warningId} className="px-4 pt-3 text-xs text-muted">
        {text.ddl.warning}
      </p>
      {ddl.kind === "loading" ? (
        <p className="px-4 py-3 text-muted">{text.ddl.unavailable}</p>
      ) : ddl.kind === "empty" ? (
        <p className="px-4 py-3 text-muted">{text.ddl.empty}</p>
      ) : ddl.kind === "view" ? (
        <p className="px-4 py-3 text-body">{text.ddl.view}</p>
      ) : (
        <>
          {ddl.maybeView ? <p className="px-4 pt-2 text-xs text-accent">{text.ddl.maybeView}</p> : null}
          {/* `tabIndex`: o bloco é texto para ler e copiar, e o teclado e o leitor de tela precisam alcançá-lo. */}
          <pre tabIndex={0} aria-label={text.ddl.label} aria-describedby={warningId} className="px-4 py-3 font-editor text-[13px] leading-5 whitespace-pre-wrap wrap-anywhere text-body">
            {ddl.text}
          </pre>
        </>
      )}
    </>
  );
}

type Level<Row> = {
  view: LevelView;
  rows: Row[];
};

type StructureSectionsProps = {
  /** A seção escolhida na lista lateral (RN-TABELA-009): é a única que se desenha. */
  section: StructureSection;
  onSection: (section: StructureSection) => void;
  columns: Level<StructureColumn>;
  foreignKeys: Level<StructureForeignKey>;
  indexes: Level<StructureIndex>;
  /** O DDL aproximado (RN-TABELA-008), montado de tudo o que a Estrutura já carregou, e o botão de copiá-lo. */
  ddl: DdlState;
  onCopyDdl: (ddl: string) => void;
  fetching: boolean;
  onRefresh: () => void;
  /** "Ver no diagrama", do canvas (`TabelaDetalhe`). */
  onOpenDiagram: () => void;
  /** "Tentar de novo": refaz as listas, e abre outra sessão da árvore se a API já não conhece a que elas usavam. */
  onRetry: () => void;
};

/** O nome de cada seção na lista lateral e o título dela no painel: um para cada seção, ou o tipo reclama. */
const entryLabels: Record<StructureSection, string> = { columns: text.columns.title, foreignKeys: text.foreignKeys.title, indexes: text.indexes.title, ddl: text.ddl.entry };
const sectionTitles: Record<StructureSection, string> = { columns: text.columns.title, foreignKeys: text.foreignKeys.title, indexes: text.indexes.title, ddl: text.ddl.title };

/**
 * O que a Estrutura desenha (RN-TABELA-003 e 009), só de propriedades: à esquerda a lista de seções (Colunas, Chaves estrangeiras, Índices e DDL, cada uma com a
 * contagem), à direita só a seção escolhida, que ocupa toda a largura e a altura que sobram. O cabeçalho da seção (o título e os botões "Ver no diagrama",
 * "Atualizar" e, no DDL, "Copiar") fica fora da rolagem; o corpo rola na vertical, com o cabeçalho da tabela fixo no topo. Cada seção tem o estado dela (carregando,
 * erro com "Tentar de novo", vazio ou a tabela), e uma lista que falha não esconde as outras: a entrada dela só ganha a marca de aviso, e continua clicável.
 */
export function StructureSections({ section, onSection, columns, foreignKeys, indexes, ddl, onCopyDdl, fetching, onRefresh, onOpenDiagram, onRetry }: StructureSectionsProps) {
  // Um id por Estrutura montada: com duas abas de tabela montadas, ids fixos fariam o painel da segunda ser nomeado pela entrada da primeira.
  const idBase = useId();
  const list = useRef<HTMLDivElement>(null);
  const orientation = useNavOrientation(list);

  const marks: Record<StructureSection, EntryMark> = {
    columns: entryMark(columns.view, columns.rows.length),
    foreignKeys: entryMark(foreignKeys.view, foreignKeys.rows.length),
    indexes: entryMark(indexes.view, indexes.rows.length),
    ddl: { kind: "none" },
  };
  const entries: NavEntry[] = structureSections.map((id) => ({ id, label: entryLabels[id], mark: marks[id] }));
  const copyText = ddl.kind === "ready" ? ddl.text : null;

  function body(): ReactNode {
    switch (section) {
      case "columns":
        return (
          <LevelBody view={columns.view} empty={text.columns.empty} onRetry={onRetry}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={cn(headerCell, "w-10 text-right")}>
                    {text.columns.number}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.columns.name}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.columns.type}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.columns.nullable}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.columns.key}
                  </th>
                </tr>
              </thead>
              <tbody>
                {columns.rows.map((row) => (
                  <tr key={row.position}>
                    <td className={cn(cell, "text-right whitespace-nowrap text-subtle")}>{row.position}</td>
                    <td className={cn(textCell, mono, "font-medium")}>
                      <Breakable text={row.name} />
                    </td>
                    <td className={cn(textCell, mono, "text-body")}>{row.type}</td>
                    <td className={cn(cell, "whitespace-nowrap text-body")}>{row.nullable ? text.columns.yes : text.columns.no}</td>
                    <td className={cn(cell, "whitespace-nowrap")}>
                      <Keys keys={row.keys} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LevelBody>
        );
      case "foreignKeys":
        return (
          <LevelBody view={foreignKeys.view} empty={text.foreignKeys.empty} onRetry={onRetry}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={headerCell}>
                    {text.foreignKeys.name}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.foreignKeys.columns}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.foreignKeys.references}
                  </th>
                </tr>
              </thead>
              <tbody>
                {foreignKeys.rows.map((row, index) => (
                  <tr key={index}>
                    <td className={cn(textCell, mono, "font-medium")}>
                      <Breakable text={row.name} />
                    </td>
                    <td className={cn(textCell, mono, "text-body")}>
                      <Breakable text={row.columns} />
                    </td>
                    <td className={cn(textCell, mono, "text-postgres")}>
                      <Breakable text={row.references} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LevelBody>
        );
      case "indexes":
        return (
          <LevelBody view={indexes.view} empty={text.indexes.empty} onRetry={onRetry}>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={headerCell}>
                    {text.indexes.name}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.indexes.columns}
                  </th>
                  <th scope="col" className={headerCell}>
                    {text.indexes.unique}
                  </th>
                </tr>
              </thead>
              <tbody>
                {indexes.rows.map((row, index) => (
                  <tr key={index}>
                    <td className={cn(textCell, mono, "font-medium")}>
                      <Breakable text={row.name} />
                    </td>
                    <td className={cn(textCell, mono, "text-body")}>
                      <Breakable text={row.columns} />
                    </td>
                    <td className={cn(cell, "whitespace-nowrap text-body")}>{row.unique ? text.columns.yes : text.columns.no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LevelBody>
        );
      case "ddl":
        return <DdlBody ddl={ddl} />;
    }
  }

  // A raiz é o contêiner da consulta (`@container`): a lista é uma fileira no topo, e uma coluna de 200 px ao lado da seção a partir de `@4xl` (56 rem) de largura
  // DELA, e não da janela. Quando a lista deixa de ser vertical, o `aria-orientation` e as setas a acompanham (`useNavOrientation`).
  return (
    <div aria-busy={fetching} className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @4xl:flex-row">
        <StructureNav ref={list} orientation={orientation} idBase={idBase} entries={entries} selected={section} onSelect={onSection} />

        <div role="tabpanel" id={structurePanelId(idBase)} aria-labelledby={structureTabId(idBase, section)} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-panel px-4 py-2">
            <h3 className="text-base leading-7 font-semibold">{sectionTitles[section]}</h3>
            <div className="ml-auto flex items-center gap-2">
              {section === "ddl" ? (
                <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" aria-label={text.ddl.copyLabel} disabled={copyText === null} onClick={() => copyText !== null && onCopyDdl(copyText)}>
                  {text.ddl.copy}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onOpenDiagram}>
                {text.openDiagram}
              </Button>
              <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" disabled={fetching} onClick={onRefresh}>
                <RefreshIcon />
                {copy.refresh}
              </Button>
            </div>
          </div>

          {/* A rolagem é só da seção: o cabeçalho acima, com os botões, não sai da vista. */}
          <div className="min-h-0 flex-1 overflow-y-auto">{body()}</div>
        </div>
      </div>
    </div>
  );
}
