/**
 * Entrega um arquivo (`Blob`, texto ou bytes) à pessoa pelo download do próprio navegador, num `Blob` e um link
 * com `download` (RN-TABELA-006). O download de uma janela do Electron abre o diálogo de salvar do sistema, onde a pessoa
 * escolhe a pasta (e pode desistir). A política de conteúdo não restringe o download de um `blob:` criado pela
 * própria página, e o conteúdo não sai da janela.
 */
export function saveBlob(fileName: string, blob: Blob, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  doc.body.append(link);
  link.click();
  link.remove();

  // O download já pegou o conteúdo; soltar o endereço logo depois pode cortar um download que ainda começa.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveCellFile(fileName: string, content: string | Uint8Array, type: string, doc: Document = document): void {
  const part: BlobPart = typeof content === "string" ? content : new Uint8Array(content);
  saveBlob(fileName, new Blob([part], { type }), doc);
}

/**
 * Entrega um texto à pessoa como arquivo (RN-TABELA-006): usa `saveCellFile` no documento principal.
 */
export function saveText(fileName: string, text: string, type: string): void {
  saveCellFile(fileName, text, type);
}
