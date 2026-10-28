/**
 * Entrega um arquivo (`Blob` ou texto) à pessoa (RN-TABELA-006): o download do próprio navegador, um `Blob` e um link
 * com `download`. A ponte do Electron (`window.prism`) não tem como gravar arquivo, e o processo principal não
 * ganhou canal novo: o download de uma janela do Electron abre o diálogo de salvar do sistema, onde a pessoa
 * escolhe a pasta (e pode desistir). A política de conteúdo não restringe o download de um `blob:` criado pela
 * própria página. O conteúdo não sai da janela: nenhuma chamada de rede.
 */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();

  // O download já pegou o conteúdo; soltar o endereço logo depois pode cortar um download que ainda começa.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveText(fileName: string, text: string, type: string): void {
  saveBlob(fileName, new Blob([text], { type }));
}
