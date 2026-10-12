import { memo, useMemo } from "react";

/**
 * O interpretador das notas de uma versão (RN-ATUALIZA-004). As notas vêm da rede e são texto não confiável: daqui só saem
 * título, lista, parágrafo, ênfase e código, como elementos do React, e todo o resto é escrito como veio. Não há HTML
 * (`dangerouslySetInnerHTML` não existe neste arquivo), imagem, link nem endereço que o app abra: `<script>`, `<img>`,
 * `[texto](endereço)` e `![imagem](endereço)` aparecem como o texto que são.
 *
 * É uma passada só pelas linhas e uma expressão regular por trecho, sem recursão: entrada enorme ou com aninhamento fundo
 * não trava nem estoura a pilha (há teste). Lista dentro de lista vira a mesma lista, e citação é parágrafo.
 */
export type Inline = { kind: "text" | "strong" | "em" | "code"; text: string };

export type Block = { kind: "heading"; level: 3 | 4; content: Inline[] } | { kind: "paragraph"; content: Inline[] } | { kind: "list"; items: Inline[][] } | { kind: "code"; text: string };

/**
 * `código`, **forte** e *ênfase*, sem aninhar. Cada alternativa só anda até a próxima marca do mesmo tipo, então a busca é
 * linear. A marca de ênfase tem de encostar no texto (`2 * 3` não é ênfase), e a que não fecha fica como texto.
 */
const inlinePattern = /`([^`\n]+)`|\*\*(?!\s)([^*\n]+)(?<!\s)\*\*|\*(?!\s)([^*\n]+)(?<!\s)\*/g;

function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;

  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push(match[1] !== undefined ? { kind: "code", text: match[1] } : match[2] !== undefined ? { kind: "strong", text: match[2] } : { kind: "em", text: match[3] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });

  return parts;
}

/**
 * A flag `s` não é enfeite: sem ela o `.` não casa U+2028, U+2029 nem um CR solto, o `$` falha numa linha que tenha um deles
 * e o `\s+` devolve os espaços um a um, relendo o resto a cada vez. Uma linha de título com 50 mil espaços custava 3 s.
 */
const headingPattern = /^(#{1,6})\s+(.*)$/s;
const itemPattern = /^[-*+]\s+(.*)$/s;
const fence = "```";

export function parseNotes(text: string): Block[] {
  if (typeof text !== "string") return [];

  const blocks: Block[] = [];
  /** O que está sendo montado: as linhas de um parágrafo, ou os itens de uma lista (o último ainda pode ganhar linhas). */
  let paragraph: string[] = [];
  let items: string[][] = [];
  let afterBlank = false;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    if (items.length > 0) blocks.push({ kind: "list", items: items.map((lines) => parseInline(lines.join(" "))) });
    paragraph = [];
    items = [];
  };

  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === "") {
      // Uma linha em branco fecha o parágrafo. A lista continua se o que vier depois for outro item.
      if (paragraph.length > 0) flush();
      afterBlank = true;
      continue;
    }
    const wasAfterBlank = afterBlank;
    afterBlank = false;

    if (line.startsWith(fence)) {
      flush();
      const code: string[] = [];
      for (index += 1; index < lines.length && !lines[index].trim().startsWith(fence); index += 1) code.push(lines[index].replace(/\r$/, ""));
      if (code.length > 0) blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length <= 3 ? 3 : 4, content: parseInline(heading[2]) });
      continue;
    }

    const item = itemPattern.exec(line);
    if (item !== null) {
      if (paragraph.length > 0) flush();
      items.push([item[1]]);
      continue;
    }

    // Texto corrido: continua o item da lista (a linha seguinte de um item quebrado) ou o parágrafo.
    if (items.length > 0 && !wasAfterBlank) {
      items[items.length - 1].push(line);
      continue;
    }
    if (items.length > 0) flush();
    paragraph.push(line);
  }
  flush();

  return blocks;
}

function InlineText({ content }: { content: Inline[] }) {
  return content.map((part, index) => {
    if (part.kind === "strong") return <strong key={index} className="font-semibold text-ink">{part.text}</strong>;
    if (part.kind === "em") return <em key={index} className="italic">{part.text}</em>;
    if (part.kind === "code") return <code key={index} className="rounded-sm bg-panel px-1 py-px font-mono text-[0.92em] text-ink">{part.text}</code>;
    return part.text;
  });
}

/**
 * As notas desenhadas. Tudo o que vem de `text` entra como filho de texto do React, que o escapa. Com `memo`: o diálogo
 * redesenha a cada aviso de progresso do download, e as notas, cujo texto não mudou, ficam de fora.
 */
export const ReleaseNotes = memo(function ReleaseNotes({ text }: { text: string }) {
  const blocks = useMemo(() => parseNotes(text), [text]);

  return (
    <div className="flex flex-col gap-2 break-words text-body">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = block.level === 3 ? "h3" : "h4";
          return <Tag key={index} className={block.level === 3 ? "mt-1.5 text-sm font-semibold text-ink" : "text-sm font-medium text-ink"}><InlineText content={block.content} /></Tag>;
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5 marker:text-subtle">
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText content={item} /></li>)}
            </ul>
          );
        }
        if (block.kind === "code") return <pre key={index} className="overflow-x-auto rounded-md border border-border bg-panel px-3 py-2 font-mono text-sm whitespace-pre-wrap text-ink">{block.text}</pre>;
        return <p key={index}><InlineText content={block.content} /></p>;
      })}
    </div>
  );
});
