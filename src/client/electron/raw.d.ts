/** `import html from "./arquivo.html?raw"`: o Vite entrega o conteúdo do arquivo como texto. */
declare module "*.html?raw" {
  const html: string;
  export default html;
}

/** `import svg from "@assets/arquivo.svg?raw"`: o texto do SVG (o logotipo e o wordmark que o splash põe na página). */
declare module "*.svg?raw" {
  const svg: string;
  export default svg;
}
