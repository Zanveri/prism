import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * A lista de sugestões (RN-CONFIG-004 e RN-TABELA-011) como o canvas a quer, no editor de SQL e no campo de filtro: é o que flutua, como a lista do Select
 * (fundo elevado, borda forte, sombra). Os seletores repetem os da biblioteca, que tem o mesmo peso e vem antes; só pares de cor que o teste de contraste
 * já cobre (texto sobre elevado e sobre selecionado). `fontFamily` é a fonte do editor SQL (Configurações › Aparência).
 */
export function completionTheme(fontFamily: string): Record<string, Record<string, string>> {
  return {
    ".cm-tooltip": { backgroundColor: "var(--color-raised)", color: "var(--color-body)", border: "1px solid var(--color-border-strong)", borderRadius: "6px", boxShadow: "var(--shadow-2xl)" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily, padding: "4px", minWidth: "260px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", borderRadius: "4px", lineHeight: "1.4" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-selected)", color: "var(--color-ink)" },
    ".cm-completionDetail": { color: "var(--color-muted)", fontStyle: "normal" },
    ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600", color: "var(--color-accent)" },
    ".cm-completion-keyword .cm-completionLabel": { color: "var(--color-syntax-keyword)" },
  };
}

/**
 * As cores de sintaxe do tema (RN-CONFIG-003): palavra-chave e tipo, texto entre aspas simples, número e comentário. Cada tema do canvas
 * define as quatro (`kw`, `str`, `num` e `com`); no Prism Escuro são o azul do PostgreSQL, o verde, o acento e o apagado.
 * O nome entre aspas duplas é um nome, e não texto. O canvas pinta em rosa a função do banco
 * (`now`); a gramática do `lang-sql` não distingue função de nome, então ela fica na cor do texto.
 */
export const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName], color: "var(--color-syntax-keyword)" },
  { tag: tags.string, color: "var(--color-syntax-string)" },
  { tag: tags.special(tags.string), color: "var(--color-ink)" },
  { tag: tags.number, color: "var(--color-syntax-number)" },
  { tag: [tags.lineComment, tags.blockComment], color: "var(--color-syntax-comment)", fontStyle: "italic" },
]);
