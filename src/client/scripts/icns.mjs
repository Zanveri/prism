/**
 * Monta um arquivo `.icns` (o ícone do macOS) cujas entradas são PNG: o cabeçalho `icns` com o tamanho total, e depois,
 * para cada imagem, o tipo (4 letras), o tamanho da entrada (8 bytes de cabeçalho mais o PNG) e os bytes do PNG. Os números
 * são big-endian.
 *
 * @param {{ type: string; png: Uint8Array }[]} images `type` é o código da entrada (`ic07`, `ic10`…)
 * @returns {Uint8Array}
 */
export function buildIcns(images) {
  if (images.length === 0) throw new Error("O .icns precisa de ao menos uma imagem.");

  const icns = new Uint8Array(8 + images.reduce((total, image) => total + 8 + image.png.length, 0));
  const view = new DataView(icns.buffer);
  const write = (offset, type) => {
    // Um código que não tem 4 letras ASCII deslocaria todas as entradas seguintes.
    if (!/^[ -~]{4}$/.test(type)) throw new Error(`Tipo inválido para o .icns: "${type}".`);
    for (let index = 0; index < 4; index++) view.setUint8(offset + index, type.charCodeAt(index));
  };

  write(0, "icns");
  view.setUint32(4, icns.length);

  let offset = 8;
  for (const { type, png } of images) {
    write(offset, type);
    view.setUint32(offset + 4, 8 + png.length);
    icns.set(png, offset + 8);
    offset += 8 + png.length;
  }
  return icns;
}
