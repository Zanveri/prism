export type ZipEntry = { name: string; data: Uint8Array };

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** O CRC-32 do ZIP e do PNG (polinômio 0xEDB88320, refletido): `123456789` dá 0xCBF43926. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00 no formato do DOS: a data é (ano - 1980) << 9 | mês << 5 | dia, aqui 0, 1 e 1. Fixa, para o mesmo conteúdo dar os mesmos bytes. */
const dosTime = 0;
const dosDate = (1 << 5) | 1;

/** O bit 11 dos sinalizadores: o nome da entrada é UTF-8. */
const utf8Names = 0x0800;

const max32 = 0xffffffff;

/**
 * Um arquivo ZIP com as entradas SEM compressão (método 0 de cada uma): o formato mais simples, que todo leitor aceita, e o suficiente para uma pasta
 * de trabalho do Excel. O TETO é o do ZIP sem ZIP64: 65.535 entradas, nome de até 65.535 bytes, e cada entrada e o arquivo todo em 4 GiB menos 1
 * (os tamanhos e as posições são de 32 bits); acima disso lança `RangeError` antes de copiar dado nenhum. Na prática quem limita é a memória, pois o
 * arquivo inteiro é montado num `Uint8Array`. A data é fixa (1980-01-01), então o mesmo conteúdo dá os mesmos bytes. Não altera os dados recebidos.
 */
export function zipStored(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) throw new RangeError("Um ZIP sem ZIP64 tem no máximo 65.535 entradas.");

  const encoder = new TextEncoder();
  const names = entries.map((entry) => encoder.encode(entry.name));
  if (names.some((name) => name.length > 0xffff)) throw new RangeError("O nome de uma entrada do ZIP tem no máximo 65.535 bytes.");

  const localSize = entries.reduce((sum, entry, index) => sum + 30 + names[index].length + entry.data.length, 0);
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);
  if (entries.some((entry) => entry.data.length > max32) || localSize + centralSize + 22 > max32) throw new RangeError("Um ZIP sem ZIP64 tem no máximo 4 GiB, e cada entrada também.");

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const crcs = entries.map((entry) => crc32(entry.data));
  const offsets: number[] = [];
  let at = 0;

  entries.forEach(({ data }, index) => {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // versão necessária: 2.0
    view.setUint16(at + 6, utf8Names, true);
    view.setUint16(at + 8, 0, true); // método 0: sem compressão
    view.setUint16(at + 10, dosTime, true);
    view.setUint16(at + 12, dosDate, true);
    view.setUint32(at + 14, crcs[index], true);
    view.setUint32(at + 18, data.length, true);
    view.setUint32(at + 22, data.length, true);
    view.setUint16(at + 26, names[index].length, true);
    view.setUint16(at + 28, 0, true); // sem campo extra
    out.set(names[index], at + 30);
    out.set(data, at + 30 + names[index].length);
    at += 30 + names[index].length + data.length;
  });

  const centralStart = at;
  entries.forEach(({ data }, index) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // versão de quem fez: 2.0, sistema 0 (DOS)
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, utf8Names, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, dosTime, true);
    view.setUint16(at + 14, dosDate, true);
    view.setUint32(at + 16, crcs[index], true);
    view.setUint32(at + 20, data.length, true);
    view.setUint32(at + 24, data.length, true);
    view.setUint16(at + 28, names[index].length, true);
    // 30 a 45: campo extra, comentário, disco, atributos interno e externo: tudo zero.
    view.setUint32(at + 42, offsets[index], true);
    out.set(names[index], at + 46);
    at += 46 + names[index].length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
