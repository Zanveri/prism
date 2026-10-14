# Prism — interface (`src/client`)

Casca Electron e tela React do Prism. O que vale para o projeto inteiro está no `AGENTS.md` da raiz
e na especificação (`docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md`); aqui fica só o
que é desta pasta. Das skills zanveri de front-end vale o que a seção 3.3 da especificação lista.

## Não é um app Next

Não há Server Components, Server Actions, BFF, `proxy.ts`, cookie de sessão nem `NEXT_PUBLIC_*`
(decisão 5 da seção 8 da especificação). A fronteira de confiança é o preload. Todo componente roda
na janela; `"use client"` e `server-only` não existem aqui.

## Layout

```
electron/        main.ts, preload.ts, api-process.ts, app-version.ts, data-dir.ts, permissions.ts (as permissões do Chromium), platform.ts, splash.ts, startup.ts, window-hub.ts e window-messages.ts (as janelas e o que passa entre elas), workspace-hub.ts e workspace-messages.ts (as abas que voltam na próxima entrada)   (processo principal e ponte; o channels.test.ts confere os canais) e update/ (as atualizações)
src/app/         app.tsx (provedores), routes.tsx (a tabela de rotas), _components/ (o que só a casca usa: o guard do cofre, o WorkbenchSlot, o bloqueio) e _lib/ (as peças do bloqueio por inatividade), uma pasta por tela (sign-in, connections, workbench, drivers, settings)
src/components/  ui/ (primitivos + index.ts), layout/ e update/ (o diálogo de versão nova, usado pelo login e pela barra superior)
src/config/      paths.config.ts
src/lib/api/     prism-api.ts, prism-endpoints.ts, query-client.ts, bridge.ts, vault-lock.ts (o estado de bloqueio e a barreira dos pedidos), workspace-sync.ts ("grave as abas agora", antes de o cofre fechar)
src/lib/utils/   cn.ts, format.ts, form.ts (a submissão e a fiação de aria dos formulários), route-params.ts (a tela gasta o parâmetro da rota que leu), zod-jitless.ts
src/lib/testing/ react-tree.ts (`elementsOf`: o que um componente sem estado monta, para testar sem DOM) e react-hooks.ts (`createHookRuntime`: os ganchos do React simulados, para o componente COM estado); só para testes
src/styles/      globals.css (tokens em @theme como light-dark(claro, escuro) e um bloco :root[data-theme] por tema: são seis; as fontes `--font-sans`, `--font-mono` e `--font-editor`)
public/          theme-boot.js (aplica o último tema antes da primeira pintura; o electron-vite o copia para out/renderer)
scripts/         ico.mjs, icns.mjs e make-icons.mjs (`pnpm icons`), api-layout.mjs (o que o app espera da API publicada), publish-api.mjs (`pnpm build:api`), check-api.mjs, dist.mjs (`pnpm dist`), run-hidden.ps1
build/           icon.svg, icon-small.svg e os arquivos gerados icon.ico, icon.icns, icon.png e icons/ (os PNG de Linux)
electron-builder.yml   o empacotamento (`pnpm dist`, `pnpm dist:dir`); a saída vai para release/ e a API publicada para resources/api/ (os dois fora do git)
index.html       entrada da tela, com a política de conteúdo e o script do tema
```

É o layout da seção 3.3 da especificação, **não o padrão do electron-vite** (`src/main`,
`src/preload`, `src/renderer`). Por isso `electron.vite.config.ts` declara as três entradas e a
raiz da tela é a própria pasta. A saída vai para `out/main/main.js`, `out/preload/preload.js` e
`out/renderer/`.

## Comandos

`pnpm dev`, `pnpm build`, `pnpm build:api -- <identificador>`, `pnpm dist -- <plataforma> [arquitetura]`, `pnpm dist:dir`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (vitest), `pnpm icons`. `typecheck` roda
dois projetos: `tsconfig.json` (a tela) e `tsconfig.node.json` (`electron/` e os arquivos de
configuração).

Para ver a tela sem olhar a janela: `pnpm dev --remoteDebuggingPort 9222` e o protocolo de
depuração do Chromium em `http://127.0.0.1:9222/json` (avaliar expressões, capturar a tela).

## Processo principal

- `api-process.ts` inicia a API e não importa nada do Electron, para o vitest exercitá-lo com um
  processo filho de verdade. Em desenvolvimento o comando é `dotnet run --project ../api/Prism.Api
  --no-launch-profile --artifacts-path src/client/.api-dev`; empacotado, `resources/api/Prism.Api.exe` no Windows e
  `resources/api/Prism.Api` no Linux e no macOS (`apiExecutable`, em `scripts/api-layout.mjs`, que o `check-api.mjs` também usa; com teste).
  O `--artifacts-path` leva `bin` e `obj` desse `dotnet run` para `.api-dev/` (fora do git): sem ele a API roda
  de `src/api/**/bin`, prende os DLL e um `dotnet build src/api/Prism.slnx` feito com o app aberto falha com
  `MSB3021`. Com ele os dois convivem. Mesmo assim, feche o app quando não estiver conferindo algo. O `stop()` usa `taskkill /T` no
  Windows porque, com o `dotnet run`, a API é neta do Electron.
- **Pasta de dados** (`PRISM_DATA_DIR` é `app.getPath("userData")`, RN-ABERTO-008): a subpasta `Zanveri/Prism` da pasta de
  dados de aplicativo do sistema (`%APPDATA%` no Windows) no app empacotado, e `Zanveri/Prism-dev` em desenvolvimento
  (`!app.isPackaged`), para o `pnpm dev` e as conferências nunca abrirem os cofres de verdade. O nome do produto continua
  `Prism` (`productName`, executável, título): só a pasta tem o `Zanveri` na frente. Quem decide é `userDataDir`
  (`data-dir.ts`, com teste), e o `main.ts` chama `app.setPath("userData", ...)` sempre, antes de qualquer outra leitura do
  caminho, do `requestSingleInstanceLock` (que a usa) e do `whenReady`; o `sessionData` (cache, `Local Storage`)
  acompanha. `--user-data-dir` na linha de comando vence nos dois modos, e é por ele que as conferências usam uma pasta
  descartável. O log tem a linha `[prism] pasta de dados: …`.
- Variáveis que a API recebe: `PRISM_API_TOKEN`, `PRISM_DATA_DIR`,
  `PRISM_ALLOWED_ORIGIN` (a origem da tela) e `PRISM_PARENT_PID`.
- A tela vem do servidor do Vite quando `ELECTRON_RENDERER_URL` existe (o `pnpm dev`) e de
  `app://prism` no app construído. No app empacotado essa variável é ignorada: a origem que ela
  aponta receberia o token. `app.isPackaged` decide também o comando da API e o menu.
- O app empacotado não tem o menu padrão do Electron (o Ctrl+R dele recarrega a janela e perde o
  texto das abas de SQL). Em desenvolvimento o menu fica. No macOS a barra de menu é do sistema, e um app sem menu não
  ouve Cmd+Q nem Cmd+C e Cmd+V nos campos: fica o mínimo, o menu do app e Editar, sem recarregar e sem ferramentas de
  desenvolvedor (`applicationMenuTemplate`, em `platform.ts`, com teste; não foi aberto no macOS).
- **F5 e Ctrl+R nunca recarregam a janela** (RN-GRADE-012), e F5 e F11 chegam à tela. O Chromium do Electron não recarrega nada sem menu: quem
  recarrega é o menu padrão de desenvolvimento (Recarregar Ctrl+R, Forçar recarga Ctrl+Shift+R, Tela cheia F11), e o app empacotado do Windows e do
  Linux não tem menu, e o do macOS não tem Recarregar. Mesmo assim, cada janela ignora o menu para essas teclas: o `before-input-event` de
  `createAppWindow` chama `setIgnoreMenuShortcuts(menuShortcutIgnored(input))` a cada tecla (`platform.ts`, com teste: F5 e F11 com qualquer
  modificador, Ctrl+R e Cmd+R com ou sem Shift). A tecla não é cancelada (o `preventDefault` do `before-input-event` a tiraria também da página):
  ela só não vai ao menu, e a tela a recebe como qualquer outra. Conferido sob Xvfb, no `pnpm dev`, com o menu padrão: F5 atualizou os Registros,
  F11 abriu o "Filtrar" (e não a tela cheia), e Ctrl+R e Ctrl+Shift+R não recarregaram a página (um marcador em `window` sobreviveu).
- Sair do app, pela última janela fechada ou por `app.quit()`, passa por `before-quit`: grava as abas de todas as janelas (`workspaceHub.flush`, RN-ABAS-006,
  no máximo 5 s), e então `closeVaultAndStop` chama `DELETE api/public/sessions` com o token (RN-COFRE-008), espera no
  máximo 2 s e para a API. A instalação de uma atualização (`stopApi` do atualizador) faz o mesmo. A resposta só vai para o log. "Reiniciar" para a API sem essa chamada.
- A ponte (`window.prism`, o tipo `PrismBridge` em `electron/preload.ts`) tem `getApiConfig`, `onApiExit`, `restartApi`, `version`,
  `getDataFolder`, `updates` (ver "Atualizações"), `windows` e `session` (ver "Abas que se movem e outras janelas") e `workspace` (ver "Abas que voltam na
  próxima entrada"). Os canais da API são
  `prism:api-config`, `prism:api-restart` e `prism:api-exit`; o da pasta de dados, `prism:data-folder`; os das atualizações, `prism:update-*`;
  os das janelas, `prism:windows-*` e `prism:session-*`; os das abas que voltam, `prism:workspace-*`. O processo principal só responde ao quadro que veio da origem do app (`assertFromApp`).
- **As janelas** (RN-ABAS-002 a 005). `createAppWindow` cria todas, com o mesmo `webPreferences` (RN-SHELL-001) e a mesma origem; cada uma tem
  um número do app (não o `id` do `BrowserWindow`: ele vai em `additionalArguments`, `windowArgument`, antes de a janela existir), que o preload
  lê (`windowIdFromArgv`, em `app-version.ts`, com teste). A primeira é a da abertura (`createMainWindow`, pelo `startUp`); as outras só nascem no
  centro das janelas (`window-hub.ts`, sem Electron, com teste: `createWindow` é dele), quando uma aba sai para uma janela nova. `window.open`
  continua negado. Os avisos que valem para todas (`prism:api-exit`, `prism:update-*`) vão a todas (`liveWindows`); o `second-instance` traz a
  primeira à frente; o "Reiniciar" de uma janela recarrega as outras (`webContents.reload()`, que o `will-navigate` não vê), porque a API nova
  tem outro token e o "Reiniciar" de cada uma derrubaria a que a primeira subiu. **Fechar uma janela** passa pelo `close` dela: com a área de
  trabalho montada (`hub.isReady`, que a tela liga e desliga, e que a navegação de página inteira e a queda do processo da tela desligam), o
  fechamento é cancelado e a tela recebe `prism:windows-close-requested`; quando as abas fecharam, ela pede `prism:windows-close` e o `close`
  passa (`closeApproved`). Sem área de trabalho (o login) e com o app saindo (`quitting`, agora do módulo) fecha direto; a última fechada
  encerra o app pelo `window-all-closed`, como antes.
- **As permissões do Chromium** (RN-SHELL-001 e RN-CONFIG-008; `permissions.ts`, sem Electron, com teste): sem tratador, o Electron concede
  tudo a qualquer página. O `whenReady` liga os dois da sessão das janelas (`session.defaultSession`), o do pedido
  (`setPermissionRequestHandler`, pelo `details.requestingUrl`) e o da consulta (`setPermissionCheckHandler`, pela origem), com a mesma regra
  (`permissionAllowed`): só `clipboard-sanitized-write` e `clipboard-read` (copiar e colar) e `local-fonts` (a lista das fontes, em
  Configurações › Aparência), e só para a origem da tela (`rendererOrigin`: `app://prism`, ou o servidor do Vite em desenvolvimento). O resto é
  negado, mesmo para o app. **Web API nova que pede permissão** (a tela passa a usar geolocalização, notificação…): entra em `appPermissions`,
  ou falha calada. Conferido no Electron sob Xvfb: `local-fonts` sai `granted` sem gesto da pessoa (quem responde é o tratador da consulta, e a API não precisa pedir), copiar e
  colar funcionam, e `geolocation` e `notifications` saem `denied`.
- **A pasta de dados pela ponte** (RN-CONFIG-001): `getDataFolder()` não leva argumento, e o processo principal responde
  `app.getPath("userData")`, só para a tela mostrar em Configurações > Sobre. Ela não abre nem troca pasta (o `channels.test.ts` confere que
  a ponte não oferece isso), e a tela valida a resposta (`readDataFolder`, em `lib/api/bridge.ts`: texto não vazio, senão `null`); fora do
  Electron a ponte de desenvolvimento responde `null`.
- **Canal novo entre a tela e o processo principal**, as cinco peças: o `ipcMain.handle("prism:…")` de `main.ts`, que começa por
  `assertFromApp(event)`; o `ipcRenderer.invoke` do `preload.ts`; o tipo em `PrismBridge`; o ramo de desenvolvimento de `getBridge`
  (`lib/api/bridge.ts`, a tela fora do Electron); e a validação da resposta na tela (a ponte é a fronteira de confiança). O
  `electron/channels.test.ts` lê `main.ts` e `preload.ts` como texto e reprova canal que só tem um dos lados: todo `ipcRenderer.invoke` tem
  o seu `ipcMain.handle`, e todo `webContents.send` tem o seu `ipcRenderer.on`, e vice-versa.
- **A versão** (RN-VERSAO-003 e 004) é o `version` do `package.json`, a única fonte (`app.getVersion()`): não há constante nem
  outro arquivo com ela. Ela chega à tela sem IPC: o processo principal a põe em `webPreferences.additionalArguments`
  (`versionArgument`) e o preload a lê de `process.argv` (`versionFromArgv`, `app-version.ts`, com teste); `window.prism.version`
  é vazia se o argumento não veio, e então a tela não escreve versão nenhuma. A tela de login a mostra ao lado do nome
  (`BrandPanel`) e o splash a traz no próprio HTML, como texto, antes de a página carregar (`splashPage`): sem script nem token
  (RN-MARCA-005). Fora do Electron (a tela num navegador, só em desenvolvimento) a ponte devolve `dev`.
- O log do processo principal (no terminal do `pnpm dev`) traz `[prism] janela criada`,
  `[prism] API pronta na porta N`, `[prism] API saiu com código N` (só quando a API saiu sozinha ou foi morta de fora),
  `[prism] API encerrada pelo app` (o app mandou parar, ao fechar ou ao reiniciar: o `taskkill` do Windows faz o processo sair
  com código 1, e isso não é falha; `apiExitMessage`, em `api-process.ts`, com teste), `[prism] API não iniciou: …`
  e `[prism] fechamento do cofre: …`.
- A primeira partida depois de mudar a API compila o projeto em `.api-dev/`, e o `dotnet build` da solução
  não adianta essa compilação. Se passar de 30 s, a tela mostra o erro com "Reiniciar".

## Política de conteúdo (RN-SHELL-001)

`default-src 'self'; connect-src 'self' http://127.0.0.1:*; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'`, no `index.html`. Consequências que não são óbvias:

- `connect-src` tem `'self'` além da API: sem ele o websocket do Vite é recusado e a tela não
  recarrega sozinha em desenvolvimento.
- **Não há `@vitejs/plugin-react`.** O Fast Refresh dele entra por um script inline, que a política
  recusa. O JSX é compilado pelo próprio Vite; cada mudança recarrega a página.
- O Zod roda sem compilar schemas (`src/lib/utils/zod-jitless.ts`, primeiro import de `main.tsx`),
  ou cada `z.object` deixa uma violação da política no console.
- Uma origem nova (script, fonte, imagem de fora) não entra: o app não carrega nada de fora. As fontes do sistema (RN-CONFIG-008) não são
  origem: a `font-family` as acha pelo nome no computador, sem baixar nada, e o `font-src 'self'` não as vê.
- O script que aplica o tema antes da primeira pintura é um **arquivo** (`public/theme-boot.js`, clássico, no `<head>`, sem
  `defer`): a política recusa script em linha, e um módulo deixaria a página pintar antes dele (ver "Configurações").
- `will-navigate` é cancelado; em desenvolvimento passa só a recarga da própria página. Abrir
  janela é sempre negado. As rotas são em hash, que não é navegação.

## Marca, ícone e abertura (RN-MARCA-001 a 006)

- **A marca é a ilustração inteira do login e nunca um desenho reduzido.** O usuário recusou duas
  vezes versões simplificadas. Os desenhos vêm do canvas, copiados, sem redesenhar: o
  `build/icon.svg` (256 px) e o `build/icon-small.svg` (32 px, até 32 px o traço engrossa) são os
  `<svg>` de `IconeApp.dc.html`; o `PrismMark` é o `<svg viewBox="0 40 700 264">` de
  `Workbench.dc.html`; o do splash é o de `Splash.dc.html`. Mudou o canvas, copie de novo.
- **No tema claro a marca continua inteira** (RN-MARCA-006): onde o fundo claro apagaria o raio branco e o vidro, ela muda de cor e nunca de
  desenho. `markColors`, em `prism-mark.tsx`, tem para cada cor que muda um par `light-dark(clara, escura)`: **a escura é a cor do desenho do
  canvas, sem mudança**, e a clara é a variante para o fundo claro (o raio e o contorno do prisma escuros, o tom do banco nas faixas, os
  cilindros claros). Quem escolhe a coluna é o `color-scheme` de onde a marca está: na barra superior, o do tema; na tela de login ela mora
  sobre o **palco escuro** (`.stage-dark`, em `globals.css`), que fica no tema escuro do Prism em qualquer tema, porque o raio e o prisma de
  vidro foram desenhados para um fundo escuro (os valores do palco são a coluna escura de `@theme`, token por token, e o `globals.test.ts` os
  confere). O contorno do prisma no claro (`#667085`) se destaca do vidro (3,3:1) e do fundo (4,3:1), e o teste confere o contraste do raio e
  do contorno em cada tema.
- Ids de filtro e gradiente: fixos nos `.svg` e no `splash.html` (cada um é uma página só);
  `useId()` no `PrismMark`, que aparece mais de uma vez na mesma tela.
- `pnpm icons` roda o `scripts/make-icons.mjs` **dentro do Electron**: cada tamanho é o SVG numa
  janela transparente fora da tela, e o PNG sai de `capturePage()`. O script confere o tamanho, o
  canto transparente e o centro opaco. Cada tamanho é desenhado uma vez só (de 16 a 1024 px; até 32 px do
  `icon-small.svg`) e serve a todos os formatos: `build/icon.ico` (16, 24, 32, 48, 64, 128 e 256 px), `build/icon.png`
  (512 px), `build/icons/<N>x<N>.png` (16 a 512 px, o conjunto que o `electron-builder` pede para Linux) e
  `build/icon.icns` (macOS, entradas PNG de 16 a 1024 px, montado por `icns.mjs` sem dependência). Todos são versionados.
  Depois de gerar, abra os PNG e olhe: brilho, degradê e os três bancos têm de aparecer de 48 px
  para cima. O PNG gerado varia alguns bytes de uma execução para outra (antialias): regerar sem mudar o canvas só
  suja o diff.
- O ícone da janela principal e do splash (`iconPath` em `main.ts`, escolhido por `windowIconFile`, com teste) é o `.ico` no
  Windows, não o PNG: o Windows escolhe a entrada do tamanho que precisa, e a de 16 e 32 px é a de traço grosso. No Linux é o
  PNG de 512 px; no macOS não há ícone de janela, o do pacote (`.icns`) vale. Empacotado, o caminho é `resources/icon.ico` ou
  `resources/icon.png`: o `electron-builder` copia o arquivo de `build/` para lá (`extraResources` de cada plataforma). O PNG
  de 512 px é também o `<link rel="icon">` do `index.html`.
- `app.setAppUserModelId("com.zanveri.prism")` agrupa a barra de tarefas e fixa o ícone.
- **Abertura:** `startUp` (`startup.ts`, sem Electron, testado com dependências falsas) mostra o
  splash, passo `api`, inicia a API; pronta ou não, passo `ui` e cria a janela principal
  escondida; quando ela está pronta, mostra e fecha o splash. Se a API falha, o caminho é o mesmo e
  a tela de abertura (`ApiGate`) mostra o erro com "Reiniciar". A janela principal também se mostra
  se a página falhar ao carregar, para o splash não ficar para sempre.
- **O splash é uma página estática** (`splash.html`, embutida no `main.js` por `?raw` e aberta
  como `data:`): sem script, sem preload, sem token, política `default-src 'none'; style-src
  'unsafe-inline'; img-src 'self' data:`. O texto, a posição e a barra de cada passo são CSS que o
  `splash.ts` insere com `insertCSS`; a regra da barra é `.bar > .bar-fill` porque o CSS inserido
  entra *antes* do da página e perderia para um `.bar-fill` simples. A fonte é a IBM Plex só se
  estiver instalada, senão a do sistema (Segoe UI): a política não deixa carregar fonte. `setStep` espera a página carregar (uma fila de
  promessas) e a janela só aparece com o primeiro passo desenhado.
- Para conferir o splash pela porta de depuração: ele é o alvo cuja URL começa com `data:text/html`,
  e nele `typeof window.prism` é `"undefined"`.

## Chamadas à API

- `apiRequest(path, { method, body, schema, signal })` devolve `ApiResult<T>` e nunca lança. Um 2xx
  só vira dado se passar pelo `schema` (Zod). `NETWORK_ERROR` e `RESPONSE_INVALID` são códigos só
  da tela.
- As chaves de `error.errors` chegam com a inicial minúscula (`name`, não `Name`).
- `error.extensions` traz os campos extras do corpo de erro, como vieram (o `sqlState` e a `position` do
  `SQL_EXECUTION_FAILED`), sem os do próprio problem+json. Quem os usa valida com Zod (`sqlErrorDetails`).
- Os caminhos ficam em `prism-endpoints.ts`, sem barra inicial, com a grafia do controller.
- Toda `queryFn` e `mutationFn` usa `unwrap(...)`. O erro lançado vira aviso em **um lugar só**,
  o `createQueryClient` (RN-AVISO-004): nenhuma tela chama `toast.error` para dizer que uma chamada
  falhou. O que a tela mostra no próprio lugar segue a regra de `allowRefusal` e `silent`, mais
  abaixo. Erro com `errors` de campo não gera aviso (a exceção está em "Avisos e mensagens"); `VAULT_LOCKED` gera o de atenção e o `VaultGuard` leva ao login.
- O `QueryClient` vive dentro do `ApiGate`: API reiniciada, cache novo. Ao sair ou trocar de
  usuário, quem faz isso limpa o cache (`queryClient.clear()`).
- O `VaultGuard` só manda para o login quando a resposta diz `unlocked: false` ou quando
  `onVaultLocked` dispara (`guardState`, com teste). Uma reconsulta que falha, já havendo
  resposta, não desmonta as telas de dentro. A consulta de sessão é `silent` e não se refaz quando
  a janela volta a ter foco.
- Consultas não são repetidas (`retry: false`): a API é local.
- Com o Prism bloqueado por inatividade os pedidos esperam o desbloqueio (`whileLocked` é a exceção): ver "Bloqueio por inatividade".
- Recusa que o formulário mostra no próprio lugar (credencial inválida, nome já existente,
  erro de campo) é escolhida por código: a `mutationFn` passa o resultado por
  `allowRefusal(result, ...codes)` (`prism-api.ts`). Esses códigos voltam como valor e o
  formulário os mostra; qualquer outro lança e vai ao aviso central, inclusive a API fora do ar.
  No login são dois, em `signInOrRefuse` (`sign-in.service.ts`, com teste): `INVALID_CREDENTIALS` e
  `VAULT_FORMAT_UNSUPPORTED` (cofre criado por um Prism mais novo, RN-VERSAO-005). Este não é erro de senha: a frase manda
  atualizar o app, e usuário e senha ficam como estão, sem limpar o campo nem marcá-lo.
  `meta: { silent: true }` é só para a consulta cujo erro, qualquer que seja o código, aparece no
  próprio lugar (o caso do `VaultGuard`). Uma mutação com `silent` calaria também a falha que
  merece aviso.
- **Nenhuma chamada que a pessoa espera fica para sempre**: "Entrar", "Criar usuário", "Sair" e o desbloqueio têm o prazo de
  `userActionDeadlineMs` (15 s, em `prism-api.ts`), por padrão do próprio serviço (`signIn`, `createUser` e `signOut`, em `sign-in.service.ts`:
  `signal = AbortSignal.timeout(...)`; quem passa o próprio sinal fica com o dele). Estourado, o pedido volta como `NETWORK_ERROR`: a mutação
  falha, o botão volta a aceitar o clique e o aviso central diz "Sem resposta da API." (na tela de bloqueio a frase é da própria tela, porque
  o aviso central fica por baixo do diálogo dela). O pedido cancelado pelo prazo pode ter chegado à API: criar usuário de novo pode responder
  `USER_ALREADY_EXISTS`. **Chamada nova que deixa um botão em "…ando…" precisa do prazo.**
- A mutação guarda o que recebeu em `variables`. A que envia senha leva `gcTime: 0` e recebe só o
  que a API precisa, sem a confirmação.
- Formulários: `parseForm(form, schema)` (`lib/utils/form.ts`) lê o `FormData`, valida e leva o foco ao
  primeiro campo recusado; `TextField` (rótulo, campo e erro) faz a fiação de `aria-invalid` e
  `aria-describedby` (o erro tem o id `<id>-error`). Os quatro formulários (login, criar usuário,
  conexão e pasta) usam as duas peças; `apiFieldErrors` leva o `errors` de um 422 ao mesmo lugar.

## Avisos e mensagens

- `useToast()` devolve `{ success, warning, error }` (RN-AVISO-001 a 006). A regra da fila está em
  `toast-queue.ts`; `toast.tsx` só desenha.
- Resultado de ação é aviso; o que precisa ficar até ser resolvido é estado na tela (`FormMessage`,
  `FieldError`, a área de resultado).
- **A pilha de avisos fica acima do rodapé do resultado** (`bottom-20`, em `toast.tsx`). Ela é do canto inferior direito, o mesmo
  do "Carregar mais 200" e do "Executar de novo" do rodapé do resultado: com `bottom-5` o aviso de erro que acabava de sair
  cobria o botão e engolia o clique por 8 s (e sem prazo com o mouse em cima, porque o cartão pausa no hover; Marco B, D3).
  `bottom-20` são 80 px: a barra de status tem 28 px e o rodapé do resultado 41 px, então o rodapé começa a 69 px da borda da
  janela e a base da pilha fica 11 px acima dele. Conferido em 1440 x 900 e em 1024 x 700 (o mínimo da janela), com o aviso alto
  de erro e com o curto de atenção: o ponteiro chega ao botão nos 15 pontos de uma grade sobre ele, e o clique carrega as
  linhas. Com a janela de 1024 px e o navegador alargado a 640 px o rodapé quebra em duas linhas (85 px), e o botão fica na
  linha de baixo, ainda abaixo da pilha. A pilha e o cartão seguem como eram: a pilha deixa o ponteiro passar, o cartão o recebe
  (hover pausa, texto seleciona). Mudou a altura do rodapé do resultado ou da barra de status: medir de novo. O vitest não
  tem layout, então a conferência é num navegador de verdade: com o aviso à vista, `document.elementFromPoint` no centro do
  botão tem de ser o botão.
- **Exceções à regra "nenhuma tela chama `toast.error` por uma chamada que falhou"** (todas por `allowRefusal`, que devolve a
  recusa como valor): (1) "Testar conexão" no formulário de conexão: o `DATABASE_CONNECTION_FAILED` vira o aviso "Não foi
  possível conectar." e a mensagem do banco (`detail`) fica abaixo dos botões; (2) um 422 com `errors` cuja chave nenhum
  campo do formulário tem (hoje a mensagem sumiria) vira aviso com o `title` do erro, no formulário de conexão e no diálogo
  de pasta. Quem decide é `hasUnshownFieldErrors(errors, fields)` (`lib/utils/form.ts`, com teste); os nomes dos campos saem
  do próprio schema (`Object.keys(schema.shape)`), então um campo novo no schema já entra na conta; (3) o editor de SQL: o
  `SQL_EXECUTION_FAILED` de uma execução vira o aviso curto "O comando falhou. Veja o erro no resultado." e a mensagem do
  banco, com o SQLSTATE, fica na área de resultado (RN-AVISO-005); o `TRANSACTION_CONTROL_NOT_SUPPORTED` (`BEGIN`,
  `COMMIT` e afins, RN-SQL-003) tem o mesmo aviso, com a frase da API (`title` e `detail`) na área de resultado, ou,
  havendo linhas na tela (que ficam), a frase da API vai no próprio aviso. Depois de "Cancelar", o comando que terminou por
  causa disso é "Comando cancelado." (ver "Uma coisa por vez"), e **não** gera o aviso de falha.
- **Avisos dos scripts** (`scripts.copy.ts`): gravar por cima um script com o SQL grande demais vira o aviso de erro com a frase da tela, porque não há
  diálogo aberto para mostrá-lo (a tela confere o tamanho antes de enviar, e o `SCRIPT_TOO_LARGE` da API só chega se as duas contas divergirem); salvar, renomear
  e excluir dão o aviso de sucesso, e abrir um script cuja conexão sumiu dá o de atenção.
- **Avisos da tela de Drivers** (`drivers.copy.ts`): (1) o remover que a API recusa com `DRIVER_IN_USE` passa por `allowRefusal` e
  vira o aviso de erro com a frase da tela ("Feche as conexões desse banco antes de remover o driver.", pedida pelo dono), no lugar do
  `title` da API; (2) o aviso de que o download falhou (com a causa, `error.detail`) **não** é de chamada que falhou: é a lista que
  chegou com um driver que baixava e agora está `failed` (`watchDriverTransitions`), e por isso sai uma vez só; a consulta periódica
  que falha várias vezes seguidas avisa só na primeira (`driversErrorMeta`) e para na terceira; (3) "Testar
  conexão" aceita também `DRIVER_NOT_INSTALLED` por `allowRefusal` (`runConnectionTest`), além do que já aceitava.
- **Avisos do editor** (`use-query-runner.ts`, frases em `workbench.copy.ts`): sucesso para comando sem linhas e para o que
  grava e devolve linhas (RN-SQL-013); atenção para cursor fechado, comando cancelado, valores cortados (uma vez por resultado), sessão
  reaberta, seleção com mais de um comando e Ctrl+Enter sem comando para enviar. `SELECT` com linhas não gera aviso. O resto
  (falha ao abrir a sessão, "Contar total" recusado, API fora do ar) é o aviso central, com o `title` e o `detail` da API.

## Conexões (`src/app/connections`)

- **Pastas e conexões** vêm de `foldersQuery` e `connectionsQuery` (`connections.service.ts`, com `queryOptions`
  para a área de trabalho reaproveitar). Depois de cada mutação, `invalidateLists` busca as duas de novo.
  `buildConnectionTree` monta a árvore; pasta ou conexão cujo pai não existe vai para a raiz, e pastas em
  ciclo (que a API recusa, RN-PASTA-003) não aparecem.
- **Quem mostra cada recusa:** só o que o formulário mostra no lugar passa por `allowRefusal`: o 422 com `errors`
  (`CONNECTION_INVALID`, `FOLDER_NAME_INVALID`) no campo, e `INVALID_PASSWORD` no diálogo de revelar. As recusas de
  regra (`FOLDER_NOT_EMPTY`, `FOLDER_CYCLE`, `*_ALREADY_EXISTS`) seguem para o aviso central, que escreve o
  `title` e o `detail` da API: a frase da regra é da API, não da tela.
- **Revelar senha** (`reveal-password-dialog.tsx`): `gcTime: 0` e `mutation.reset()` assim que a resposta chega, para
  nem a senha do usuário nem a da conexão ficarem no cache. A senha da conexão vai ao estado do formulário aberto
  (`ConnectionForm`) e sai com ele: a página o remonta (`key`) a cada conexão e a cada gravação. O `VAULT_LOCKED`
  do quinto erro é tratado na `onSuccess` da própria `useMutation` (que roda mesmo com o diálogo já desmontado pelo
  `VaultGuard`), e não no `mutate(…, { onSuccess })`.
- **Os diálogos ficam fora do `<form>`** que os abre: o evento de um portal sobe pela árvore do React, e o `submit`
  do diálogo chegaria ao formulário de baixo.
- **Mover pasta** oferece todas as pastas, a própria e as de dentro dela: o ciclo é recusa da API (RN-PASTA-003), e o
  aceite pede que ela apareça como aviso.
- **A seção Ambiente** (`environment-picker.tsx`, RN-CONN-015, RN-CONN-017 e RN-PASTA-005) é uma só, no formulário da conexão e nos
  diálogos de nova pasta e de "Editar pasta" (também pelo F2); mover pasta não a mostra. Os ids vêm do `idPrefix` (`cx` e `folder`), e a
  explicação de baixo, do `hint` (`connectionHint`, `folderHint`). **A cor é uma fileira de botões**: as seis do canvas (clicar na escolhida
  a tira) e, por último, "Outra cor", com o `EyedropperIcon`, a ÚNICA que abre o seletor do sistema, pelo `showPicker` do
  `<input type="color">` (sem ele, o `click`). O defeito de antes era um `<label>` em volta do input: clicar em qualquer ponto da linha
  "Outra cor #RRGGBB" abria o seletor. Agora o input fica ao lado da bolinha, fora de qualquer rótulo, invisível (`opacity-0`, 1 px,
  `pointer-events-none`, e não `display:none`, para o seletor abrir ancorado nele, junto da bolinha), fora do Tab (`tabIndex={-1}`) e da
  leitura (`aria-hidden`); Enter e Espaço abrem porque a bolinha é um `<button>` de verdade. Com uma cor que não é das seis (a comparação
  ignora a caixa), a bolinha fica com ela, a marca `ring-2` das outras e o conta-gotas no contraste do `environmentTextColor`, e o
  `#RRGGBB` vai no `aria-label` e no `title` (`otherColorChosen`); a cor do seletor volta em maiúsculas. A linha "Outra cor" de baixo e o
  "Sem cor" saíram. O teste (`environment-picker.test.ts`) roda com os ganchos simulados: põe um seletor de mentira na referência do input,
  clica em tudo o que tem `onClick` fora da bolinha (nada abre) e nela (abre), e confere que nenhum `<label>` o contém nem aponta para ele.
  **Conferido sob Xvfb**: o seletor do Chromium é uma janela do X SEM nome, então quem conta janelas usa `xdotool search --onlyvisible
  --name ''` (com `--name '.'` ele não aparece e a contagem não prova nada); oito cliques fora da bolinha (título, legenda, entre as
  bolinhas, depois da última, o fim da fileira, a dica, a borda da seção, o canto onde o input está) deixaram 2 janelas, e o clique, o Enter e o Espaço na
  bolinha, 3; Escape o fecha, e a cor digitada nos campos R, G e B dele chegou à bolinha.
- **O ambiente herdado** (RN-PASTA-005). A pasta tem `environmentName` e `environmentColor` (o `folderSchema` os exige, nulos quando não
  há), e quem diz o que cada uma mostra é o `environmentLookup(folders)` (`_lib/environment.ts`, puro e testado): `connection(c)` dá o
  ambiente próprio, que sempre ganha, ou o da pasta mais próxima acima que tenha um, com a pasta em `folder` (o `ShownEnvironment`);
  `folder(id)` dá só o da pasta, para a etiqueta dela na árvore (a subpasta sem ambiente não mostra o de cima); `inheritedIn(folderID)` dá o
  que uma conexão sem ambiente herdaria ali, para o formulário dizer "Herda <ambiente> da pasta <pasta>." (a frase acompanha o nome
  digitado e a pasta escolhida no campo, antes de gravar). **Só o nome faz um ambiente**: a cor sem nome não conta, como na
  `EnvironmentPill`. A pasta que sumiu e as pastas em ciclo não passam nada adiante. As respostas são guardadas (a mesma conexão e a mesma
  pasta dão o mesmo objeto), para o `TableTabPanel` memorizado não redesenhar; quem monta o lookup é um `useMemo` sobre `folders.data`, e
  mover a conexão ou a pasta é outra lista, então a resposta muda sozinha depois do `invalidateLists`. A etiqueta é a
  `ShownEnvironmentPill` (com a dica "Herdado da pasta <pasta>" quando é herdada), na árvore (`NavigatorRow` recebe `environment`), na
  faixa de abas (`environmentOf` do `TabStrip`), no cabeçalho da aba da tabela (`environment` do `TableTabPanel`), na barra de status e no
  cabeçalho do diálogo da conexão. A conexão continua com o ambiente PRÓPRIO no estado e no `PATCH` (mover e renomear conexão mandam o
  dela): o herdado nunca é gravado nela. Não há mais "lista" de conexões (RN-NAV-001): a RN-CONN-015 vale na árvore, na aba e na barra.
- **Os ambientes do usuário** (RN-AMB-001) saem de `userEnvironments(folders, connections)` (`_lib/user-environments.ts`, pura e testada): um
  por nome, sem diferenciar maiúsculas nem os espaços das pontas (`environmentKey`; o acento conta), com o nome e a cor da pasta ou conexão de
  `updatedAt` mais novo (a API manda nas duas; a data que não se lê perde, e no empate fica a primeira encontrada: as pastas antes das conexões,
  na ordem da lista), em ordem alfabética. Só o nome faz um ambiente. Nada é gravado à parte: as listas são as do cache (`foldersQuery` e
  `connectionsQuery`), e o ambiente que ninguém mais usa some. O `FolderDialog` e o `ConnectionDialog` leem a lista de conexões do cache
  (`useQuery(connectionsQuery)`) e passam o resultado à seção Ambiente (`environments`). Lá, acima do nome, o grupo "Ambientes já usados"
  (`role="group"`) tem uma etiqueta por ambiente, cada uma um `<button>` com `aria-pressed` (a do nome que está no campo) e a dica "Usar o
  ambiente X": escolher preenche o nome e a cor, que continuam editáveis. O campo do nome passou a ser controlado (o valor ainda vai pelo
  `FormData`) e completa pela `<datalist>` dele (`<prefixo>-environment-options`): o teclado e o leitor de tela são os do Chromium. O nome
  digitado que VIRA o de um ambiente (com qualquer caixa) traz a cor dele uma vez; seguir digitando no mesmo nome não a troca de novo, e abrir
  o formulário não muda nada sozinho. Sem ambiente nenhum, nem o grupo nem a `<datalist>` aparecem. **Conferido sob Xvfb** (a API de
  desenvolvimento, sem banco): o grupo aparece no "Editar pasta" e na "Nova conexão", e a etiqueta escolhida pelo clique preenche o nome e a
  cor e fica marcada.
