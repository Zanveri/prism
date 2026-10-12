// Gera a prancha "Ícone do aplicativo" e troca a marca das barras pela ilustração completa do prisma.
// Uso: node gen-logo.mjs <pasta project do canvas>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const mono = "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace";

const cylinder = (cx, cy, rx, ry, body, color, w) =>
  `<path d="M${cx - rx} ${cy} v${body} a${rx} ${ry} 0 0 0 ${rx * 2} 0 v-${body}" fill="#14181D" stroke="${color}" stroke-width="${w}"></path>` +
  `<path d="M${cx - rx} ${cy + body / 2} a${rx} ${ry} 0 0 0 ${rx * 2} 0" stroke="${color}" stroke-width="${w}" stroke-opacity="0.55"></path>` +
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#1B2027" stroke="${color}" stroke-width="${w}"></ellipse>`;

const gradient = (id, color, x1, x2, end) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="${color}"></stop><stop offset="1" stop-color="${color}" stop-opacity="${end}"></stop></linearGradient>`;

// Ícone quadrado, desenho completo (48 px ou mais): a mesma ilustração do login, recomposta para o quadrado.
function squareIcon(size, s, label) {
  const id = (n) => `prism-icon-${n}-${s}`;
  const aria = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" stroke-linecap="round" stroke-linejoin="round" ${aria} style="flex: none; display: block">` +
    `<defs>` +
    `<filter id="${id("glow")}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="296" height="296"><feGaussianBlur stdDeviation="5"></feGaussianBlur></filter>` +
    gradient(id("ifx"), "#F591B6", 136, 213, 0.5) + gradient(id("db2"), "#5ED3A3", 136, 213, 0.5) + gradient(id("pg"), "#7DB2FF", 136, 213, 0.5) +
    `<linearGradient id="${id("face")}" gradientUnits="userSpaceOnUse" x1="100" y1="56" x2="50" y2="196"><stop offset="0" stop-color="#3D4856"></stop><stop offset="1" stop-color="#1E242C"></stop></linearGradient>` +
    `<clipPath id="${id("clip")}"><rect x="0" y="0" width="256" height="256" rx="52"></rect></clipPath>` +
    `</defs>` +
    `<rect x="0" y="0" width="256" height="256" rx="52" fill="#0E1114"></rect>` +
    `<g clip-path="url(#${id("clip")})">` +
    `<g filter="url(#${id("glow")})" opacity="0.6">` +
    `<path d="M0 140.9 L56.7 133.7" stroke="#F3F5F8" stroke-width="9"></path>` +
    `<path d="M136.3 121.1 L213 70 L213 92 L138.7 125.4 Z" fill="#F591B6"></path>` +
    `<path d="M139 126 L213 120 L213 142 L141.4 130.3 Z" fill="#5ED3A3"></path>` +
    `<path d="M141.7 130.9 L213 170 L213 192 L144.1 135.2 Z" fill="#7DB2FF"></path>` +
    `</g>` +
    `<path d="M0 140.9 L56.7 133.7" stroke="#F3F5F8" stroke-width="4.5"></path>` +
    `<path d="M136.3 121.1 L213 70 L213 92 L138.7 125.4 Z" fill="url(#${id("ifx")})"></path>` +
    `<path d="M139 126 L213 120 L213 142 L141.4 130.3 Z" fill="url(#${id("db2")})"></path>` +
    `<path d="M141.7 130.9 L213 170 L213 192 L144.1 135.2 Z" fill="url(#${id("pg")})"></path>` +
    `<path d="M100 56 L178 196 H22 Z" fill="#1A2028"></path>` +
    `<path d="M100 56 L22 196 L95.6 155.5 Z" fill="url(#${id("face")})"></path>` +
    `<path d="M22 196 L95.6 155.5 L178 196 Z" fill="#11151A"></path>` +
    `<path d="M100 56 L95.6 155.5 M22 196 L95.6 155.5 M178 196 L95.6 155.5" stroke="#46505D" stroke-width="1.5"></path>` +
    `<path d="M56.7 133.7 L137.9 123.9 L142.8 132.6 Z" fill="#F3F5F8" fill-opacity="0.14"></path>` +
    `<path d="M56.7 133.7 L137.5 123.3" stroke="#F591B6" stroke-width="1.5" stroke-opacity="0.9"></path>` +
    `<path d="M56.7 133.7 L140.2 128.2" stroke="#5ED3A3" stroke-width="1.5" stroke-opacity="0.9"></path>` +
    `<path d="M56.7 133.7 L142.9 133" stroke="#7DB2FF" stroke-width="1.5" stroke-opacity="0.9"></path>` +
    `<path d="M94 76 L68 122" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"></path>` +
    `<path d="M100 56 L178 196 H22 Z" stroke="#E6EAF0" stroke-width="4"></path>` +
    `<circle cx="56.7" cy="133.7" r="8" fill="#FFFFFF" fill-opacity="0.12"></circle>` +
    `<circle cx="56.7" cy="133.7" r="4.5" fill="#FFFFFF" fill-opacity="0.28"></circle>` +
    `<circle cx="56.7" cy="133.7" r="2.4" fill="#FFFFFF"></circle>` +
    cylinder(230, 68, 15, 5.5, 24, "#F591B6", 3) + cylinder(230, 118, 15, 5.5, 24, "#5ED3A3", 3) + cylinder(230, 168, 15, 5.5, 24, "#7DB2FF", 3) +
    `</g>` +
    `<rect x="1" y="1" width="254" height="254" rx="51" stroke="#2A313B" stroke-width="2"></rect>` +
    `</svg>`;
}

