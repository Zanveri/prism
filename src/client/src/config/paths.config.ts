/**
 * As rotas da tela (em hash). Nenhum caminho é escrito à mão fora daqui.
 *
 * `connections` e `drivers` são os endereços das telas de antes (RN-NAV-001): o primeiro leva à área de trabalho (o formulário de conexão é
 * um diálogo sobre ela, RN-NAV-004), e o segundo é o endereço dos drivers, que leva a Configurações › Drivers (RN-NAV-006).
 *
 * Cada seção das Configurações é uma página (`settingsSection`); `settings` sozinho leva à primeira.
 */
export const pathsConfig = {
  signIn: "/sign-in",
  connections: "/connections",
  drivers: "/drivers",
  workbench: "/workbench",
  settings: "/settings",
  settingsSection: "/settings/:section",
} as const;
