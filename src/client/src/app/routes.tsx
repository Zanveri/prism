import { Navigate, Outlet, type RouteObject } from "react-router";

import { RemountOnLock } from "@/app/_components/remount-on-lock";
import { VaultGuard } from "@/app/_components/vault-guard";
import { WorkbenchSlot } from "@/app/_components/workbench-slot";
import { LegacyConnectionsRedirect } from "@/app/connections/page";
import { DriversRedirect } from "@/app/drivers/page";
import { SettingsShortcut } from "@/app/settings/_components/settings-shortcut";
import { ThemeSync } from "@/app/settings/_components/theme-sync";
import { SettingsPage } from "@/app/settings/page";
import { SignInPage } from "@/app/sign-in/page";
import { WorkbenchProvider } from "@/app/workbench/_lib/workbench-state";
import { WorkbenchPage } from "@/app/workbench/page";
import { pathsConfig } from "@/config/paths.config";

/**
 * A tabela de rotas, separada de `app.tsx` para o teste conferir onde cada coisa é montada.
 *
 * O estado da área de trabalho (abas, nós abertos, o que cada aba executa) fica **dentro do guard
 * do cofre e acima das telas de dentro**:
 * - dentro do guard, porque ele consulta `api/user/connections`: montado com o cofre fechado, cada
 *   abertura do app pediria a lista antes do login, receberia 401 `VAULT_LOCKED` e mostraria o
 *   aviso "Cofre fechado" a quem ainda nem entrou;
 * - acima das telas, para abrir Configurações (ou Configurações › Drivers, que o "Instalar driver" de uma conexão sem driver abre) e voltar
 *   não o apagar;
 * - o guard só desenha o que está abaixo dele com o cofre aberto, então sair, ou o cofre fechar por
 *   qualquer motivo, desmonta tudo: nada passa para o usuário seguinte.
 *
 * O tema do usuário (RN-CONFIG-001) é aplicado também aqui dentro, por `ThemeSync`: só com o cofre aberto há usuário. As
 * Configurações são mais uma tela sob o provedor, então abrir e fechar a tela (ou Ctrl+, de qualquer uma, `SettingsShortcut`)
 * não apaga as abas.
 *
 * A área de trabalho NÃO é uma rota filha: ela fica montada por baixo, em `WorkbenchSlot`, enquanto o cofre está aberto, e as outras telas
 * (Configurações) aparecem no lugar dela, com ela escondida e inerte. Montada por uma rota ela seria desmontada ao
 * sair, e o editor recriado perderia o cursor, a seleção, o histórico de desfazer e a rolagem. A rota `/workbench` existe (o caminho
 * é válido), mas não tem elemento: quem a mostra é o `WorkbenchSlot`.
 */
export const routes: RouteObject[] = [
  { path: pathsConfig.signIn, element: <SignInPage /> },
  {
    element: <VaultGuard />,
    children: [
      {
        element: (
          <WorkbenchProvider>
            <ThemeSync />
            <SettingsShortcut />
            <WorkbenchSlot>
              <WorkbenchPage />
            </WorkbenchSlot>
            <RemountOnLock>
              <Outlet />
            </RemountOnLock>
          </WorkbenchProvider>
        ),
        children: [
          // A tela de Conexões deixou de existir (RN-NAV-001 e 004: o formulário é um diálogo sobre a área de trabalho): o endereço leva a ela.
          { path: pathsConfig.connections, element: <LegacyConnectionsRedirect /> },
          // A tela de Drivers virou Configurações › Drivers (RN-NAV-006); o endereço continua e leva para lá.
          { path: pathsConfig.drivers, element: <DriversRedirect /> },
          { path: pathsConfig.settings, element: <SettingsPage /> },
          { path: pathsConfig.workbench },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to={pathsConfig.workbench} replace /> },
];
