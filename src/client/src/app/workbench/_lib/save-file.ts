/**
 * Entrega um texto à pessoa como arquivo (RN-TABELA-006): o download do próprio navegador, um `Blob` e um link
 * com `download`. A ponte do Electron (`window.prism`) não tem como gravar arquivo, e o processo principal não
 * ganhou canal novo: o download de uma janela do Electron abre o diálogo de salvar do sistema, onde a pessoa
 * escolhe a pasta (e pode desistir). A política de conteúdo não restringe o download de um `blob:` criado pela
 * própria página. O texto não sai da janela: nenhuma chamada de rede.
 */
export function saveText(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
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
