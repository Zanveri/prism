// Aplica o último tema escolhido ANTES da primeira pintura (RN-CONFIG-001): sem isto, quem usa o tema claro veria uma
// página escura por um instante a cada abertura. É um script clássico, de um arquivo do próprio app (a política de
// conteúdo não deixa script em linha), carregado no <head> sem `defer` para bloquear a pintura até rodar.
//
// A chave e os valores são os de `src/app/settings/_lib/theme.ts` (`themeStorageKey`, `applyTheme`) e a lista é a de `themeModes`
// (`preferences.ts`); `theme.test.ts` roda este arquivo, confere a ida e volta de cada modo e que um valor que não é modo não passa. A chave é a do dispositivo, e não a do usuário: o login acontece antes
// de se saber quem entrou. Sem nada guardado, ou sem `localStorage`, nada muda e o CSS fica no tema escuro.
(function () {
  try {
    var mode = localStorage.getItem("prism:theme");
    if (["dark", "light", "system", "monokai", "dracula", "nord", "github-light", "kanagawa"].indexOf(mode) !== -1) document.documentElement.dataset.theme = mode;
  } catch {
    // Sem acesso ao localStorage: fica o tema padrão.
  }
})();