// Ícone quadrado para 32 px ou menos: os mesmos elementos, com traço na escala do pixel.
function smallIcon(size) {
  const band = (d, color) => `<path d="${d}" fill="${color}" stroke="${color}" stroke-opacity="0.35" stroke-width="1.4"></path>`;
  const can = (y, color) => `<rect x="26.4" y="${y}" width="4.6" height="4.6" rx="1.3" fill="#14181D" stroke="${color}"></rect>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none; display: block">` +
    `<rect x="0" y="0" width="32" height="32" rx="6.5" fill="#0E1114"></rect>` +
    `<path d="M0.6 17.5 L7.1 16.7" stroke="#F3F5F8" stroke-width="1.5"></path>` +
    band("M17 15.1 L26 9 L26 11.8 L17.3 15.7 Z", "#F591B6") + band("M17.4 15.8 L26 15 L26 17.8 L17.7 16.3 Z", "#5ED3A3") + band("M17.7 16.4 L26 21.2 L26 24 L18 16.9 Z", "#7DB2FF") +
    `<path d="M12.5 7 L22.25 24.5 H2.75 Z" fill="#1A2028"></path>` +
    `<path d="M12.5 7 L2.75 24.5 L11.95 19.4 Z" fill="#3D4856"></path>` +
    `<path d="M2.75 24.5 L11.95 19.4 L22.25 24.5 Z" fill="#11151A"></path>` +
    `<path d="M12.5 7 L22.25 24.5 H2.75 Z" stroke="#E6EAF0" stroke-width="1.3"></path>` +
    `<circle cx="7.1" cy="16.7" r="1" fill="#FFFFFF"></circle>` +
    can(8.2, "#F591B6") + can(14.1, "#5ED3A3") + can(20.2, "#7DB2FF") +
    `</svg>`;
}

