import { crc32 as nodeCrc32 } from "node:zlib";

/**
 * Só para os testes: um leitor de ZIP escrito à parte do escritor (`zip.ts`), pelo diretório central, que confere tudo o que o formato manda ler:
 * as assinaturas, os tamanhos, o método (0, sem compressão), o CRC-32 (pelo `zlib.crc32` do Node, e não pela tabela do escritor) e que o cabeçalho local
 * diz o mesmo que o central. Qualquer divergência lança, com a razão.
 */
export type ZipFile = { name: string; data: Uint8Array; crc: number; method: number; flags: number; time: number; date: number };

export function readZip(bytes: Uint8Array): ZipFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });

  // O fim do diretório central: 22 bytes, sem comentário.
  const end = bytes.length - 22;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error("sem o registro de fim do diretório central");
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error("arquivo em vários discos");
  if (view.getUint16(end + 20, true) !== 0) throw new Error("o comentário do arquivo devia estar vazio");

  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 8, true) !== count) throw new Error("a contagem de entradas do disco não é a total");

  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (centralOffset + centralSize !== end) throw new Error("o diretório central não termina onde começa o fim do arquivo");

  const files: ZipFile[] = [];
  let cursor = centralOffset;
  let expectedLocal = 0;

  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error(`entrada ${index}: sem a assinatura do diretório central`);

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const time = view.getUint16(cursor + 12, true);
    const date = view.getUint16(cursor + 14, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (method !== 0) throw new Error(`${name}: método ${method}, e o escritor só grava sem compressão`);
    if (view.getUint32(cursor + 24, true) !== size) throw new Error(`${name}: tamanho comprimido diferente do original`);
    if (localOffset !== expectedLocal) throw new Error(`${name}: o cabeçalho local devia estar em ${expectedLocal} e está em ${localOffset}`);

    // O cabeçalho local diz o mesmo que o central.
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`${name}: sem a assinatura do cabeçalho local`);
    if (view.getUint16(localOffset + 6, true) !== flags || view.getUint16(localOffset + 8, true) !== method) throw new Error(`${name}: sinalizadores ou método diferentes no cabeçalho local`);
    if (view.getUint32(localOffset + 14, true) !== crc || view.getUint32(localOffset + 18, true) !== size || view.getUint32(localOffset + 22, true) !== size) throw new Error(`${name}: CRC ou tamanho diferentes no cabeçalho local`);
    if (view.getUint16(localOffset + 26, true) !== nameLength || view.getUint16(localOffset + 28, true) !== 0) throw new Error(`${name}: nome ou campo extra diferentes no cabeçalho local`);
    if (decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + nameLength)) !== name) throw new Error(`${name}: nome diferente no cabeçalho local`);

    const data = bytes.slice(localOffset + 30 + nameLength, localOffset + 30 + nameLength + size);
    if (data.length !== size) throw new Error(`${name}: dados cortados`);
    if (nodeCrc32(data) !== crc) throw new Error(`${name}: CRC-32 errado (o arquivo diz ${crc.toString(16)}, o dado dá ${nodeCrc32(data).toString(16)})`);

    files.push({ name, data, crc, method, flags, time, date });
    expectedLocal = localOffset + 30 + nameLength + size;
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (cursor !== end) throw new Error("sobrou ou faltou byte no diretório central");
  if (expectedLocal !== centralOffset) throw new Error("há bytes entre o último arquivo e o diretório central");
  return files;
}