- **"Editar pasta…"** (RN-PASTA-006) é o antigo "Renomear" da pasta: o item do menu (F2, lápis) e o modo `edit` do `FolderDialog` (título
  "Editar pasta", "Salvar", aviso "Pasta alterada.", `editFolderSchema` com o nome e o ambiente). A ação do menu continua `renameFolder`
  (`keyActionFor` e `menuFor`), e o navegador a leva ao modo `edit` (`folderActionTypes`). Pôr só o ambiente numa pasta que já existia é o
  `PATCH` com o nome e a pasta pai como estavam (`folderInputOf`; conferido sob Xvfb pelo `GET api/user/folders`).
- **O `PATCH` da pasta grava a pasta por inteiro**, o ambiente inclusive: o corpo de cada modo do diálogo sai do `folderInputOf` (o que o
  modo não perguntou vai como a pasta já tem, senão mover tiraria o ambiente dela). As recusas do ambiente da pasta são 422
  `FOLDER_NAME_INVALID` no campo (`environmentName`, `environmentColor`), que o diálogo já mostra no lugar.
- Em desenvolvimento o `StrictMode` roda o efeito do `Dialog` duas vezes e o foco cai no painel, não no campo com
  `autoFocus`; sem o `StrictMode` cai no campo (conferido em dev; o app empacotado não foi aberto).
- **`?connection=<id>`** (o "Editar conexão" do navegador de bancos): a página abre aquela conexão no formulário ao chegar,
  uma vez, quando a lista a tem (`requestedConnectionId`, em `_lib/edit-connection.ts`; é um ajuste durante a renderização,
  guardado em `openedFromRoute`), e ignora o valor que não é de uma conexão da lista. Escolher outra conexão depois não é
  desfeito pelo parâmetro. Quem monta o destino é `editConnectionTo(id)`. **Depois de usar o parâmetro a página o gasta**
  (`useSpendParam(connectionParam, listaChegou)`, em `lib/utils/route-params.ts`): ele sai da URL com `replace`, sem entrada nova no
  histórico, e o formulário segue aberto porque a escolha ficou no estado da página. Sem isso, remontar a tela com a URL suja (o bloqueio
  por inatividade remonta as telas de dentro do cofre; voltar e avançar no histórico) reabria o formulário. Antes de a lista chegar o
  parâmetro fica (não se sabe se o valor serve), e o valor ignorado também é gasto. Quem decide é `spendParam`, pura e testada (tira todas
  as ocorrências, deixa os outros parâmetros e não altera o objeto recebido). A tela de Drivers faz o mesmo com `?driver=`.

## Área de trabalho (`src/app/workbench`)

- **O estado fica dentro do guard do cofre e acima das telas de dentro.** Em `routes.tsx`, o `VaultGuard` é a rota de fora
  e o `WorkbenchProvider` (`_lib/workbench-state.tsx`) é uma rota sem caminho dentro dele, com Conexões, Drivers e Configurações
  como filhas. **A área de trabalho não é uma rota filha**: o `WorkbenchSlot` (`app/_components/workbench-slot.tsx`) a mantém MONTADA
  enquanto o cofre está aberto e a esconde (`hidden`) e a torna inerte (`inert`: fora do teclado e do leitor de tela, sem atalho) fora
  da rota dela; a rota `/workbench` existe, sem elemento. Ir de uma tela à outra não apaga as abas, os nós abertos da árvore, o que o
  editor guarda (cursor, seleção, desfazer, rolagem), a largura do navegador, a divisão do resultado nem o zoom do diagrama; uma
  consulta em andamento continua, e ao reaparecer o foco volta ao elemento que o tinha, se ele ainda existe (as linhas de uma lista virtual saem do
  DOM enquanto ela está escondida, e voltam outras: o foco que estava numa linha da árvore não é devolvido; a seleção, que é estado, fica). Sair do
  cofre (ou o cofre fechar por qualquer motivo) desmonta tudo, então nada passa ao usuário seguinte: o provedor aposenta os executores e apaga a
  memória das abas e os filtros pedidos que esperavam (`tab-memory.ts` e `filter-handoff.ts` são de módulo). **Escondida com `hidden`, toda caixa
  aqui dentro mede 0x0**: quem observa tamanho tem de tratar o zero como "sem medida" (ver "Lista virtual que MEDE as linhas", abaixo). **O provedor não pode subir para fora do guard**:
  ele consulta `api/user/connections`, e montado com o cofre fechado cada abertura do app receberia 401 `VAULT_LOCKED`
  antes do login e mostraria o aviso "Cofre fechado" (`routes.test.ts` confere a posição). Guarda `tabs` (`QueryTab`, em `workbench-model.ts`: `id`, `title`,
  `connectionId` (nulo só na aba de um script cuja conexão sumiu, ver "Scripts salvos"), `sessionId`, `sql`, na aba de uma tabela `table` (esquema, nome e a
  vista; `isTableTab` estreita o tipo para `TableTab`, que sempre tem a conexão) e, na aba de um script, `script`), `activeTabId`, os nós abertos
  (`expanded`, sem as pastas, que são só do navegador e começam abertas) e "Desconectar". `openQueryTab(connectionId, sql?)` abre
  uma consulta (com `sql`, o editor já nasce com esse texto e nada é executado); `openTableTab(connectionId, { schema, name, view? })`
  abre a aba de uma tabela, uma por tabela (de novo, volta à que existe), e `setTableView` troca a vista (ver "Aba de uma tabela e
  área de resultado recolhível"). `closeTab` cancela o que a aba estiver rodando e fecha a sessão dela (404
  `DATABASE_SESSION_NOT_FOUND` conta como fechada).
- **O que cada aba executa é um objeto fora do React** (`QueryRunner`, em `_lib/use-query-runner.ts`, criado com a aba,
  em `openQueryTab` ou `openTableTab`, e guardado pelo provedor; `runnerOf(tabId)`). É ele que tem a sessão da aba (aberta na primeira
  execução), o comando em andamento e o resultado, nos estados `idle`, `running`, `rows`, `affected`, `cancelled`, `error` e `notice`
  (o comando não foi enviado, e a área de resultado diz por quê). Por estar
  no provedor, um comando rodando e o resultado sobrevivem a trocar de aba e a ir a Conexões; por estar fora do estado do
  React, uma página nova de resultado não redesenha a área de trabalho, só quem o observa (`useQueryRunner`). A sessão é
  dele: `tab.sessionId` é só uma cópia (`onSession`), para a tela dizer que a conexão está conectada. Quem tira uma aba
  de cena (`closeTab`, "Desconectar", a poda da conexão excluída, sair do cofre) chama `release()` **antes** de fechar a
  sessão: sem isso, o comando que rodava receberia `DATABASE_SESSION_NOT_FOUND` e abriria outra sessão, que ficaria órfã.
- **As chamadas da aba passam pelo cache de mutações** (`throughMutationCache`, sem hook): a recusa que a aba não trata no
  lugar lança e chega ao aviso central, como em qualquer `mutationFn`. As que ela trata (`SQL_EXECUTION_FAILED`,
  `TRANSACTION_CONTROL_NOT_SUPPORTED`, `NO_OPEN_CURSOR`, `DATABASE_SESSION_NOT_FOUND`) voltam como valor por `allowRefusal`.
  **Um `MutationObserver` usado fora de hook tem de ser solto** (`observer.reset()` num `finally`): `mutate()` prende o
  observador à mutação, e presa ela nunca sai do cache, nem com `gcTime: 0`. Cada execução ficaria guardada com as linhas
  da resposta e o SQL até o cofre fechar. Há teste do cache vazio depois de cada tipo de chamada.
- **O resultado na tela só é substituído quando a API aceitou um comando novo.** Resultado é o que um comando aceito
  deixou: as linhas, as linhas afetadas ou o erro de SQL com que o banco respondeu (`resultOf`). Enquanto o comando novo
  roda ele continua na tela, esmaecido (o estado `running` o leva em `previous`, e a grade fica no mesmo lugar da árvore,
  com a rolagem). O que não deu resultado novo (seleção com mais de um comando, nada para enviar, `SESSION_BUSY`,
  controle de transação, falha ao abrir a sessão, API fora do ar, resposta inválida, 500) devolve a aba a ele e avisa por
  toast. Sem resultado na tela, a frase vai para a área de resultado; essa frase, a da API para o controle de transação e
  a mensagem da conexão que não abriu **não** são resultado, e a recusa seguinte ocupa o lugar delas. Só o
  `SQL_EXECUTION_FAILED` troca o resultado pelo erro: o banco executou o comando novo e fechou o cursor anterior.
- **O que a tela garante sobre o cursor das linhas mantidas.** Na seleção com mais de um comando e em "nada para enviar",
  nada saiu da tela: o cursor está como estava. Em `SESSION_BUSY` e no controle de transação a API recusou antes de
  executar. Em **500, falha de rede e resposta inválida a tela não sabe até onde o comando foi**: o cursor pode já ter
  sido fechado. As linhas ficam do mesmo jeito, e o "Carregar mais" seguinte mostra o aviso de cursor fechado, com
  "Executar de novo".
- **"Executar de novo" repete o comando das linhas que estão na tela**, e nunca outro: o comando viaja dentro do estado
  das linhas (`RowsState.target`). Não guarde "o último comando tentado" fora dele: um comando recusado, que deixa as
  linhas antigas na tela, passaria a ser o que o botão executa.
- **Rede de segurança** (`guarded`): em executar, carregar mais e contar, uma exceção que não é recusa da API devolve a
  aba ao que mostrava (`settle`) e avisa "Erro inesperado." uma vez, em vez de deixá-la em "Executando…". Ela confere o
  `epoch`: a exceção tardia de um comando cuja aba já foi solta não mexe no comando novo que estiver em voo.
- **Uma coisa por vez em cada aba.** Executar, "Carregar mais" e "Contar total" deixam a aba ocupada: "Executar" vira
  "Cancelar", que interrompe qualquer um dos três (RN-SQL-010), e os outros dois esperam. A contagem roda em conexão
  separada na API, mas o botão de cancelar é um só. O que terminou antes de o cancelamento chegar aparece como concluído.
  **O que terminou por causa do cancelamento** é "Comando cancelado." (estado `cancelled`, neutro, com aviso de atenção;
  RN-SQL-010), não o "Erro do banco … 57014". Quem decide é o **pedido do usuário** naquele comando (`cancelRequested`, que só
  vale se o pedido chegou à sessão), e nunca o SQLSTATE, que muda de banco para banco: o 57014 de um timeout do servidor,
  sem pedido do usuário, segue sendo erro. O estado `cancelled` é resultado, como o erro de SQL: uma recusa depois dele o deixa
  na tela. Em "Carregar mais" que termina em erro de execução, cancelado ou não, o cursor já está fechado na API: as linhas
  ficam, o botão "Carregar mais" some e a área oferece "Executar de novo" (`cursorClosed`), como no 409 `NO_OPEN_CURSOR`; o
  aviso é o de "Comando cancelado." ou o central da falha. Cancelar uma contagem só avisa, e o cursor e as linhas ficam.
- **Comando que grava e devolve linhas** (RN-SQL-013): a página traz `totalRows`. O resultado mostra as linhas recebidas e
  "200 de N linhas devolvidas · comando concluído", sem "Carregar mais" (não há cursor) e sem "Contar total".
- **"Contar total" só aparece quando há o que contar**: com linhas que a tela não leu (`hasMore`, com o cursor aberto ou
  já fechado). No resultado que veio inteiro, o total é o número do resumo, e a API não é chamada.
- **O texto de SQL vive no editor** (CodeMirror 6, `sql-editor.tsx`), e não no estado do React. O provedor o recebe por
  `updateTab(tabId, { sql })` 400 ms depois da última tecla, quando o editor perde o foco e quando é desmontado (sair do cofre; ir a
  outra tela não o desmonta): nunca a cada tecla, porque cada mudança no provedor redesenha o navegador e refaz a poda. `tab.sql` só
  é lido ao criar o editor; mudar a propriedade depois não altera o texto.