// Marca larga para as barras do app: a ilustração do login, com traço mais grosso para 24 px de altura.
function wideMark(height, s) {
  const id = (n) => `prism-mark-${n}-${s}`;
  const width = Math.round((height * 700) / 264);
  return `<svg width="${width}" height="${height}" viewBox="0 40 700 264" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none">` +
    `<defs>` +
    `<filter id="${id("glow")}" filterUnits="userSpaceOnUse" x="0" y="0" width="720" height="360"><feGaussianBlur stdDeviation="14"></feGaussianBlur></filter>` +
    gradient(id("ifx"), "#F591B6", 366, 646, 0.55) + gradient(id("db2"), "#5ED3A3", 366, 646, 0.55) + gradient(id("pg"), "#7DB2FF", 366, 646, 0.55) +
    `<linearGradient id="${id("face")}" gradientUnits="userSpaceOnUse" x1="300" y1="44" x2="200" y2="300"><stop offset="0" stop-color="#3D4856"></stop><stop offset="1" stop-color="#1E242C"></stop></linearGradient>` +
    `</defs>` +
    `<g filter="url(#${id("glow")})" opacity="0.6">` +
    `<path d="M8 213 L220 186" stroke="#F3F5F8" stroke-width="26"></path>` +
    `<path d="M366.9 163 L646 72.3 L646 104.3 L371.4 171 Z" fill="#F591B6"></path>` +
    `<path d="M372 172 L646 146.4 L646 178.4 L376.5 180 Z" fill="#5ED3A3"></path>` +
    `<path d="M377.1 181 L646 220.5 L646 252.5 L381.6 189 Z" fill="#7DB2FF"></path>` +
    `</g>` +
    `<path d="M8 213 L220 186" stroke="#F3F5F8" stroke-width="14"></path>` +
    `<path d="M366.9 163 L646 72.3 L646 104.3 L371.4 171 Z" fill="url(#${id("ifx")})"></path>` +
    `<path d="M372 172 L646 146.4 L646 178.4 L376.5 180 Z" fill="url(#${id("db2")})"></path>` +
    `<path d="M377.1 181 L646 220.5 L646 252.5 L381.6 189 Z" fill="url(#${id("pg")})"></path>` +
    `<path d="M300 50 L440 298 H160 Z" fill="#1A2028"></path>` +
    `<path d="M300 50 L160 298 L292 226 Z" fill="url(#${id("face")})"></path>` +
    `<path d="M160 298 L292 226 L440 298 Z" fill="#11151A"></path>` +
    `<path d="M220 186 L369.8 168 L378.8 184 Z" fill="#F3F5F8" fill-opacity="0.16"></path>` +
    `<path d="M300 50 L440 298 H160 Z" stroke="#E6EAF0" stroke-width="13"></path>` +
    `<circle cx="220" cy="186" r="15" fill="#FFFFFF"></circle>` +
    `<path d="M656 69 v34 a20 8 0 0 0 40 0 v-34" fill="#14181D" stroke="#F591B6" stroke-width="10"></path><ellipse cx="676" cy="69" rx="20" ry="8" fill="#1B2027" stroke="#F591B6" stroke-width="10"></ellipse>` +
    `<path d="M656 145 v34 a20 8 0 0 0 40 0 v-34" fill="#14181D" stroke="#5ED3A3" stroke-width="10"></path><ellipse cx="676" cy="145" rx="20" ry="8" fill="#1B2027" stroke="#5ED3A3" stroke-width="10"></ellipse>` +
    `<path d="M656 221 v34 a20 8 0 0 0 40 0 v-34" fill="#14181D" stroke="#7DB2FF" stroke-width="10"></path><ellipse cx="676" cy="221" rx="20" ry="8" fill="#1B2027" stroke="#7DB2FF" stroke-width="10"></ellipse>` +
    `</svg>`;
}

const sizeCell = (svg, px) =>
  `<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">${svg}<span style="font-family: ${mono}; font-size: 12px; line-height: 16px; color: #8E99A8">${px}</span></div>`;
const slot = (bg) => `<span style="flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center"><span style="width: 22px; height: 22px; border-radius: 5px; background: ${bg}"></span></span>`;
const taskbar = (bg, border, slotBg, activeBg, line, label, labelColor) =>
  `<div style="display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 12px; border-radius: 8px; background: ${bg}; border: 1px solid ${border}">` +
  slot(slotBg) + slot(slotBg) +
  `<span style="flex: none; position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: ${activeBg}">${smallIcon(24)}<span style="position: absolute; left: 12px; right: 12px; bottom: 2px; height: 3px; border-radius: 2px; background: ${line}"></span></span>` +
  slot(slotBg) +
  `<span style="margin-left: 8px; font-size: 12px; line-height: 16px; color: ${labelColor}">${label}</span></div>`;
const control = (path) => `<span style="flex: none; width: 46px; height: 34px; display: flex; align-items: center; justify-content: center; color: #C9D1DC"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${path}</svg></span>`;
const h2 = (text) => `<h2 style="margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; color: #B4BCC8">${text}</h2>`;

