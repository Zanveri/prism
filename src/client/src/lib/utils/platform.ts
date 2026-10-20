/**
 * O macOS (e o iOS) pelo `navigator.platform`: lá o Cmd faz o papel do Ctrl e o Option o do Alt, e os atalhos e as dicas se escrevem com eles. Uma
 * conferência só, para que os atalhos de cada lugar não passem a discordar sobre qual plataforma é qual.
 */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad/i.test(platform);
}
