/*
 * A árvore que o leitor monta (RN-VAR-014): cada nó é de uma lista fechada de espécies, e o avaliador só anda por ela. Nada do texto vira nome de propriedade do
 * JavaScript: os nomes das variáveis e dos campos ficam em `string` e se buscam em `Map`.
 */

type Span = { start: number; end: number };

/** Um item de lista ou de argumentos, com o `...` que espalha uma lista. */
export type Spreadable = { spread: boolean; node: Node };

/** Os níveis de precedência dos operadores de dois lados, do mais fraco ao mais forte (a lista `chain` de cada um tem um nível só). */
export type ChainLevel = "nullish" | "or" | "and" | "equality" | "relational" | "additive" | "multiplicative";

export type ChainOperator = "??" | "||" | "&&" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "%";

/** A função que uma chamada chama, resolvida quando o texto é lido (RN-VAR-002 e 009): `namespace` é `Math`, `random`, `date`, `Date`, `Number` ou nulo (`Number(…)`, `String(…)`). */
export type FunctionRef = { namespace: string | null; name: string };

export type Node =
  | (Span & { t: "number"; text: string; value: number })
  | (Span & { t: "string"; value: string })
  | (Span & { t: "template"; quasis: string[]; exprs: Node[] })
  | (Span & { t: "boolean"; value: boolean })
  | (Span & { t: "null" })
  | (Span & { t: "name"; name: string })
  | (Span & { t: "list"; items: Spreadable[] })
  | (Span & { t: "object"; pairs: { key: string; keyStart: number; value: Node }[] })
  | (Span & { t: "newDate"; args: Spreadable[] })
  | (Span & { t: "unary"; op: "!" | "-" | "+"; operand: Node })
  | (Span & { t: "chain"; level: ChainLevel; first: Node; rest: { op: ChainOperator; operand: Node; start: number }[] })
  | (Span & { t: "power"; base: Node; exponent: Node })
  | (Span & { t: "conditional"; test: Node; then: Node; otherwise: Node })
  | (Span & { t: "member"; object: Node; name: string; nameStart: number; optional: boolean })
  | (Span & { t: "index"; object: Node; index: Node; optional: boolean })
  | (Span & { t: "call"; fn: FunctionRef; args: Spreadable[] })
  | (Span & { t: "method"; receiver: Node; name: string; nameStart: number; args: Spreadable[]; optional: boolean })
  | (Span & { t: "constant"; namespace: string; name: string })
  | (Span & { t: "query"; sql: string; sqlStart: number })
  | (Span & { t: "sample"; column: ColumnRef; count: Node | null });

/** A coluna de `random.of` e do tipo de coluna: `tabela.coluna` ou `esquema.tabela.coluna` (RN-VAR-004). */
export type ColumnRef = Span & { schema: string | null; table: string; column: string; text: string };

export type TypeAnnotation = Span & {
  base: "number" | "string" | "boolean" | "Date" | "sql" | "column";
  column: ColumnRef | null;
  list: boolean;
  nullable: boolean;
  /** O tipo como a pessoa o escreveu, para as frases. */
  text: string;
};

export type Declaration = Span & {
  kind: "declaration";
  mutable: boolean;
  name: string;
  nameStart: number;
  annotation: TypeAnnotation | null;
  value: Node | null;
};

export type Reassignment = Span & { kind: "reassignment"; name: string; nameStart: number; value: Node };

/** Uma declaração ou uma reatribuição, lida: `start` e `end` são as posições no texto do script. */
export type ParsedItem = Declaration | Reassignment;

/** Os nós de dentro de `node`, na ordem do texto: quem anda pela árvore (o conferidor, as dependências) usa esta função, e não anda por conta própria. */
export function childrenOf(node: Node): Node[] {
  switch (node.t) {
    case "template":
      return node.exprs;
    case "list":
    case "newDate":
    case "call":
      return (node.t === "list" ? node.items : node.args).map((item) => item.node);
    case "object":
      return node.pairs.map((pair) => pair.value);
    case "unary":
      return [node.operand];
    case "chain":
      return [node.first, ...node.rest.map((part) => part.operand)];
    case "power":
      return [node.base, node.exponent];
    case "conditional":
      return [node.test, node.then, node.otherwise];
    case "member":
      return [node.object];
    case "index":
      return [node.object, node.index];
    case "method":
      return [node.receiver, ...node.args.map((item) => item.node)];
    case "sample":
      return node.count === null ? [] : [node.count];
    default:
      return [];
  }
}
