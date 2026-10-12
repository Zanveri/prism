// Gera os ícones de todas as plataformas a partir dos dois SVG da pasta (`pnpm icons`): `build/icon.ico` (Windows),
// `build/icons/<N>x<N>.png` e `build/icon.png` (Linux) e `build/icon.icns` (macOS).
//
// Roda dentro do Electron (`electron scripts/make-icons.mjs`) porque é o Chromium dele que
// desenha o SVG com o brilho (feGaussianBlur) e os degradês exatamente como o canvas mostra: cada
// tamanho é um SVG aberto numa janela transparente, fora da tela, do tamanho pedido, e o PNG sai
// de `capturePage()`. Nenhum desenho é refeito aqui (RN-MARCA-001): até 32 px vale o
// `icon-small.svg`, que engrossa o traço com os mesmos elementos; dali para cima, o `icon.svg`.
import { app, BrowserWindow } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildIcns } from "./icns.mjs";
import { buildIco } from "./ico.mjs";

const buildDir = join(import.meta.dirname, "..", "build");

/** O que entra no `.ico` (16 a 256) e qual SVG desenha cada tamanho. O `icon.png` de 512 px sai do `icon.svg`. */
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngSize = 512;
/** Os PNG de Linux que o `electron-builder` pede (`build/icons/<N>x<N>.png`), para o `.deb`, o `.rpm` e o AppImage. */
const linuxSizes = [16, 24, 32, 48, 64, 128, 256, 512];
/** As entradas do `.icns`: o tipo e o tamanho em pixels (as de @2x repetem um tamanho, e a imagem é a mesma). */
const icnsEntries = [
  ["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
  ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512],
];
const largest = 1024;
const svgFor = (size) => (size <= 32 ? "icon-small.svg" : "icon.svg");

// Um pixel de tela é um pixel do PNG, qualquer que seja a escala do Windows (125%, 150%…).
app.commandLine.appendSwitch("force-device-scale-factor", "1");

async function render(size) {
  const svgFile = svgFor(size);
  const svg = await readFile(join(buildDir, svgFile), "utf8");
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;

  // A janela tem sempre o tamanho do maior ícone: o Windows não deixa uma janela de 16 px existir,
  // e o recorte de `capturePage` tira só o canto onde o SVG foi desenhado.
  const window = new BrowserWindow({ show: false, width: largest, height: largest, useContentSize: true, frame: false, transparent: true, resizable: false, webPreferences: { offscreen: true } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    // Dois quadros: o primeiro pode sair antes de o filtro e os degradês estarem desenhados.
    await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: size, height: size });

    const captured = image.getSize();
    if (captured.width !== size || captured.height !== size) throw new Error(`${svgFile} a ${size} px saiu com ${captured.width}×${captured.height}.`);

    // O canto fica fora do quadrado arredondado: tem de ser transparente, e não branco nem preto.
    // O centro é da ilustração: tem de ser opaco.
    const pixels = image.toBitmap();
    const alphaAt = (x, y) => pixels[(y * size + x) * 4 + 3];
    if (alphaAt(0, 0) > 64) throw new Error(`${svgFile} a ${size} px saiu com o canto opaco (alfa ${alphaAt(0, 0)}).`);
    if (alphaAt(size >> 1, size >> 1) < 255) throw new Error(`${svgFile} a ${size} px saiu com o centro transparente.`);

    return image.toPNG();
  } finally {
    window.destroy();
  }
}

async function main() {
  // Cada tamanho é desenhado uma vez só, em sequência (uma janela de cada vez), qualquer que seja o formato que o use.
  const sizes = new Set([...icoSizes, pngSize, ...linuxSizes, ...icnsEntries.map(([, size]) => size)]);
  const pngs = new Map();
  for (const size of [...sizes].sort((a, b) => a - b)) pngs.set(size, await render(size));

  await writeFile(join(buildDir, "icon.ico"), buildIco(icoSizes.map((size) => ({ size, png: pngs.get(size) }))));
  await writeFile(join(buildDir, "icon.png"), pngs.get(pngSize));

  await mkdir(join(buildDir, "icons"), { recursive: true });
  for (const size of linuxSizes) await writeFile(join(buildDir, "icons", `${size}x${size}.png`), pngs.get(size));

  await writeFile(join(buildDir, "icon.icns"), buildIcns(icnsEntries.map(([type, size]) => ({ type, png: pngs.get(size) }))));

  console.log(`build/icon.ico (${icoSizes.join(", ")} px), build/icon.png (${pngSize} px), build/icons/ (${linuxSizes.join(", ")} px) e build/icon.icns (${icnsEntries.length} entradas até ${largest} px) gerados.`);
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);

// Entre um tamanho e outro não há janela aberta; sem isto o Electron sairia no meio.
app.on("window-all-closed", () => {});
