// Gera os PNG do logotipo do Prism a partir dos SVG de `assets/` (RN-MARCA-007): de cada um, `prism-logo-<largura>.png` e
// `prism-logo-light-<largura>.png`, com fundo transparente, nas larguras 720, 1440 e 2880 px. É o único jeito de ter esses PNG:
// nenhum é feito à mão, e nenhum desenho é refeito aqui.
//
// Roda dentro do Electron (`electron scripts/make-logo-pngs.mjs`, da pasta `src/client`), pelo mesmo motivo do `make-icons.mjs`: é o
// Chromium dele que desenha o SVG (o brilho do feGaussianBlur e os degradês) como o app desenha. Cada largura é o SVG numa janela
// transparente, fora da tela, e o PNG sai da captura do protocolo de depuração (ver `render`). Num Linux sem tela, sob o Xvfb:
// `xvfb-run -a pnpm exec electron scripts/make-logo-pngs.mjs --no-sandbox` (o `--no-sandbox` só como root).
import { app, BrowserWindow, nativeImage } from "electron";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const assetsDir = join(import.meta.dirname, "..", "..", "..", "assets");
const variants = ["prism-logo", "prism-logo-light"];
const widths = [720, 1440, 2880];

// Um pixel de CSS é um pixel da captura sem escala, qualquer que seja a escala da tela: a escala de cada PNG é só a da captura.
app.commandLine.appendSwitch("force-device-scale-factor", "1");

/** A largura e a altura do desenho, do `viewBox` do arquivo: a altura de cada PNG sai dele, para a escala ser a mesma nos dois eixos. */
function viewBoxOf(svg, file) {
  const match = /<svg[^>]*\sviewBox="([^"]+)"/.exec(svg);
  const [, , width, height] = (match?.[1] ?? "").split(/\s+/).map(Number);
  if (!(width > 0 && height > 0)) throw new Error(`${file} não tem um viewBox que se leia.`);
  return { width, height };
}

/**
 * Uma largura do PNG. O SVG é posto na página no tamanho do `viewBox` (1 px de CSS por unidade), e a captura é pelo protocolo de
 * depuração com escala: o Chromium desenha o vetor de novo, na escala pedida, e o PNG maior não é um PNG pequeno ampliado. Assim a
 * janela não precisa ter o tamanho do maior PNG (uma janela fora da tela não passa do tamanho da tela).
 */
async function render(file, svg, box, width, height) {
  const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${box.width}px;height:${box.height}px}</style>${svg}`;
  const window = new BrowserWindow({ show: false, width: Math.ceil(box.width), height: Math.ceil(box.height), useContentSize: true, frame: false, transparent: true, resizable: false, webPreferences: { offscreen: true } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
    // Dois quadros: o primeiro pode sair antes de o filtro e os degradês estarem desenhados.
    await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

    const debug = window.webContents.debugger;
    debug.attach("1.3");
    await debug.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const { data } = await debug.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: box.width, height: box.height, scale: width / box.width } });
    debug.detach();

    const png = Buffer.from(data, "base64");
    const image = nativeImage.createFromBuffer(png);
    const captured = image.getSize();
    if (captured.width !== width || captured.height !== height) throw new Error(`${file} a ${width} px saiu com ${captured.width}×${captured.height}.`);

    // O canto de cima, à esquerda, não tem desenho: tem de ser transparente, e não branco nem preto. O meio da imagem é o vidro do
    // prisma: tem de ser opaco.
    const pixels = image.toBitmap();
    const alphaAt = (x, y) => pixels[(y * width + x) * 4 + 3];
    if (alphaAt(0, 0) !== 0) throw new Error(`${file} a ${width} px saiu com o canto opaco (alfa ${alphaAt(0, 0)}).`);
    if (alphaAt(width >> 1, height >> 1) !== 255) throw new Error(`${file} a ${width} px saiu com o vidro do prisma transparente.`);

    return png;
  } finally {
    window.destroy();
  }
}

async function main() {
  for (const variant of variants) {
    const file = `${variant}.svg`;
    const svg = await readFile(join(assetsDir, file), "utf8");
    const box = viewBoxOf(svg, file);

    for (const width of widths) {
      const height = Math.round((width * box.height) / box.width);
      await writeFile(join(assetsDir, `${variant}-${width}.png`), await render(file, svg, box, width, height));
      console.log(`assets/${variant}-${width}.png (${width}×${height})`);
    }
  }
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);

// Entre uma largura e outra não há janela aberta; sem isto o Electron sairia no meio.
app.on("window-all-closed", () => {});