- **Os painéis das abas ficam todos montados** e só o da aba ativa aparece (`hidden`): trocar de aba não desfaz o editor
  da outra (desfazer, cursor e rolagem continuam). Ir a Conexões, a Drivers ou a Configurações também não: a área de trabalho
  inteira fica montada por baixo (`WorkbenchSlot`), e o texto, o resultado, o comando em andamento e o histórico de desfazer continuam.
  Só sair do cofre os desmonta; o bloqueio por inatividade mantém as abas e o texto, mas dá a cada aba um executor novo (ver "Bloqueio
  por inatividade").
- **"Executar"** envia a seleção ou, sem seleção, `statementAt(texto, cursor, banco)` (`sql-statements.ts`). Uma execução
  leva um comando só (RN-SQL-001): quem confere é o `run`, com `statementCount`, e a seleção com mais de um não é enviada
  (aviso de atenção; e o estado `notice`, quando não há linhas na tela). Trecho só com comentários não é comando. O botão
  pergunta "há o que enviar?" a cada tecla com `hasStatement`, que para no primeiro caractere de comando: não separe os
  comandos a cada tecla. Ctrl+Enter é registrado com `Prec.highest`, porque o mapa padrão do CodeMirror usa a mesma tecla
  para abrir uma linha.
- **O separador conhece o banco da aba** (RN-SQL-002): o editor manda o banco junto do texto (`RunTarget.engine`). No
  PostgreSQL o comentário de bloco aceita outro dentro dele e existe o bloco `$tag$`; no Db2 e no Informix o primeiro `*/`
  fecha o comentário e `$` é um caractere qualquer; no Informix `{ ... }` também é comentário. Sem o banco, vale o
  PostgreSQL.
- **A posição do erro vale para o texto que foi enviado, e é em caracteres.** O PostgreSQL conta caracteres (de 1 em diante) e
  o editor conta unidades UTF-16: cada emoji antes do erro valeria dois para o editor e um para o banco, e a marca cairia um
  caractere antes por emoji. `utf16IndexOf` (`sql-statements.ts`, com teste) converte; acento comum não precisa. O editor avisa cada alteração (`onEdited`, sem atraso): a marca
  que estiver na tela some (também a do erro que ficou na tela enquanto outro comando roda), e o erro de um comando que
  ainda roda chega sem posição (`textEdited`).
- **A grade do resultado** (`result-grid.tsx`) é virtualizada nas duas direções, com linhas de altura fixa e larguras de
  coluna calculadas uma vez, da primeira página, contando caracteres (a fonte é de largura fixa). Não meça célula no DOM
  nem recalcule largura ao carregar mais: é isso que deixa "Carregar mais 200" sem redesenhar o que está na tela. A grade
  recebe `key` por execução (`state.id`), não por página. **No cabeçalho, quem cede espaço é o tipo, e o nome da coluna não cede nada**
  (`GridHeaderCell`): a largura é calculada sem a seta da ordem, e quando a seta aparece alguém cede os 18 px dela; era o nome, e o `id`
  ordenado virava `integer ▲`. O nome é `shrink-0` (não encolhe) e o tipo, `min-w-0 truncate`, absorve o que falta INTEIRO, até sumir; os dois
  moram numa caixa (`flex min-w-0 overflow-hidden`) que encolhe com a célula e fica ao lado da seta, e o `max-w-full` do nome só o corta (com
  reticências, sem vazar para a coluna ao lado) quando nem ele sozinho cabe. **Não troque isso por um peso de encolhimento** (`shrink-[999]`
  no tipo foi a primeira correção): com qualquer razão numérica o nome ainda perde centésimos de pixel, e com 1/64 de pixel a menos o Chromium
  já desenha a reticência (`cliente_id` virava `cliente_…` em 12 de 28 cabeçalhos ordenados). O vitest não tem layout: o teste confere a regra
  (as classes e a seta fora da caixa), e a medida é na tela, **com fração de pixel**: a largura real do nome (`getBoundingClientRect`) contra a
  do mesmo texto sem corte (um gêmeo fora do fluxo, `width: max-content`). `scrollWidth` contra `clientWidth` não serve: são inteiros, e deram
  28 de 28 com o defeito na tela. O
  tempo do comando (`formatElapsed`, em `lib/utils/format.ts`) sai em `ms` abaixo de um segundo, em segundos com um décimo até um minuto
  (`1,3 s`), em minutos e segundos até uma hora (`1 min 10 s`) e em horas e minutos daí em diante (`2 h 5 min`); a unidade é a do valor já
  arredondado, e o que não é um tempo (não finito, ou negativo) sai como um traço.
- **"Conectada" tem uma definição só**, `isConnected` (`workbench-model.ts`): a árvore abriu a sessão da conexão, ou
  alguma aba tem a sua. Vale para o ponto e o "Desconectar" do navegador e para a barra de status.
- **Aba à vista (RN-SEG-001): só ela fala com o banco.** `visible` é "a aba é a ativa E a área de trabalho é a tela mostrada"
  (`selected && useWorkbenchOnScreen()`, em `workbench-tabs.tsx`; o `useWorkbenchOnScreen` usa a regra do `WorkbenchSlot`: a rota é
  `/workbench`). Chega ao `TableTabPanel` e dali à vista Registros (`needsFirstRun(estado, { engine, visible, disconnected })`: a primeira
  carga só com a aba à vista, o executor `idle`, o banco conhecido e a conexão não desconectada pela pessoa) e às consultas da Estrutura,
  do Diagrama e das chaves estrangeiras (o `enabled` delas). Sem `visible` nada é pedido, nem a primeira carga nem o catálogo. É o que
  deixa o desbloqueio leve: cada aba ganha um executor novo, e dez abas abertas não são dez sessões e dez consultas de uma vez. A que está à
  vista recarrega sozinha, e as escondidas esperam ser abertas.
- **Nada reconecta sozinho (RN-SESSAO-004).** "Desconectar" é uma decisão da pessoa, e nada na tela a desfaz. `createDisconnectLog`
  (`_lib/connection-intent.ts`) observa o cache e registra a conexão cuja consulta `["database-session", id]` foi REMOVIDA (o "Desconectar"
  a remove), menos com o cofre bloqueado (o bloqueio também a remove, e o desbloqueio restaura tudo); a conexão sai do registro quando uma
  sessão volta a ter dado, e o `WorkbenchTabs` a esquece (`forget`) quando uma aba dela tem sessão. As vistas das tabelas dessa conexão não
  abrem sessão por conta própria: a Estrutura e o Diagrama mostram "A conexão está desconectada." com "Conectar" (`DisconnectedView`, que
  abre a sessão da árvore por `connectTree`), e os Registros esperam o "Atualizar", que conecta e carrega (abre a sessão da aba). As
  consultas do catálogo (`columnsQuery`, `indexesQuery`, `foreignKeysQuery` e `treeQuery`) têm o parâmetro `enabled` por isso. O foco que
  estava no "Conectar", que sai de cena, vai ao painel da aba, e quem decide é o estado (`disconnected` voltou a falso), e não um aviso do
  botão: quem reconecta pelo nó da conexão no navegador tem o foco onde o pôs.
- **As abas mudam de lugar e de janela**: ver "Abas que se movem e outras janelas", logo abaixo desta seção.
- **A faixa de abas** (`_components/tab-strip.tsx`; `_lib/tab-strip.ts` tem tudo o que ela decide sem tocar a página, em funções puras e
  testadas): uma linha só, que rola na horizontal. `overflowOf` acende os botões das pontas (uma faixa sem largura, a área de trabalho
  escondida, não tem o que rolar), `revealOffset` traz a aba ativa à vista com folga, `wheelScroll` faz a roda vertical rolar, `stripKeyTarget`
  dá as setas (com a volta), Home e End, e um botão no fim abre a lista de todas as abas. O menu de botão direito (`tabMenu`: Fechar; Fechar
  as outras, as da direita e todas, com o que não se aplica apagado) é o `ContextMenu` do navegador, com a mesma guarda de
  `ignoresContextMenu`; Shift+F10 e a tecla de menu o abrem, e o botão do meio fecha a aba. Ctrl+W (Cmd+W) fecha a ativa com o foco na área
  das abas (`isCloseShortcut`, tratado em `WorkbenchTabs`): o app empacotado não tem menu no Windows e no Linux, então nada mais responde a
  esse atalho. **Fechar várias abas usa uma fila** (`tabsToClose` e o `pendingClose` do `WorkbenchTabs`): `closeTab` parte da lista que viu
  quando foi criado, então várias chamadas no mesmo instante valeriam só a última; a primeira fecha agora, e cada mudança de `tabs` fecha a
  seguinte, cada uma pelo caminho de sempre (cancela o que roda e fecha a sessão). Um `closeTabs(ids)` no provedor trocaria a fila.
- **A árvore é plana e virtualizada** (`@tanstack/react-virtual`): `flattenVisible` (`_lib/navigator-model.ts`, testado)
  achata nós abertos em linhas, e só as que se veem existem no DOM. Como uma linha fora da janela não existe, ela não pode
  buscar nada: **quem busca é o `Navigator`, num `useQueries` só, a partir das chaves dos nós abertos**. A busca por nome não
  passa por aí: ela só lê o que já está em cache (ver "Navegador: clique, menu e busca").
- **Lista virtual que MEDE as linhas passa `measureElement: measureRendered`** (`_lib/row-measure.ts`; hoje só a árvore mede, porque a linha
  de erro é mais alta que as outras). A área de trabalho fica escondida por baixo das outras telas com `hidden`, que é `display: none`, e o
  painel da aba inativa também: enquanto dura, TODA caixa lá dentro mede 0x0 e o `ResizeObserver` avisa isso. A biblioteca guardava o ZERO
  como a altura de cada linha desenhada; ao reaparecer, cada linha "crescia" de 0 para 30 px, e ela, achando que uma linha acima da janela
  tinha crescido, somava 30 à rolagem que guarda e pedia ao DOM para rolar. Numa lista que cabe na janela o Chromium não rola nem emite
  `scroll`, então nada corrigia a conta: com 17 linhas a rolagem guardada ia a 510 com o `scrollTop` em 0, a faixa visível virava a do FIM
  da lista e ficavam desenhadas só as últimas `overscan + 1` linhas (as primeiras linhas do navegador sumiam ao voltar de Configurações,
  Conexões ou Drivers: o E2 do fechamento da Tarefa 26). `measureRendered` mede como a biblioteca, menos nisto: **zero não é altura de linha,
  é a linha sem caixa**, e ela fica com a medida que tinha (a guardada ou a estimada), no aviso do observador e na medida síncrona do `ref`.
  O `row-measure.test.ts` reproduz a sequência com o `Virtualizer` de verdade e **reprova qualquer componente que use
  `ref={….measureElement}` sem passar `measureElement: measureRendered`**. A grade do resultado não mede as linhas (altura e largura são só a
  estimativa), então não tem o defeito: se um dia passar a medir, a regra é a mesma. Não troque isso por `useCachedMeasurements` (para de
  medir todas as linhas, e a de erro é mais alta) nem por `enabled: visível` (zera a rolagem guardada e manda o DOM ao topo ao religar). O
  contêiner sem altura só deixa de desenhar linhas (a faixa fica nula) e volta a desenhar ao reaparecer; o Chromium devolve o `scrollTop` e o
  `scrollLeft` do elemento que deixou de ter caixa, e a rolagem que o virtualizador guarda não foi tocada, então as duas coincidem.
  **Sintoma para reconhecer de novo**: o DOM no topo, as primeiras linhas faltando, exatamente `overscan + 1` linhas desenhadas, e um evento
  de rolagem de verdade "consertando". Para olhar dentro: o virtualizador é o estado de um gancho do componente da lista (pela fibra do React,
  `__reactFiber$…` do contêiner, subindo até a função e andando por `memoizedState`); `scrollOffset`, `range` e `itemSizeCache` dizem tudo.
- **TODO virtualizador observa a rolagem por `observeElementOffset: observeRenderedOffset`** (o vizinho do `measureRendered`, em
  `_lib/row-measure.ts`; hoje são três: a árvore e as duas direções da grade). É o mesmo princípio: **escondido por `display: none`, o que se lê
  do contêiner não é dado**. A biblioteca relê a rolagem 150 ms depois do último evento (é como ela sabe que a rolagem acabou); quem rola e, antes
  disso, vai a outra tela ou troca de aba esconde a lista com a releitura ainda por vir, e ela lê `scrollTop` 0 e guarda 0 (o mesmo com um evento
  de rolagem que só é entregue com a lista já escondida). Ao voltar, o Chromium devolve o `scrollTop` de antes SEM evento, e a lista desenha as
  linhas do topo com o DOM lá embaixo: **fica em branco até um giro da roda**. `observeRenderedOffset` embrulha a observação da biblioteca e, com
  o contêiner sem caixa (`clientHeight` e `clientWidth` zero), repassa o aviso (a rolagem acabou) com a posição que a lista já tinha, em vez da
  lida. Recolhido (altura zero, mas com largura: a área de resultado fechada) o contêiner tem caixa, e a leitura vale. O `row-measure.test.ts`
  reproduz a sequência com o `Virtualizer` de verdade e a observação de verdade da biblioteca, e **reprova qualquer `useVirtualizer(…)` de
  `src/` que não passe a opção**. Na tela, o roteiro precisa esconder a lista a MENOS de 150 ms do último evento de rolagem (role e clique na
  mesma avaliação da página, ou um giro da roda pelo protocolo com o clique logo atrás): com meio segundo de espera entre os dois o defeito
  não aparece, e foi por isso que a conferência do E2 não o viu.
- **A chave de um nó é o caminho dele em JSON** (`navKey`, `NavPath`): nome de esquema ou de tabela pode ter barra, aspas e
  espaço, e qualquer separador faria dois caminhos colidirem. Da chave sai o que buscar (`parseNavKey`), sem procurar o nó.
  As linhas de folha (coluna, índice, chave estrangeira, rotina, visão) usam o caminho do pai mais a posição, porque
  sobrecarga de rotina repete o nome. `NavNode` tem, além do que o brief lista, `badge` (`PK`, `único`), `retryKey` (só na
  linha de erro) e o tipo `loading` (a linha "Carregando…").
- **A sessão da árvore é um `POST`**, então a consulta dela (`databaseSessionQuery`, chave `["database-session", id]`) nunca
  é invalidada nem refeita enquanto tem dado: refazer abriria uma segunda sessão e deixaria a primeira órfã na API. Ela tem
  `gcTime: Infinity` (sair da área de trabalho não a descarta) e só "Desconectar" a remove. "Atualizar" invalida por
  prefixo as consultas `["tree", conexão, …]` (`treePrefixes`), nunca a sessão; "Tentar de novo" é um `refetch` do nível que
  falhou. Os níveis da árvore têm `staleTime` e `gcTime` infinitos e não se refazem ao voltar o foco nem ao montar de novo:
  ficam até o "Atualizar" daquele nó (RN-ARVORE-002).
- **Os bancos do servidor** (RN-ARVORE-006): o nível da conexão é a lista que `GET .../databases` devolve pela sessão da conexão
  (`["tree", conexão, "databases"]`, `databaseNodes`), com o banco da conexão primeiro, marcado com o `badge` "padrão" (o mesmo
  estilo do `PK`). O banco da conexão guarda as chaves de antes (`{ type: "database", connectionId }`, `["tree", conexão, "schemas"]`,
  `["database-session", conexão]`) e abre junto com a conexão; outro banco leva o nome no caminho (`database`) e, nas chaves de
  consulta, uma marca `{ database }` logo depois da conexão (`databaseMark`), que nome de esquema (texto) não imita. Abrir outro
  banco abre a sessão dele (`databaseSessionQuery(conexão, banco)`, o `POST` com `database`), e o que está abaixo dele usa essa
  sessão; a aba aberta a partir dele guarda o banco (`QueryTab.database`): a sessão da aba, a Estrutura, o Diagrama, a passagem do
  filtro e o completar do editor são desse banco. `navKey` escreve o caminho sempre na mesma ordem de campos. "Desconectar" fecha
  as sessões da árvore de todos os bancos (`treeSessionIds`) e as das abas, e remove o prefixo `["database-session", conexão]`;
  "Atualizar" na conexão traz a lista de novo, e num banco, só o que é dele. A aba de consulta troca de banco pela barra do editor: ver
  "Trocar o banco da aba de consulta", abaixo.
- **Falha de nível**: linha de erro no nó (a mensagem do banco, `detail`, senão o `title`) com "Tentar de novo", mais o
  aviso central. "Desconectar" recolhe e esquece antes de remover as consultas: com o nó ainda aberto a consulta removida
  seria refeita e abriria outra sessão.
- **Conexão que some da lista** (excluída em Conexões ou de outro jeito): a API já encerrou as sessões dela (RN-CONN-014), e
  o provedor, que olha `connectionsQuery`, poda a área de trabalho (`pruneWorkbench`, pura e testada): tira as abas dela
  (a ativa passa para a vizinha, `nextActiveTab`) e os nós abertos, durante a renderização, de modo que nenhum filho vê o
  estado velho; e um efeito esquece o cache de dados de banco dela (`forgetMissingConnections`, em `workbench-model.ts`, sobre
  `connectionOwnedFamilies`: `["database-session", id]`, `["tree", id, …]` e `["table-structure", id, …]`, com o id na posição 1 das três).
  Com a lista ainda sem chegar (`null`) nada se poda: "lista vazia" é outra coisa.
- **Sessão da árvore que caiu**: quando um nível responde `DATABASE_SESSION_NOT_FOUND` (`isSessionLost`), "Tentar de novo" e
  "Atualizar" não repetem com o id morto: `reopenDatabaseSession` volta ao início a consulta da sessão e as dos níveis
  (`resetQueries`, as duas na mesma chamada para os níveis esperarem a sessão nova) e a tela avisa em atenção (RN-AVISO-003).
  "Desconectar" também serve: o `DELETE` 404 conta como fechado.
- **Resposta da sessão**: `databaseSessionSchema` exige só o `id` e o `database`; o resto (`connectionID`, `engine`,
  `serverVersion`) é tolerado em qualquer formato. A sessão já está aberta na API quando a resposta chega, e recusá-la por
  um campo que a árvore não usa a deixaria órfã, com outra aberta a cada "Tentar de novo".
- **Teclado**: uma linha só entra no Tab (`tabbableKey`): a selecionada, se está entre as desenhadas, senão a primeira
  desenhada (a selecionada pode ter rolado para fora da janela virtual, e sem isso o Tab pularia a árvore). A linha de
  erro recebe foco (`isFocusable`) e o "Tentar de novo" está sempre na ordem do Tab e entra nas setas (`data-row-toggle`).
- **Nome antes do detalhe**: o detalhe de uma linha (tipo, colunas, contagem) ocupa só o que sobra, encolhe primeiro e some
  antes de o nome ser cortado; a linha tem `title` com os dois por inteiro.
- **Ações da linha**: as de uso mais comum (Nova consulta, Atualizar, Desconectar) são botões de ícone que aparecem com o
  mouse ou o foco na linha, como as da árvore de Conexões, e o **menu de contexto** traz as do tipo de linha (menos o "Atualizar"
  da tabela, que a especificação não põe no menu dela): ver "Navegador: clique, menu e busca". Teclado: setas movem, direita
  abre, esquerda fecha, Enter abre a aba da tabela ou da visão, Shift+F10 e a tecla de menu abrem o menu; só uma linha entra
  no Tab. A largura do navegador é ajustável (arrastar a divisória ou setas nela, de 200 a 640 px; 320 px de saída, para os nomes de
  coluna caberem inteiros).
- **O que o canvas tem e a fatia não**: ocultar o navegador, "Atualizar navegador" e o "+" de nova conexão no título dele, o botão "+" de aba;
  na barra do editor, "Explicar plano", "Formatar", a troca da conexão da aba e a transação (a barra tem Executar e Cancelar,
  seção 9 da especificação, e o banco da aba, RN-ARVORE-007); na área de resultado, "Mensagens" e "Plano de execução" (o "Exportar CSV" só existe
  nos Registros de uma tabela, RN-TABELA-006). A edição de célula já existe nas duas grades: ver "Edição das células", abaixo.
  O canvas pinta em rosa a função do banco (`now`); a gramática do `lang-sql` não a distingue de um nome.
- **Conferir na tela sem a API ter as rotas**: o `pnpm dev --remoteDebuggingPort 9222` sobe a API de verdade só para a
  ponte responder; a tela é levada ao `#/workbench` depois de trocar `window.fetch` por um que responde `api/…` com dados
  simulados (avaliar o script na página já carregada: `Page.addScriptToEvaluateOnNewDocument` vale só enquanto a sessão
  de depuração que o registrou está aberta).
- **Conferir sem disputar a árvore com outras frentes**: o servidor do Vite (e o `pnpm dev`) observa os arquivos e, como não há
  Fast Refresh, recarrega a página a cada salvamento de quem trabalha ao lado: no meio de um roteiro a tela fica branca e o
  estado se perde. Para conferir sem janela, suba um Vite seu com `server.watch: null` e `hmr: false`, com a configuração FORA do
  repositório (alias `@` para `src`, o plugin do Tailwind, porta e perfil do Chrome próprios), ou construa uma cópia com
  `electron-vite build --outDir <pasta da sessão>` e sirva-a (o `out/` da árvore é de todos). Nos dois, injete `window.prism` e troque
  `window.fetch` antes do app (`Page.addScriptToEvaluateOnNewDocument`), e encerre só os processos que você iniciou, pelo PID.
  Mudar só o hash da URL não recarrega a página: use uma consulta nova. `Enter` pelo protocolo de depuração só aciona botão e
  formulário com `text: "\r"`.
- **Medir quadros pela porta de depuração**: com a janela do Electron minimizada, o Chromium para o
  `requestAnimationFrame` (`document.visibilityState` vira `hidden`); coberta por outra janela, cai para um quadro por
  segundo. Toda medida de quadro fica errada, e quem está usando o computador minimiza a janela que apareceu. Para conferir
  e medir sem janela nenhuma: `pnpm build`, servir `out/renderer` num servidor estático local e abrir num Chrome com
  `--headless=new --remote-debugging-port=<porta>`; o script injetado simula também a ponte (`window.prism`), que fora do
  Electron não existe. É outro Chromium, então a medida que vale para o produto é a do Electron com a janela à vista.
  `Input.insertText` com um texto grande não é colar: use um evento `paste` com `DataTransfer`.
- **Mais cuidados ao conferir sem janela** (da segunda leva das abas, das Configurações e do bloqueio): (1) para provar que uma vista NÃO
  falou com a API (aba escondida, conexão desconectada), conte os pedidos antes e depois da ação (`Network.enable`, ou um registro no `fetch`
  trocado) em vez de olhar a tela: ela mostra o que está desenhado, e não o que foi pedido; (2) para ter um comando que fica em andamento
  (cancelar, o bloqueio que não conta com comando rodando), segure um `LOCK TABLE` numa transação aberta em outro `psql` e execute a
  consulta nessa tabela; fechar o `psql` solta o comando; (3) baixar o CSV: `Browser.setDownloadBehavior` mostra que o download começou, mas o
  diálogo de salvar do sistema não se conclui sem janela, e o conteúdo se confere trocando `URL.createObjectURL` antes do clique, para guardar
  o `Blob` e ler os bytes; (4) com a área de trabalho montada por baixo de outra tela, `document.querySelector("h1")` acha primeiro o `h1`
  DELA: procure o título dentro do `main` da tela, ou pelo texto; (5) o `waitFor` do roteiro devolve booleano (`!!document.querySelector(...)`):
  devolver o elemento não serve (por valor ele não chega ao roteiro, que vê `undefined` ou o erro "Object reference chain is too long"), e a
  espera só acaba no tempo-limite, com a página certa na frente; (6) em
  desenvolvimento o `StrictMode` chama um `ref` em função duas vezes ao montar (anexa, solta, anexa), então o que o `ref` faz (a rolagem da linha
  destacada de Drivers) acontece duas vezes na chegada, e uma só no app construído: compare com a contagem da chegada, e não com 1; (7) para
  provar `replace` (e não `push`) numa navegação, `history.back()` tem de voltar à tela de antes, e `history.forward()` remonta a tela com a
  URL que ficou; com `push` o voltar cai na URL com o parâmetro e o formulário reabre. Troque `replace` por `push` de propósito e veja a
  conferência reprovar: é a prova de que ela enxerga o defeito.
- **E mais estes** (do fechamento da Tarefa 26): (1) **toda ida e volta entre telas entra no roteiro**: o que só quebra depois de a área de
  trabalho ficar escondida (o E2) passa em qualquer roteiro que nunca sai dela; confira o que está POR BAIXO pelo DOM (as linhas que deviam
  estar à vista estão desenhadas? o `scrollTop` é o de antes? a seleção ficou?), e não só pela captura; (2) o bloqueio por inatividade fecha o
  cofre aos 10 minutos sem tecla nem ponteiro DE VERDADE, e um roteiro longo, ou uma pausa entre dois roteiros, acaba na tela de bloqueio (e um
  `Page.reload` depois disso cai no login): desligue-o para o usuário de teste (`security.lockEnabled` na chave `prism:preferences:<usuário>`
  do `localStorage`, e recarregue), a não ser que o roteiro seja o do bloqueio; (3) "Desconectar" recolhe a conexão na árvore: o roteiro que
  segue tem de abri-la de novo; (4) para a API "congelada" do lado da tela, troque `window.fetch` por um que só rejeita quando o `signal` do
  pedido cancela (o prazo é do cliente, e é ele que se confere); (5) para uma aba OCUPADA de verdade, segure um `LOCK TABLE … IN ACCESS
  EXCLUSIVE MODE` com um `pg_sleep` na mesma transação, numa sessão do `psql` que termina sozinha, e clique em "Atualizar" naquela tabela.

## Abas que se movem e outras janelas (RN-ABAS-001 a 005)

Seção 23 da especificação. **Só o processo principal cria janela e passa aba de uma para outra**; a tela pede pela ponte (`window.prism.windows`) e
nenhuma janela fala com outra. Tudo o que passa tem o schema de `electron/window-messages.ts`, conferido **nos dois lados**: o centro das janelas
(`window-hub.ts`) confere o que a tela manda antes de repassar, e a tela confere o que chega (`lib/api/bridge.ts`: `listOtherWindows`, `sendTabAway`,
`onTabArrived`, `onTabWanted`, `onPeerEvent`; a aba em si ainda por `readTransfer`). As enumerações desse schema repetem as da tela (ele não importa
nada de `src/`), e quem as mantém juntas é o TypeScript: `readTransfer` devolve os tipos da tela, e uma que divergir não compila.

- **A ordem** (`_lib/tab-order.ts`, puro e testado): `moveTab(tabs, id, insertAt)` com a posição de ANTES de a aba sair do lugar (a marca de
  soltar), `shiftTab` (Ctrl+Shift+PageUp e PageDown na aba ativa, sem dar a volta, `tabMoveShortcut`, tratado em `WorkbenchTabs` como o Ctrl+W),
  `dropIndex` (pela metade de cada aba) e `isOutsideWindow`. O provedor tem `reorderTab` e `shiftTab`. A ordem vale na próxima entrada (RN-ABAS-006, ver
  "Abas que voltam na próxima entrada").
- **O arrasto é o do HTML** (`draggable` na moldura de cada aba, `data-tab-id`), com o tipo `application/x-prism-tab` e o dado `{ windowId, tabId }`
  (`writeTabDrag`/`readTabDrag`, conferido: qualquer programa pode soltar algo na faixa). A faixa aceita só esse tipo, mostra a marca de soltar
  (`data-drop` `before`/`after`, uma sombra interna da cor de destaque) e, solta, ou muda de lugar (veio desta janela) ou pede a aba à janela de
  origem (`prism:windows-request-tab`; o centro manda `prism:windows-give-tab` a ela, e ela a leva pelo caminho de sempre, na posição pedida).
  A janela sem abas não tem faixa: o lugar vazio dela recebe a aba solta. O fim do arrasto (`dragend`) com `dropEffect` `none` e o ponto fora da
  janela leva a aba a uma janela nova ali. **Entre janelas o Chromium às vezes diz `none` mesmo quando a outra aceitou**: por isso o centro
  recusa a janela nova quando o ponto está em cima de outra janela do Prism (`overWindow`, sem aviso), e quem leva a aba é o pedido da faixa de
  lá. Solta fora da faixa de outra janela, a aba fica onde estava.
- **O menu da aba** ganhou o grupo `moveMenu`: "Mover para nova janela" e "Mover para a janela…" (apagado sem outra janela; abre, no mesmo
  ponto, a lista das outras, pedida ao centro ao abrir o menu, com o número e o resumo que cada uma dá de si, `prism:windows-describe`). Fora do
  Electron o grupo não aparece.
- **O que passa** (`_lib/tab-transfer.ts`, puro e testado): `serializeTab` monta a aba com o texto e a seleção do editor DESTE instante
  (`liveEditors`, `_lib/live-editors.ts`: cada editor se registra pelo id da aba; o `tab.sql` chega com 400 ms de atraso), a sessão do executor
  (`sessionOf`, e não a cópia da aba), o resultado parado (o mapa das células cortadas vira pares) e o que a tela lembrava
  (`recallForTransfer`: divisão, diagrama, filtro dos Registros, seção da Estrutura, larguras; **não** as alterações não salvas). A aba leva o banco em que
  roda (`database`, o de agora, depois de uma troca pela barra do editor). A aba de um script leva o id, o nome, o SQL salvo e o banco em que foi salvo
  (`savedDatabase`; o ponto é refeito na janela que recebe, pelo texto que chegou e pelo banco da aba), e a aba sem conexão passa sem conexão (`connectionId` nulo no schema). Com comando em
  andamento (executar, carregar mais, contar) não passa: a tela avisa `moveBusy`. `readTransfer` confere e devolve a aba, a seleção (cortada no
  fim do texto), o estado e a memória.
- **A janela de origem** só tira a aba depois do `ok` do centro, por `detachTab`: o executor sai de cena (`retire`) e a sessão **não** fecha (é a
  mesma API, e a sessão agora é da outra janela). A aba dos Registros com alterações não salvas pergunta antes, com o `UnsavedEditsDialog` e os
  textos de `records.copy.ts`: "Descartar" leva a aba sem elas (ficam na memória desta janela, que a aba deixa), "Salvar" grava e leva a aba sem
  as linhas de antes (o salvar não relê, e as linhas na tela seriam as velhas): a janela que recebe lê os registros na mesma sessão.
- **A janela que recebe** (`adoptTab`, no provedor): a memória vai antes (os painéis a leem ao montar), a seleção vai ao slot `selection` da
  memória (o editor nasce com ela, `initialSelection`, e a rola à vista), e o executor nasce com o estado e a sessão (`createQueryRunner({ initial })`:
  a chave da grade continua do resultado que veio, e "Carregar mais" continua no cursor da sessão). Nada é executado. O número da próxima
  consulta não repete o da aba que chegou. O provedor diz ao centro quando está pronto (`setReady`, ao montar e ao desmontar): o centro guarda a
  aba até lá (a janela nova ainda está abrindo o cofre), e a que fecha antes de recebê-la a devolve à de origem.
- **Fechar a janela** (`WorkbenchTabs`): o aviso do processo principal começa o "Fechar todas" da janela, com as perguntas dele (na última janela, só a da grade, RN-ABAS-007); cancelar uma
  pergunta deixa a janela aberta; quando a última aba fechou, `releaseWindow` espera os fechamentos de sessão a caminho e fecha as sessões da
  árvore DESTA janela, e só então a janela fecha. Com o cofre bloqueado fecha direto (a API já fechou as sessões).
- **O cofre é um só** (RN-ABAS-004). O que uma janela conta às outras (`prism:session-share`, `peerEventSchema`: `activity`, `lock`, `unlock`,
  `signOut`, `signIn`, só o tipo) o centro repassa a todas as outras, também às que estão no login, e cada uma decide com `peerAction`
  (`app/_lib/peer-session.ts`, puro e testado). A atividade vai no máximo uma vez por segundo (`shouldShareActivity`), e a cada conferência
  enquanto há comando em andamento (`useIdleLock`, opção `peers`): a contagem de cada janela recomeça com a atividade de qualquer uma, e o
  comando parado numa segura as outras. A janela que bloqueia conta; as outras bloqueiam **sem pedir o fechamento do cofre** (um pedido
  repetido depois do desbloqueio fecharia o cofre recém-aberto: `closedByAnotherWindow`, em `vault-lock.tsx`). Desbloquear numa conta, e as
  outras soltam a barreira. "Sair" (barra superior e tela de bloqueio) conta, e as outras vão ao login e limpam o cache (`PeerSession`, em
  `app/_components/peer-session.tsx`, montado no `app.tsx` acima das rotas, com o roteador por propriedade). O login (e o criar usuário) conta:
  a janela no login entra; a que está num cofre confere se é o mesmo usuário (`getSession`) e sai se não for. As preferências mudam em todas
  pelo evento `storage` (`preferencesStore.refresh`).
- **Como conferir sob o Xvfb** (o app de verdade, sem gerenciador de janelas): o `xdotool` (instalado por `apt-get`) faz o arrasto com
  `mousedown`, vários `mousemove` com pausa e `mouseup`, e põe as janelas lado a lado (`windowsize`/`windowmove`; a largura mínima é 1024, e
  numa tela de 1920 elas se sobrepõem um pouco). Um movimento rápido demais às vezes não chega à outra janela: espace os `mousemove` (0,1 a 0,15 s).
  Fechar "pelo X" é mandar `WM_DELETE_WINDOW` à janela (um `ClientMessage` por `libX11` com `ctypes`): o `xdotool windowclose` desta versão
  destrói a janela sem passar pelo `close`, e o `window.close()` da página também não passa por ele. O `location.reload()` da página é cancelado
  pelo `will-navigate`; o `Page.reload` do protocolo de depuração passa. A janela nova é outro alvo em `/json/list`: ache-o por
  `window.prism.windows.id`. Para provar que nada foi executado de novo, conte as linhas `ExecuteAsync` do log da API (`<dados>/logs/`); o
  "Carregar mais" aparece como `FetchNextAsync` na MESMA sessão.

## Abas que voltam na próxima entrada (RN-ABAS-006)

Seção 24 da especificação (issue 2 do repositório público). As abas de TODAS as janelas vão para o cofre do usuário pela API (`PUT api/user/workspace`, ver o
guia da API) e voltam na janela principal na próxima entrada. **Nada vai ao `localStorage`**, e nenhuma janela fala com outra (RN-ABAS-005): cada uma conta as
suas abas ao processo principal, que junta as de todas e grava.

- **O que vai e o que volta** (`_lib/saved-workspace.ts`, puro e testado). Vai, de cada aba de consulta, o texto do editor DESTE instante (`liveEditors`), a
  conexão, o banco, o script de onde veio e a marca de mudança não salva (`isScriptDirty`, pelo texto); de cada aba de tabela, a conexão, o banco, o esquema,
  a tabela e a vista; e a ordem e a ativa. O título não vai (a consulta volta com o número seguinte da janela, o script com o nome que tem hoje), nem a sessão,
  o resultado, o cursor e as alterações não salvas da grade. O texto acima de 1 MB em bytes de UTF-8 não vai: a aba vai vazia com `sqlTooLarge`, e volta vazia
  com o aviso (`restoredEmpty`). Volta (`restoreWorkspace`): ids novos, sem sessão, a aba de um script ligada a ele (o SQL salvo dele é lido pela rota do item
  só para a aba que tinha mudança não salva, para o ponto se apagar ao desfazer até o texto salvo), a de um script excluído como consulta comum, a de consulta
  cuja conexão foi excluída sem conexão (`NoConnectionBarView` com `forScript` falso: "A conexão desta aba não existe mais"; aviso `restoredWithoutConnection`),
  e a de tabela cuja conexão foi excluída **não volta**, e a entrada avisa (a regra, RN-ABAS-006: a aba de uma tabela sempre tem a conexão dela; aviso
  `restoredTablesDropped`). A ativa que não voltou
  passa à vizinha. O schema é um só, `electron/workspace-messages.ts`, com os nomes da API (`connectionID`, `scriptID`), conferido no processo principal (o
  relato de cada janela) e na tela (a resposta do `GET`, `workspace.service.ts`: a aba que não confere fica de fora, sem derrubar as outras).
- **Nada conecta nem executa sozinho.** As abas voltam sem sessão; as conexões das abas de tabela que voltaram são marcadas como desconectadas
  (`DisconnectLog.mark`, pelo `restoredTableConnections` do provedor), e as vistas delas esperam o clique, como as de uma conexão que a pessoa desconectou. A
  árvore não abre nada (os nós abertos não são gravados).
- **Quem reabre** (`WorkbenchProvider`): ao montar, a área de trabalho pergunta ao processo principal se reabre (`claimWorkspaceRestore`, canal
  `prism:workspace-claim`: só a janela principal, a primeira das vivas, e uma vez por entrada; a que recarrega com outra janela aberta não reabre, porque as abas
  estão nas janelas). A principal lê (`getWorkspace`), as conexões e os scripts, e só DEPOIS começa a contar as suas; uma falha em qualquer leitura não reabre
  nada e não conta nada nesta entrada (gravar sem ter reaberto apagaria o que não voltou). As outras janelas contam desde já.
- **Quem conta** (`_lib/workspace-reporter.ts`, com o relógio injetado): a fonte (`createWorkspaceSource`, criada por `useState` como os executores, e não
  por `useRef`, que o lint do React não deixa passar a uma função durante a renderização) recebe as abas a cada renderização; o relato as lê 1 s depois de uma
  mudança (a lista de abas, ou uma tecla: `markScriptEdited` também o avisa, porque o texto da aba chega com 400 ms de atraso), várias mudanças são um relato
  só, o que não mudou não vai, e a aba que fecha vai na hora, com urgência (`urgentReport`, ligado no `closeTab`). Desmontar (sair do cofre) para o relato e
  tira as abas da janela do que volta (`withdrawWorkspace`). Canais: `prism:workspace-report` e `prism:workspace-withdraw`.
- **Quem grava** (`electron/workspace-hub.ts`, sem Electron, com teste): junta as janelas (a principal primeiro, as outras pela ordem em que abriram; a ativa é a
  da principal, ou a da primeira janela que tem uma) e grava 3 s depois da PRIMEIRA mudança ainda não gravada (digitar sem parar não adia a gravação), na hora
  com urgência, ao fechar uma janela que não é a última (as abas dela saem do que volta) e quando pedem (`flush`). Uma gravação de cada vez, a mesma área de
  trabalho não vai de novo, e nada se grava antes de a principal contar as dela. A gravação é o `PUT` com o token (`saveWorkspaceThroughApi`, prazo de 5 s); a
  falha (o cofre fechado, a API que caiu) não aparece na tela: o log do processo principal leva `[prism] abas: a gravação não valeu: …` com o status, nunca o
  conteúdo. Fora do Electron (`getBridge` de desenvolvimento) a própria tela faz o papel do processo principal, com o mesmo centro e uma janela só.
- **Antes de o cofre fechar** (`src/lib/api/workspace-sync.ts`: a área de trabalho registra o relato urgente; `flush` conta e espera o processo principal gravar,
  no máximo 5 s, e nunca lança): o "Sair" da barra superior grava antes do `signOut`; o bloqueio por inatividade grava entre o descarte e o fechamento do cofre
  (`saveWorkspace` de `lock-vault.ts`, uma vez, e a falha não impede o fechamento; a janela que só acompanha o bloqueio de outra não grava); fechar o app grava no
  `before-quit`, canal `prism:workspace-flush`. O "Sair" da tela de bloqueio não grava: o cofre já fechou, e o bloqueio gravou antes.
- **A janela que fecha** (RN-ABAS-004 com a RN-ABAS-006 e 007): fechar a janela fecha as abas dela com as perguntas de sempre, mas fechar a ÚLTIMA é o app saindo, e as
  abas voltam na próxima entrada. Por isso, ao começar a fechar, a janela segura as abas dela (`holdForWindowClose` → `source.hold`, `withHeld`: as que fecham
  ficam como estavam por último, na ordem e com a ativa de então); se a pessoa cancela uma pergunta, solta (`releaseWindowClose`) e o que fechou até ali sai do
  que volta. O processo principal decide no `closed`: a última janela (ou qualquer uma com o app saindo) deixa as abas para a gravação do `before-quit`; as
  outras as tiram do que volta, na hora. A navegação de página inteira e a queda do processo da tela também tiram as abas da janela (`withdraw`).
- **Como conferir sob o Xvfb**: sem banco nenhum (as abas voltam desconectadas); a conexão pode apontar para um host que não existe. Crie o usuário e a conexão
  pela página (`window.prism.getApiConfig()` e `fetch`), entre pelo formulário, abra consultas pelo menu da conexão ("Nova consulta"), digite com
  `Input.insertText` (o texto acima de 1 MB entra por `document.execCommand("insertText", …)` no `.cm-content`, porque um argumento de linha de comando não
  passa de 128 KB), e leia o que foi gravado com `GET api/user/workspace` pela página. Feche o app pelo "X" (`WM_DELETE_WINDOW`, ver "Abas que se movem e outras
  janelas"), responda as perguntas, abra de novo com a mesma `--user-data-dir` e entre: as abas voltam. Para a conexão excluída: saia, entre, exclua e saia pela
  API (com a área de trabalho desmontada nada é podado), e entre pelo formulário. O log da API (`<dados>/logs/`) tem "Área de trabalho gravada com N abas." e
  nunca o SQL.
- **Fechar o app só pergunta pelo que não volta** (RN-ABAS-007). O aviso `prism:windows-close-requested` leva `{ last }` (`windowCloseRequestSchema`; o centro
  das janelas diz, `hub.isLast`), e a tela o confere (`onWindowCloseRequested`: o aviso que não confere vale "não é a última", e pergunta tudo). A última janela
  fecha as abas com `closeAsks({ closesTheApp: true })`: só a pergunta das alterações não salvas da grade (RN-EDIT-007), que não voltam; o SQL digitado e os
  scripts com mudança não salva voltam, e não perguntam. Fechar uma aba, várias ou uma janela que não é a última pergunta como antes, e o texto da pergunta do
  SQL diz que o que fecha não volta na próxima entrada (`confirmClose.description`).
- **Em aberto, à espera do dono**: sem nenhuma conexão cadastrada, a área de trabalho mostra o primeiro uso (RN-NAV-007) por cima das abas que
  voltaram sem conexão; elas continuam gravadas e aparecem quando uma conexão é criada.

## Scripts salvos (RN-SCRIPT-001 a 004)

Seção 23 da especificação. Os scripts moram no cofre do usuário, cifrados (rotas `api/user/scripts`, ver o guia da API); a tela tem a lista em cache
(`scriptsQuery`, sem o SQL: o schema recusa a lista que o traga) e lê o SQL só para abrir e para copiar, pela rota do item, pelo cache de mutações (não fica
guardado). As regras que a tela confere antes de enviar (`saved-scripts.ts`, puro e testado) são as da API: o nome normalizado como a API o grava, de 1 a 200
caracteres, sem caractere de controle, único sem diferenciar maiúsculas; o SQL de até 1 MB em bytes de UTF-8. Os textos estão em `scripts.copy.ts`.

- **Ctrl+S e Ctrl+Shift+S** (`saveShortcut`, tratado no painel da aba de consulta, com o foco em qualquer lugar dela; o Cmd do macOS vale o Ctrl) passam pelo
  `useScriptSaving` (`_components/use-script-saving.tsx`, usado pelo `WorkbenchTabs`). O texto é o do editor DESTE instante (`liveEditors`). A aba que já é um
  script grava por cima (`PATCH` com o SQL e o lugar da aba: a conexão e o banco); a que não é, e o "Salvar como", pedem o nome (`ScriptNameDialog`), com a
  sugestão: o primeiro "Script N" livre, ou, no "Salvar como" de um script, o nome dele com "(2)", "(3)"… (`copyName`). Gravar por cima de um script que outra
  janela excluiu (404) pede o nome, como na primeira vez. O "Salvar como" faz da aba o script novo. As recusas do nome e do tamanho ficam no campo
  (`refusalProblem`); o resto vai ao aviso central. As chamadas têm o prazo das ações da pessoa.
- **A aba de um script** tem o nome dele como título e, com mudança não salva, um ponto na faixa (desenho; o leitor de tela ouve "alterações não salvas", e o
  `title` diz o mesmo: `tabTitleOf`). Só a aba de um script tem o ponto e a pergunta: a consulta que nunca foi salva fecha como antes. O ponto acende na
  primeira tecla (`markScriptEdited`, pelo `onEdited` do editor, sem atraso; as teclas seguintes devolvem a mesma lista de abas e não redesenham nada) e é
  recalculado quando o texto chega com o atraso de sempre (`withEditedSql`): desfazer até o texto salvo o apaga. **Mudança não salva é o texto OU o banco**
  (`isScriptDirty`): o `ScriptRef` guarda o banco em que o script foi salvo ou aberto (`savedDatabase`, sem ele o da conexão), e a aba que trocou de banco
  (RN-ARVORE-007) fica com o ponto até o Ctrl+S gravar o banco novo, ou até voltar ao banco salvo com o texto salvo. `setTabScript` recebe o banco que foi
  gravado (o da aba quando o Ctrl+S saiu).
- **Fechar** (uma aba, as outras, todas, a janela): primeiro a pergunta dos Registros, depois a dos scripts com mudança não salva entre as que fecham
  (`scriptsToAsk`, `UnsavedScriptsDialog`: um script, Salvar, Descartar e Cancelar; vários, Salvar todos), depois a do SQL digitado, que deixa de contar as abas de
  script (`closeConfirmation`). Salvar grava cada um, em ordem, e só então segue; um que não gravou (cancelou o nome, a API recusou) para tudo, e a janela fica
  aberta. Mover a aba para outra janela não pergunta: o texto vai com ela.
- **A seção "Scripts" do navegador** (`scripts-section.tsx`; a lista é `ScriptsListView`, sem estado, testada sem DOM), abaixo da árvore e recolhível: em ordem de
  nome, uma linha só no Tab, setas, Home e End; duplo clique e Enter abrem, F2 renomeia, Delete exclui (com a confirmação), Shift+F10 e a tecla de menu abrem o
  menu (Abrir; Renomear e Copiar SQL; Excluir). Renomear muda o título das abas do script; excluir deixa as abas com o texto, como consultas sem script.
- **Abrir** (`openScriptTab`): uma aba por script (abrir de novo volta para ela), na conexão e no banco em que foi salvo (`scriptPlace`). Se a conexão não existe
  mais, a aba abre **sem conexão** (`connectionId` nulo), com aviso: o texto já está no editor, a faixa acima dele (`NoConnectionBarView`) pede uma conexão, e
  "Usar esta conexão" (`assignConnection`) dá à aba um executor novo, na conexão escolhida e no banco dela. Sem conexão o executor não abre sessão nem chama a
  API (`run` avisa e, sem resultado na tela, diz por quê), a poda da conexão excluída não tira a aba, a barra de status diz "Sem conexão", e gravar por cima
  mantém o lugar antigo (o `PATCH` sem `connectionID`). **O editor segue o banco da aba com ele montado** (a gramática, o separador de comandos, as maiúsculas e o
  completar, por compartimentos): a aba que recebe uma conexão de outro banco não recria o editor, e o texto e o desfazer ficam.

## Trocar o banco da aba de consulta (RN-ARVORE-007)

Seção 24 da especificação (issue 1 do repositório público). A barra do editor da aba de consulta mostra, depois de Executar, o banco em que a aba roda
("Banco", um `Select` com rótulo visível ligado a ele) e deixa trocá-lo. A aba sem conexão não tem a lista (a faixa pede a conexão antes).

- **A lista é a da árvore** (RN-ARVORE-006): a mesma consulta e o mesmo cache (`["tree", conexão, "databases"]`, `databaseNodes`), sem rota nova. O
  `DatabasePicker` (`_components/database-picker.tsx`; o desenho é `DatabasePickerView`, testado sem DOM) só LÊ o cache: a consulta dele é a `treeQuery`
  desligada, que nunca abre sessão sozinha, nem depois de "Desconectar" remover as consultas (RN-SESSAO-004). Quem busca é **abrir a lista** (`onOpen` do
  `Select`, novo), e só quando ela não está em cache ou foi atualizada: `loadServerDatabases` (`database-sessions.service.ts`, testado) abre a sessão da
  árvore da conexão se ainda não estava, como expandir a conexão (o navegador passa a mostrá-la conectada), e pede a lista; a conexão que não abre para
  ali, com o aviso central uma vez; a sessão da árvore que caiu abre outra e a lista vem de novo, com o aviso de sessão reaberta. Enquanto vem, uma região
  viva diz "Carregando os bancos…", e a lista aberta cresce quando chega: o `Select` leva o destaque junto da opção escolhida (o Enter não escolhe outra).
- **As opções** (`databaseChoices`, `_lib/tab-database.ts`, puro e testado): os bancos da lista na ordem dela, o da conexão primeiro, com o nome que o
  servidor deu e "(padrão)"; antes de a lista chegar, só o banco da aba. O banco da aba que a lista não traz (um script salvo num banco que sumiu) fica no fim.
  O valor de cada opção é o banco em JSON (`databaseValue`: o da conexão é `null`), para nenhum nome se confundir com o padrão. **No Db2** só o banco da
  conexão, e a lista fica desabilitada com o motivo à vista, ligado ao controle por `aria-describedby`. Com comando em andamento (executar, carregar mais,
  contar) a lista fica desabilitada: a resposta dele é do banco de agora.
- **A troca** (`switchDatabase` no provedor, sobre `withDatabase`, puro e testado): a aba ganha um executor novo nesse banco (que abre a sessão dele na
  próxima execução, como a aba aberta pela "Nova consulta" do banco), e o de antes sai de cena (`retire`) antes de a sessão dele fechar na API (pelo mesmo
  caminho de fechar a aba, `endInBackground`, que a janela que fecha espera). **Nada é executado, o texto fica** (o do editor deste instante, `liveEditors`),
  e **o resultado que estava na tela sai**: era do banco anterior, e o cursor dele fecha com a sessão (como ao dar uma conexão à aba de um script sem
  conexão). O mesmo banco, a aba de uma tabela, a aba sem conexão e a aba ocupada não trocam. O editor segue o banco com ele montado: o completar e os
  links de tabela leem o cache da árvore do banco novo.
- **Pergunta antes** com alterações não salvas na grade (RN-EDIT-007): a troca passa pelo `guard` da edição, o mesmo diálogo de executar outro comando
  ("Salvar" grava pela sessão de antes e só então troca; "Descartar" troca sem elas; "Cancelar" fica no banco). A aba de consulta ainda não tem o Commit manual
  (RN-TX-001), então não há transação aberta a perguntar; quando ele entrar, a troca é uma das saídas da RN-TX-006.
- **O que acompanha a troca**: a barra de status escreve a conexão e o banco da aba ativa (`conexão / banco`, o da conexão quando a aba não tem outro); o
  Ctrl+S grava o banco da aba (`PATCH`/`POST` com `database`, nulo para o da conexão), e a aba de um script fica com o ponto enquanto o banco não é o salvo;
  a aba que vai para outra janela leva o banco novo e o banco salvo do script; o bloqueio por inatividade dá à aba um executor no banco dela.

## Links de tabela no editor (RN-LINK-001)

Com Ctrl (⌘ no macOS) apertado, o nome de uma tabela ou visão sob o ponteiro fica no azul de link do tema, sublinhado e com o cursor de mão; Ctrl+clique abre a
aba da tabela nos Registros (`openTableTab` com a vista `data`), na conexão e no banco da aba do editor. Soltar o Ctrl, tirar o ponteiro do nome ou a janela
perder o foco desfaz o destaque.

- **Quem decide é puro e testado** (`_lib/table-links.ts`): `tableLinkAt` lê os pedaços do texto pelo leitor do projeto (`sqlTokens`, o mesmo de
  `sql-statements.ts`), então texto entre aspas simples, `$tag$ … $tag$` e comentário (inclusive o de chaves do Informix) não são nome. O nome é `tabela` ou
  `esquema.tabela`, as partes coladas pelo ponto, com ou sem aspas em cada uma; com três partes ou mais não é link (`banco.esquema.tabela`, `apelido.coluna` de
  outro jeito). Sem aspas o nome é dobrado como o banco o lê (só o ASCII: minúsculas no PostgreSQL e no Informix, maiúsculas no Db2), e a palavra reservada sem
  aspas não é nome (`isReservedWord`, a lista do completar); entre aspas vale como está, com a aspa dobrada de dentro. Sem esquema vale o padrão da sessão
  (`defaultSchemasOf`): no PostgreSQL o do usuário da conexão e depois o `public`; no Db2 o do usuário, em maiúsculas; no Informix qualquer dono.
- **O catálogo é o do autocompletar** (`linkCatalog` sobre `cachedLevels`: as tabelas e visões que a árvore já carregou do banco da aba), sem consulta nova: o que
  a árvore ainda não abriu não vira link. O editor o refaz só quando algum nível muda (`sameLevels`).
- **A extensão** (`_lib/table-link-extension.ts`) lê o modificador das teclas da JANELA (o editor pode não ter o foco) e de cada movimento do ponteiro, guarda
  o texto e os pedaços por versão do texto (um movimento não copia nem relê um script de 1 MB), acha o caractere sob o ponteiro (`posAtCoords` e o lado dele) e
  tem precedência no `mousedown`: o Ctrl+clique de um link não chega ao CodeMirror, que acrescentaria um cursor. A aba sem conexão não tem link.
- **A cor** é a ficha `link` (`globals.css`), com o contraste conferido em todos os temas sobre as superfícies e a seleção (`globals.test.ts`). O GitHub Claro
  usa o azul dele (#0969da) escurecido o mínimo (#0967d7), porque sobre a linha selecionada ele dava 4,4:1.

## Navegador: clique, menu e busca (`src/app/workbench`)

Seção 18 da especificação (RN-TABELA-001, RN-MENU-001 e RN-BUSCA-001). O que decide é função pura e testada; a tela só executa.

- **Clique e Enter** (`clickEffect` e `tableTargetOf`, em `_lib/navigator-model.ts`). O clique no nome da **tabela** só seleciona:
  abrir os filhos é do chevron (um alvo à parte, `data-chevron`, dentro do botão da linha), das setas e do Espaço, e **o duplo
  clique e o Enter abrem a aba dela** (`openTableTab`; a visão também). Nas demais linhas o clique alterna o nó, e o segundo clique
  de um duplo clique (`event.detail` maior que 1) não alterna de novo, senão o nó abriria e fecharia (o chevron é a exceção). Sem
  isso, cada duplo clique numa tabela deixaria três linhas a mais na lista. `tableTargetOf` acha conexão, esquema e nome: a tabela
  os traz na chave; a visão não (a chave de folha é o caminho do pai mais a posição), então o esquema sai do pai (o que vem antes
  do último `#`) e o nome, do rótulo. O Enter chama `preventDefault`, senão o botão da linha ainda alternaria o nó.
- **Menu de contexto** (`menuFor`, em `_lib/navigator-menu.ts`). Devolve os itens por tipo de linha, em grupos, e **só descreve**
  (`MenuAction`): quem executa é `runMenuAction`, em `navigator.tsx`, que tem a conexão, as abas e o cache. A ação que não se aplica
  agora vem desabilitada, não some ("Atualizar" numa conexão sem sessão). Além do que a especificação lista, o banco e os grupos
  (Tabelas, Colunas…) têm "Atualizar", porque a linha já o oferece ao passar o mouse; as linhas "Carregando…" e de erro não têm
  menu. Atalho só onde a árvore já trata a tecla: o Enter abre a aba da tabela, na vista em que ela estiver (uma aba por tabela; por isso a dica
  do duplo clique diz "abre a aba", e não "abre os registros"), e "Abrir registros" faz o mesmo quando a aba ainda não existe, mas com
  ela noutra vista é o item que leva aos registros. A tabela ou visão que o menu não sabe localizar mostra as ações desabilitadas, não
  some com elas. "Atualizar" é o `refresh` da árvore; "Conectar"
  abre o nó (a sessão abre junto) ou, com o nó já aberto e sem sessão, busca de novo; "Gerar SELECT" abre uma consulta nova com
  `selectAllSql` no editor, sem executar; "Copiar" é `navigator.clipboard.writeText`, com aviso ("Copiado." ou "Não foi possível
  copiar."), "Copiar nome" copia o nome cru, e "Copiar nome qualificado" o que o "Gerar SELECT" escreve depois do `FROM`: `"esquema"."nome"`,
  pelo mesmo `quoteIdentifier` do `table-sql.ts` (**a regra única das aspas**: duas aspas duplas sempre, nos três bancos, com a aspa de
  dentro dobrada); "Editar conexão" usa `editConnectionTo` (ver "Conexões"); a pasta reaproveita o `FolderDialog` e o
  `DeleteFolderDialog` da tela de Conexões (`folder-action-dialogs.tsx` só escolhe qual).
- **F2, Renomear e Duplicar conexão** (RN-NAV-009 e RN-CONN-016). O F2 sem modificador na linha da pasta ou da conexão é `keyActionFor`
  (`_lib/navigator-menu.ts`, pura), que devolve a MESMA `MenuAction` do item do menu que mostra o atalho F2 ("Editar pasta…" na pasta,
  RN-PASTA-006; "Renomear" na conexão), e a árvore a executa pelo `runMenuAction`, como se viesse do menu; nas outras linhas, e com Shift,
  Ctrl, Alt ou Cmd, não faz nada. A pasta abre o `FolderDialog` no modo `edit` (o nome e o ambiente; ver "Conexões"). A conexão abre o `RenameConnectionDialog` (`connections/_components`), só com o nome: grava pelo
  mesmo `PATCH` do formulário com a conexão como está e o nome novo (`renamedConnectionInput`, em `_lib/rename-connection.ts`, sobre o
  `movedConnectionInput`: senha nula, que a API mantém), e o nome repetido (`CONNECTION_ALREADY_EXISTS`) e o 422 do nome ficam no campo
  (`renameRefusalFields`); o 422 de outro campo vai ao aviso pelo título. "Duplicar conexão" chama `POST api/user/connections/{id}/duplicate`
  (`duplicateConnection`, sem corpo: a senha é copiada dentro do cofre), atualiza as listas e pede ao `connectionReveal` a cópia, que aparece
  escolhida e com o foco, desconectada; a recusa vai ao aviso central.
- **Filtro por ambiente** (RN-NAV-010). Ao lado do campo de busca, na mesma linha (que quebra no navegador estreito: o campo é
  `flex-[1_1_8rem]`, o seletor `flex-[1_1_9rem]`, e a 200 px o seletor desce), o `NavigatorEnvironmentFilter` (`navigator-environment-filter.tsx`,
  sem estado) é o `Select` do app com "Todos os ambientes" (valor vazio, o padrão), cada ambiente do usuário (RN-AMB-001) e "Sem ambiente". Cada
  ambiente vai como a `EnvironmentPill` dele, na lista e no controle fechado (o `content` da opção do `Select`); o controle fechado fica numa linha
  só, cortado com reticências (`[&>span:first-child]:truncate`), e na lista o texto quebra. Com um filtro escolhido aparece o `x` "Limpar o filtro
  de ambiente", que volta a "Todos". Quem filtra é `filterByEnvironment(folders, connections, escolha, environmentLookup)`
  (`_lib/navigator-environment.ts`, pura e testada): as conexões cujo ambiente mostrado (o próprio ou o herdado) tem a chave escolhida, ou que não
  têm nenhum ("Sem ambiente"), e as pastas no caminho até elas, na ordem da lista; "Todos" devolve as MESMAS listas. O navegador monta a árvore
  (`buildConnectionTree`) sobre o que sai daí, e a busca roda depois, sobre essa árvore: os dois se combinam sem tocar em `searchTree`. A pasta do
  ambiente sem conexão dele dentro não aparece (a regra fala das pastas no caminho). A escolha é estado do `Navigator`, que fica montado enquanto o
  cofre está aberto (`WorkbenchSlot`): vale enquanto a janela está aberta, ir às Configurações e voltar a mantém, e sair do cofre a apaga (uma
  janela nova começa em "Todos"). O ambiente que ninguém mais usa volta a escolha a "Todos" (`choiceAvailable`, um ajuste durante a renderização,
  só com as duas listas já na tela), e a conexão que o formulário salvou ou a duplicada que o filtro esconderia também (no mesmo ajuste do
  `connectionReveal`, como a busca). A árvore vazia pelo filtro diz "Nenhuma conexão em X." (ou "sem ambiente") numa região viva, e não é o
  primeiro uso. **Conferido sob Xvfb**: Develop mostra a pasta Desenvolvimento com a conexão que herda e a conexão da raiz com o próprio; com
  "MES" no campo fica só a da raiz; "Sem ambiente" deu a frase; a inicial "p" escolhe Produção com a lista fechada; o `x` volta a todas.
- **`ContextMenu`** (`components/ui/context-menu.tsx`) é genérico. Portal `position: fixed` em `document.body`; `role="menu"` com
  `menuitem` e `separator`; o item desabilitado é `aria-disabled` e continua na ordem das setas; as setas dão a volta, Home e End,
  Enter e Espaço (o clique do botão), Esc e Tab fecham, e clique fora, rolar e trocar o foco da janela também. `placeMenu` (abre com
  o canto no ponto, ou do outro lado dele quando não cabe, e nunca sai da janela) e `nextItemIndex` são puras e testadas, e os itens
  e os separadores são uma view sem hooks (`ContextMenuItems`) que o teste renderiza: o item desabilitado sai com `aria-disabled` e o
  clique nele não chama nada. Abre por botão direito, Shift+F10 e tecla de menu (no pé da linha, com o foco no primeiro item).
  **A tecla de menu ainda gera um `contextmenu` no keyup** (o Shift+F10 não gera), em cima do menu que ela abriu, e o `preventDefault`
  do keydown não o impede: por isso um menu aberto pelo teclado ignora o `contextmenu` do ponteiro que vier enquanto estiver aberto
  (`ignoresContextMenu`, pura), e a linha só toma o foco quando o menu vai abrir (o `onContextMenu` dela devolve se vai: um pedido
  ignorado não tira o foco do primeiro item). O clique direito de verdade não é pego, porque o `pointerdown` fora do menu já o
  fechou. O Chromium sem janela não gera esse evento: o roteiro de conferência o simula.
- **O fundo escurecido de um `Dialog` só fecha com o botão principal** (`closesFromBackdrop`, em `dialog.tsx`): fechando no
  `pointerdown` de qualquer botão, o botão direito no fundo fechava o diálogo, e o `contextmenu` seguinte caía na linha do navegador
  que estava por baixo e abria o menu dela.
- **Foco do menu**: ao escolher um item o foco volta à linha ANTES da ação (um diálogo que a ação abra guarda a linha como destino
  do foco); nos demais fechamentos, na limpeza do efeito e **de novo no fim do evento** (`setTimeout`), porque o `mousedown` numa
  área sem foco tira o foco depois do `pointerdown`. O segundo passo só vale com o menu já fora do DOM (o `StrictMode` desmonta e
  monta os efeitos de mentira, e aí o menu segue vivo e é quem tem o foco) e só se o foco se perdeu: nunca rouba o de um diálogo que
  a ação abriu. O menu para a propagação das teclas: o portal as sobe pela árvore do React, e o Ctrl+F do navegador as pegaria.
- **Busca** (`_lib/navigator-search.ts`). `searchTree` (pura) filtra por nome sem diferenciar caixa nem acento (`fold`), mantém os
  ancestrais abertos, não casa os grupos fixos pelo nome e devolve as linhas, as chaves abertas e o trecho que casou por linha
  (`findMatch`, nas posições do rótulo que a pessoa vê: caminho rápido para ASCII e para acento composto, mapa ponto a ponto para
  acento solto e hangul; o teste de invariante confere os dois). **Olha o que a árvore já carregou, aberto ou não**: `loadedLevels`
  junta os níveis do navegador com o que o cache guarda (`cachedTree`, em `navigator-search.ts`, lê os níveis
  `["tree", …]`, a começar pela lista dos bancos de cada conexão, e devolve o MESMO objeto enquanto nenhuma dessas consultas mudou), e `levelPathOf` é o inverso de `treeKey` (**mudou `treeKey`, mude `levelPathOf`**: há teste de ida e volta).
  **Nunca chama a API, nunca abre nó e nunca toca em `expanded`**: limpar o campo devolve a árvore como estava.
- **Na tela filtrada** só tem chevron quem tem algo à vista embaixo; recolher um ancestral ali é estado local daquele texto
  (`searchCollapsed`), não `expanded`; o grupo diz "3 de 120"; o destaque é um `<mark>` de texto (o nome vem do banco). O filtro roda
  sobre `useDeferredValue` do texto, para a digitação não esperar uma lista de milhares de linhas: com 20 mil nós carregados ele leva
  dezenas de milissegundos (o teste exige menos de 100 ms medindo o melhor de cinco execuções depois de uma de aquecimento: uma
  medida só falhou na suíte inteira, com a máquina disputada). O filtro está num `useMemo` (texto, o que se recolheu, a árvore e o
  `cachedTree`, de identidade estável): um aviso ou uma tecla no editor, que redesenham o navegador, não o refazem.
- **`NavigatorList` fica sempre montada**, inclusive no "nada encontrado": a seleção (`selectedKey`) e a rolagem da árvore moram
  nela, e desmontá-la as perdia ao limpar. A rolagem é acompanhada por `onScroll` enquanto a árvore está à mostra e volta ao sair da
  busca; ler `scrollTop` ao entrar na busca não serve, porque a lista já encolheu e o navegador já o ajustou. Ctrl+F com o foco no
  navegador vai ao campo (`handleShortcut`, no contêiner); Esc limpa o texto (com o campo vazio devolve o foco à lista); seta para
  baixo e Enter levam o foco à linha que o Tab alcança.

## Aba de uma tabela e área de resultado recolhível (`src/app/workbench`)

Seção 18 (RN-TABELA-001 a 004 e RN-PAINEL-001).

- **A aba de uma tabela é uma `QueryTab` com `table`** (`TableTarget`: esquema, nome e a vista `data`, `structure` ou `diagram`),
  aberta por `openTableTab`. Tem o executor e a sessão como qualquer aba e entra nas mesmas regras de fechar, desconectar e podar.
  `TableTabPanel` (`_components/table-tab/table-tab.tsx`) desenha o cabeçalho do canvas, o seletor de vistas (`table-view-tabs.tsx`:
  `tablist` com setas, Home e End, pela `tabForKey` de `table-view.ts`; só a ativa entra no Tab) e a vista ativa. **Só a vista ativa existe na página**: as demais buscam
  o que mostram quando se abrem, e o que a aba já leu fica guardado (os registros, no executor). Um pedido de vista que a aba não
  tem cai nos registros (`viewOf`).
- **Registros** (RN-TABELA-002): executa o `SELECT` dos registros (`recordsSql`, em `_lib/table-sql.ts`; sem filtro nem ordem é o `selectAllSql`) pelo executor
  da aba, **uma vez**,
  quando ela nunca executou nada (`needsFirstRun`: `idle`, o banco da conexão conhecido, a aba À VISTA e a conexão não desconectada pela
  pessoa; o segundo efeito do `StrictMode` vê `running`). Erro, cancelamento e linhas na tela ficam como estão: quem refaz é "Atualizar".
  **Os nomes vão sempre entre aspas duplas, nos três bancos** (`quoteIdentifier`, em `table-sql.ts`: a aspa dobrada dentro do nome impede que ele escape, e nada nele,
  `;`, `--`, `{` ou espaço, separa comandos nem vira comentário; no Informix também, porque a sonda do projeto mostrou que o driver abre
  a sessão com identificadores delimitados, e sem aspas um nome com maiúsculas seria dobrado para minúsculas pelo servidor). É a regra
  única: o `SELECT` da aba, o "Gerar SELECT" e o "Copiar nome qualificado" escrevem o nome por ela, e o texto gerado tem
  `statementCount` 1. A vista usa o `ResultPanel` no modo `records` (título, rótulo, rodapé com "Atualizar" ou
  "Cancelar", e o cursor fechado que pede "Atualizar", e não "Executar de novo"): sem editor de SQL; a grade edita as células (ver "Edição das células", abaixo).
- **Filtro e ordem** (RN-TABELA-005). O campo `WHERE` (`records-filter.tsx`, um CodeMirror de uma linha, `filter-field.tsx`: ver "Filtrar como no DBeaver",
  abaixo) recebe a condição **como o usuário a escreve**, só sem o espaço
  das pontas: não se lê, não se escapa e não se põe entre parênteses (RN-SQL-003). `recordsSql(engine, esquema, nome, { where, sort })` monta
  o comando com cada parte numa linha própria (uma condição que termina em `--` não engole o `ORDER BY`), e a recusa de mais de um comando é
  `filterProblem` (`statementCount`, no dialeto do banco): ela aparece no próprio campo, antes de a API ser chamada. Clicar no cabeçalho de
  uma coluna ordena (`nextSort`: crescente, decrescente, sem ordem; outra coluna começa crescente; `aria-sort`), só nos Registros. A tela
  mostra o comando que executou, e o filtro e a ordem em vigor ficam lembrados com a aba (`tab-memory`).
- **O que a vista Registros decide, e o que ela FAZ com cada decisão, mora em `_lib/table-view.ts`**, em funções sem React, com as peças
  injetadas e testadas com espiões (o molde de `submitPasswordChange` e de `lock-vault.ts`): `runRecords` e `applyRunPlan` ("aplicar", "limpar",
  "atualizar" e o clique no cabeçalho: a aba ocupada não muda nada, vários comandos só avisam no campo, e enviar é registrar a consulta como a
  em vigor e pedi-la ao executor, nesta ordem), `takeHandoff` e `settleHandoff` (a entrega do filtro de outra aba) e `needsFirstRun`. Elas
  recebem o ESTADO do executor (`runner.getState()`), e não um "ocupado" calculado no componente. `RecordsView` só entrega o que tem. **Decisão
  nova da vista entra ali, com teste; um `if` no componente não tem quem o confira** (era assim, e tirar o ramo da aba ocupada ou o dos vários
  comandos não reprovava nada). **O que a vista ENTREGA a essas funções também tem teste** (`records-view.test.ts`): a vista é chamada como
  função com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`, a mesma runtime de
  `workbench-state.lock.test.ts`), o executor é de mentira, e o que se afirma é o que chega ao campo do filtro, à área de resultado e ao
  executor com a aba escondida, a conexão desconectada, a aba ocupada e o executor ocupado DEPOIS da última renderização. Valor novo que a
  vista passe a entregar (`visible`, `disconnected`, o estado lido na hora) ganha um caso ali: trocá-lo por uma constante passava com a suíte
  verde. A grade virtualizada não desenha linha sem DOM: para conferir o que a área de resultado entrega à grade, troque a grade por uma que
  anota as propriedades (`result-panel.grid.test.ts`).
- **Exportar CSV** (RN-TABELA-006), só nos Registros. `csvExportOf` (`_lib/csv.ts`, puro) monta o arquivo das linhas CARREGADAS (as que ainda
  não foram lidas não entram, e o aviso diz quantas saíram, que as outras ficaram de fora e quantos valores não puderam vir inteiros; a célula cortada sai com o valor completo, RN-SQL-017, ver "Valor completo das células cortadas"): UTF-8 com BOM, separador `;`, aspas dobradas, CRLF, nulo como campo vazio
  e valor cujo primeiro caractere, depois de espaços, tabulação ou retorno de carro, é `=`, `+`, `-` ou `@` com um apóstrofo na frente, para a
  planilha não o executar. **O número simples, inclusive o negativo (`-12,50`), sai como está, sem apóstrofo** (`simpleNumber`, em `csv.ts`: é o
  que a especificação diz, e a coluna segue somando na planilha). A entrega é `saveText` (`_lib/save-file.ts`): o download do próprio navegador,
  um `Blob` e um link com `download`, que no Electron abre o diálogo de salvar do sistema. **Não há canal novo, e a ponte não grava arquivo.** O
  nome proposto (`csvFileName`) é `esquema.tabela.csv` sem o que o sistema de arquivos recusa: saem os caracteres de controle, os de direção de
  texto e os invisíveis (o espaço de largura zero, os separadores de linha e de parágrafo, a marca de ordem de bytes, o juntador de palavras e o
  hífen opcional); o que o Windows não aceita vira `_`; e o nome de
  dispositivo do Windows antes do primeiro ponto (`con`, `prn`, `aux`, `nul`, `com0` a `com9`, `lpt0` a `lpt9`, `conin$`, `conout$`, também
  seguido de espaço) ganha um `_` na frente.
- **Chave estrangeira** (RN-TABELA-007). O valor de uma coluna que é chave estrangeira é um botão na grade (`foreignKeyLinks` e `followOf`,
  em `_lib/foreign-key-links.ts`; as chaves vêm de `foreignKeysQuery`, a mesma da Estrutura, e só são pedidas com a aba à vista e linhas na
  tela). O clique abre, ou traz à frente, a aba da tabela referenciada, na vista Registros, com `"coluna" = valor` já no campo e executado.
  O filtro viaja por `filter-handoff.ts` (um pedido por conexão e tabela, que a vista de lá leva ao campo e apaga), porque a aba de lá pode
  não existir ainda, ou existir escondida. A vista só o leva ao campo quando o comando com ele vai de fato ser enviado (`handoffToTake`): com a
  aba à vista, sem nada em andamento nela e com a conexão de pé; senão o campo e o comando à vista ficam como estavam, e o pedido espera
  (RN-TABELA-005: a tela só mostra como aplicado o filtro do comando que foi enviado). **O pedido que ninguém levou em 15 s não some calado**:
  a passagem avisa quem ouve `onExpired`, e o `WorkbenchProvider` mostra o aviso de atenção com a tabela e "clique no valor de novo". **O pedido
  é da aba da tabela a que se destina e morre com ela**: o provedor apaga os pedidos das tabelas que deixaram de ter aba (`forgetExcept`, no
  mesmo efeito que apaga a memória da aba), então fechar a aba e reabrir a mesma tabela não leva o filtro velho. Não são link: o nulo, o
  valor cortado (RN-SQL-011) e o que não cabe numa linha de filtro (quebra de linha, tabulação: `fitsFilter`); e, **com a conexão desconectada
  pela pessoa, nenhum valor é link** (`recordLinks`): as linhas que ficaram na tela são o retrato de antes da desconexão, e nada reconecta sem
  o clique em "Atualizar", que devolve os links. Numa chave composta cada coluna leva à sua parceira, a de mesma posição; numa coluna que está
  em duas chaves, vale a primeira do catálogo.
- **O valor entra no filtro como literal do banco** (`sqlLiteral(engine, valor, tipoDaColuna)`, em `table-sql.ts`; `equalsCondition` monta
  `"coluna" = literal`). Número sem aspas só se a coluna é numérica E o valor é um número (um `007` numa coluna de texto fica entre aspas); o
  resto vai entre aspas simples, com a aspa dobrada, e a barra invertida depende do banco: no PostgreSQL o literal com barra vira `E'…'` com
  ela dobrada, no Db2 ela é um caractere como outro, e no Informix é dobrada. Nunca sobra uma aspa solta, então o literal nunca vira outro
  comando (há teste com valores hostis dos três bancos e com valores sorteados). Os NOMES seguem a regra única das aspas
  (`quoteIdentifier`); este é o escape dos VALORES. O autocompletar do editor tem outra regra (`sqlName`, em "Configurações"), porque escreve
  o que a pessoa digitaria.
- **Estrutura** (RN-TABELA-003): colunas, chaves estrangeiras e índices pelas três rotas e pelos schemas Zod que a árvore já usa,
  pela **sessão da árvore**. As consultas são da família **`["table-structure", conexão, esquema, tabela, nível]`**
  (`_lib/table-structure.service.ts`) e não de `["tree", …]`: "Desconectar" remove as consultas `["tree", …]`, e uma vista aberta as
  refaria na hora, abrindo outra sessão e desfazendo a desconexão. As opções de cache são as da árvore (`keepUntilRefreshed`,
  exportado de `database-sessions.service.ts`), e a consulta tem `enabled`: desligado (aba escondida, conexão desconectada), o pedido
  não sai. Cada seção tem carregando, erro (a mensagem do banco, com "Tentar de novo", que reabre a sessão quando ela caiu) e vazio, e uma que falha não esconde as outras; "Atualizar" invalida `structurePrefix`. A família sai do
  cache com a conexão excluída e no bloqueio (`connectionOwnedFamilies`), e o "Atualizar" da árvore não atualiza a Estrutura nem o
  Diagrama.
- **A lista lateral da Estrutura** (RN-TABELA-009; o dono reprovou os cartões lado a lado, cada um com barra horizontal própria, que cortavam "Referência" e
  "Colunas", e pediu a lista do DBeaver): uma lista de seções à esquerda e **só a escolhida** à direita. `StructureSections` (só de propriedades) monta a lista
  (`structure-nav.tsx`) e o painel. As seções são o array `structureSections` (`_lib/structure-sections.ts`: Colunas, Chaves estrangeiras, Índices e DDL), e
  **seção nova (a "Referenciada por" e as restrições de conferência, RN-CAT-004 e 005) entra aí**, com o nome e o título em `workbench.copy.ts` e o corpo no `switch` de
  `StructureSections` (os `Record<StructureSection, …>` fazem o TypeScript cobrar), sem redesenhar a lista.
  - **A lista** é um `tablist` com `tab`, foco itinerante (só a escolhida entra no Tab) e a seta que escolhe também leva o foco; o painel é o `tabpanel` rotulado pela
    entrada escolhida, e as entradas apontam para ele, como no seletor de vistas. As setas são a `tabForKey` do seletor (`table-view.ts`, generalizada: na fileira valem
    ←/→, na coluna ↑/↓, Home e End nas duas). A entrada escolhida é a de Configurações (`navItem`, em `components/ui`). Os ids vêm de `useId()` (`structureTabId`,
    `structurePanelId`), porque as abas de tabela ficam todas montadas. Cada entrada mostra a contagem (`entryMark`): nada enquanto a lista carrega (nem zero), o
    número quando ela chegou (zero é número) e uma marca de aviso (um círculo com "!", e o texto "Falhou ao carregar" para o leitor de tela) quando falhou, mesmo com
    a lista de antes ainda na mão. A entrada continua clicável, e o DDL não tem marca (a própria seção diz por que ainda não há texto).
  - **O painel**: o cabeçalho da seção (título, "Ver no diagrama", "Atualizar" e, no DDL, "Copiar") fica FORA da rolagem; só o corpo rola, na vertical, com o `thead` fixo
    (`sticky top-0`; por isso a tabela é `border-separate`: com `border-collapse` a borda de baixo do cabeçalho rolaria embora).
  - **Nada de barra horizontal e nada cortado: o texto quebra.** As células de texto levam `wrap-anywhere` (`overflow-wrap: anywhere`), e não `break-words`: só o `anywhere`
    diminui a largura MÍNIMA da célula, e então a tabela cabe no painel em vez de empurrá-lo. Escolhi quebrar, e não cortar com reticências e `title`, porque o que distingue
    dois nomes de restrição ou de índice é o fim deles. Para a quebra cair entre as palavras, e não no meio de uma (`academic_pe` / `riod_systems`), o texto ganha um
    `<wbr>` depois de cada `_` e `.` (`breakableParts`, pura; o `<wbr>` não é caractere, e copiar ou ler dá o nome inteiro); o `anywhere` fica como último recurso. O DDL
    quebra as linhas (`whitespace-pre-wrap`): o botão copia o texto, e não a quebra. As células de uma palavra só e de largura conhecida (o número, "sim" e "não", a marca
    de chave) não quebram.
  - **Painel estreito: a lista vira uma faixa no topo** da Estrutura. É consulta de CONTÊINER do Tailwind (`@container` na raiz e `@4xl:` = 56 rem = 896 px de largura DELA,
    e não da janela). Medido numa tabela de 16 colunas, 4 chaves estrangeiras (nomes de até 55 caracteres) e 7 índices: com a lista ao lado em 1024x700 e o navegador em
    320 px o painel ficava com 504 px, e as linhas das chaves chegavam a 77 px (três linhas) e, na composta, a 116 px (cinco linhas: a quebra nos `_` aproveita mal uma
    coluna estreita); na faixa ele tem 704 px, e nenhuma linha passa de 57 px (duas linhas). Com o navegador em 320 px
    a faixa vale para a janela abaixo de 1216 px (medido: a 1215 px é fileira, e a 1216 px é coluna). **A largura limite está em dois lugares** (o `@4xl:flex-row` da raiz e as `@4xl:` da lista): mude os dois. Se nem a
    fileira cabe, as entradas passam para outra linha, e a lista nunca rola na horizontal. **O `aria-orientation` e as setas acompanham o desenho** (`useNavOrientation`): o
    CSS é a única fonte da largura, e o gancho só LÊ a `flex-direction` da lista (`orientationOf`), com um `ResizeObserver`. Escondida (a área de trabalho por baixo de
    outra tela mede 0x0, e a consulta de contêiner a avalia como fileira) não há medida, e a orientação fica como estava. Começa vertical, também na renderização de
    servidor e nos testes.
  - **A seção escolhida fica lembrada com a aba** (`tab-memory`, espaço `structure`, pelo id da aba): `StructureView` a lê ao montar (`recall ?? firstSection`) e a grava a
    cada troca. Ir a Registros ou ao Diagrama e voltar, trocar de aba e voltar e passar pelo bloqueio por inatividade não a perdem; fechar a aba, ou podá-la, a esquece,
    como ao filtro dos registros. As três consultas são as mesmas qualquer que seja a seção (a contagem de cada entrada e o DDL dependem das três), e a aba escondida não
    pede nada.
  - **Como conferir na tela** (o vitest não tem layout): `scrollWidth` contra `clientWidth` de cada elemento que rola dentro da Estrutura, em 1440x900 e em 1024x700 (nenhum
    pode passar), a tabela contra o painel, e o cabeçalho da tabela a 0 px do topo da área depois de rolar. A lista se acha pelo `aria-label` ("Seções da estrutura"), e não
    pelo `aria-orientation`, que muda com a largura. **O "Atualizar" com o banco fora tem DUAS rodadas** (a primeira falha, a API vê que a sessão caiu, tenta reabri-la e
    refaz as listas, e no meio as seções voltam a "Carregando…"): espere o `aria-busy` da Estrutura voltar a `false` antes de capturar o erro. Um contêiner Docker com a
    porta publicada sem número (`-p 127.0.0.1::5432`) volta de um `docker stop` noutra porta, e a conexão salva deixa de valer.
- **DDL aproximado** (RN-TABELA-008), uma seção da Estrutura: o `CREATE TABLE` que o Prism MONTA do catálogo já carregado (`approximateDdl`,
  em `_lib/table-ddl.ts`, pura): colunas com tipo e `NOT NULL`, chave primária e chaves estrangeiras, e os `CREATE INDEX` depois (o índice
  único das colunas da chave primária é o dela e não se repete). Só com as três listas na mão: uma que falhou, ou que ainda carrega, deixa o
  DDL de fora, e a seção diz por quê. **Não é o DDL do banco** (padrões, restrições de conferência e opções de armazenamento não aparecem), e
  a primeira linha do texto diz isso, para a cópia não ser tomada pelo original; o botão copia. Os nomes seguem a regra única das aspas; no
  Informix o nome da restrição vem depois da definição. Para uma visão o texto diz `CREATE TABLE` (a aba não carrega o tipo do objeto).
- **Diagrama** (RN-TABELA-004): SVG à mão, sem dependência. A geometria é função pura (`layoutDiagram`, em `_lib/table-diagram.ts`):
  a tabela no centro, até 12 vizinhas (`maxNeighbors`, com o aviso do que ficou de fora) em duas colunas e uma linha ortogonal por
  chave, do meio da coluna de origem ao meio da coluna referenciada. **A ordem dos corredores** (as linhas que sobem e as que
  descem pedem os corredores em ordens contrárias) e a abertura dos pontos que coincidem dentro da linha de 24 px é o que evita o
  cruzamento; o teste confere de 1 a 12 vizinhas. `fitText` ajusta o nome e o tipo ao orçamento de caracteres da linha (`rowChars`, 29: corta com reticências e a dica leva o
  texto inteiro); a chave de uma tabela é `[esquema, nome]` em JSON (`tableKey`). Zoom por botões, `+`, `-` e `0`, e Ctrl+roda (precisa de `addEventListener` não
  passivo, e a página do Chromium não pode ampliar); duplo clique ou Enter numa vizinha chama `openTableTab`. Uma consulta de
  colunas por vizinha, em paralelo, pelas mesmas da Estrutura. As tabelas que apontam PARA a tabela não entram: a API não as devolve. A
  área pode nascer escondida (a área de trabalho por baixo de outra tela): sem tamanho nada se mede, e quando ela aparece
  (`ResizeObserver`) o diagrama se ajusta ou volta à rolagem lembrada.
- **Edição das células** (seção 22, RN-EDIT-001 a 012): a mesma nos Registros de uma tabela e na grade do resultado de um comando da aba de
  consulta (o mesmo campo, faixa, menu e atalhos; a diferença da aba de consulta está em "Na aba de consulta", abaixo). As decisões são funções puras com teste:
  `record-edits.ts` (as pendências, `PendingEdits`: células de linha lida, numa junção com a linha da tabela, `change`; exclusões e linhas novas, cada lista na ordem em que foi feita; uma
  alteração por comando do Salvar, `pendingCount`; o pedido do Salvar na ordem exclusões, alterações, linhas novas, com a chave que a grade leu,
  `changesOf`; o que o banco sem log já gravou sai, `withoutApplied`; a recusa na faixa, com a mensagem do banco como veio, `failureOf`),
  `cell-editing.ts` (o que a célula, a linha nova e a exclusão permitem, com o motivo já na frase "Somente leitura: …"), `cell-menu.ts` (o menu da
  célula: Copiar valor, Colar, Editar célula, Definir como nulo, Desfazer alteração; Linha nova e Excluir linha, os rótulos da RN-EDIT-001; o que não se aplica vem desabilitado,
  com o motivo no `hint` do `ContextMenuItem`, embaixo do rótulo), `grid-cursor.ts` (setas, Home, End, Tab) e `grid-editing.ts` (as linhas e as
  marcas que a grade desenha). As rotas são `record-edits.service.ts` (`allowRefusal` com as recusas que a faixa mostra; o resto vai ao aviso
  central pelo cache de mutações) e os esquemas, `record-edits.schema.ts`. A página traz `resultID` e o motivo de só leitura (`QueryPage.resultId` e
  `readOnly`, que o executor guarda nas linhas), e o executor dá a sessão da aba (`sessionOf`).
  - **Quem liga tudo é `_lib/use-record-edits.ts`** (na vista Registros e na aba de consulta): o estado (as pendências, que ficam na memória da aba, espaço `edits`, pelo
    resultado; o alvo do catálogo, perguntado na primeira tentativa de editar, pela sessão da árvore da mesma conexão quando ela existe; a célula
    ativa e o campo aberto, do resultado; a faixa, o menu, o "Ver SQL" e a pergunta). A grade (`ResultGrid` com `editing`) passa a `role="grid"`,
    com `gridcell`, `aria-activedescendant` e a posição em `data-row`/`data-col`, que o clique, o duplo clique e o botão direito leem por
    delegação na caixa da grade (a linha memorizada não ganha um manipulador por célula). Teclado com o foco na grade: setas, Home e End (com Ctrl,
    da grade), F2 e Enter abrem o campo, começar a digitar o abre com o que foi digitado, Shift+F10 e a tecla de menu abrem o menu, Ctrl+S salva
    as alterações quando há alguma (`savesEdits`; sem nenhuma, ou com Shift, a tecla segue para o script da aba de consulta, RN-SCRIPT-001),
    Alt+Insert cria a linha. A grade rola até a célula ativa quando ela muda (a linha nova entra depois das lidas). O campo (`cell-editor.tsx`, como
    no canvas) é uma área de texto de uma linha (o `input` tiraria as quebras de linha do valor): Enter confirma, Shift+Enter quebra a linha, Esc
    desfaz, Tab e Shift+Tab confirmam e passam à próxima editável, sair do campo confirma, e as teclas não sobem (o Ctrl+W no campo não fecha a aba).
  - **O que a grade desenha**: a célula pendente com o valor lido riscado (11 px, `text-muted`) ao lado do novo, em `bg-accent/20`; a linha nova
    com `+` no número; a excluída riscada; a que falhou no Salvar em `bg-danger/15`; a coluna que não se edita diz o motivo na dica do cabeçalho (na aba de consulta, também a marca "somente leitura" depois do tipo; ver "Num resultado de junção").
  - **A faixa** (`_components/edits-banner.tsx`), sobre a grade: "N alterações não salvas" com "Ver SQL", "Descartar" e "Salvar"; o aviso do banco sem log; o
    erro do último Salvar (`role="alert"`), que fica até o próximo; e o motivo de só leitura, à vista. Salvar que gravou tudo avisa "N alterações
    salvas." e chama `onSaved`: os Registros leem de novo. Sem o alvo (as pendências lembradas voltam sem ele), o Salvar e o "Ver SQL" o perguntam
    antes. O menu, o "Ver SQL" (`edit-sql-dialog.tsx`) e a pergunta são os elementos de `resultEditDialogs` (`result-edit-dialogs.tsx`), iguais nas duas grades.
  - **A pergunta antes de perder as pendências** (`_components/unsaved-edits-dialog.tsx`, com Salvar, Descartar e Cancelar; o foco em Cancelar): "Atualizar",
    aplicar o filtro, limpar e ordenar passam por `guard`; o filtro que chega por chave estrangeira espera (`handoffToTake` com `unsaved`), e
    Cancelar o tira da passagem; fechar abas pergunta pelo registro `unsaved-edits.ts` (`unsavedQuestion`: uma aba oferece Salvar; várias, ou a aba
    com a vista Registros desmontada, só Descartar e Cancelar), antes da pergunta do SQL digitado. O provedor esquece o registro das abas que
    fecham, como a memória da aba.
  - **Copiar e colar** usam a área de transferência do navegador (`navigator.clipboard`), como o "Copiar nome" do navegador; copiar (Ctrl+C e
    "Copiar valor") leva o valor completo da célula cortada (ver "Valor completo das células cortadas", abaixo); colar vira pendência
    da célula, como a edição.
  - **Na aba de consulta** (`query-tab.tsx`, `subject: "result"`, que muda só as frases da conferência do catálogo): executar outro comando (o botão
    e o Ctrl+Enter) e "Executar de novo" passam por `guard` quando o executor vai de fato enviar o comando (`commandWillRun`; o que ele recusaria
    só avisa). O Salvar que gravou tudo NÃO executa de novo (RN-EDIT-009): `savedResultOf` (`record-edits.ts`) monta a grade que fica (os valores
    salvos, as excluídas fora, a linha nova no fim com o que foi digitado) e `runner.keepSaved` a põe no executor, com `cursorClosed` quando havia
    mais linhas (salvar é um comando na sessão e fecha o cursor; "Carregar mais" dá lugar a "Executar de novo"). As colunas da linha nova que a
    pessoa não preencheu ficam em `RowsState.generated` ("gerado pelo banco — execute de novo para ver", em itálico e `text-subtle`): a célula não
    se edita e, com a chave entre elas, a linha também não (`cellAccess`, `deleteRowAccess`). `generated` viaja com a aba para outra janela
    (`tab-transfer.ts`), e a aba de consulta que salvou para ir vai com a grade salva (`sendTab`). Os diálogos e o menu ficam fora da caixa que
    trata o Ctrl+S do script: vão por portal, e o teclado deles subiria até ela. Fechar a aba pergunta pelo mesmo registro `unsaved-edits.ts`. A
    aba de consulta ainda não tem o Commit manual na tela (RN-TX-001): o Salvar é sempre uma transação própria.
  - **Num resultado de junção** (RN-EDIT-002, pedido do dono de 2026-10-14; só a aba de consulta tem junção, os Registros são de uma tabela só e
    ficam como estavam): o `edit-target` diz a tabela de cada coluna (`columns[].table`) e a chave de cada tabela, e cada coluna se edita na
    tabela de onde veio (`cell-editing.ts`: `cellAccess` olha a tabela DA COLUNA, e numa tabela só, sempre a 0, como antes; a chave cortada,
    gerada ou NULA vale por tabela, e a nula é a junção externa sem linha ali, "<tabela> não tem linha aqui (junção externa)", pelos valores
    da linha em `RowContext.values`). "Linha nova" e "Excluir linha" ficam desabilitados com "num resultado de junção só se alteram células"
    (`isJoin`: mais de uma tabela). **A linha repetida** (a mesma linha de uma tabela em várias linhas da grade): a célula alterada guarda
    `change`, a linha da tabela (`changeKeyOf`: a tabela e os textos da chave, em JSON), e `editCell`/`undoCell` com `change` acham a pendência
    por ela em qualquer linha que a mostre; `linkedCells` repete a pendência nas outras linhas para a grade, o valor da célula, o menu e a
    grade salva (também nas que chegam pelo "carregar mais"), e `pendingCount` e `changesOf` contam e mandam UMA alteração por linha de tabela:
    a linha da grade editada em duas tabelas vira duas, cada uma com a sua `table` e a sua chave, e a API faz um `UPDATE` de cada (a faixa
    conta duas, e o "Ver SQL" mostra os dois). No banco sem log, a gravada sai pela `change` (`withoutApplied`), sem levar a da outra tabela.
    O cabeçalho (`columnHintsOf`): a dica diz o motivo da coluna que não se edita e, na junção, o que a editável altera ("Altera nome de
    cliente."); só na aba de consulta (`subject: "result"`, `GridEditing.columnReadOnly`), a coluna que não se edita leva "somente leitura"
    depois do tipo, como no canvas (e no nome para o leitor de tela), e a largura de saída da coluna passa a contar a marca quando o catálogo
    responde (`baseWidths` e `fitWidth` com a marca; sem isso o tipo a cortava com reticências). `columnHints` e `columnReadOnly` são
    memorizados pelo alvo: a grade refaz as larguras por eles. A barra do resultado só diz "Somente leitura" quando nenhuma tabela se edita,
    com o motivo de cada uma (`resultReadOnly`). **Conferido na tela** (Xvfb, PostgreSQL em contêiner, as tabelas `pallets`, `items` e
    `pallets_items` do pedido): o SELECT do dono (`pallets_items.*` numa junção de três) com `id` "somente leitura" e "Linha nova"/"Excluir
    linha" desabilitados no menu; uma junção com colunas de duas tabelas, a edição de uma célula de cada (a descrição do item repetido mudou nas
    duas linhas dele), o "Ver SQL" com os dois `UPDATE`, o Salvar ("2 alterações salvas.") e a releitura com os valores novos.
- **Valor completo das células cortadas** (RN-SQL-017, RN-GRADE-002): a grade continua mostrando o valor cortado (RN-SQL-011), e copiar e
  exportar levam o completo, que a API guarda em memória e devolve por `POST .../results/{resultID}/cells` (`full-values.service.ts`,
  `resultCells`: nunca lança, e acha cada valor pela posição que a resposta diz). As decisões são de `_lib/full-values.ts`, pura, com teste:
  `cutCellsOf` (só as cortadas da seleção, sem repetir, pela linha do resultado na API), `fetchFullValues` (lotes de até 10.000, um depois do
  outro; o lote que não veio deixa as células cortadas e conta; cancelado, devolve nulo) e `withFullValues` (as linhas com o valor completo no
  lugar e as marcas só das que ficaram sem). Quem liga é `completeValues`, em `use-record-edits.ts`: sem célula cortada responde na hora, sem
  pedido; com, a faixa da grade (`EditsBanner`, `fetching`) diz "Buscando os valores completos…" com "Cancelar", e a grade segue livre; uma
  busca nova cancela a anterior. `RESULT_NOT_FOUND`, `DATABASE_SESSION_NOT_FOUND` e `CELLS_INVALID` deixam as células cortadas sem aviso
  central; o resto (a API fora do ar) passa pelo cache de mutações (RN-AVISO-004). O valor sem completo vai cortado, e o aviso diz quantos
  (`recordsCopy.edit.menu.copiedCut` na cópia, `workbenchCopy.tableTab.records.exportedCut` no CSV).
  - **Onde vale**: Ctrl+C com o foco na grade copia a célula ativa (`copiesCell`, em `grid-editing.ts`; com Shift é o copiar avançado e segue),
    "Copiar valor" do menu da célula, e "Exportar CSV" dos Registros (as cortadas das linhas carregadas; sem nenhuma, o arquivo sai na hora,
    como antes). Vale na aba de consulta e nos Registros, que usam a mesma edição. **O copiar avançado (RN-GRADE-003) e o diálogo de exportar
    nos oito formatos (RN-GRADE-007) ainda não existem na tela**: só a biblioteca `_lib/grid-export/`. Quem os ligar monta o `GridSlice` e o
    passa por `completeSlice` (`grid-slice.ts`) com o que `completeValues` achou, antes do formato.
  - **A linha do resultado na API** é a da grade, salvo depois de um Salvar da aba de consulta que tirou ou pôs linhas sem executar de novo
    (RN-EDIT-009): `savedResultOf` devolve `sourceRows` (a linha de antes de cada uma, nula na nova; um segundo Salvar continua a conta), o
    executor a guarda (`RowsState.sourceRows`, por `keepSaved`) e ela viaja com a aba para outra janela (`window-messages.ts`). Sem ela, a cópia de
    uma linha depois de uma excluída pediria o valor da linha errada.
  - **Conferido na tela** (Xvfb, PostgreSQL em contêiner, `text` de 50.000 caracteres com acentos e `bytea` de 100.000 bytes): o Ctrl+C e o
    "Copiar valor" deixaram na área de transferência os 50.000 caracteres, com o MD5 igual ao do banco, e o "Exportar CSV" gravou o texto e o
    binário inteiros (o `Blob` que a tela entrega ao download; o diálogo de salvar do sistema foi trocado no teste). Para ler a área de
    transferência pelo protocolo de depuração: `navigator.clipboard.readText()` com `userGesture: true`.
- **Área de resultado recolhível** (RN-PAINEL-001): o estado é um redutor puro (`_lib/result-layout.ts`: `split`, `collapsed`,
  `maximized` e `resultPercent`, de 15 a 85, que fica guardado e volta ao restaurar) em `useReducer` na aba. Recolher e maximizar
  **não desmontam** nada (`h-0` e `inert`): é o que guarda o histórico de desfazer do editor e a rolagem da grade.
  `collapsedSummary` é o texto da barra recolhida; a divisória (`result-splitter.tsx`) é um `separator` horizontal focável e só
  existe com a divisão à mostra; executar restaura só a recolhida; os botões chegam ao `ResultPanel` pela propriedade `actions`
  (`result-actions.tsx`). O que a tela de uma aba lembra quando o componente dela desmonta com a aba viva (o zoom e a rolagem do
  diagrama, o filtro e a ordem dos Registros e a seção da Estrutura, ao trocar de vista; a divisão e o recolhido da consulta, se ele remontar)
  fica em `_lib/tab-memory.ts`, pelo ID DA ABA (um mapa de módulo; com o executor como chave, como já foi, o bloqueio, que troca os executores,
  apagava o filtro). Quem a apaga é o `WorkbenchProvider`, que tem a lista de abas: a aba que fecha (ou é podada com a conexão) leva a dela, e o
  desmonte do provedor (sair do cofre) apaga todas, para o texto dos filtros não ficar para o usuário seguinte; o bloqueio por inatividade não
  apaga nada (há teste dos três). Ir a outra tela não precisa dela: a área de trabalho não desmonta.
- **Conferir com banco de verdade, sem janela**: `pnpm build`; `scripts/run-hidden.ps1 -Exe node_modules\electron\dist\electron.exe
  -ExtraArgs <pasta do client> -UserDataDir <descartável> -Desktop prism-<nome>`; o cofre sobrevive a `Page.reload` em
  desenvolvimento, e o login por `Input.insertText` funciona; o `waitFor` do seu roteiro não deve devolver o elemento
  (`returnByValue` falha com "Object reference chain is too long"). No Linux, sob Xvfb: `xvfb-run -a pnpm dev --remoteDebuggingPort <porta>
  --noSandbox -- --user-data-dir=<descartável>` (o `--` leva o argumento ao Electron, e a pasta de dados fica fora da sua); a conexão de teste
  pode ser criada pela própria página, com `window.prism.getApiConfig()` e um `POST api/user/connections`, e um `location.reload()` a mostra no navegador.

## Filtrar como no DBeaver, o filtro do resultado e o F5 (RN-GRADE-011 a 013 e RN-TABELA-011)

Subseção "Filtrar como no DBeaver, e o autocompletar do filtro" da especificação: o "Filtrar" (F11) é a RN-GRADE-013, o filtro do resultado
a RN-GRADE-011 e o F5 a RN-GRADE-012.

- **O submenu "Filtrar" (F11)** no menu da célula, nas duas grades (Registros e resultado da aba de consulta). O modelo é `filterMenuItem`
  (`_lib/filter-menu.ts`, puro, com teste): "Filtrar por valor…" (Ctrl+F11); o grupo "Valor da célula" (`=`, `<>`, `>`, `<`, `LIKE` só em coluna de texto,
  `IS NULL`, `IS NOT NULL`); o grupo "Personalizado" (`= …`, `<> …`, `> …`, `< …`); e "Remover todos os filtros e ordenações". **O rótulo é a condição como
  ela entra** (`valueFilterOptions`, em `_lib/grid-export/value-filter.ts`: o nome por `quoteIdentifier` e o literal por `sqlLiteral`, cada um cortado em 30
  caracteres com reticências, sem controles nem marcas de direção; a condição que vai ao campo é a inteira). O que não se aplica vem desabilitado com
  "Não se aplica: <motivo>." (`grid-filter.copy.ts`): célula nula, cortada ou binária (só os de nulo e o personalizado), valor com controle, o literal que
  o Informix não aceita, o lógico que o Informix não ordena, o `contém` vazio, a linha nova (que não está no banco; os de nulo e o personalizado valem), a
  aba ocupada e **o campo em que a condição não se junta com segurança** (`joinFilter`: aspas, comentário de bloco, `{` do Informix ou `$tag$` abertos, ou
  um `;` que não é o do fim). O valor do "Filtrar" é o LIDO do banco, e não a alteração pendente da célula.
- **A junção ao campo** é `joinFilter(engine, campo, condição)`: separa a condição do que vem depois dela (`filterParts`, em `table-sql.ts`: a ordem de fora,
  o `;` e o comentário do fim), junta por `AND` entre parênteses (`mergeCondition`) e recoloca o resto como estava. A condição existente nunca termina num
  comentário (ele fica na parte de depois), então o campo continua numa linha só. O texto novo vai ao campo e é executado como o "Aplicar" (`filterRecords`,
  em `table-view.ts`, no molde do `sortRecords`; na aba de consulta, `applyResultFilter`), com a pergunta das alterações não salvas antes (RN-EDIT-007).
- **"Filtrar por valor…"** (`value-filter-dialog.tsx`): `distinctValues` conta os valores das linhas CARREGADAS (do mais frequente ao menos; empate, o que
  aparece primeiro; o nulo é um valor; a célula cortada conta à parte e não entra, nem o valor sem literal), a busca acha o texto em qualquer parte
  (`visibleValues`, no máximo 500 desenhados), e "Filtrar" monta `valuesCondition`: `coluna IN (…)`, `=` com um, e o nulo como `coluna IS NULL`, por `OR`.
  O "Personalizado" abre um campo pequeno sobre a grade, onde o menu abriu (`custom-filter-field.tsx`): o valor escrito vira literal pela RN-TABELA-007
  (`customCondition`), nunca SQL; o que não vira fica no campo com o motivo. **O foco entra no campo pequeno depois de ele ser posto no lugar**: escondido
  (`visibility: hidden`, até a medida) ele não o recebe, e o `autoFocus` do React chega antes (o defeito apareceu na tela: o que se digitava ia para a
  célula). Ao sair, o foco volta à grade só com o campo fora do DOM (o `StrictMode` desmonta os efeitos de mentira).
- **Quem liga** é `use-record-edits.ts`: recebe `filter` (`GridFilterSource`: o banco, o texto do campo e "há o que remover", lidos na hora da escolha, e
  `apply`/`clear`) e `refresh` (o "Atualizar" do menu, F5). A escolha é decidida de novo na hora (`filterPlan` com o contexto de agora: o campo pode ter
  mudado com o menu aberto). A grade chama `editing.onFilter(célula, ponto, "menu" | "values")` com F11 e Ctrl+F11 (`filterKey`, em `grid-editing.ts`), e
  `resultEditDialogs` desenha o menu (com `openSubmenu`), o diálogo e o campo pequeno.
- **O submenu do `ContextMenu`** (`components/ui/context-menu.tsx`): o item com `submenu` abre outro `menu` num portal ao lado (`placeSubmenu`, com
  teste), pela seta para a direita, Enter, Espaço, o clique e o mouse em cima; no submenu, seta para a esquerda e Esc voltam ao item, e Tab fecha tudo. O
  grupo com título (`{ label, items }`) é um `group` com nome, e o título não é item. `openSubmenu` abre o menu já com o submenu aberto e o foco no
  primeiro item dele; por isso **quem tinha o foco é lido na primeira renderização** (`useState`), e não no efeito: o submenu foca antes do efeito do menu.
  O clique fora considera os dois menus. Um nível só.
- **O campo de filtro é um CodeMirror de uma linha** (`filter-field.tsx`), o mesmo nos Registros e no resultado: controlado como o `input` de antes (`value`
  de fora troca o texto com o cursor no fim, anotado para não voltar como digitação), Enter aplica (com uma sugestão escolhida, o Enter a aceita: a lista
  abre sem nada escolhido), a quebra de linha que chega vira espaço (`singleLine`, com teste), desfazer vale, as cores são as do editor (`highlight`, agora
  em `_lib/completion-theme.ts`, com a lista de sugestões do editor, `completionTheme`) e a lista vai para o `body` (`tooltips({ parent })`), para a barra
  não a recortar. O texto de ajuda do campo vazio é o mesmo nos dois: "Insira uma expressão SQL para filtrar os resultados (use Ctrl+Espaço)". O teste
  do `RecordsFilter` troca o `FilterField` por um `input` que mostra o que recebeu.
- **O autocompletar do campo** (RN-TABELA-011; `_lib/filter-completion.ts`, com teste pela fonte de verdade): as colunas (nos Registros, as da grade, que
  são as da tabela; no resultado, as do resultado; as duas vistas guardam as da última grade, para o filtro que deu erro continuar sugerindo) e as
  palavras do filtro (`AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL`, `LIKE`, `IN`, `BETWEEN`, `ORDER BY`, `ASC`, `DESC`; as de duas palavras continuam
  depois do espaço, `is n`). O nome sai por `sqlName` (cru só quando o banco o lê como está; senão entre aspas), e com as aspas já abertas, por
  `quoteIdentifier`. Nada dentro de texto, de comentário ou depois de um ponto. Ao digitar, segue a chave do autocompletar do editor
  (`preferences.editor.autocomplete`, `activateOnTyping`); Ctrl+Espaço abre sempre (o mapa da biblioteca).
- **O campo no resultado da aba de consulta** (RN-GRADE-011): o mesmo `RecordsFilter` (`subject: "result"`, sem a linha do comando), no topo do corpo do
  `ResultPanel` (propriedade `filter`), quando há o que filtrar (`filterBaseOf`, em `_lib/result-filter.ts`: o comando do resultado na tela, sem o filtro; com
  o erro do comando filtrado na tela, o último filtrado, para a correção). Aplicar executa de novo o comando com `filter` no corpo de `POST …/queries`
  (`executeQuery`, só quando há filtro); o texto do editor não muda; o filtro viaja no `RunTarget` (`filter`), então "Executar de novo" e a aba que vai
  para outra janela o levam (`window-messages.ts` e `tab-transfer.ts`). A página traz `filterApplied` (`merged` ou `wrapped`, qualquer outro valor vira
  nulo); o embrulhado é só leitura, com o motivo da API ou, sem ele, `gridFilterCopy.result.wrapped`, que a faixa mostra. O 422 `FILTER_INVALID` (só com
  filtro) volta de `runner.run` como valor (`FilterRefusal`): nada é executado, o resultado e o cursor de antes ficam, sem aviso, e a frase da API vai ao
  campo (`problem: { message }`). O erro do banco num comando filtrado não marca o editor (a posição é a do comando que a API montou). Executar pelo editor
  limpa o filtro (`clearResultFilter`, só quando o comando vai de fato ser enviado). A ordem pelo clique no cabeçalho não existe no resultado: a ordem vai
  escrita no campo.
- **F5** (RN-GRADE-012): nos Registros é o "Atualizar"; na Estrutura e no Diagrama, o "Atualizar" da vista; na aba de consulta, o "Executar de novo"; no
  navegador, o "Atualizar" do nó escolhido, quando se aplica (`refreshesSelection`). Com algo em andamento, nada; com alterações não salvas na grade, a
  pergunta antes. Vale com o foco em qualquer ponto da aba: a aba de uma tabela trata a tecla na raiz (`refreshFromKey`, em `_lib/tab-refresh.ts`) e chama o
  que a vista à vista deixou ali (`useRefreshSlot`); a de consulta, na caixa que já trata o Ctrl+S. O campo de edição da célula não deixa a tecla subir. O
  menu da grade mostra "Atualizar" (F5).
- **Conferido na tela** (Xvfb, `pnpm dev` com a API desta árvore, PostgreSQL 18 em contêiner, `estoque.itens`): F11 na célula `11.901` abriu o submenu com o
  foco em "Filtrar por valor…", as setas e a seta para a esquerda e a direita andaram, Esc fechou um nível e depois o menu, com o foco de volta na grade;
  `"code" = '11.901'` deu 3 linhas e o comando `WHERE "code" = '11.901'`; Ctrl+F11 na coluna `quantidade` mostrou os valores com a contagem, e dois
  marcados deram `("code" = '11.901') AND ("quantidade" IN (10, 1))`; o personalizado `"code" <> …` com `A1` deu `"code" <> 'A1'`; "Remover todos" voltou ao
  `SELECT` puro; o campo sugeriu `CodigoBarras` e `code` para `Co` e escreveu `"CodigoBarras"`, sugeriu `IS NULL` e `IS NOT NULL` para `code is n`, e com
  o autocompletar desligado só abriu com Ctrl+Espaço; F5 na grade, no campo, na Estrutura e no nó da conexão pediu de novo o que cada um mostra. O filtro do
  resultado da aba de consulta só foi conferido com a API simulada (`use-query-runner.filter.test.ts` e `query-tab.test.ts`): a parte da API é de outra
  tarefa; na tela, o campo aparece acima da grade do resultado.

## Configurações (`src/app/settings`)

RN-CONFIG-001. A rota é `/settings` (`pathsConfig.settings`), sob o `WorkbenchProvider` como as outras telas de dentro: abrir e
fechar não apaga as abas.

- **Como se chega**: o item "Configurações" da barra superior (o ícone dos controles deslizantes e o texto, como os outros itens;
  a dica diz que Ctrl+, também abre) e Ctrl+, (Cmd+, no macOS) de qualquer tela de dentro do cofre (`SettingsShortcut`; `isOpenSettingsShortcut`: quem já
  tratou a tecla fica com ela). Esc e "Fechar · Esc" voltam à área de trabalho; a lista aberta de um campo trata o Esc primeiro.
- **Em todas as janelas** (RN-ABAS-004): o `storage` que chega quando outra janela grava tira a chave dela do que a loja guardava
  (`preferencesStore.refresh`), e quem lê lê de novo; a janela que grava já tem o valor novo.
- **Preferências** (`_lib/preferences.ts`, `use-preferences.ts`) são do dispositivo **e** do usuário do cofre: `localStorage`, chave
  `prism:preferences:<usuário em minúsculas>`, esquema Zod com **leitura tolerante campo a campo** (JSON inválido, objeto estranho
  ou valor fora do esquema volta ao padrão do campo, sem lançar). Se o `localStorage` falta, recusa o acesso ou lança ao gravar, elas
  vivem na memória da sessão e a tela segue. `usePreferences()` devolve `{ preferences, update, signedIn }`
  (`useSyncExternalStore`); quem só lê usa o nome do campo, em grupos (`preferences.editor.fontSize`): `theme`, `ui` (`fontFamily`, a fonte da
  interface), `editor` (fonte,
  tamanho, tabulação, `autocomplete` e `uppercaseKeywords`), `results` (`nullText` e `autoLoadMore`) e `security` (`lockEnabled` e `lockAfterMinutes`); `update` aceita um grupo pela metade, e o
  formato antigo (três campos soltos do editor) é migrado (`upgradeLegacy`). **Nunca guarde segredo nem
  dado de conexão ali**: quem apagar o `localStorage` perde só o gosto. As de atualização (verificar ao abrir, versão pulada) são
  outra coisa: moram no processo principal e a tela as lê e muda pela ponte (`window.prism.updates`).
- **Temas** (RN-CONFIG-001 e RN-CONFIG-003): são seis, os do canvas, na ordem dele: Prism Escuro (`dark`), Prism Claro (`light`), Monokai,
  Dracula, Nord e GitHub Claro (`github-light`). `system` não é um tema: é "seguir o sistema", que escolhe entre o Prism Escuro e o Prism
  Claro só com CSS, ao vivo. Os tokens do `globals.css` são `light-dark(claro, escuro)`, e quem escolhe a coluna é o `color-scheme` do
  `<html>`, que o atributo `data-theme` muda (sem atributo é o escuro, igual ao de antes, com teste). Cada um dos outros quatro é um bloco
  `:root[data-theme="…"]` que diz o `color-scheme` dele e troca **fichas que existem** (um teste reprova ficha inventada, e confere que o
  esquema do bloco é o de `themeSchemes`). O Prism Claro usa os valores do canvas onde ele os dá, e o resto é derivado; nos outros quatro, as
  cores do canvas só foram trocadas onde sozinhas não passavam, e um teste confere que essas são as únicas. **O `globals.test.ts` confere o
  contraste de TODOS os pares de texto e fundo de TODOS os temas** (WCAG: 4,5:1 para texto, 3:1 para o raio e o contorno da marca), a sintaxe
  sobre as superfícies e a seleção, e que a seleção e a linha selecionada se veem contra o fundo (1,15:1). **Token novo: escreva as duas
  colunas na mesma linha** (o teste confere), e dê o valor dele nos blocos dos outros temas que precisarem. **Tema novo**, em seis lugares: o
  bloco em `globals.css`; o id em `themeModes` (`preferences.ts`), em `themeSchemes` (`theme.ts`: claro ou escuro) e na lista de
  `public/theme-boot.js` (o `theme.test.ts` executa o arquivo e confere a lista); a prévia do cartão em `themes.ts` (o `themes.test.ts`
  confere que as cores dela são as dos tokens); e o nome em `settings.copy.ts`. O modo vai também para `prism:theme` (uma chave do
  **dispositivo**, não do usuário: o login acontece antes de se saber quem entrou) e `public/theme-boot.js` o aplica antes da primeira
  pintura. **O script tem de ser um arquivo clássico no `<head>`, sem `defer`** (ver "Política de conteúdo"); `theme.test.ts` o executa
  (`node:vm`) e confere a ida e volta com `applyTheme`. O tema do usuário entra por `ThemeSync`, assim que o cofre abre. O splash e o fundo
  da janela do Electron seguem escuros em qualquer tema (`electron/**`). A marca no tema claro está em "Marca, ícone e abertura".
- **A cor de sintaxe é ficha de tema**: `--color-syntax-keyword`, `-string`, `-number` e `-comment`, nos seis temas. O editor as lê pelo
  `HighlightStyle` de `sql-editor.tsx` (palavra-chave e tipo, texto entre aspas, número e comentário) e pela lista de sugestões, e a prévia
  do cartão do tema usa os mesmos valores. Nos dois temas do Prism são as cores do PostgreSQL, do sucesso, do acento e do texto apagado.
- **O editor recebe as preferências ao vivo** (`sql-editor.tsx`), em quatro compartimentos do CodeMirror (`Compartment`) que se
  reconfiguram sem recriar o editor, porque a área de trabalho fica montada por baixo das Configurações (`WorkbenchSlot`): `themeSlot` (fonte,
  tamanho, altura da linha e o esquema de cor, claro ou escuro, inclusive com "seguir o sistema" trocando com o app aberto), `tabSlot`
  (`tabSize` e `indentUnit`), `completionSlot` (o autocompletar) e `caseSlot` (as maiúsculas); as duas caixas têm um efeito à parte, para
  ligar uma não refazer o tema. O editor de outra aba nasce com as de agora (`initial`). **Extensão nova que depende de preferência ganha o
  próprio compartimento e a própria entrada de `initial`**, ou só vale para o editor criado depois. O padrão da tabulação é 4 (o do canvas; o
  editor usava 2). A fonte do editor é a de Configurações › Aparência (ver "Fontes"): o `themeSlot` a recebe pelas preferências, e não pela
  variável `--font-editor`, porque reconfigurar o compartimento é o que faz o CodeMirror medir o texto de novo.
- **Fontes** (RN-CONFIG-008; `_lib/fonts.ts`, `_lib/system-fonts.ts`, `_components/font-picker.tsx` e `font-sync.tsx`): Aparência tem "Fonte da
  interface" (`ui.fontFamily`, padrão IBM Plex Sans) e "Fonte do editor SQL" (`editor.fontFamily`, padrão IBM Plex Mono; o campo saiu da seção
  Editor SQL, que diz onde ele está, e a escolha da lista fixa de antes continua valendo). **O nome vira CSS**: o esquema (`fontNameSchema`) e a
  pilha (`fontStack`) só aceitam de 1 a 100 caracteres, sem espaço nas pontas, sem aspas, ponto e vírgula, chaves, barra invertida nem `\p{C}`
  (controle, formatação, direção de texto), e o nome vai **sempre entre aspas** com a fonte do app atrás: `"Inter", var(--font-app-sans)` e
  `"JetBrains Mono", var(--font-mono)`. A fonte que não está instalada cai na do app, sem erro (conferido: o Chromium desenhou a IBM Plex Mono
  com `Consolas` escolhida), e o campo diz que ela não está instalada; a preferência fica, e a fonte volta se for reinstalada. **Quem aplica** é o
  `FontSync` (montado ao lado do `ThemeSync`): põe as pilhas nas variáveis do <html>, `--font-sans` (o corpo e `font-sans`) e `--font-editor`
  (`font-editor`); a fonte do app tira a variável. A reserva da interface é `--font-app-sans` (num `:root` fora do `@theme`, para não virar
  classe), porque a escolha troca a `--font-sans`. Ao sair do cofre o `FontSync` desmonta e a janela volta às fontes do app: **diferente do
  tema, nada das fontes é lembrado no dispositivo**, e o login sempre abre na IBM Plex Sans. Em todas as janelas pelo `storage`, como o resto
  das preferências (conferido com uma aba levada a outra janela: a fonte do editor dela mudou com a escolha feita na primeira). **Onde vale**: a
  da interface, em todo o texto fora do código; a do editor, no CodeMirror e no SQL que a tela mostra fora dele (`font-editor`): o campo do
  filtro dos Registros e o comando executado embaixo dele, o "Ver SQL" e o DDL aproximado. A grade, a árvore, as etiquetas e o resto do que é
  `font-mono` não mudam. **A lista** é a da API de fontes locais do Chromium (`window.queryLocalFonts`, liberada em `permissions.ts`), lida na
  primeira vez que um dos campos recebe o foco (`systemFontsQuery`, a mesma para os dois, `gcTime: 0`: volta a ser lida a cada visita às
  Configurações): uma entrada por família, em ordem de nome (`Intl.Collator` pt-BR, sem caixa, numérica), sem o nome que não pode virar CSS.
  Sem a API, com a permissão negada, com erro ou com a lista vazia ela é `null`, e o campo aceita o nome digitado (Enter), se ele serve (senão,
  diz o que tirar). **Monoespaçada** (`monospaceProbe`): num canvas, dez "i" medem o mesmo que dez "M" (1% de folga), com a pilha
  `32px "<família>", sans-serif`; a reserva é proporcional, então a família que o canvas não acha, ou que não desenha letras latinas, não passa por
  monoespaçada, e antes de cada medida a fonte volta à reserva (uma pilha recusada não mede a anterior). No editor a lista vem com a do app,
  depois "Monoespaçadas" e "Outras fontes"; na interface, a do app e todas as outras. Conferido sob Xvfb: 26 famílias em 2 ms, e
  DejaVu Sans Mono, FreeMono, IPAGothic, Liberation Mono, Unifont e WenQuanYi Zen Hei Mono como monoespaçadas (IPAPGothic, a proporcional da
  mesma família, ficou nas outras). **O campo** é um combobox editável (`FontPicker`): fechado, mostra a escolhida; digitar filtra pelo pedaço
  do nome (sem caixa nem acento) e, com a lista lida, marca a primeira que combina; setas, Enter, Esc (o primeiro fecha a lista, o segundo
  desfaz o digitado, o terceiro chega às Configurações) e sair do campo desfaz. A lista é um portal como a do `Select`; o clique nela não tira o
  foco do campo (`mousedown` cancelado).
- **Autocompletar** (RN-CONFIG-004; `_lib/sql-completion.ts`; a única dependência nova foi o `@codemirror/autocomplete`, em 6.20.3 exato, a
  versão que a trava já resolvia): as palavras-chave do dialeto da aba e os **nomes que a árvore já carregou** daquela conexão (esquemas,
  tabelas, visões e colunas). Os nomes vêm do cache (`cachedLevels`: `getQueriesData(["tree", conexão])`), que **nunca busca**: o que a árvore
  não abriu não existe para o autocompletar, e nenhuma chamada à API sai por causa dele. Depois de `esquema.` saem as tabelas; depois de
  `tabela.` ou de um apelido, as colunas com o tipo; as tabelas de qualquer esquema carregado aparecem também sem o esquema (o `public` do
  PostgreSQL sem ele, os outros com `esquema.`). A lista abre sem nada escolhido (`selectOnOpen: false`: Enter e Tab seguem como eram),
  filtra por prefixo, Esc a fecha e Ctrl+Espaço a abre. **Depois de um ponto não entra palavra-chave nenhuma** (`keywordsSource`): a fonte de
  palavras-chave do `lang-sql` só se cala com o cursor encostado no ponto, e com uma letra depois dele (`pedidos.i`) a lista misturava as
  colunas com `if`, `ignore`… e repetia `id`, que o dialeto do PostgreSQL conta como palavra-chave. O ponto que conta é o que encosta na palavra
  em que o cursor está. O teste roda as fontes que a extensão de verdade entrega à biblioteca (o `override`, anotado com `autocompletion`
  embrulhada), e não uma cópia delas. A conexão é a da PRÓPRIA aba, que o editor recebe por propriedade (`connectionId`) e lê na hora do pedido.
  O nome entra sem aspas só quando o banco o lê como está escrito, e por `quoteIdentifier` em todo outro caso (`sqlName`: no PostgreSQL e no
  Informix, o nome simples em minúsculas; no Db2, o simples em MAIÚSCULAS; a palavra reservada, sempre entre aspas): é o que a pessoa digitaria,
  **outra regra que a das aspas dos comandos que o Prism gera** (essa é sempre aspas). A lista das reservadas (`reservedWords`) tem TODAS as do
  PostgreSQL, as "reservadas" e as "reservadas, podem ser função ou tipo" (`verbose`, `freeze`, `isnull`…): o teste as confere contra o que um
  PostgreSQL 18 devolve em `pg_get_keywords()`, categorias R e T; ao subir de versão do PostgreSQL, rode a consulta de novo. Db2 e Informix usam
  as palavras-chave do SQL padrão.
- **Converter palavras-chave para maiúsculas** (RN-CONFIG-004; `_lib/sql-keyword-case.ts`): converte a palavra que a pessoa acabou de digitar, na
  MESMA transação da tecla (um Ctrl+Z desfaz a palavra e o caractere), só numa inserção do teclado cujo primeiro caractere termina a palavra
  (espaço, vírgula, parêntese, ponto e vírgula, quebra de linha); colar, aceitar uma sugestão e desfazer não convertem. Só o que está na lista
  fixa `uppercaseWords` (as reservadas e as que montam o comando), e só onde a gramática do dialeto diz que é palavra-chave, `null` ou
  booleano: fora de aspas, de comentário e de nome depois de ponto. **A lista é fixa de propósito**: o dialeto do PostgreSQL marca `id`,
  `name`, `type` e `count` como palavra-chave, e converter "tudo o que o dialeto marca" reescreveria o nome das colunas do usuário. Um falso
  negativo deixa a palavra como foi digitada; um falso positivo reescreve um nome dele. O preço: `PRIMARY KEY` sai `PRIMARY key`.
- **A navegação da tela não usa `<a href="#cfg-…">`** como o canvas: a rota é em hash, e uma âncora a trocaria. São botões que rolam
  e dão foco ao título da seção; `activeSection` (pura) decide a marcada pela rolagem.
- **O que ainda não existe é um `ComingSoonCard`**, sem controle nenhum: o `page.test.ts` confere que ele não tem `input`, `select`,
  `textarea`, `button` nem papel de controle. Para uma seção ganhar efeito, troque o cartão pela seção de verdade e tire-a de `soon`
  em `sections.ts`. Hoje só as **Transações** são "em breve". A ordem das seções, a da navegação e a da página, é Conta, Aparência, Editor
  SQL, Resultados, Segurança, Atualizações, Drivers e Sobre, e depois as "em breve".
- **Conta: trocar senha** (RN-COFRE-013; `account-section.tsx`, `_lib/account.ts` e `account.service.ts`; é a primeira seção, como no
  canvas): a senha atual, a nova e a confirmação. A confirmação só se confere na tela (`changePasswordSchema`: a nova de 8 a 128 caracteres,
  sem regra de composição, e nenhuma senha é aparada); a API recebe `{ currentPassword, newPassword }` (`PUT api/user/password`, 204).
  **Cada recusa aparece no campo que a API nomeia** (`changePasswordOrRefuse`, `refusalFields`) e a senha recusada volta VAZIA:
  `INVALID_PASSWORD` esvazia a atual; `PASSWORD_INVALID` e `PASSWORD_UNCHANGED` esvaziam a nova e a confirmação. O quinto erro seguido é
  `VAULT_LOCKED`: o cofre fecha e a tela vai ao login com o aviso de cinco tentativas (o `onSuccess` mora na própria `useMutation`, que roda
  mesmo com a seção já desmontada pelo `VaultGuard`; a resposta não diz quantas tentativas faltam, e a tela não inventa contador). Trocada a
  senha, os campos se esvaziam, a tela avisa, e o cofre continua aberto. **Nenhuma senha mora em estado do React**: os campos não são
  controlados (o valor sai pelo `FormData`), a mutação leva `gcTime: 0` e é esvaziada (`reset`) assim que a resposta chega, o que apaga as
  `variables` com as senhas; um campo `userName` escondido e só de leitura diz ao gerenciador de senhas e ao leitor de tela de que conta é a
  senha.
- **Resultados** (RN-CONFIG-005; `results-section.tsx`): o texto do valor nulo na grade (de 1 a 12 caracteres, que não sejam só espaços nem
  tenham caractere de controle ou de direção de texto) e "buscar mais linhas ao rolar até o fim" (`autoLoadMore`, desligado de saída).
  Com ele ligado a grade pede a página seguinte sozinha (`autoLoadArmed`, em `result-paging.ts`): uma por vez, com linhas na tela, mais a
  ler e nada em andamento (página, contagem, comando ou cancelamento), e o cursor fechado é o fim. "Linhas por busca" depende da API
  (RN-SQL-016) e é "em breve". Os campos de texto e de número de Configurações usam `useDraft`: o texto válido vale na hora, sem botão de
  salvar; o inválido não muda nada, mostra o erro depois de parado (600 ms) e, ao sair do campo ou no primeiro Esc, volta ao valor que vale.
- **Segurança** (RN-SEG-001; `security-section.tsx`): liga e desliga o bloqueio por inatividade e escolhe os minutos (de 1 a 240); com ele
  desligado os minutos ficam à vista e desabilitados. A frase da seção não fala da opção "Somente leitura" do texto do canvas, porque ela
  ainda não existe (o `page.test.ts` confere). Ver "Bloqueio por inatividade".
- **Sobre** mostra o nome, a versão e a **pasta de dados em uso** (`dataFolderQuery`, lida uma vez pela ponte; só para ver e copiar, a tela
  não a abre nem a troca; fora do Electron a linha não aparece): ver `prism:data-folder`, em "Processo principal".

## Bloqueio por inatividade (RN-SEG-001)

Seção 19 da especificação: **é ela que manda**, e o que segue diz onde ficam as peças e o que não é óbvio. Sem tecla nem ponteiro na janela
por 10 minutos (1 a 240; pode ser desligado: `security.lockEnabled` e `security.lockAfterMinutes`, nas preferências) e sem comando em
andamento em nenhuma aba, o Prism avisa 60 s antes (30 s com 1 minuto) e bloqueia: a API fecha o cofre, e a tela pede a senha do MESMO
usuário. Desbloquear devolve as abas e o texto de SQL; os resultados são descartados; as outras telas de dentro do cofre voltam ao estado
inicial; "Sair" encerra de verdade.

- **Quem faz o quê.** `lib/api/vault-lock.ts` (o estado "bloqueado", a época e a barreira dos pedidos). Em `app/_lib/`: `idle-timer.ts` (a
  contagem, pura, com relógio injetado), `idle-watch.ts` (`watchActivity`: os eventos da janela ligados ao temporizador), `use-idle-lock.ts`
  (o gancho), `lock-vault.ts` (**a ordem dos passos de bloquear e de desbloquear, e o que cada falha faz**, com dependências injetadas),
  `lock-dialog.ts` (o que o diálogo da tela de bloqueio faz com o que lhe acontece) e `close-portals.ts`. Em `app/_components/`:
  `vault-lock.tsx` (liga as peças; é montado pelo `WorkbenchProvider`, ao lado das telas, e não acima dele: bloquear não o desmonta),
  `idle-warning.tsx` (o aviso), `lock-screen.tsx` (a tela) e `remount-on-lock.tsx`. E `workbench/_lib/workbench-lock.ts` (o que sai do
  cache e das abas). **A ordem dos passos e as falhas ficam em `lock-vault.ts` e no teste dele; este guia não as repete.**
- **Com mais de uma janela** a contagem é de todas e o bloqueio também (RN-ABAS-004): `peers` do `useIdleLock`, `peerAction` e
  `closedByAnotherWindow`, descritos em "Abas que se movem e outras janelas".
- **A barreira.** Bloqueado, `apiRequest` espera o desbloqueio (não falha e não avisa); só passa o pedido com `whileLocked` (`signIn` e
  `signOut`). Um 401 `VAULT_LOCKED` que chega com o app bloqueado não leva ao login (um pedido que já estava a caminho apagaria as abas), e a
  falha de consulta não vira aviso. `vaultLock.reset()` no desmonte do `VaultGuard` solta o que ficou preso: sem isso o login seguinte
  começaria bloqueado. **Chamada nova que precise sair com o Prism bloqueado tem de usar `whileLocked`.**
- **O que o bloqueio mantém e o que descarta** (`workbench-lock.ts`). Mantém as abas, o texto de SQL, a aba ativa e os nós abertos da árvore,
  e as listas do cofre (pastas e conexões). Descarta os resultados (cada aba ganha um **executor novo**, e o antigo sai de cena de vez,
  `retire()`), as sessões (`tab.sessionId` volta a `null`: a API já as fechou) e o dado de banco do cache (`["database-session"]`, `["tree"]`,
  `["table-structure"]` e **qualquer família fora da lista do que fica**, `keptAtLock`: registrar uma família nova de dado de banco não exige
  mexer no bloqueio). Ao desbloquear, a árvore se refaz do zero (uma sessão nova por conexão aberta) e cada aba só volta a falar com o banco
  quando é vista ou executada: a de tabela à vista recarrega os registros, e as escondidas esperam ser abertas (ver "Aba à vista", em "Área de
  trabalho"). **A vista Registros recarrega porque o executor da aba é novo e o efeito dela tem o `runner` nas dependências**: mudar isso a
  deixaria em "Carregando os registros…" depois do desbloqueio.
- **As outras telas e o que está aberto por portal.** Conexões, Configurações e Drivers se **remontam** a cada bloqueio (`RemountOnLock`, em
  `routes.tsx`, em volta do `Outlet`; a chave é a época, `vaultLock.epoch()`, que sobe só no bloqueio): um formulário aberto, uma senha de
  conexão revelada ou digitada e ainda não gravada e um rascunho de campo não sobrevivem. **A área de trabalho NÃO se remonta** (o
  `WorkbenchSlot` fica ao lado do `RemountOnLock`, e o `routes-lock.test.ts` confere os dois lados): remontá-la apagaria o cursor e o
  histórico de desfazer que o bloqueio manda manter. A remontagem só acontece com a busca da URL vazia (`remountStep`, pura) e a limpa com
  `replace`: as telas gastam `?connection=` e `?driver=` assim que os usam (`useSpendParam`), e isto cobre o que ainda não tinha sido gasto no
  instante do bloqueio. O que está aberto por portal no `body` (diálogo, menu, lista de um `Select`) fecha por `closeOpenPortals`, que manda
  um `Esc` a cada um: **nenhum componente sabe do bloqueio**, e cada um respeita o que já respeita (um diálogo que só se resolve por botão,
  ou com uma ação em andamento, não fecha e reaparece no desbloqueio). Ficam de fora a tela de bloqueio e o diálogo de versão nova
  (RN-ATUALIZA-003: sair dele é "Depois", escolha da pessoa).
- **A tela é um `<dialog>` aberto com `showModal()`, e não um `inert` num contêiner**: o `inert` posto na área de trabalho não alcança os
  portais (`Dialog`, `ContextMenu`, `Select` e os avisos vivem no `body`), e o `<dialog>` modal deixa o resto do documento inerte, inclusive
  o que nascer depois, prende o Tab e devolve o foco ao fechar. Não o "conserte" para um `inert`. Nada o fecha nem leva o foco dele
  (`lock-dialog.ts`: o cancelamento do Esc é cancelado e, se o Chromium o fechar mesmo assim, ele reabre; o foco volta ao campo de senha), e
  um ouvinte de captura em `window` corta o teclado que chegue de fora do diálogo, então nenhum atalho global funciona (Ctrl+, inclusive: um
  atalho novo não precisa saber do bloqueio); o `role="dialog"` escrito é o que o diálogo de versão nova procura (`focusIsElsewhere`).
- **Desbloquear** é a chamada de entrada (`signInOrRefuse`) com o usuário da sessão em cache e a senha digitada; senha errada mostra a frase
  da tela de login, e só se desbloqueia depois de conferir que a resposta é do mesmo usuário (`unlockVault`). "Sair" faz a saída de verdade
  (`signOut`, `navigate(signIn)`, `queryClient.clear()`). O cofre fechado por OUTRO motivo (a API reiniciou, o quinto erro ao revelar a senha
  ou ao trocar a senha) continua levando ao login: só o bloqueio por inatividade passa pela barreira.
- **O temporizador**: minutos de 1 a 240 (fora disso, ou não inteiro, valem 10); o aviso vem 60 s antes (30 s com 1 minuto, `min(60 s,
  limite/2)`: com 60 s ele voltaria a cada tecla, porque mexer o cancela); com comando em andamento não conta e recomeça do fim do último;
  desligado não conta (e ligar de novo recomeça do zero). `watchActivity` ouve `keydown`, `pointerdown`, `pointermove` (só se mudou de
  lugar: o navegador o repete quando o conteúdo sob o ponteiro muda) e `wheel` em `window`, **na captura e passivos** (o `Dialog` para a
  propagação do teclado, e um ouvinte em bolha não veria a pessoa digitando), **só o que a pessoa faz** (`isTrusted`: um evento que um
  programa dispara na página não mantém o Prism desbloqueado); a janela voltar a aparecer também confere na hora (o navegador atrasa os
  temporizadores de uma janela escondida), e o toque depois de o prazo acabar bloqueia em vez de reiniciar (a janela dormiu).
- **Como conferir sem janela**: com `lockAfterMinutes` em 1, `Input.insertText` **não** dispara `keydown` (não conta como atividade), e um
  `dispatchEvent` da página também não conta (`isTrusted`): use `Input.dispatchKeyEvent` ou o mouse pelo protocolo. **Não injete entrada nos
  60 s que antecedem o bloqueio**: o aviso vem aos 30 s, e qualquer tecla ou clique o cancela e reinicia a contagem. O `innerText` de uma
  árvore virtualizada dentro de um contêiner escondido vem vazio (não há linhas desenhadas). Com a API de `.api-dev` de outra frente de pé,
  o `dotnet run` falha com `MSB3021`: use uma cópia privada do app com uma junção para `src/api`.

## Drivers (`src/app/drivers`)

Seção 16 da especificação (RN-DRIVER-001 a 009 e "O que a lista garante"). A tela foi feita **contra a API simulada**, antes de as
rotas existirem (Tarefa 22 antes da 21), ao pé da letra do contrato; o que a seção garante está em "O que a lista garante", abaixo, e o que
ainda é suposição da tela, em "Suposições que sobraram".

- **O item da lista** (`driverSchema`, `drivers.schema.ts`). `state` é um texto que vira `comingSoon` se a tela não o conhece (a API pode
  ser mais nova que a tela): "Em breve", **sem botão**, e a lista não cai. Estado **ausente ou que não é texto** é resposta inválida.
  `engines` aceita qualquer inteiro; só 1, 2 e 3 viram etiqueta (`knownEngines`). Toda chave vem sempre (a seção garante), então nenhuma é
  opcional, e `totalBytes` é positivo. **Um `license.url` que não é `https://`, ou que tem caractere de controle, de direção de texto
  (`U+202E`), invisível ou espaço (`isLicenseUrl`: `\p{C}` e `\p{Z}`), faz a licença valer como ausente**: sem "Copiar link" e sem instalar.
  Escolhi recusar, e não limpar o endereço: copiar o que não é o que se vê seria o pior caso, e limpar esconderia um catálogo estranho.
  Todo o resto é validado de verdade: um item fora do formato é `RESPONSE_INVALID`.
- **O modelo** (`drivers.model.ts`, puro e testado) diz tudo o que a tela decide: os quatro grupos na ordem (`groupDrivers`: instalados
  e embutidos; disponíveis para baixar, com os que baixam e os que falharam; sem driver para a plataforma; em breve), o estado em palavras
  (`stateLabel`), o botão de cada estado (`actionOf`: `bundled`, `unavailable` e `comingSoon` não têm), a porcentagem (`progressPercent`;
  `progress` nulo é "o primeiro byte ainda não chegou", e a barra não inventa porcentagem) e o tamanho (`formatMegabytes`: 1 MB = 1.048.576 bytes, a conta do Windows).
- **A consulta periódica** é a `refetchInterval` do próprio `driversQuery` (`pollInterval`, em `drivers.polling.ts`): 1 s enquanto algum
  driver está `installing`, e `false` assim que nenhum está. Duas regras a mais, com estado de módulo (o `refetchInterval` só recebe a
  consulta, não o `QueryClient`; o estado recomeça ao abrir a tela): (1) **depois de um 202** a consulta fica ligada por 10 s mesmo com a
  lista ainda em `available` (`keepPollingAfterInstall`, rede de segurança: a seção garante que a lista já traz `installing`); (2) com a
  API viva e respondendo erro, **para depois de 3 erros seguidos**, e só o primeiro dá aviso (o `driversErrorMeta.silent` é o `meta` da
  consulta, lido pelo aviso central na hora do erro). A tela diz "A lista de drivers parou de atualizar." com "Atualizar a lista", que
  recomeça a contagem; ela assina o estado do módulo (`subscribePolling`, `useSyncExternalStore`) porque o terceiro erro **não muda nada**
  do que o TanStack entrega ao componente (segue `isError`, com a mesma lista) e a tela não seria desenhada de novo: a conferência sem janela
  pegou isso, o teste de renderização não. Sair da tela solta o observador e para a consulta. Só a tela de Drivers busca a lista (a API pode nem ter a rota ainda, e a barra superior não pode pedir um erro a cada
  login); a barra só **lê** o cache (`enabled: false`), e por isso o `driversQuery` tem `gcTime` infinito. O TanStack decide "estou num
  servidor" (e então não agenda intervalo) quando o módulo carrega, olhando `window`: o teste do intervalo define `window` antes dos imports.
  O `throughMutationCache` (chamada pelo cache de mutações, para a falha ir ao aviso central) mora em `lib/api/mutation-cache.ts`, e não mais em `use-query-runner.ts`.
- **O que a lista deixa para trás é acontecimento, não estado** (`watchDriverTransitions`, `drivers.watch.ts`): assina o cache e compara
  cada lista que chega com a anterior. `restartRequired` que passou de falso a verdadeiro (instalação terminada **ou** remoção, sem depender
  do `state` de um driver removido) abre o diálogo de reinício; `installing` que virou `failed` dá o aviso de erro. A primeira lista vista
  não é transição, mas a que já estava no cache quando a tela abriu é o ponto de partida: uma instalação que terminou enquanto a pessoa
  estava em outra tela abre o diálogo ao voltar.
- **O reinício é o do `ApiGate`** (`useApiRestart`, em `api-gate.tsx`), o mesmo do "Reiniciar" da tela de erro, e chama
  `window.prism.restartApi()` por ele. Uma tela que chamasse a ponte por conta própria deixaria de pé o `QueryClient` e a área de trabalho
  da API antiga (o processo principal não manda `prism:api-exit` num reinício que o próprio app pediu), e uma falha ao subir não teria onde
  aparecer. Pelo `ApiGate` tudo desmonta, a API nova sobe com o cofre fechado e o `VaultGuard` leva ao login; as abas de SQL abertas
  se perdem, e é isso que o diálogo de instalação avisa antes ("pede a sua senha de novo", RN-DRIVER-005).
- **O diálogo de reinício** (`restart-dialog.tsx`) é um `Dialog` com `dismissible={false}` (sem X; Esc e clique fora não fecham: `canClose`,
  em `dialog.tsx`, com teste) e dois botões: "Reiniciar agora" e "Depois". O "Depois" existe porque a RN-DRIVER-005 diz que a pessoa pode
  adiar o reinício, com um lembrete à vista e o driver ainda sem uso: com ele o reinício continua pendente, e a tela (a faixa de aviso com
  "Reiniciar agora", e o selo "Reinício pendente" na linha) e a barra superior (um ponto no "Drivers") lembram. Não bloqueia o resto do app.
  **O foco inicial é de "Depois"**, e não de "Reiniciar agora": o diálogo abre sozinho no fim da instalação, e o reinício fecha o cofre e as
  abas de SQL; um Enter ou Espaço que a pessoa já ia dar a outra coisa não pode reiniciar. O diálogo de instalação, a faixa e o diálogo de
  reinício dizem, todos, que **as abas de SQL abertas serão fechadas** (RN-DRIVER-005).
- **O endereço da licença é só texto** (`install-driver-dialog.tsx`): `select-text` mais "Copiar link" (`navigator.clipboard`; `app://prism` é
  seguro, e se falhar o aviso manda selecionar e copiar). Sem `<a>`, `href`, `window.open` nem ponte nova no preload (o app não navega para
  fora, RN-SHELL-001). O botão "Baixar e instalar" só libera com o aceite, e nunca sem licença no catálogo, mas **quem guarda o
  aceite é o `createInstallFlow`** (`install-driver-flow.ts`, um objeto fora do React como o `QueryRunner`, testado sem DOM): `confirm`
  não envia nada sem o aceite marcado, sem licença, com um pedido em andamento ou depois de uma recusa, e o corpo leva o aceite de verdade
  (`installDriver(id, accepted)`), não um `true` fixo. O atributo `disabled` do botão só desenha essa regra. Depois de **qualquer recusa**
  (409, 404, 422, entre elas `DRIVER_NOT_FOUND`) o diálogo mostra a mensagem da API e não envia de novo: o que ele sabe é velho, e a pessoa o
  fecha e abre outra vez com a lista nova. O que o diálogo desenha é `InstallDriverDialogView`, só de propriedades: é o que os testes
  renderizam, com o `Dialog` trocado por um sem portal (o de verdade usa `createPortal` e `document`, que o renderizador de servidor não tem).
- **`DRIVER_NOT_INSTALLED` (RN-DRIVER-006) em três lugares**, sempre com "Instalar driver" (`InstallDriverLink`, um `Link` para
  `pathsConfig.drivers`) **ao lado** do que já existia: a linha de erro do nó da conexão na árvore (`LevelState.error.code` →
  `NavNode.errorCode`; fica "Tentar de novo" e "Instalar driver", e o link entra no mesmo teclado do botão ao lado: `data-row-toggle`, foco e
  setas), o resultado de "Testar conexão" (`TestFailure`: a mensagem e, abaixo e à
  esquerda dela, o link; à direita ele ficaria sob o aviso de erro numa janela baixa) e a área de resultado do editor (`ErrorState.source:
  "driver"`, que, como `connection`, não é resultado de comando: um resultado que já está na tela fica). A frase é a da API. A rota de
  Drivers fica sob o `WorkbenchProvider`, para o "Instalar driver" não perder as abas. O 422 traz o `driverID` como extensão (seção
  16): os três guardam-no (`ErrorState.driverID`, `NavNode.errorDriverID`, `TestFailureState.driverID`, lido por `driverIdOf`) e o link vai
  para `/drivers?driver=<id>`, onde a linha daquele driver sai destacada (`aria-current`) e entra na tela. **A página gasta o parâmetro**
  (`useSpendParam("driver")`): ele sai da URL com `replace`, e o destaque fica no estado da página enquanto ela está montada (voltar a Drivers depois, ou remontá-la pelo bloqueio, não destaca
  nem rola de novo). Sem a extensão, o link leva à tela sem apontar nada.
- **O que a lista garante** (seção 16, e o que a tela faz com cada garantia): toda chave vem sempre, com `null` quando não se aplica
  (`sizeBytes`, `license`, `platformNote` e `error.detail` podem ser nulos; `license` nunca o é nos estados instaláveis, e o endereço dela é
  `https://`); com o 202 a lista já traz `installing`, com `progress` nulo até o primeiro byte e `totalBytes` o tamanho do catálogo (nunca
  zero); cancelar devolve `available`, sem `error`; `failed` fica até uma nova tentativa, e o POST de instalar vale a partir dele; depois
  de removido o driver vem `available` com `restartRequired` verdadeiro (a linha mostra "Disponível" e o selo "Reinício pendente"), e as
  sessões que o usavam seguem até o reinício; o 422 `DRIVER_NOT_INSTALLED` traz o nome do driver no detalhe e `driverID` como extensão.
- **Suposições que sobraram** (a seção 16 não diz; a Tarefa 21 as confere): o POST de instalar devolve 202 com ou sem corpo (a tela não lê o
  corpo); o `DELETE` de instalar numa instalação que acabou responde 409 `DRIVER_NOT_INSTALLING` (a tela mostra o aviso central e atualiza a
  lista); `restartRequired` volta a falso depois do reinício; um `driverID` que não está na lista só não destaca linha nenhuma.
- **Como foi conferida sem janela**: `pnpm build`, `out/renderer` servido por um servidor estático local e aberto num Chrome com
  `--headless=new --remote-debugging-port`; um script injetado antes do app (`Page.addScriptToEvaluateOnNewDocument`) define `window.prism`
  (com um `restartApi` que conta as chamadas) e troca `window.fetch` por uma API em memória, com o progresso andando pelo relógio (e, para a
  rede de segurança do 202, a lista ainda em `available` por uns segundos). É o mesmo
  método de "Conferir na tela sem a API ter as rotas", acima.

## Atualizações (`electron/update`, `src/components/update`)

Seção 17 da especificação (RN-ATUALIZA-001 a 009). **O app baixa e executa um instalador**: é a parte mais sensível do projeto depois
do cofre. Três regras não se negociam, e todo o desenho serve a elas: (1) nada é executado nem entregue ao usuário sem a soma SHA-256
bater com as DUAS fontes; (2) nenhum endereço que venha do conteúdo da rede é seguido; (3) a tela não ganha permissão de rede e não
passa endereço, caminho nem nome de arquivo ao processo principal.

- **Quem faz o quê.** O processo principal fala com a rede, grava e executa. A tela só mostra e pede. A API em C# não participa. A
  política de conteúdo da janela não mudou.
- **Os arquivos de `electron/update/`**, todos sem Electron (o vitest os exercita) menos um: `version.ts` (só `vX.Y.Z`; tag malformada
  e pré-lançamento são ignorados antes de virar comparação, pasta ou endereço), `origin.ts` (a origem e os ÚNICOS construtores de
  endereço), `packages.ts` (a lista de pacotes e a escolha pela instalação em uso), `releases.ts` (lê o JSON das releases campo a
  campo), `checksums.ts` (as somas das notas e do `SHA256SUMS`), `download.ts` (prazo, tetos, redirecionamento, soma do que gravou),
  `preferences.ts`, `install.ts`, `updater.ts` (o estado e a ordem das coisas; confere tudo o que chega da tela), `update-state.ts` (só
  tipos: é o que a tela importa, porque `updater.ts` traz consigo módulos do Node e um `.mjs`, que o `tsconfig.json` da tela não aceita),
  `http.fake.ts` (o transporte de mentira dos testes) e `net-transport.ts`, **o único que importa o Electron** e por isso sem teste de
  unidade (conferido por sonda e de ponta a ponta).
- **A origem (RN-ATUALIZA-001).** O `dist` lê `PRISM_UPDATE_API` (`https://…/api/v4`, sem usuário, senha, consulta nem fragmento) e
  `PRISM_UPDATE_PROJECT` (só dígitos), valida (`parseUpdateOrigin`, em `scripts/dist-plan.mjs`, a MESMA função que o app usa ao ler) e
  as passa ao electron-builder em `-c.extraMetadata.prismUpdateApi=…` e `-c.extraMetadata.prismUpdateProject=…`: duas chaves planas
  do `package.json` DENTRO do pacote (`app.asar`). O electron-builder grava o identificador como número (`42`), e o leitor aceita os
  dois. Sem as duas o `dist` avisa e o pacote sai sem origem (o app não consulta, e "Verificar atualizações" diz isso); só uma, ou
  uma inválida, falha. **No app empacotado a origem vem SÓ desse `package.json`** (`app.getAppPath()`): variável de ambiente em tempo de
  execução nunca a muda, como o `ELECTRON_RENDERER_URL`. Em desenvolvimento, e só nele, vem das mesmas duas variáveis lidas do ambiente,
  e pode ser `http://127.0.0.1:<porta>`. Nenhum endereço de repositório fica em arquivo versionado (RN-ABERTO-003). Conferido num
  pacote `--dir`: as chaves estão no `package.json` do `app.asar`, o app empacotado consultou a origem gravada e um servidor local
  apontado pelas variáveis de ambiente não recebeu nada.
- **A consulta (RN-ATUALIZA-002).** `GET <api>/projects/<id>/releases?per_page=100` (as cem mais recentes, o máximo da API; os
  pré-lançamentos contam), sem token, cookie nem cabeçalho de identificação (o agente é `Prism/<versão>`); prazo de 10 s; no máximo
  4 MiB; **não segue redirecionamento**. Só entram as estáveis mais novas que `app.getVersion()`, e **a tela recebe no máximo as 20
  mais recentes** (`maxOfferedReleases`, em `updater.ts`), com a contagem das que ficaram de fora (`omitted`): desenhar dezenas de
  versões com notas no teto de tamanho pararia a tela. **O que vai à tela é menos do que o processo principal guarda:** as notas de
  cada versão com no máximo 400 linhas e uma linha final dizendo que foram cortadas (`clipNotes`, em `releases.ts`; a cerca de código
  aberta é fechada antes), e só as somas dos nomes de pacote conhecidos daquela versão (`isPackageFile`). A conferência usa o texto e
  as somas inteiros (`found`), nunca o que foi para a tela. Ao abrir, no máximo uma a cada 24 horas: a hora gravada é a da TENTATIVA (uma
  máquina sem rede não consulta a cada abertura), e uma hora no futuro vale como "nunca consultou". A falha ao abrir só vai para o
  log (`[prism] atualização: …`). A consulta manual não depende das 24 horas, de "Não verificar ao abrir" nem da versão pulada.
- **Linha de comando que desliga o atualizador (RN-ATUALIZA-008).** O app empacotado aberto com `ignore-certificate-errors`,
  `ignore-certificate-errors-spki-list`, `host-resolver-rules` ou `host-rules` não consulta nem baixa nada naquela abertura
  (`updatesBlocked`, em `origin.ts`, pura e testada; o `main.ts` pergunta a `app.commandLine.hasSwitch`): os dois primeiros fazem o
  transporte aceitar certificado que não confere, e os dois últimos mandam o pedido a outro servidor. "Verificar atualizações"
  responde `blocked`, e a tela diz por quê e o que fazer, sem citar o nome do argumento. Em desenvolvimento a regra não se aplica.
  Os "fuses" do Electron não cobrem isso: eles não fecham argumentos do Chromium.
- **As somas (RN-ATUALIZA-005) são contrato com `scripts/ci/release-notes.sh`.** Nas notas vale o ÚLTIMO título exatamente
  `### Somas SHA-256`, seguido de uma cerca que abre, das linhas no formato do `sha256sum` e da cerca que fecha, sem nada depois;
  qualquer coisa fora disso não dá soma, e sem soma a atualização é recusada. No `SHA256SUMS`, as mesmas linhas. Nome com caminho e
  linha malformada são ignorados; o mesmo nome com duas somas vale como ausente. **Mudou o título ou a cerca na pipeline, o app para
  de atualizar (fechado, não aberto): mude `checksums.ts` junto.** O nome lido das somas nunca vira caminho.
- **O download.** O endereço sai de `packageUrl(origem, versão, nome)`, que recusa versão fora de `X.Y.Z` e nome que não é da lista de
  `packages.ts`. A lista repete `scripts/ci/packages.txt`, e um teste compara as duas: **mudou um alvo lá, mude aqui**. `assets.links`,
  `_links` e `description_html` do JSON não são lidos. Redirecionamento só para `https` (o registro manda o download para o armazenamento
  dele), no máximo cinco. Teto de 1 GiB, pelo tamanho declarado e pela contagem; recusa quando o recebido não bate com o declarado;
  desiste após 30 s sem dado. Grava em `<pasta de dados>/updates/<versão>/<nome>.part` e só dá o nome final depois de a soma bater com
  as DUAS fontes; senão apaga e o estado vira `failed` com a causa. **`updates/` é apagada quando o atualizador nasce**: as somas
  ficam na memória, então um arquivo de outra abertura (ou posto lá por alguém) não vale nada. Se não der para apagar (logo depois de
  uma atualização o instalador ainda pode estar rodando de lá, e o Windows não apaga um executável em uso), o app abre do mesmo jeito.
  A recusa por soma vai para o log ANTES de o arquivo ser apagado, e continua sendo a causa mesmo se apagar falhar (a frase diz se o
  arquivo foi apagado). Dar o nome final é tentado três vezes (`withRetries`): um antivírus pode estar lendo o arquivo recém-fechado.
  **Um pacote que já está em `updates/<versão>/` não é baixado de novo** (é o que fica quando o instalador não iniciou, e a pessoa
  pede "Tentar de novo"): o `SHA256SUMS` é buscado outra vez, e a soma do arquivo é refeita, do disco, contra as DUAS fontes; se não
  confere, a pasta é apagada e o download segue o caminho normal.
- **Nenhuma causa que vai para a tela leva caminho de pasta.** O erro do disco traz o caminho na mensagem; `causeOf` (`updater.ts`)
  manda só o código, descendo por `cause` (o `download.ts` reembrulha o erro), e `screenSafe`, a última guarda antes de `fail`, troca
  por uma frase fixa qualquer causa que contenha a pasta de dados ou a de downloads (o texto inteiro fica no log). **Nenhuma função
  que a tela chama rejeita com caminho, nem deixa o estado preso:** todo arquivo recusado é apagado por `refuseAndRemove` (a falha de
  apagar vira frase, e não exceção), e `download` e `install` saem embrulhadas em `guarded`, que transforma qualquer outra exceção em
  `failed` pela mesma guarda (só "Pedido de atualização inválido." rejeita). `updater.disk.test.ts` faz falhar cada passo de disco
  com o `node:fs/promises` trocado, e varre todas as respostas e todos os estados atrás da pasta.
- **O atualizador nunca impede o app de abrir.** `startUpdater` (em `main.ts`) roda dentro de um `try`, e a consulta do início não
  segura a abertura: se ele não nascer, só não há atualização naquela abertura, e os canais respondem que ele não está pronto.
- **Instalar (RN-ATUALIZA-006).** Imediatamente antes de usar o arquivo a soma é calculada de novo, do disco; se mudou, o arquivo é
  apagado e nada roda. **O instalador do Windows, nesta ordem:** o estado vira `installing` (a tela não oferece mais nada); o cofre é
  fechado e a API parada, e o app **espera o processo dela terminar** (`stopApi`, o mesmo fechamento do `before-quit`; sem confirmação
  em 15 s, nada roda e a falha aparece); **a soma é refeita mais uma vez, do disco** (a parada leva tempo, e nesse tempo o arquivo
  pode ter sido trocado: nada pode entrar entre esta conferência e o `spawn`); só então o `spawn` do instalador, sem shell,
  desanexado, com `--updated /S --force-run` (a fonte de cada um, nos modelos do electron-builder 26.15.3, está no comentário de
  `install.ts`); e, com o processo dele iniciado, `app.quit()`. O motivo da ordem: o instalador remove a versão antiga antes de pôr
  a nova, e um arquivo da pasta de instalação em uso (a API viva) faz essa etapa abortar; num instalador silencioso o app some e não
  volta. Se a instalação não for adiante depois de a API ter parado (o instalador não iniciou, ou o arquivo mudou), o `main.ts` avisa
  a tela (`prism:api-exit`) e ela mostra o erro com "Reiniciar"; a causa no diálogo diz que o serviço foi parado e manda usar
  "Reiniciar", e, quando o instalador não iniciou, que o pacote continua guardado (ele NÃO é apagado: "Tentar de novo" o confere de
  novo, sem baixar). Em `installing`, `check` responde `busy` e `skipVersion` é recusado (`isBusy`): nada troca a oferta por baixo de
  uma instalação em andamento. Os argumentos são os mesmos nos dois modos do instalador (só do usuário ou para todos; ver "O instalador do
  Windows", abaixo): o modo vem do registro, e a anotação `update-attempt.json` é gravada logo antes do `spawn` (RN-INSTALA-003). **Os outros formatos** são copiados para a pasta de downloads (sem
  gravar por cima de nada) e mostrados no gerenciador de arquivos, e a tela diz o que fazer por formato; o app continua aberto.
  O formato é o da instalação em uso (`choosePackage`, pura e testada): no Windows, o instalador se o desinstalador está ao lado do
  executável (`Uninstall <executável>`, que o instalador deixa), senão o **zip portátil** (o instalador criaria OUTRA instalação);
  AppImage se a variável `APPIMAGE` existe; em `/opt/`, `deb` se o dpkg tem o pacote (`/var/lib/dpkg/info/prism.list`), senão `rpm`
  se há `rpm`; senão `tar.gz`; macOS, o `dmg` da arquitetura.
- **A rede é o `net.request` do Electron** (`net-transport.ts`), numa sessão só do atualizador (`session.fromPartition("prism-update")`,
  em memória), e não o `fetch` do Node nem o `net.fetch`. Motivos, todos medidos: o `net.fetch` com `redirect: "manual"` falha com
  "Redirect was cancelled" sem dizer para onde era, então não dá para conferir o destino; o `fetch` do Node não usa o proxy nem os
  certificados do sistema e **obedece a `NODE_TLS_REJECT_UNAUTHORIZED=0`** (que estava definida no ambiente da máquina onde isto foi
  escrito), e a pilha do Chromium não lê essa variável. O `redirect` do `net.request` pergunta antes de seguir. Cabeçalhos fixos:
  `User-Agent: Prism/<versão>`, `Accept-Language: *` (o Chromium mandaria o idioma do sistema) e `Accept-Encoding: identity` (para o
  tamanho declarado valer; se o servidor comprimir mesmo assim, o Chromium falha). Sem cookies e sem credenciais. Não há
  `setCertificateVerifyProc` nem tratador de `certificate-error` no app, e não pode haver.
- **A ponte** (`window.prism.updates`): `getState`, `onState`, `onProgress`, `check`, `download(versão)`, `cancel`, `install(versão)`,
  `getPreferences`, `setCheckOnStartup(booleano)`, `skipVersion(versão)` e `takeNotice()`. Canais `prism:update-state`, `-check`, `-download`, `-cancel`,
  `-install`, `-preferences`, `-check-on-startup`, `-skip` e `-notice`, e os avisos `prism:update-changed` (o estado inteiro, uma vez por mudança
  de estado) e `prism:update-progress` (o avanço do download, até cinco por segundo: `UpdateProgress`, só `checkId`, `receivedBytes`
  e `totalBytes`). **O progresso não passa por `setState`**: ele mandaria as notas de até 20 versões a cada aviso. O estado do
  processo principal fica em dia (quem chama `getState` no meio do download recebe o avanço de agora), e a tela junta os números ao
  estado dela (`withProgress`, em `update-store.ts`) sem trocar a lista de versões. Os canais de pedido passam por `assertFromApp`. A
  versão que a tela manda tem de ser a que a última consulta DESTE processo achou, e o booleano tem de ser booleano: o resto é
  "Pedido de atualização inválido." (a promessa rejeita). A hora da última consulta a tela só lê. O estado (`UpdateState`: `none`,
  `available`, `downloading`, `ready`, `installing`, `delivered`, `failed`) não leva caminho nem endereço. `check` responde
  `available`, `upToDate`, `noSource`, `blocked`, `busy` ou `failed` com a causa.
- **As preferências (RN-ATUALIZA-007)** ficam em `<pasta de dados>/update-preferences.json`, fora do cofre: `checkOnStartup`,
  `skippedVersion` e `lastCheckedAt`. Arquivo ilegível ou adulterado vale como o padrão, campo a campo.
- **A tela.** O estado mora no processo principal; `update-store.ts` é o espelho dele, fora do React e das rotas. `UpdateDialog` é
  montado **uma vez, em `app.tsx`, acima do `ApiGate`** (`app.test.ts` confere): aparece no login, dentro do cofre e também na tela de
  erro da API, que é quando a versão nova pode ser o conserto; a tela de erro (`ApiGateError`) tem "Verificar atualizações" abaixo de
  "Reiniciar". O diálogo abre quando há um achado cujo `checkId` a pessoa ainda não fechou com "Depois"; cada consulta que acha versão
  tem um `checkId` novo. `UpdateDialogView` é só de propriedades (é o que os testes desenham). O resultado da consulta manual é aviso
  (`checkNotice`, pura e testada), menos a versão nova, que é o diálogo. Os textos estão em `update.copy.ts`.
- **O diálogo abre sozinho, e por isso nada nele age sem a pessoa escolher.** (1) O foco inicial é de "Depois", nunca de "Atualizar
  agora": com o foco no botão principal, o Enter ou o Espaço que ia para a senha baixava, instalava e fechava o app. (2) O diálogo
  **segura o foco**: como ele fica acima do `ApiGate`, a tela de trás costuma montar depois dele, e o campo de usuário do login
  (`autoFocus`) tomava o foco, por trás do diálogo. Um `focusin` de fora do diálogo devolve o foco a "Depois" e guarda quem o queria,
  que o recebe quando o diálogo fecha. **Ficam de fora outro diálogo (aberto por cima deste) e a pilha de avisos**, e a pergunta é a
  mesma (`focusIsElsewhere`, pura e testada) nos três lugares em que este diálogo mexe no foco: o `focusin`, o efeito que devolve o
  foco a "Depois" a cada mudança de estado, e a devolução do fim. Não há DOM no vitest: o uso nos três lugares é conferido de ponta a
  ponta (`document.activeElement` ao abrir, depois de Enter e de Espaço, e com um `[role=dialog]` posto por cima). (3) A linha de confiança (RN-ATUALIZA-009) e
  o aviso do que "Atualizar agora" vai fazer ficam no **cabeçalho** do diálogo (`description`), que não rola: depois das notas, com
  notas longas, ficavam fora da vista. (4) Só o instalador do Windows segue sozinho do download para a instalação
  (`installsRightAway`); nos formatos entregues na pasta de downloads o diálogo para em `ready` e espera o clique em "Mostrar na
  pasta de downloads".
- **As notas (RN-ATUALIZA-004)** passam por `release-notes.tsx`, o interpretador do projeto: título, lista, parágrafo, ênfase e código,
  como elementos do React. Não há `dangerouslySetInnerHTML`, `<a>`, `<img>` nem `href`; `<script>`, HTML cru, `[texto](endereço)` e
  `![imagem](endereço)` aparecem como o texto que são. É uma passada pelas linhas e uma expressão regular por trecho, sem recursão; há
  teste com entrada de megabytes e aninhamento fundo. **As duas expressões de linha levam a flag `s`, e ela não é enfeite:** sem ela o
  `.` não casa U+2028, U+2029 nem um CR solto, e uma linha de título com muito espaço e um desses caracteres custava 3 s (há teste
  com essa forma exata). O bloco das somas não entra nas notas: fica no detalhe "Somas de verificação". `ReleaseNotes` é `memo`: o
  diálogo redesenha a cada aviso de progresso, e as notas, cujo texto não mudou, ficam de fora.
- **Como conferir de ponta a ponta sem tocar em instalação nenhuma.** `pnpm build`; um servidor HTTP local que imita `…/releases` e
  `…/packages/generic/prism/<versão>/<arquivo>`; o app em desenvolvimento aberto por
  `scripts/run-hidden.ps1 -Exe node_modules\electron\dist\electron.exe -ExtraArgs <caminho absoluto de src/client> -UserDataDir <pasta
  temporária> -Desktop prism-<nome> -EnvVars @{ PRISM_UPDATE_API = 'http://127.0.0.1:<porta>/api/v4'; PRISM_UPDATE_PROJECT = '1' }`
  (o argumento é a PASTA do app, e não o `main.js`: com o arquivo, `app.getVersion()` devolve a versão do Electron). Na tela,
  `data-update-dialog` traz o estado do diálogo, `data-update-release` cada versão, e `data-check-updates` o botão. O "instalador" tem
  de ser um `.exe` de verdade (o Node recusa `spawn` de `.cmd` sem shell); para o caso do instalador que NÃO inicia, sirva com esse
  nome um arquivo de texto com as duas somas certas (o `spawn` falha com `UNKNOWN`). Use um nome de área de trabalho só seu: o `-Stop` encerra
  tudo o que tem janela nela. Em desenvolvimento o executável é o `electron.exe`, que não tem desinstalador ao lado: **para o caminho
  do instalador, a prova põe um arquivo vazio `Uninstall electron.exe` em `node_modules\electron\dist` e o tira no fim**; sem ele o
  app segue o caminho do zip portátil. Nesse caminho (e no do Linux e do macOS) pare em `ready`: "Mostrar na pasta de downloads"
  grava na pasta de downloads de quem usa a máquina e abre o gerenciador de arquivos na tela visível. Para a tela de erro da API,
  abra com um `PATH` sem o `dotnet` (`-EnvVars @{ PATH = 'C:\Windows\System32;C:\Windows' }`). Para as teclas,
  `Emulation.setFocusEmulationEnabled` e depois `Input.dispatchKeyEvent` (`keyDown` com `text`, e `keyUp`): chegam à página mesmo na
  área escondida. `window.close()` pode fechar a janela antes de a resposta do pedido chegar: não espere por ela. O bloqueio pela linha de comando só existe no app empacotado: gere a pasta com `--dir`.
- **O instalador do Windows pede administrador e, sem a permissão, instala só para o usuário** (seção 25, RN-INSTALA-001 a 004,
  versão 0.3.0). É o instalador **assistido** do electron-builder (`nsis.oneClick: false`), sem `perMachine`: o manifesto continua
  `RequestExecutionLevel user` (o Windows recusaria o `spawn` de um que exige administrador, `ERROR_ELEVATION_REQUIRED`), e quem pede a
  permissão é `build/installer.nsh`, pelo `UAC::RunElevated` (o pedido do próprio Windows). As regras moram no `customInit` dele (fim do
  `.onInit`, depois do `initMultiUser` do modelo): a instalação que existe manda (HKLM `Software\<guid>` é a de todos, atualizada
  pedindo a permissão; HKCU, a do usuário, atualizada sem pedir nada; sem a permissão para a de todos, nada é instalado, porque só do
  usuário seriam duas); aberto pela pessoa sem instalação, pede a permissão e, negada ou numa conta sem administrador, instala só para o
  usuário; `/allusers` e `/currentuser` escolhem o modo, e o que pede o outro modo de uma instalação existente é recusado (sai com 2);
  o silencioso sem modo instala só para o usuário. O `customInstallMode` pula a página "para quem instalar". O include só existe na
  compilação do instalador (`!ifndef BUILD_UNINSTALLER`), só com macros e variáveis que ele usa: o electron-builder compila com `-WX`.
  O `nsis.guid` é o que o electron-builder calcularia do `appId` (as instalações da 0.2.0, de um clique e por usuário em
  `%LOCALAPPDATA%\Programs\prism-client`, têm as mesmas chaves e são atualizadas no lugar); uma instalação nova vai para
  `%LOCALAPPDATA%\Programs\Prism` ou `%ProgramFiles%\Prism`. A página de progresso e a de fim ("Executar Prism") são as do modelo.
- **O app e os dois modos.** `install-scope.ts` diz se a instalação é para todos: o `reg.exe` do sistema (`%SystemRoot%\System32`),
  sem shell, lê `HKLM\Software\<guid>` `InstallLocation` na visão de 64 bits, a mesma regra do instalador; qualquer falha vale "só do
  usuário". O atualizador só pergunta na instalação feita pelo instalador, uma vez por abertura, e a oferta leva `forAllUsers`: o
  diálogo avisa, antes de baixar e ao instalar, que o Windows vai pedir a permissão e o que acontece sem ela. Logo antes do `spawn`, o
  atualizador grava `<pasta de dados>/update-attempt.json` (`install-attempt.ts`: de que versão para qual, e o modo); se o instalador
  não inicia, a anotação sai. A abertura seguinte a lê e a apaga: na versão de antes, a atualização não entrou, e a primeira janela
  recebe o aviso uma vez (`takeNotice`; `UpdateDialog` o mostra como aviso de atenção, `noticeToast`). Na de todos com a permissão
  negada, quem abre o Prism de novo é o instalador (`prismReopenApp`: espera o Prism que o abriu, o processo pai, fechar, até 30 s, por
  causa do bloqueio de instância única, e o abre na versão que está).
- **Conferido:** as duas fases do NSIS compilam com `-WX` (no Linux, com o `makensis` do electron-builder e um `wine` de mentira que só
  copia o gerador do desinstalador, o que não serve para instalar), e as duas macros entram no instalador e não no desinstalador. A
  pipeline instala e desinstala o `.exe` gerado nos dois modos, no runner do Windows (`scripts/ci/check-windows-installer.sh`).
- **Não exercitado:** o pedido de permissão do Windows (aceito, negado, numa conta sem administrador) e a reabertura depois dele; a
  atualização de dentro do app por cima de uma instalação de verdade (com `--force-run`); Linux e macOS (a escolha do formato e a entrega só têm teste de unidade); o último
  passo do zip portátil no Windows (a cópia para a pasta de downloads) fora dos testes de unidade; o GitLab de verdade (o formato da
  resposta e o redirecionamento do registro vêm da documentação); proxy com autenticação.

## Empacotamento (`pnpm build:api`, `pnpm dist`, `pnpm dist:dir`)

- `build:api -- <identificador>` (`scripts/publish-api.mjs`; `win-x64`, `linux-x64`, `osx-arm64` ou `osx-x64`, sem argumento o da
  máquina, desconhecido falha com a lista dos válidos) roda `dotnet publish ../api/Prism.Api -c Release -r <identificador>
  --self-contained true -p:Version=<versão do package.json> -o resources/api` com `--artifacts-path .api-publish` (fora do git):
  `bin` e `obj` dele não se misturam com os de `dotnet build` e `dotnet test` da solução (MSB3021), como no `.api-dev` do
  `pnpm dev`. A API recebe a versão do app (RN-VERSAO-003): nenhum `.csproj` a declara. Apaga `resources/api` antes. Há uma API
  só em `resources/api`: a do identificador que foi publicado por último. **Efeito colateral conhecido:** o restore com `-r`
  acrescenta o alvo vazio `"net10.0/<identificador>": {}` aos quatro `packages.lock.json` de `src/api` (há
  `RestorePackagesWithLockFile` no `Directory.Build.props`, e `-p:RestorePackagesWithLockFile=false` é recusado com NU1005 enquanto
  o arquivo existe). A correção, que é da trilha da API, é declarar os identificadores nos projetos e publicar em modo travado
  (`RestoreLockedMode`). **Provisório**, até lá: depois de um `build:api`, olhe `git diff -- "src/api/*/packages.lock.json"`
  e desfaça (`git checkout -- "src/api/*/packages.lock.json"`) só se a única diferença for esse alvo.
- `dist -- <plataforma> [arquitetura]` (`scripts/dist.mjs`; `win`, `linux` ou `mac`, sem argumento a da máquina) confere a
  API (`check-api.mjs`), dá permissão de execução ao executável dela no Linux e no macOS (o `dotnet publish` feito num
  Windows não a grava, e o pacote leva o arquivo como está), roda `electron-vite build` e o `electron-builder --<plataforma>
  --<arquitetura> --publish never`. Alvos (RN-ABERTO-006, em `electron-builder.yml`): Windows `nsis` e `zip`; Linux
  `AppImage`, `deb`, `rpm` e `tar.gz`; macOS `dmg` e `zip`. Os arquivos saem em `release/` como
  `Prism-<versão>-<sistema>-<arquitetura>.<extensão>` (o `${arch}` do electron-builder vira `x64`, `x86_64` ou `amd64`, conforme
  o formato). **O macOS sai uma arquitetura por vez**, porque há uma API só em `resources/api`: `build:api -- osx-arm64` e
  `dist -- mac arm64`, depois `build:api -- osx-x64` e `dist -- mac x64` (sem arquitetura, a da máquina). Os alvos de macOS no
  `electron-builder.yml` não declaram `arch` de propósito: com `arch` lá, o `--arm64` não restringe e as duas saem de uma vez. Sem assinatura
  e sem publicação: nenhum token, certificado ou variável de segredo. Windows e Linux são só x64.
- **`PRISM_HOMEPAGE`** (só no `dist -- linux`): o `.deb` e o `.rpm` exigem a URL pública do projeto ("Please specify project
  homepage"), que não está no repositório; a pipeline a preenche. O `dist` valida a variável (`parseHomepage`: `https://` bem
  formada, sem usuário nem senha, senão falha dizendo só que é inválida) e a passa ao electron-builder em
  `-c.extraMetadata.homepage=<URL>`, numa lista de argumentos, nunca por shell. Com ela saem os quatro alvos; sem ela
  (ausente ou vazia), `--linux AppImage tar.gz`: o `dist` avisa que `deb` e `rpm` ficaram de fora e por quê, e termina com 0.
  Quem decide tudo isso é `planDist` (`scripts/dist-plan.mjs`, com teste). Windows e macOS ignoram a variável.- **Linux, associação da janela ao ícone**: o `package.json` tem `"desktopName": "prism.desktop"` e o `electron-builder.yml`
  `linux.syncDesktopName: true`. O Electron usa o `desktopName` como app_id e WM_CLASS, e o `.desktop` do pacote passa a se
  chamar `prism.desktop` com `StartupWMClass=prism`: sem isso o GNOME no Wayland pode mostrar o ícone genérico na barra de
  tarefas (RN-MARCA-001). O nome tem de ser o `executableName` mais `.desktop` (há teste).
- `dist:dir` roda o mesmo, com `--dir`: sem instalador, só a pasta `release/win-unpacked` (ou `linux-unpacked`), para conferir.
- **Caminho longo no Windows**: com o repositório (ou a cópia onde se empacota) num caminho fundo, `pnpm dist` e `pnpm dist:dir`
  morrem no `electron-vite build` com `Error [ERR_REQUIRE_CYCLE_MODULE]: Cannot require() ES Module … electron-vite.js in a
  cycle`, e `electron-vite --version` chamado direto dá o mesmo erro. Foi visto com o caminho completo do
  `node_modules/.pnpm/electron-vite@…/…/bin/electron-vite.js` acima de 260 caracteres (Node 22.17); com cerca de 200 funciona. A causa
  não está confirmada: a hipótese é o Node ler o `package.json` do pacote por uma API do Windows sem o prefixo de caminho longo,
  não ver o `"type": "module"` e tratar o arquivo como CommonJS. Não é defeito do app e não se corrige aqui. O que fazer:
  empacotar (`git archive` ou clone) num caminho curto, perto da raiz do disco. Um *junction* curto para a pasta funda não
  adianta: o Node resolve o junction para o caminho real.
- O que o pacote leva: `files` só tem `out/**` e o `package.json` (nada de `node_modules`, fonte, mapa, `.env`, `.api-dev` ou
  `.api-publish`); `extraResources` leva `resources/api` para `resources/api` (sem os `.pdb`, o `web.config` e o
  `*.staticwebassets.endpoints.json`), o ícone da janela de cada plataforma (`icon.ico` no Windows, `icon.png` no Linux) e os
  avisos de licença, em `resources/` (RN-ABERTO-001; o `nsis` não ganha tela de licença, só os arquivos): `LICENSE` e `NOTICE` da
  raiz do repositório; `licenses/ibm-plex-sans/LICENSE` e `licenses/ibm-plex-mono/LICENSE` (as fontes vão dentro do app, e a
  SIL OFL 1.1 pede o texto junto; os dois textos diferem); `licenses/dotnet/LICENSE.txt` e `ThirdPartyNotices.txt` (o runtime do
  .NET vai junto da API autocontida). Todos copiados como estão, sem editar. Os caminhos estão no `electron-builder.yml` e em
  `scripts/licenses.mjs`, e um teste confere que batem. O `dist` **falha** se o `LICENSE`, o `NOTICE` ou o de uma fonte
  não existem (o electron-builder só avisaria e geraria um pacote sem licença). Os do .NET moram na raiz da instalação do
  `dotnet` (achada por `dotnet --list-sdks`): o `build:api` os copia para `resources/licenses/dotnet` (fora do git) e o `dist`,
  se não os acha lá, tenta de novo; sem `dotnet`, avisa e o pacote sai sem eles. **Quem leva a API de um job a outro precisa levar
  `resources/licenses/dotnet` junto de `resources/api`.** Os avisos de terceiros do Electron (`LICENSE.electron.txt` e
  `LICENSES.chromium.html`) vão ao lado do executável no Windows e no Linux, e a publicação da API não traz arquivo de licença
  de terceiros além desses do .NET. O ícone e os textos de versão
  do `Prism.exe` (`author` do `package.json` vira o `CompanyName`) são gravados pelo próprio `electron-builder`; a armadilha
  do `winCodeSign` (link simbólico sem privilégio) não apareceu com a versão 26.15.3, então não há gancho `afterPack`.
- `dist:dir` e `dist` começam por `scripts/check-api.mjs [win|linux|mac] [x64|arm64]`, que falha (código 1) se o executável da
  API da plataforma (`Prism.Api.exe` ou `Prism.Api`) não existe em `resources/api`: sem isso o electron-builder só avisa "file
  source doesn't exist", termina com 0 e sai um pacote sem API (acontece quando um `build:api` falha, depois de ter apagado a
  pasta). Ele também **lê o cabeçalho do executável** (`executableTarget`, em `api-layout.mjs`: PE, ELF ou Mach-O de 64 bits) e
  recusa a API de outra plataforma ou arquitetura, com a mensagem do que achou, do que o pacote pede e do `build:api` a rodar:
  Linux e macOS compartilham o nome `Prism.Api`, e um ELF dentro do `.app` instala e nunca sobe (`bad CPU type` na arquitetura
  errada). Só Mach-O fino: o `dotnet publish` não gera binário universal.
- Para abrir o app empacotado com dados descartáveis, passe `--user-data-dir=<pasta>`: o Electron a respeita, e
  `userData`, o cofre e o log da API passam a ficar nela. Sem isso ele usa `%APPDATA%\Zanveri\Prism` (ver "Processo principal").

### Conferir o app empacotado sem aparecer na tela do dono

`scripts/run-hidden.ps1` abre o `Prism.exe` numa área de trabalho separada do Windows (`CreateDesktop` +
`CreateProcess` com `lpDesktop`): a janela existe, a GPU funciona e a porta de depuração responde, mas nada aparece na
tela de quem usa a máquina. O cabeçalho do script tem o uso. Em resumo:

```powershell
$r = .\scripts\run-hidden.ps1 -Exe .\release\win-unpacked\Prism.exe -UserDataDir $env:TEMP\prism-teste -LogFile $env:TEMP\prism-teste.log -EnvVars @{ ELECTRON_RENDERER_URL = 'http://localhost:1' }
# http://127.0.0.1:$($r.DebugPort)/json/list: avaliar expressões e capturar a tela (o Node 22 tem WebSocket)
.\scripts\run-hidden.ps1 -ListWindows     # as janelas da área escondida
.\scripts\run-hidden.ps1 -Stop            # encerra o que ficou lá
```

- É ferramenta de desenvolvimento, só para o build deste projeto: `-Exe`, `-ExtraArgs` e `-EnvVars` rodam o que
  receberem. `-Desktop` só aceita nome que comece por `prism-`, para o `-Stop` nunca atingir a área de trabalho de
  quem usa a máquina nem a de outra ferramenta.
- Use sempre `-UserDataDir`, a não ser que a conferência seja justamente a pasta de dados padrão: sem ele o app usa os
  dados reais do dono (`%APPDATA%\Zanveri\Prism`).
- Se o app não abre janela em `-WindowTimeoutSeconds` (30 s) ou morre, o script encerra o que lançou (o `cmd`, o app e os
  filhos) e falha: o `-Stop` acha processo pela janela, e nesse caso não há janela.
- Quem chama o script de um terminal que espera o fim do pipe (a ferramenta Bash do Claude Code, por exemplo) não fica
  preso: o app é criado sem herdar handles nem console (`CREATE_NO_WINDOW`), e o log vai por `cmd /c ... > arquivo`.
- A área de trabalho só vive enquanto alguém a segura: o script a segura até a primeira janela do app existir. Fechar
  o handle antes disso mata o app na partida (`0xC0000142`, `0x80000003`).
- **Barra de menu**: o Electron desenha a dele com o próprio Chromium, então `GetMenu` devolve nulo mesmo com menu e
  não serve. A medida é `window.outerHeight - window.innerHeight` da janela de 1440x900: 39 px sem menu e 65 px com o
  menu padrão (conferido com um app de teste com e sem `Menu.setApplicationMenu(null)`); o `Prism.exe` dá 39.
- Fechar a janela como o usuário faz: `window.close()` na página. A API some junto em cerca de 2 s.

## Design

- Os tokens estão em `src/styles/globals.css` e vêm do canvas (`docs/design/canvas/`). A paleta
  padrão do Tailwind está desligada: só existem as cores do Prism (`background`, `panel`, `raised`,
  `selected`, `border`, `border-strong`, `ink`, `body`, `muted`, `subtle`, `accent`, `postgres`,
  `db2`, `informix`, `danger`, `success`, `scrim`, mais `selection`, as quatro de sintaxe, `syntax-keyword`, `-string`, `-number` e
  `-comment`, e `link`, o azul de link de cada tema: RN-LINK-001; o canvas não o desenha, e os quatro temas além dos do Prism trazem o da paleta deles). **Cada uma é `light-dark(claro, escuro)`** (seis temas: ver "Configurações"), então
  nenhuma cor fixa (`#rrggbb`, `text-white`, `fill` nomeado) entra em componente: só os tokens. As exceções são a ilustração da
  marca, a lista de cores de ambiente da conexão e o texto que a etiqueta calcula sobre ela, as prévias do tema e os `.svg` do splash.
- A escala de texto reaproveita os nomes padrão com os tamanhos do canvas: `text-xs` 12/18,
  `text-sm` 13/20, `text-base` 14/22 (o corpo), `text-lg` 18/24. `rounded-xl` é o raio do diálogo
  (10px) e `shadow-2xl` a sombra do que flutua.
- O sucesso usa o mesmo verde do Db2 (`#5ED3A3` no escuro, `#097244` no Prism Claro: o `#0B7A4B` do canvas dava 4,37:1 sobre a linha
  selecionada), como a especificação pede; o canvas não tem outro.
- Primitivos (`@/components/ui`): `Button`, `Field`, `FieldLabel`, `Input`, `TextField`, `FieldError`,
  `FormMessage`, `Dialog`, `ConfirmDialog`, `Select`, `Segmented`, `navItem` (a classe da entrada de uma lista de navegação vertical: a lista de Configurações e a de seções da Estrutura), `StatusBadge`, `EngineTag`,
  `EnvironmentPill`, os ícones (`icons.tsx`), `ToastProvider`, `useToast`. Vieram do etio com o que esta fatia usa (o `ContextMenu` é do
  Prism, não do etio: ver "Navegador: clique, menu e busca"): o `Select` não tem busca nem lista mais larga
  que o controle (e tem `onOpen`, para quem busca as opções só quando a pessoa abre a lista, `aria-describedby`, e o `content` da opção, que
  a desenha no lugar do rótulo, na lista e no controle fechado: a etiqueta de ambiente do navegador; o rótulo segue sendo o da busca pela inicial), o `Dialog` não tem os tamanhos `xl` e `full`, e não há `lucide-react` (os
  ícones são SVG de `icons.tsx`, no traço do canvas). O `Dialog` aceita um `icon` ao lado do título. O `ConfirmDialog` é um `Dialog` com
  as duas respostas no rodapé: foco preso, Esc, clique fora e portal moram num lugar só.
- As fontes IBM Plex vão dentro do app (`@fontsource`), nos pesos 400, 500 e 600. São o padrão e a reserva das que o usuário escolhe
  (RN-CONFIG-008): `font-sans` é a da interface, `font-editor` a do editor SQL (para SQL fora do CodeMirror) e `font-mono` a mono do app, que
  não muda (grade, árvore, etiquetas). Texto novo que é SQL usa `font-editor`; dado do banco, `font-mono`.

## Dependências

- Tudo fica em `devDependencies`: o Vite empacota a tela, e `main` e `preload` só usam o Electron
  e os módulos do Node. O `electron-builder` copia para o app o que estiver em `dependencies`.
- React e Electron em versão exata. O Electron está na 44.5.1 porque a 44.6 e a 44.7 tinham menos
  de três dias quando o projeto foi criado; subir quando a trava deixar.
- `vite` fica na linha 7 (o `electron-vite` 5 não aceita a 8) e `typescript` na 6.0 (o
  `typescript-eslint` não aceita a 7).
- As travas do pnpm (`pnpm-workspace.yaml`) ficam ligadas. As únicas exceções, `semver@5.7.2` e `semver@6.3.1` (falsos
  positivos do `trustPolicy`, por versão exata), estão explicadas lá. O `electron-builder` é devDependency; o
  `electron-winstaller` dele tem script de instalação e fica negado (só serve ao alvo Squirrel, que não se usa).
- O editor de SQL é o CodeMirror 6: `@codemirror/state`, `view`, `commands`, `language`, `lang-sql`, `autocomplete` (exato em 6.20.3, a
  versão que a trava já resolvia) e `@lezer/highlight` (as etiquetas de sintaxe). Não há `codemirror` (o pacote de conveniência): só as
  extensões que `sql-editor.tsx` lista. O CodeMirror injeta os estilos dele em `<style>`, que a política de conteúdo já
  permite, e não usa `eval`.

## O que é provisório

- O `.deb` e o `.rpm` só saem com `PRISM_HOMEPAGE` (a URL pública do projeto, que ainda não está definida e não vai para o
  repositório): até a pipeline preenchê-la, o `dist -- linux` gera o AppImage e o `tar.gz` e termina com 0. O mantenedor é
  `Zanveri`, sem e-mail, e o electron-builder o aceita assim.
- **Fontes do sistema (RN-CONFIG-008)**: a lista e a medida foram vistas só no Linux, sob Xvfb, em desenvolvimento (`http://localhost`); no app
  empacotado (`app://prism`), no Windows e no macOS ainda não. O caminho "não deu para ler a lista" (o campo que aceita o nome digitado) só foi
  visto nos testes: no Electron a permissão é dada.
- Pacote de macOS: não provado por inteiro: o `dmg` só se gera no macOS, e nenhum pacote foi aberto no macOS. Num contêiner Linux o electron-builder aceita a
  configuração e gera o `zip`, e recusa o `dmg` (`sips process failed ENOENT`: o `dmg` só se gera no macOS). O `.icns` existe e
  traz a ilustração inteira, mas o app nunca foi aberto no macOS.

- A `TopBar` tem a marca (com a versão e "Verificar atualizações"), "Área de trabalho", "Conexões", "Drivers" (com um ponto quando há
  reinício pendente), "Configurações" (ícone e texto, como os outros itens), o usuário e "Sair". O link da marca para a área de
  trabalho ainda não existe.
- O `sqlLiteral` foi conferido contra um PostgreSQL de verdade (com aspa, barra invertida, zeros à esquerda, notação científica e ponto e
  vírgula no valor); o Informix e o Db2 nunca foram vistos num servidor para o literal e para o DDL aproximado, só nos testes de função pura.
  O CSV foi conferido até o início do download e pelos bytes do `Blob`: o diálogo de salvar do sistema precisa ser concluído por uma pessoa
  numa janela de verdade. Não exercitados na tela: macOS e Linux, leitor de tela, método de entrada (IME) e `prefers-reduced-motion`.