const iconPage = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Prism — Ícone do aplicativo</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap">
<style>
body{margin:0}
</style>
</helmet>
<div style="width: 1120px; height: 640px; box-sizing: border-box; padding: 40px; display: flex; gap: 56px; background: #14181D; color: #E6EAF0; font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 22px">
<section style="flex: none; width: 256px; display: flex; flex-direction: column; gap: 20px">
${squareIcon(256, "a", "Ícone do Prism: o feixe branco entra no prisma de vidro e sai em três faixas de cor com brilho, cada uma chegando a um banco de dados")}
<div style="display: flex; flex-direction: column; gap: 6px">
<h1 style="margin: 0; font-size: 20px; line-height: 26px; font-weight: 600">Ícone do aplicativo</h1>
<p style="margin: 0; color: #B4BCC8">A ilustração da tela de login inteira: feixe, prisma de vidro, as três faixas com brilho e os três bancos, recomposta para caber no quadrado.</p>
<p style="margin: 0; color: #B4BCC8">Entra no executável, no atalho, na barra de tarefas e na barra de título da janela.</p>
</div>
</section>
<section style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 26px">
<div style="display: flex; flex-direction: column; gap: 12px">
${h2("Tamanhos")}
<div style="display: flex; align-items: flex-end; gap: 28px">
${sizeCell(squareIcon(128, "b"), 128)}
${sizeCell(squareIcon(64, "c"), 64)}
${sizeCell(squareIcon(48, "d"), 48)}
${sizeCell(smallIcon(32), 32)}
${sizeCell(smallIcon(24), 24)}
${sizeCell(smallIcon(16), 16)}
</div>
<p style="margin: 0; font-size: 13px; line-height: 20px; color: #8E99A8">O desenho é o mesmo em todos os tamanhos. Até 32 px o traço engrossa e o brilho vira um contorno, para não sumir no pixel.</p>
</div>
<div style="display: flex; flex-direction: column; gap: 12px">
${h2("Barra de tarefas")}
${taskbar("#1C1F24", "#2A313B", "#3A424D", "#2A3038", "#7DB2FF", "tema escuro", "#8E99A8")}
${taskbar("#E9EDF2", "#C9D1DC", "#B4BCC8", "#FFFFFF", "#2F6FD0", "tema claro", "#4A5461")}
</div>
<div style="display: flex; flex-direction: column; gap: 12px">
${h2("Janela e barra do app")}
<div style="display: flex; flex-direction: column; border-radius: 8px; overflow: hidden; border: 1px solid #2A313B">
<div style="display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 0 0 12px; background: #0E1114">${smallIcon(16)}<span style="flex: 1 1 auto; min-width: 0; font-size: 13px; line-height: 18px; color: #C9D1DC">Prism</span>${control('<path d="M1.5 6.5 H10.5"></path>')}${control('<rect x="1.5" y="1.5" width="9" height="9"></rect>')}${control('<path d="M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5"></path>')}</div>
<div style="display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 16px; background: #14181D; border-top: 1px solid #2A313B">${wideMark(24, "bar")}<span style="font-size: 15px; line-height: 20px; font-weight: 600; letter-spacing: 0.01em">Prism</span><span style="margin-left: 16px; font-size: 13px; color: #8E99A8">a mesma ilustração, ao lado do nome, na barra superior de cada tela</span></div>
</div>
</div>
</section>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":1120,"height":640}}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script>
</body>
</html>
`;
writeFileSync(join(dir, "IconeApp.dc.html"), iconPage, "utf8");

// Troca a marca compacta (viewBox 0 0 40 24) das barras pela ilustração completa.
const marks = { "Main.dc.html": 28, "Workbench.dc.html": 24, "Conexoes.dc.html": 24, "TabelaDetalhe.dc.html": 24, "DiagramaER.dc.html": 24, "TabelaDados.dc.html": 24, "TabelaDadosFK.dc.html": 24 };
const old = /<svg width="\d+" height="\d+" viewBox="0 0 40 24"[^>]*>.*?<\/svg>/s;
for (const [file, height] of Object.entries(marks)) {
  const path = join(dir, file);
  const html = readFileSync(path, "utf8");
  if (!old.test(html)) { console.log(`${file}: marca antiga não encontrada`); continue; }
  writeFileSync(path, html.replace(old, wideMark(height, file.replace(".dc.html", "").toLowerCase())), "utf8");
  console.log(`${file}: marca trocada (${Math.round((height * 700) / 264)}x${height})`);
}
console.log("IconeApp.dc.html gerado");
