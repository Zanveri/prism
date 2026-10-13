import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";

import { ApiGate } from "@/app/_components/api-gate";
import { PeerSession } from "@/app/_components/peer-session";
import { routes } from "@/app/routes";
import { ToastProvider, useToast } from "@/components/ui";
import { UpdateDialog } from "@/components/update/update-dialog";
import { createQueryClient } from "@/lib/api/query-client";

// Rotas em hash: funcionam igual no servidor do Vite e em `app://prism`, e trocar de rota não é
// uma navegação da janela, que o processo principal cancela (RN-SHELL-001).
const router = createHashRouter(routes);
// Para o que outra janela contou do cofre (RN-ABAS-004), que chega fora das rotas.
const currentPath = () => router.state.location.pathname;
const navigateTo = (to: string, options: { replace: true }) => router.navigate(to, options);

/**
 * Um `QueryClient` por vida da API: fica dentro do `ApiGate`, que desmonta tudo quando ela cai.
 * O que estava em cache era da API anterior — a nova tem o cofre fechado e nenhuma sessão.
 */
function Queries({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [queryClient] = useState(() => createQueryClient(toast));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function App() {
  return (
    <ToastProvider>
      {/*
        O diálogo de versão nova fica acima do `ApiGate` (RN-ATUALIZA-003): o atualizador mora no processo principal e não
        depende da API, e quando a API não sobe a versão nova pode ser justamente o conserto. É o único lugar onde ele é montado.
      */}
      <UpdateDialog />
      <ApiGate>
        <Queries>
          <PeerSession pathname={currentPath} navigate={navigateTo} />
          <RouterProvider router={router} />
        </Queries>
      </ApiGate>
    </ToastProvider>
  );
}
