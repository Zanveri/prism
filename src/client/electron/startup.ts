import type { SplashStep } from "./splash";

/**
 * A ordem da abertura (RN-MARCA-002 a 004), sem depender do Electron: o splash aparece primeiro,
 * a API sobe, a janela principal é criada e só então se mostra, e o splash fecha. Não há espera
 * artificial: cada passo dura o que o trabalho dele durar.
 *
 * Se a API não subir, o caminho é o mesmo: a janela principal abre e é a tela de abertura dela
 * (`ApiGate`) que mostra o erro, com "Reiniciar" (seção 7 da especificação).
 */
export async function startUp(deps: {
  showSplash(): { setStep(step: SplashStep): void; close(): void };
  startApi(): Promise<unknown>;
  createMainWindow(): { whenReadyToShow(): Promise<void>; show(): void };
}): Promise<void> {
  const splash = deps.showSplash();

  try {
    splash.setStep("api");
    // A falha não é tratada aqui: quem iniciou a API a registra, e a tela mostra o motivo.
    await deps.startApi().catch(() => undefined);

    splash.setStep("ui");
    const mainWindow = deps.createMainWindow();
    await mainWindow.whenReadyToShow();
    mainWindow.show();
  } finally {
    // Aconteça o que acontecer na abertura, o splash não fica para trás.
    splash.close();
  }
}
