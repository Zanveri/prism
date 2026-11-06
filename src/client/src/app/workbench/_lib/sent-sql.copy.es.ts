import type { SentSqlCopy } from "./sent-sql.copy";

export const sentSqlCopyEs: SentSqlCopy = {
  title: "SQL enviado",
  description: "La sentencia con los valores de las variables escritos como literales de la base de datos, para leer y para copiar y ejecutar en otro lugar. Lo que fue a la base de datos fueron los parámetros.",
  button: "SQL enviado",
  hint: "Ver el SQL enviado, con los valores de las variables",
  view: "Ver el SQL enviado",
  parameters: "Parámetros",
  columns: { marker: "Marcador", variable: "Variable", type: "Tipo", value: "Valor" },
  none: "La sentencia no llevó parámetros.",
  copy: "Copiar",
  close: "Cerrar",
  copied: "SQL copiado.",
  notCopied: "No se pudo copiar el SQL.",
};
