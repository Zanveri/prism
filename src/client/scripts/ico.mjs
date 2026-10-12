/**
 * Monta um arquivo `.ico` cujas entradas são PNG (formato aceito desde o Windows Vista). O
 * diretório vem primeiro, com 16 bytes por imagem, e os PNG logo depois, na mesma ordem.
 *
 * @param {{ size: number; png: Uint8Array }[]} images quadrados de 1 a 256 px
 * @returns {Uint8Array}
 */
export function buildIco(images) {
  if (images.length === 0) throw new Error("O .ico precisa de ao menos uma imagem.");

  const directorySize = 6 + 16 * images.length;
  const ico = new Uint8Array(directorySize + images.reduce((total, image) => total + image.png.length, 0));
  const view = new DataView(ico.buffer);

  view.setUint16(0, 0, true); // reservado
  view.setUint16(2, 1, true); // tipo 1: ícone
  view.setUint16(4, images.length, true);

  let offset = directorySize;
  images.forEach(({ size, png }, index) => {
    // A medida cabe em um byte, e 256 se grava como 0.
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`Tamanho inválido para o .ico: ${size}.`);

    const entry = 6 + 16 * index;
    view.setUint8(entry, size % 256);
    view.setUint8(entry + 1, size % 256);
    view.setUint8(entry + 2, 0); // sem paleta
    view.setUint8(entry + 3, 0); // reservado
    view.setUint16(entry + 4, 1, true); // planos
    view.setUint16(entry + 6, 32, true); // bits por pixel
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);

    ico.set(png, offset);
    offset += png.length;
  });

  return ico;
}
