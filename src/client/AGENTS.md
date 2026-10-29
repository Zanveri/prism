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
electron/        main.ts, preload.ts, api-process.ts, dbeaver-source.ts e dbeaver-messages.ts (a procura e a cópia do DBeaver), app-version.ts, data-dir.ts, permissions.ts (as permissões do Chromium), platform.ts, splash.ts, startup.ts, window-hub.ts e window-messages.ts (as janelas e o que passa entre elas), workspace-hub.ts e workspace-messages.ts (as abas que voltam na próxima entrada), zoom.ts e zoom-file.ts (o zoom do programa)   (processo principal e ponte; o channels.test.ts confere os canais) e update/ (as atualizações)
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
Numa cópia de trabalho cujo `node_modules/electron` não tem o `dist/` (o binário não foi baixado), o `electron-vite` falha com "Electron
uninstall": `ELECTRON_EXEC_PATH=<outra cópia>/node_modules/electron/dist/electron pnpm dev …` usa o binário de outra cópia, da mesma versão.

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
  texto das abas de SQL). Em desenvolvimento o menu fica (no Windows ele existe, mas não aparece: a barra da janela é a do app, RN-JANELA-001; para inspecionar a tela, `--remoteDebuggingPort`). No macOS a barra de menu é do sistema, e um app sem menu não
  ouve Cmd+Q nem Cmd+C e Cmd+V nos campos: fica o mínimo, o menu do app e Editar, sem recarregar e sem ferramentas de
  desenvolvedor (`applicationMenuTemplate`, em `platform.ts`, com teste; não foi aberto no macOS).
- **F5 e Ctrl+R nunca recarregam a janela** (RN-GRADE-012), e F5, F6 (RN-ABAS-014) e F11 chegam à tela; **o Ctrl+W nunca a fecha** (RN-ABAS-019). O Chromium do Electron não
  recarrega nem fecha nada sem menu: quem o faz é o menu padrão de desenvolvimento (Recarregar Ctrl+R, Forçar recarga Ctrl+Shift+R, Tela cheia F11, Janela › Fechar
  Ctrl+W), e o app empacotado do Windows e do Linux não tem menu, e o do macOS não tem Recarregar nem Fechar. Mesmo assim, cada janela ignora o menu para essas
  teclas: o `before-input-event` de `createAppWindow` chama `setIgnoreMenuShortcuts(menuShortcutIgnored(input))` a cada tecla (`platform.ts`, com teste: F5, F6 e F11 com
  qualquer modificador, Ctrl+R e Cmd+R com ou sem Shift, Ctrl+W e Cmd+W com ou sem Shift). A tecla não é cancelada (o `preventDefault` do `before-input-event` a tiraria
  também da página): ela só não vai ao menu, e a tela a recebe como qualquer outra. O Ctrl+W que a área de trabalho não trata (um diálogo, um menu ou uma lista
  aberta, o cofre bloqueado, a tela de entrada) não faz nada, e é por isso que o desenvolvimento se comporta como o pacote. Conferido sob Xvfb, no `pnpm dev`, com o menu padrão: F5 atualizou os Registros,
  F11 abriu o "Filtrar" (e não a tela cheia), e Ctrl+R e Ctrl+Shift+R não recarregaram a página (um marcador em `window` sobreviveu).
- **O zoom do programa inteiro** (RN-ZOOM-001; `zoom.ts`, puro e sem Node, porque a tela também o importa, e `zoom-file.ts`, com o disco; os dois com
  teste). É **desta instalação**, e não do usuário: `zoom.json` (`{ "zoom": 110 }`) na pasta de dados, fora do cofre, lido uma vez ao carregar o `main.ts`
  (depois do `setPath`) com leitura tolerante (o que não é um dos passos vale 100%) e gravado de forma atômica, como `update-preferences.json`; gravar que
  falha só vai para o log. Os passos são os do zoom da grade (`appZoomSteps`). **Onde vale**: o splash nasce nele (`splashGeometry`, em `splash.ts`: a
  janela de 640×400 cresce junto, até caber na área útil da tela, e a página `data:` recebe o `zoomFactor`); cada janela do app nasce nele pelo
  `webPreferences.zoomFactor`; e a mudança (`changeZoom`) chama `setZoomFactor` em todas as vivas e manda `prism:zoom-changed`. O Chromium guarda o zoom
  **por origem** (as janelas do app são todas de `app://prism`, ou do servidor do Vite): conferido no Electron, o `setZoomFactor` de uma janela vale nas
  outras da mesma origem e passa por cima do `webPreferences.zoomFactor` das que nascem depois, e a página `data:` do splash fica à parte. Por isso o
  valor é um só, e todo lugar recebe o mesmo. **Cuidado com 100%**: é o padrão do Chromium, e ir a ele APAGA o zoom guardado para a origem; e o Electron
  reaplica o `webPreferences.zoomFactor` (o zoom com que a janela nasceu) a cada navegação do quadro principal quando a origem não guarda zoom. Sem
  mais nada, a janela nascida em 125% voltava a 125% ao recarregar depois de ir a 100% (o "Reiniciar" da API recarrega as outras janelas; o Vite recarrega
  em desenvolvimento), levava as outras da mesma origem junto, e o `zoom.json` e Configurações continuavam dizendo 100% (conferido sob Xvfb no `pnpm dev`:
  aberto em 125%, Ctrl+0 e `location.reload()` voltavam a 1,25 sem a correção, e ficam em 1). Por isso cada janela recebe o zoom de agora também no
  `did-navigate` (as rotas em hash não passam por ele), o que cobre ainda o zoom mudado enquanto uma janela nova carregava. **Os atalhos** são tratados
  no `before-input-event` de `createAppWindow`, ANTES do `menuShortcutIgnored`:
  `zoomShortcut` (Ctrl+= e Ctrl++, o + do teclado numérico, Ctrl+- e Ctrl+0; Cmd no macOS; sem Alt, que é o AltGr) chama `event.preventDefault()`, e a
  tecla não chega à página (o editor e a grade não a veem: nenhum caractere entra no editor) nem ao menu (o Zoom do menu padrão de desenvolvimento não
  muda o zoom por fora). A tecla é o caractere (`key`), menos o + e o - do teclado numérico (`code`); o 0 vai pelo caractere, porque com o Num Lock
  desligado aquela tecla é o Insert, e Ctrl+Insert é o copiar do Windows e do Linux, que tem de chegar à página (conferido sob Xvfb: `xdotool key
  ctrl+KP_Insert` chega à página como `Insert`/`Numpad0` e o zoom não muda). Ctrl+roda do mouse continua sendo só o zoom da grade: o
  Electron não muda o zoom pela roda. **Conferido sob Xvfb** (`xdotool key`, teclas de verdade: o `Input.dispatchKeyEvent` do protocolo de depuração NÃO
  passa pelo `before-input-event`): o login abriu em 125% com o `zoom.json` já gravado, o splash em 800×500 com a página em 640×400, Ctrl+- e Ctrl+=,
  Ctrl++ e o + numérico andaram um passo cada com o foco no editor (o texto dele não mudou), Ctrl+0 voltou a 100%, o controle de Configurações
  acompanhou o atalho, e a janela nova de "Mover para nova janela" nasceu no zoom de então e mudou junto com a primeira.
- **A barra da janela** (RN-JANELA-001; `windowBarOptions`, `windowBarOverlayHeight` e `isSymbolColor` em `platform.ts`, com teste). Só no Windows: a janela
  do app nasce com `titleBarStyle: "hidden"` e os botões do sistema sobrepostos (`titleBarOverlay`) com o fundo **transparente**, conferido no Electron 44: o
  sistema desenha só os símbolos e o realce do mouse (o cinza do minimizar e do maximizar, o vermelho do fechar), e o que fica atrás deles é a tela, em
  qualquer tema e em qualquer tela. O Snap Layouts do Windows 11 continua no maximizar, porque o botão é o do sistema. No Linux (os botões sobrepostos seriam
  do Electron) e no macOS (nunca aberto) a barra nativa fica, como a regra permite; as janelas do resultado também, que a seção 39 deixou para depois.
  **A altura** é a da barra superior, 53 px, vezes o zoom do programa (`changeZoom` chama `setTitleBarOverlay({ height })` em todas as janelas), e a tela a lê
  de volta em `env(titlebar-area-height)`, que já vem no zoom (conferido no app: 53 px a 100%, 110% e 200%, e 54 a 67%, em que a sobreposição arredonda para 36). **A cor dos
  símbolos** é o `muted` do tema em uso: `syncWindowBar` (`components/layout/window-bar.ts`, chamado em `main.tsx`) a calcula num elemento escondido, converte
  para `#rrggbb` (`hexOf`, com teste) e manda por `prism:window-bar` ao abrir a tela, antes de a janela aparecer, e quando o `<html>` muda de atributo (o
  tema) ou o sistema troca entre claro e escuro (o tema do sistema). O processo principal só aceita `#rrggbb` e pinta só a janela que pediu. **Na tela**,
  dois utilitários em `globals.css`: `window-bar` (a altura dos botões, o lugar deles à direita, por `env(titlebar-area-x/width)`, mais 12 px, e
  `app-region: drag`) vai na barra superior e no cabeçalho de Configurações, que esconde a área de trabalho e por isso também é a barra da janela (numa
  linha só, da mesma altura: quem encolhe é o nome do usuário); `window-drag` (uma faixa fixa no alto, da altura dos botões) vai antes do conteúdo da
  abertura (`ApiGate`), da consulta do cofre (`VaultGuard`), do login e do bloqueio. O Chromium junta as áreas de arrastar na ordem do documento: o que é
  clicável, se digita ou tem dica (`title`) dentro da barra, ou depois da faixa, é recortado dela (`app-region: no-drag`), e só aí: a regra global
  poria os milhares de controles da área de trabalho na conta das áreas a cada mudança de layout. Fora do Windows as variáveis `titlebar-area-*` faltam,
  e os dois utilitários ficam com a altura do conteúdo e 12 px à direita (a barra) e altura nenhuma (a faixa). Duplo clique na barra maximiza e restaura, e quem o faz é o sistema. O título continua "Prism" (a barra de tarefas e o Alt+Tab).
- Sair do app, pela última janela fechada ou por `app.quit()`, passa por `before-quit`: grava as abas de todas as janelas (`workspaceHub.flush`, RN-ABAS-006,
  no máximo 5 s), e então `closeVaultAndStop` chama `DELETE api/public/sessions` com o token (RN-COFRE-008), espera no
  máximo 2 s e para a API. A instalação de uma atualização (`stopApi` do atualizador) faz o mesmo. A resposta só vai para o log. "Reiniciar" para a API sem essa chamada.
  Os três (o `before-quit`, o `stopApi` e o "Reiniciar") soltam antes os destinos das exportações de dados (`transferDesk.releaseAll`), o que interrompe a
  entrega em andamento e apaga a cópia pela metade (RN-EXPORT-023), e os arquivos das importações de dados (`transferSource.releaseAll`), o que interrompe a
  cópia do arquivo e apaga o que a API ainda não tomou (RN-IMPORT-018), e as cópias do DBeaver (`dbeaverSource.releaseAll`, RN-DBEAVER-006).
- A ponte (`window.prism`, o tipo `PrismBridge` em `electron/preload.ts`) tem `getApiConfig`, `onApiExit`, `restartApi`, `version`,
  `getDataFolder`, `updates` (ver "Atualizações"), `windows` e `session` (ver "Abas que se movem e outras janelas"), `verification` (a vez da verificação
  periódica entre as janelas; ver "Verificação periódica e Só as conectadas"), `workspace` (ver "Abas que voltam na
  próxima entrada"), `zoom` (`get`, `set` e `onChanged`; ver "O zoom do programa inteiro", acima) e `transfers` (o destino e a entrega das
  exportações de dados e o arquivo das importações, abaixo) e `dbeaver` (a procura e a cópia do DBeaver, abaixo). Os canais da API são
  `prism:api-config`, `prism:api-restart` e `prism:api-exit`; o da pasta de dados, `prism:data-folder`; os das atualizações, `prism:update-*`;
  os das janelas, `prism:windows-*` e `prism:session-*`; os da verificação, `prism:verification-*`; os das abas que voltam, `prism:workspace-*`; o da barra da janela, `prism:window-bar` (a cor dos símbolos, RN-JANELA-001); os do zoom, `prism:zoom-get`, `prism:zoom-set` (só um dos
  passos passa: `isAppZoom`) e o aviso `prism:zoom-changed`; os das exportações de dados, `prism:transfer-destination`, `prism:transfer-deliver`,
  `prism:transfer-copy`, `prism:transfer-reveal` e `prism:transfer-release`; os do arquivo das importações de dados, `prism:transfer-source`,
  `prism:transfer-source-status` e `prism:transfer-source-release`; os da cópia do DBeaver, `prism:dbeaver-source` e `prism:dbeaver-source-release`. O processo principal só responde ao quadro que veio da origem do app (`assertFromApp`).
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
  negado, mesmo para o app. **A janela do resultado** (RN-ABAS-017) é reconhecida pelo `webContents` (`isResultContents`, pelo `id`), e não pelo endereço
  (`about:blank`, com a origem herdada ou nula): `permissionAllowed(…, isResultWindow)` dá a ela só a área de transferência (`resultWindowPermissions`); a
  consulta sem `webContents` vale a regra da origem. **Web API nova que pede permissão** (a tela passa a usar geolocalização, notificação…): entra em `appPermissions`,
  ou falha calada. Conferido no Electron sob Xvfb: `local-fonts` sai `granted` sem gesto da pessoa (quem responde é o tratador da consulta, e a API não precisa pedir), copiar e
  colar funcionam, e `geolocation` e `notifications` saem `denied`.
- **O destino das exportações de dados** (RN-EXPORT-019 e 020; `electron/transfer-desk.ts`, sem Electron, com teste em pastas temporárias de
  verdade; as mensagens em `electron/transfer-messages.ts`, `zod` dos dois lados). **O processo principal é o dono do destino: nenhum caminho vem da
  tela, e nenhum vai a ela.** `prism:transfer-destination` recebe só `{ suggestedName, extension }` (a extensão de uma lista fixa, `exportExtensions`), passa
  o nome de novo por `safeFileBase` (`electron/file-name.ts`, a mesma regra do "Exportar CSV"), abre o diálogo de salvar sobre a janela que pediu (os
  filtros, "Todos os arquivos" e `showOverwriteConfirmation` escritos aqui; a pasta é a última desta abertura do app, ou Downloads), confere que a pasta
  existe e aceita gravação (um arquivo de prova `.prism-<id>.tmp`, criado e apagado), recusa a pasta de dados do Prism e o destino já reservado por outra
  exportação, e responde `chosen` com um identificador e o nome do arquivo, `canceled`, `notWritable` ou `inUse`. O destino é de uso único e da janela
  que o pediu. `prism:transfer-deliver` (`{ transferId, destinationId, reveal }`) acha o `.ready` na pasta `transfers` só pelo id conferido como `Guid`
  minúsculo, move-o (`rename`; entre unidades, a cópia em fluxo para um `.<nome>.<id>.part` escondido ao lado e o `rename` dele), numera o nome (`pedido
  (2).csv`) quando um arquivo apareceu lá depois da escolha sem a pessoa ter confirmado a troca, e responde `delivered` (com um `deliveryId` para o
  "Mostrar na pasta"), `missing`, `canceled` (o destino foi solto no meio) ou `failed` com o motivo (`diskFull`, `notWritable`, `folderMissing`,
  `inUse`, `other`) e a frase; o destino que falhou fica reservado para o "Salvar como…". **O diálogo só perguntou pelo nome que devolveu**: com a
  extensão posta pelo processo principal (o nome escolhido sem nenhuma), o `pedido.csv` que já existia conta como não confirmado e é numerado, e nunca
  substituído. O arquivo renomeado ganha o modo da prova de gravação da pasta (`chmod`, fora do Windows), e não o 0600 do temporário da API, como o
  copiado entre unidades; o gerenciador de arquivos que não abre depois da entrega fica no log, e a entrega continua `delivered`.
  `prism:transfer-copy` lê o `.ready` (até 10 MiB, `tooLarge` acima) para a área de transferência; `prism:transfer-reveal` abre a pasta de uma
  entrega; `prism:transfer-release` solta um destino. A janela que recarrega, cai ou fecha solta os dela (`releaseWindow`, `windowClosed`), e o diálogo
  de salvar que ela tinha aberto, quando volta, responde `canceled` sem registrar o destino. O log leva só ids e tamanhos. A ponte de desenvolvimento tem
  `transfers.available: false`, e as chamadas que gravam recusam com "Exportar só funciona no app do Prism." (RN-EXPORT-019).
- **O arquivo das importações de dados** (RN-IMPORT-017 e 018; `electron/transfer-source.ts`, sem Electron, com teste em pastas temporárias de verdade; as
  mensagens em `electron/transfer-messages.ts`, `zod` dos dois lados). **O processo principal é o dono do caminho, como no destino das exportações.**
  `prism:transfer-source` não recebe nada: abre o diálogo de abrir sobre a janela que pediu, com o título "Importar dados", os filtros escritos aqui
  (`sourceDialogFilters`) e a pasta da última importação desta abertura do app (na primeira, Downloads); confere o arquivo (comum, seguindo o atalho: um FIFO
  prenderia a cópia; até 2 GiB; legível, aberto e fechado; a pasta `transfers` criada com 0700 quando falta e aceitando gravação, pela prova de nome
  aleatório; o espaço livre para o arquivo e mais 64 MiB, pelo `statfs`) e responde `chosen` com um `fileId` novo (a forma de um id da API), o nome sem a
  pasta e o tamanho, ou `canceled`, `notAFile`, `tooLarge`, `notWritable`, `noSpace` e `unreadable` (a frase pelo código do sistema, `unreadableReason`,
  nunca pelo texto dele, que traz o caminho). Então copia em segundo plano para `transfers/<fileId>.in.part` (`wx`, 0600), em fluxo com um `AbortSignal`,
  parando ao passar de 2 GiB (o teto é um parâmetro do `defaultCopy`, e o teste o baixa para 1 MiB para a parada correr na cópia de verdade), e, no
  fim, `fsync` e renomeia para `<fileId>.in`. `prism:transfer-source-status` (`{ fileId }`, que a tela consulta a cada
  250 ms) responde `copying`, `ready`, `failed` (`diskFull`, `tooLarge`, `unreadable`, `other`, com a frase, sem caminho) ou `missing`;
  `prism:transfer-source-release` interrompe a cópia e apaga o `.part` e o `.in` que a API ainda não tomou (ela os renomeia ao começar a importação, e aí
  o processo principal não os acha mais, e não precisa). O arquivo é da janela que o escolheu: a consulta e o soltar de outra janela, ou com um id
  desconhecido, respondem `missing`. A janela que recarrega, cai ou fecha solta os dela; a saída e o reinício, todos. O log leva só o `fileId`, o
  tamanho e a duração. A tela confere cada resposta com o mesmo schema (`chooseImportSource`, `importSourceStatus`, `releaseImportSource`, em
  `lib/api/bridge.ts`), e a ponte de desenvolvimento responde que importar só funciona no app.
- **A procura e a cópia do DBeaver** (RN-DBEAVER-004 a 006; `electron/dbeaver-source.ts`, sem Electron, com teste em pastas temporárias de verdade e uma
  pasta pessoal falsa; as mensagens em `electron/dbeaver-messages.ts`, `zod` dos dois lados). **O processo principal é o dono de todo caminho, e não lê o
  conteúdo dos arquivos: só os copia**; quem os lê e decifra as senhas é a API, pelo `sourceId`. `prism:dbeaver-source` recebe só `{ mode: "find" | "choose" }`
  (`.strict()`). `find` procura nas pastas de dados do sistema (`dbeaverRoots`, pura: `DBEAVER_DATA` sozinha; `%APPDATA%\DBeaverData`; `~/Library/DBeaverData`; no
  Linux o Flatpak, o Snap, `~/.local/share/DBeaverData` e, só quando esta não existe, a antiga `.DBeaverData`), cada uma resolvida uma vez com `realpath` (o
  `current` do Snap é um atalho), com `workspace6` também resolvido; vale a pasta cujo `data-sources*.json` foi alterado por último, com o `General` primeiro e
  os outros projetos pela ordem dos nomes. `choose` abre o diálogo de pasta (`openDirectory` e `showHiddenFiles`, escritos em `main.ts`, o título em
  `dbeaverDialogTitle`, começando na primeira pasta de dados que existe ou na pessoal) e descobre o que a pasta é pelo que tem dentro: a de dados, um
  workspace, um projeto ou a própria `.dbeaver`; nada disso é `notDbeaver`. Listar uma pasta passa de 1.000 entradas: não é do DBeaver. **Só se copiam** os
  cinco arquivos esperados da `.dbeaver` de cada projeto (`data-sources[-<sufixo>].json`, `credentials-config[-<sufixo>].json`, `project-settings.json`; o
  sufixo de 1 a 64 caracteres), com os limites de 50 projetos, 41 arquivos por projeto, 5 MiB por arquivo e 32 MiB no total conferidos ANTES de qualquer
  cópia (`tooLarge`), a pasta `transfers` aceitando gravação (`notWritable`) e o espaço da cópia mais 64 MiB (`noSpace`). **Atalho não se segue**: o projeto, a
  `.dbeaver` ou o arquivo que é atalho recusa tudo com `unreadable` e a frase do atalho (`symlinkMessage`); a abertura é `O_RDONLY | O_NOFOLLOW`, conferida pelo
  `fstat` do descritor contra o `lstat` (arquivo comum, mesmo dispositivo e `inode`: o arquivo trocado no meio do caminho é recusado, e o teste o troca pelo
  `beforeOpen`), lida até 5 MiB (o que cresceu para ali). Vai tudo para `transfers/<sourceId>.dbeaver.part/` (a pasta 0700, uma subpasta 0700 por projeto, `1`,
  `2`…, os arquivos 0600 com `fsync` e o `manifest.json` por último) e a pasta inteira é renomeada no fim: a API nunca vê uma cópia pela metade. A resposta é
  `found { sourceId, where, projects }` ou `notFound`, `canceled`, `notDbeaver`, `tooLarge`, `notWritable`, `noSpace`, `unreadable { message }` (a frase inteira,
  pelo código do sistema, sem caminho). **Uma cópia por janela**: um novo `find` solta a anterior, o `choose` desistido não solta nada, e o pedido que termina
  depois de a janela ser solta ou de outro mais novo da mesma janela apaga a cópia que fez e responde `canceled`. `prism:dbeaver-source-release`
  (`{ sourceId }`) apaga a cópia da própria janela (a de outra, ou um id desconhecido, não faz nada). O log leva só o `sourceId`, o `where`, as contagens e a
  duração, nunca um caminho nem um nome. A tela confere cada resposta com o mesmo schema (`requestDbeaverSource`, `releaseDbeaverSource` e `dbeaverAvailable`, em
  `lib/api/bridge.ts`), e a ponte de desenvolvimento diz que importar do DBeaver só funciona no app.
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
- A navegação (`will-navigate`, `will-frame-navigate` e `will-redirect`), o `webview` e a abertura de janelas são negados em TODO `webContents` desde o
  nascimento (`app.on("web-contents-created")`, `main.ts`); em desenvolvimento passa só a recarga da própria página das janelas do app
  (`navigationAllowed`, `web-lockdown.ts`). A **única** abertura é a da janela do resultado (ver "O resultado no painel, numa aba ou numa janela"). As
  rotas são em hash, que não é navegação.

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
- **O aviso pode ter um botão de ação** (RN-AVISO-006): o terceiro argumento de `success`, `warning` e `error` é `{ label, run }` (`ToastAction`); o
  botão roda a ação e fecha o aviso. O aviso com ação fica `actionToastDurationMs` (8 s), também no tom de sucesso, e pausa com o foco, como no hover;
  dois avisos iguais com ações diferentes não se juntam. A ação nunca é o único caminho (o "Mostrar na pasta" da exportação tem a opção "Mostrar na
  pasta ao terminar", RN-EXPORT-014).
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
  havendo linhas na tela (que ficam), a frase da API vai no próprio aviso; a recusa do somente leitura (`CONNECTION_READ_ONLY`, RN-PROT-002)
  é tratada do mesmo jeito (ver "Proteções da conexão e da pasta"). Depois de "Cancelar", o comando que terminou por
  causa disso é "Comando cancelado." (ver "Uma coisa por vez"), e **não** gera o aviso de falha.
- **Avisos dos scripts** (`scripts.copy.ts`): gravar por cima um script com o SQL grande demais vira o aviso de erro com a frase da tela, porque não há
  diálogo aberto para mostrá-lo (a tela confere o tamanho antes de enviar, e o `SCRIPT_TOO_LARGE` da API só chega se as duas contas divergirem); salvar, renomear
  e excluir dão o aviso de sucesso, e abrir um script cuja conexão sumiu dá o de atenção. "Tornar genérico" e "Vincular à conexão da aba" (RN-SCRIPT-005) dão o
  de sucesso (`madeGeneric`, `bound`); a recusa deles vai ao aviso central.
- **Avisos da tela de Drivers** (`drivers.copy.ts`): (1) o remover que a API recusa com `DRIVER_IN_USE` passa por `allowRefusal` e
  vira o aviso de erro com a frase da tela ("Feche as conexões desse banco antes de remover o driver.", pedida pelo dono), no lugar do
  `title` da API; (2) o aviso de que o download falhou (com a causa, `error.detail`) **não** é de chamada que falhou: é a lista que
  chegou com um driver que baixava e agora está `failed` (`watchDriverTransitions`), e por isso sai uma vez só; a consulta periódica
  que falha várias vezes seguidas avisa só na primeira (`driversErrorMeta`) e para na terceira; (3) "Testar
  conexão" aceita também `DRIVER_NOT_INSTALLED` por `allowRefusal` (`runConnectionTest`), além do que já aceitava.
- **Avisos do editor** (`use-query-runner.ts`, frases em `workbench.copy.ts`): sucesso para comando sem linhas e para o que
  grava e devolve linhas (RN-SQL-013); atenção para cursor fechado, comando cancelado, valores cortados (uma vez por resultado, e nunca na
  execução da atualização automática, RN-GRADE-014), sessão
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
- **Os textos da conexão e da pasta** (RN-CONN-010 e RN-PASTA-001, seção 34): o nome, o host, o banco de dados, o usuário e o nome do ambiente recusam o
  caractere de controle e o de direção do texto (`withoutControl`, em `connections.schema.ts`: `\p{Cc}`, U+200E, U+200F, U+202A a U+202E e U+2066 a U+2069),
  com "<campo> não pode ter caractere de controle nem de direção do texto."; nos nomes (`asName`) a conferência é depois da normalização da API, que junta
  os espaços (a tabulação e a quebra de linha viram espaço e passam), e no host, no banco e no usuário, depois de aparados. O host tem até 255 caracteres,
  o banco de dados e o usuário até 128, e a senha até 1.024, contada como veio. São as regras da importação (RN-TRANSF-014), para o arquivo que o Prism
  exporta voltar por ela; a API confere do mesmo jeito.
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
  diálogos de nova pasta e de "Editar pasta…"; mover e renomear pasta não a mostram. Os ids vêm do `idPrefix` (`cx` e `folder`), e a
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
  cabeçalho do diálogo da conexão. A COR dele (`ShownEnvironment.color`, o herdado da pasta inclusive) também pinta os destaques da área de resultado
  da aba (RN-AMB-002, "A cor do ambiente nos destaques da área de resultado", em Design): o `WorkbenchTabs` a leva como texto ao
  `QueryTabPanel.environmentColor` e, pelo `environment` do `TableTabPanel`, ao `RecordsView.environmentColor`, e os dois ao `ResultPanel`. A conexão
  continua com o ambiente PRÓPRIO no estado e no `PATCH` (mover e renomear conexão mandam o dela): o herdado nunca é gravado nela. Não há mais "lista" de
  conexões (RN-NAV-001): a RN-CONN-015 vale na árvore, na aba, na barra e nos destaques da área de resultado.
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
- **"Renomear" (F2) e "Editar pasta…"** (RN-NAV-009 e RN-PASTA-006, seção 28: a issue #8 desfez o "Editar pasta…" no F2). O menu da pasta
  tem os dois, lado a lado, com o lápis. "Renomear" (`renameFolder`, o do F2 pelo `keyActionFor`) abre o `RenameFolderDialog`, só com o
  nome, no molde do "Renomear conexão": grava pelo `PATCH` com a pasta como está (`renamedFolderInput`, em `_lib/rename-folder.ts`, sobre o
  `folderInputOf`: a cor e o ambiente ficam), e o nome repetido (`FOLDER_ALREADY_EXISTS`) e o 422 do nome ficam no campo
  (`renameFolderRefusalFields`); o 422 de outro campo vai ao aviso pelo título. "Editar pasta…" (`editFolder`, sem atalho) é o modo `edit` do
  `FolderDialog` (título "Editar pasta", "Salvar", aviso "Pasta alterada.", `editFolderSchema` com o nome, a cor e o ambiente). O navegador
  leva cada ação ao diálogo dela (`folderActionTypes`: `rename`, `edit`, `move`, `delete`, no `FolderActionDialogs`). Pôr só o ambiente numa
  pasta que já existia é o `PATCH` com o nome, a pasta pai e a cor como estavam (`folderInputOf`; conferido sob Xvfb pelo `GET api/user/folders`).
- **A cor da pasta** (RN-PASTA-007): `folderSchema.color` (exigida, nula sem cor), que pinta o ícone da linha da pasta no navegador, aberta ou
  fechada (`NavigatorRow.folderColor`, do mapa `folderColors` que o `Navigator` monta das pastas com cor; o esquema, que usa o mesmo desenho,
  fica neutro). Não é o ambiente: não passa às subpastas nem às conexões, e não entra no `environmentLookup` nem nos ambientes do usuário
  (testes em `environment.test.ts` e `user-environments.test.ts`). Escolhe-se em "Cor da pasta", antes da seção Ambiente, na nova pasta e no
  "Editar pasta…": o `ColorField` (`_components/color-field.tsx`), a fileira do ambiente com **"Sem cor" na frente** (o traço na diagonal,
  `NoColorIcon`, escolhido quando não há cor), as seis do canvas (clicar na escolhida a tira) e "Outra cor", a única que abre o seletor do
  sistema, nas regras da RN-CONN-017; a cor vai ao `FormData` pelo campo escondido `color`. O `EnvironmentPicker` usa as peças da bolinha
  dele (`swatchClassName`, `chosenClassName`, `pickerStart`, `openSystemPicker`) e continua sem o "Sem cor".
- **O ícone colorido passa em 3:1 em todos os temas** (RN-CONFIG-003; a cor da pasta e a do script, RN-SCRIPT-006): quem pinta passa pelo
  `iconColorStyle` (`components/ui/icon-color.ts`), que devolve `light-dark(<variante dos temas claros>, <variante dos escuros>)` como a marca
  faz, e o `color-scheme` do tema escolhe sem JavaScript (o "seguir o sistema" inclusive). A variante (`readableIconColor`, pura) é a própria cor
  quando ela já passa sobre as superfícies do esquema (`iconSurfaces`: o fundo, o painel, a elevada e a linha selecionada de cada tema; o
  `icon-color.test.ts` confere que são as fichas do `globals.css`), e senão a mistura com o preto (claros) ou o branco (escuros) com a menor
  parte, de 1 em 1%, que passa. As seis do canvas são claras: nos escuros ficam como são, e nos claros escurecem (o Âmbar dá 1,7:1 sobre o
  fundo do Prism Claro). A gravada, e a das bolinhas, é a escolhida. Tema novo: as superfícies dele entram em `iconSurfaces`, e o teste avisa. **A cor do
  ambiente da aba passa pela mesma conta** (RN-AMB-002): contorno é elemento gráfico, com o mesmo 3:1, então os destaques da área de resultado levam o
  `iconColorStyle` da cor do ambiente (pela variável `--environment-color`, ver Design), e a etiqueta do ambiente, essa, continua com a cor escolhida.
- **O `PATCH` da pasta grava a pasta por inteiro**, o ambiente, a cor e as proteções inclusive: o corpo de cada diálogo sai do `folderInputOf` (o que o
  diálogo não perguntou vai como a pasta já tem, senão mover ou renomear tirariam o ambiente e a cor dela, voltariam a confirmação a "Não" e tirariam
  o somente leitura, com a API pedindo a senha). As recusas do ambiente e da cor da pasta são 422 `FOLDER_NAME_INVALID` no campo (`environmentName`,
  `environmentColor`, `color`), que o diálogo já mostra no lugar.
- **O `PATCH` da conexão também grava a conexão por inteiro** (seção 32): as proteções próprias (`confirmCommands`, `readOnly`) e a verificação
  (`verificationEnabled`, `verificationInterval`, `verificationQuery`) vão sempre. Renomear e mover mandam as da conexão (`movedConnectionInput`, que
  o `renamedConnectionInput` usa, com o `verificationOf`); o formulário manda as proteções pelos campos escondidos da seção Proteções e a verificação
  pelo painel "Sessão da conexão" (abaixo), que nasce com a gravada (na nova, o `newVerification`). As herdadas (`protections`) nunca vão: elas
  mudam com a pasta. O `connectionSchema` e o `folderSchema` exigem os campos: a resposta sem eles, ou com uma confirmação que a tela não conhece, é
  recusada, em vez de o PATCH seguinte gravar a proteção mais fraca sem ninguém pedir (o `none` da API vale nulo, "Não"). Os testes dos corpos
  (`folder-input`, `move-connection`, `rename-connection`, `rename-folder`) conferem que renomear e mover levam as proteções e a verificação, e os dos
  diálogos, com os ganchos simulados (`connection-dialog.save`, `folder-dialog.save`, `move-connection-dialog`, `rename-connection-dialog`,
  `rename-folder-dialog.save`), o `PATCH` que cada um manda de fato, por inteiro, e quando a senha é pedida. **Quem passar a gravar uma conexão ou uma
  pasta por outro caminho** (o arrastar na árvore, que a especificação cita e a árvore ainda não tem, ou um atalho que troque só a cor) monta o corpo
  pelo `movedConnectionInput` ou pelo `folderInputOf` e trata o `USER_PASSWORD_REQUIRED` pelo `passwordAsked`, como o "Mover".
- **O painel "Sessão da conexão"** (`session-section.tsx`, RN-VERIF-001), só no formulário da conexão, logo depois dos campos e antes do Ambiente: a
  ordem de leitura do canvas (`Conexoes.dc.html`), que põe a sessão embaixo dos campos, na coluna da esquerda, e o Ambiente e as Proteções na da direita.
  "Verificar a cada [N] segundos" é estado do diálogo (`verifying`) e vai pelo campo escondido `verificationEnabled`, como o somente leitura; o intervalo
  (`verificationInterval`, de 5 a 3.600, com a frase da API) e a "Consulta de verificação" (`verificationQuery`, um `<textarea>`, aparada, até 1.000
  caracteres, sem caractere de controle nem de direção do texto fora a tabulação, a quebra de linha e o retorno de carro, `queryWithoutControl`, emenda
  de 2026-10-17 da RN-VERIF-001, com as frases da API, e nula em branco) são campos não controlados do `FormData`, no `connectionFields`. O intervalo não se desabilita com a caixa desmarcada:
  desabilitado, ele sairia do `FormData`. A dica da consulta é a do banco escolhido (`engineOptions[].verificationQuery`, as `PingSql` da API), e que ela
  seja uma leitura só quem diz é a API: a recusa (`CONNECTION_INVALID` no `verificationQuery`, com o motivo) vai ao campo, com o foco, como as outras; o
  `readForm` serve a gravar e a testar, então o "Testar conexão" leva a consulta digitada (RN-CONN-013), e não a gravada. À direita da linha da caixa vai o
  indicador da última verificação da conexão aberta, como no canvas (`checkIndicator`, que a página da área de trabalho passa: o `ConnectionCheckLabel`,
  ver "Verificação periódica e Só as conectadas"). O "Encerrar a conexão após N minutos sem uso" do canvas não é desenhado: o encerramento por ociosidade
  continua fora (seção 13), e o teste confere que ele não aparece.
- **A seção Proteções** (`protections-section.tsx`, RN-PROT-001 a 004), a mesma no formulário da conexão e nos diálogos de nova pasta e de "Editar
  pasta…", depois da seção Ambiente (o "Mover" não a mostra), como no canvas, com a escolha de três no lugar da caixa: "Confirmar antes de executar"
  ("Não", "Só comandos irreversíveis", "Todos os comandos", rádios) e "Somente leitura" (caixa, com o cadeado). As escolhas PRÓPRIAS são estado do
  diálogo e vão por dois campos escondidos (`confirmCommands`: `none`, `irreversible` ou `all`; `readOnly`: `true` ou `false`), e os controles
  mostram o que vale. **A herdada não se afrouxa**: `inheritedProtections(folders, pasta)` (`_lib/protections.ts`, pura e testada) diz o que a pasta
  impõe a quem está dentro dela, pelo `protections` que a API devolve de cada pasta (as dela e as de cima, com a origem); na conexão é a pasta
  escolhida no campo (antes de gravar, como o ambiente herdado), na pasta é a pasta pai. O somente leitura herdado fica marcado e desabilitado, as
  escolhas abaixo da confirmação herdada ficam desabilitadas, e as duas dizem "Herdado da pasta X" e por que não se afrouxa ali. A herdada não vira
  própria: o campo escondido continua com a própria, e sair da pasta tira a proteção junto.
- **A senha do somente leitura** (RN-PROT-003, `user-password-dialog.tsx`, no molde do de revelar a senha): marcar ou desmarcar "Somente leitura"
  numa conexão ou numa pasta que já existe abre "Confirme a sua senha" ao salvar (`readOnlyChange`), com o que muda ("Desmarcar “Somente leitura” de
  MES Produção") e o aviso de que cinco senhas erradas seguidas fecham o cofre, e o mesmo `PATCH` vai com `userPassword` (`updateConnection` e
  `updateFolder` só põem a chave quando ela veio). O 422 `USER_PASSWORD_REQUIRED` que a tela não previu (mover a conexão, ou a pasta acima dela,
  para fora de uma pasta somente leitura: pelo formulário, pelo "Mover" da conexão ou pelo "Mover" da pasta; a árvore não se arrasta) abre o mesmo diálogo (`passwordAsked`)
  e grava de novo; o Renomear não pede, e a recusa que chegasse nele iria ao aviso central. No diálogo, a senha errada (`INVALID_PASSWORD`) e a que
  faltou ficam no campo, que volta vazio; o 401 `VAULT_LOCKED` do quinto erro dá o aviso de atenção na `onSuccess` da própria mutação, e o
  `VaultGuard` leva ao login; o resto volta a quem abriu (`onDone`: o 422 dos campos vai a eles; `null` quando a falha já foi ao aviso central). A
  senha não fica guardada (`gcTime: 0` e `reset`). Não há transação aberta a avisar: a tela ainda não tem o Commit manual (RN-TX-001). O diálogo
  fica fora do `<form>` de quem o abre, como o de revelar.
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

- **O texto da área de trabalho é 13/20** (RN-CONFIG-009, a escala do canvas): a raiz de `WorkbenchPage` leva `text-sm`, e só ela; tudo de dentro herda
  dali (a árvore, a busca e as mensagens do navegador, a seção Scripts, a barra de abas, as barras e os painéis das abas). Até a 0.3.0 a árvore, a busca e
  as abas herdavam o 14/22 do `body`. Os diálogos abrem num portal no `<body>` e continuam no 14/22 dos formulários, como a tela de login e as
  Configurações; o editor (o tamanho em Configurações › Editor SQL), a grade (o zoom dela) e as etiquetas têm tamanho próprio. Peça nova da área de
  trabalho não escreve `text-sm` nem `text-base` para "voltar ao normal": herda (o `page.test.ts` confere a raiz).
- **O estado fica dentro do guard do cofre e acima das telas de dentro.** Em `routes.tsx`, o `VaultGuard` é a rota de fora
  e o `WorkbenchProvider` (`_lib/workbench-state.tsx`) é uma rota sem caminho dentro dele, com Conexões, Drivers e Configurações
  como filhas. **A área de trabalho não é uma rota filha**: o `WorkbenchSlot` (`app/_components/workbench-slot.tsx`) a mantém MONTADA
  enquanto o cofre está aberto e a esconde (`hidden`) e a torna inerte (`inert`: fora do teclado e do leitor de tela, sem atalho) fora
  da rota dela; a rota `/workbench` existe, sem elemento. Ir de uma tela à outra não apaga as abas, os nós abertos da árvore, o que o
  editor guarda (cursor, seleção, desfazer, rolagem), a largura do navegador, a divisão do resultado nem o zoom do diagrama; uma
  consulta em andamento continua, e ao reaparecer o foco volta ao elemento que o tinha, se ele ainda existe e se o foco está perdido (as linhas de uma lista virtual saem do
  DOM enquanto ela está escondida, e voltam outras: o foco que estava numa linha da árvore não é devolvido; a seleção, que é estado, fica; o `WorkbenchSlot` é pai da área
  das abas e o efeito dele roda DEPOIS do dela, então sem o "se o foco está perdido" (`isLost`) ele desfaria o foco que uma aba aberta na mesma volta acabou de levar à entrada). Sair do
  cofre (ou o cofre fechar por qualquer motivo) desmonta tudo, então nada passa ao usuário seguinte: o provedor aposenta os executores e apaga a
  memória das abas e os filtros pedidos que esperavam (`tab-memory.ts` e `filter-handoff.ts` são de módulo). **Escondida com `hidden`, toda caixa
  aqui dentro mede 0x0**: quem observa tamanho tem de tratar o zero como "sem medida" (ver "Lista virtual que MEDE as linhas", abaixo). **O provedor não pode subir para fora do guard**:
  ele consulta `api/user/connections`, e montado com o cofre fechado cada abertura do app receberia 401 `VAULT_LOCKED`
  antes do login e mostraria o aviso "Cofre fechado" (`routes.test.ts` confere a posição). Guarda `tabs` (`QueryTab`, em `workbench-model.ts`: `id`, `title`,
  `connectionId` (nulo só na aba de consulta: a de um script cuja conexão sumiu, a do script genérico sem uma só conexão conectada e a que voltou na entrada
  sem a conexão dela, ver "Scripts salvos"), `sessionId`, `sql`, na aba de uma tabela `table` (esquema, nome e a
  vista; `isTableTab` estreita o tipo para `TableTab`, que sempre tem a conexão) e, na aba de um script, `script`), `activeTabId`, os nós abertos
  (`expanded`, sem as pastas, que são só do navegador e se lembram à parte: ver "As pastas abertas lembradas") e "Desconectar". `openQueryTab(connectionId, sql?)` abre
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
  `TRANSACTION_CONTROL_NOT_SUPPORTED`, `CONNECTION_READ_ONLY`, `NO_OPEN_CURSOR`, `DATABASE_SESSION_NOT_FOUND`) voltam como valor por `allowRefusal`.
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
  já fechado). No resultado que veio inteiro, o total é o número do resumo, e a API não é chamada. **O total contado se conta de novo**
  (RN-SQL-006, issue #10): ver "Contar de novo e atualizar automaticamente", abaixo.
- **O texto de SQL vive no editor** (CodeMirror 6, `sql-editor.tsx`), e não no estado do React. O provedor o recebe por
  `updateTab(tabId, { sql })` 400 ms depois da última tecla, quando o editor perde o foco e quando é desmontado (sair do cofre; ir a
  outra tela não o desmonta): nunca a cada tecla, porque cada mudança no provedor redesenha o navegador e refaz a poda. `tab.sql` só
  é lido ao criar o editor; mudar a propriedade depois não altera o texto.
- **Os painéis das abas ficam todos montados** e só o da aba ativa aparece (`hidden`): trocar de aba não desfaz o editor
  da outra (desfazer, cursor e rolagem continuam). Ir a Conexões, a Drivers ou a Configurações também não: a área de trabalho
  inteira fica montada por baixo (`WorkbenchSlot`), e o texto, o resultado, o comando em andamento e o histórico de desfazer continuam.
  Só sair do cofre os desmonta; o bloqueio por inatividade mantém as abas e o texto, mas dá a cada aba um executor novo (ver "Bloqueio
  por inatividade").
- **"Executar"** envia a seleção ou, sem seleção, `statementAt(texto, cursor, banco, { blankLines })` (`sql-statements.ts`; quem monta
  é o `runTarget` de `sql-editor.tsx`, com teste, e `blankLines` é a preferência `editor.blankLineSeparates`, lida na hora: ver "A linha
  em branco separa o comando do cursor", abaixo). Uma execução
  leva um comando só (RN-SQL-001): quem confere é o `run`, com `statementCount`, e a seleção com mais de um não é enviada
  (aviso de atenção; e o estado `notice`, quando não há linhas na tela). Trecho só com comentários não é comando. O botão
  pergunta "há o que enviar?" a cada tecla com `hasStatement`, que para no primeiro caractere de comando: não separe os
  comandos a cada tecla. O "Executar script" (Alt+X), que manda vários, é outro caminho: ver "Executar script", mais abaixo. Ctrl+Enter é registrado com `Prec.highest`, porque o mapa padrão do CodeMirror usa a mesma tecla
  para abrir uma linha.
- **O separador conhece o banco da aba** (RN-SQL-002): o editor manda o banco junto do texto (`RunTarget.engine`). No
  PostgreSQL o comentário de bloco aceita outro dentro dele e existe o bloco `$tag$`; no Db2 e no Informix o primeiro `*/`
  fecha o comentário e `$` é um caractere qualquer; no Informix `{ ... }` também é comentário. Sem o banco, vale o
  PostgreSQL.
- **A linha em branco separa o comando do cursor** (RN-SQL-018, issue #7; `blankLineCuts` em `sql-statements.ts`, testes em
  `sql-statements.blank-line.test.ts`). Com a preferência ligada (o padrão), sem seleção, a linha em branco (só espaços) também termina o
  comando, como o "Smart" do DBeaver. A regra é **"na dúvida, não separa"**: só a conexão que pede confirma o comando irreversível (RN-PROT-001), e
  separar onde não devia executa a metade de um comando (`DELETE FROM t`, a linha em branco e `WHERE id = 1`), enquanto não separar só faz o banco
  recusar o texto inteiro. Separa só quando as duas condições valem: o pedaço logo depois da linha em branco começa um comando
  (`startsCommand`: `commandWords`, mais os casos que olham a palavra seguinte, `WITH` com `nome [ ( … ) ] AS (` em `opensQueries`, `ALTER`
  e `DROP` com o tipo do objeto em `objectKinds`, `COMMENT ON`, `LOCK TABLE`, `REFRESH MATERIALIZED|TABLE` e `DO` com o corpo) e o comando
  de cima está fechado (`commandAbove`: parênteses em zero; o fim não é vírgula, operador nem palavra de `continuationWords`, com as
  exceções de valor `SET … ON`, `DEFAULT VALUES` e o `ON COMMIT` que pede o `DELETE ROWS`; e nada espera o resto: o `INSERT` antes do
  `VALUES`/`SELECT`/`EXECUTE`, o `WITH` antes do comando principal, o `EXPLAIN` antes do comando, e o `CREATE TRIGGER` e o `CREATE SCHEMA`,
  que só o `;` termina, em `untilSemicolon`: o esquema traz os objetos dele, `CREATE TABLE`, `GRANT`…, sem `;` entre eles, e separá-lo criaria
  a tabela fora dele). `SET` e `BEGIN` não começam comando de propósito, e dentro de um `ALTER` nem `ALTER`, `DROP`, `GRANT` e `REVOKE`
  (são cláusulas dele). Dentro de um bloco com `;` no corpo nunca separa: o corpo é o `dialect.body()` do `statementCount`, recomeçado só no `;` que
  fecha e no corte (no Db2, depois do bloco, até o fim do texto). Esse corpo só vê o bloco nas primeiras palavras do comando, e o `BEGIN` não
  começa comando: no Db2 (`beginBlock`), o primeiro `begin` em qualquer lugar do texto para os cortes até o fim, porque com `SELECT …`, a linha
  em branco e `BEGIN … END` (ou `nome: BEGIN`, ou `ALTER MODULE … ADD PROCEDURE`) o primeiro `;` do bloco recomeçaria o corpo, e a linha em
  branco depois de `purge: LOOP` mandaria sozinho o `DELETE` de dentro do laço. A coluna chamada `BEGIN` também para os cortes (na dúvida,
  não separa). **Palavra nova que começa comando**: só se nenhuma cláusula de outro comando pode começar com ela depois de um texto que
  parece completo (o `LOCK MODE ROW` do `CREATE TABLE` do Informix e o `DROP STORAGE` do `TRUNCATE` são os exemplos); na dúvida, peça a
  palavra seguinte, como o `LOCK` faz. O corte é posicional: `blankLineCuts` devolve
  o começo da primeira linha em branco entre os dois comandos (e o da última, quando há comentário entre elas: o comentário separado do
  comando de baixo por uma linha em branco não vai com ele), e o `scan` fecha o comando de cima no `\n` antes dela, que é também o
  `boundary` do cursor; o `scan` marca esse comando com `cut`. **O cursor numa linha em branco** fora de um comando (`statementAt`) dá
  `null` quando acima dele não há comando nenhum, no começo do texto ou só com comentários acima ("se não há nada acima, nada abaixo
  também", do dono, como no DBeaver: nem o `DELETE` de baixo vai; o executor diz "Não há comando para executar.", e o botão continua
  habilitado, porque o `hasStatement` não separa os comandos). Com um comando acima, só muda de resposta onde a regra cortou
  (`onBlankLineCut`: a linha dele está na mesma sequência de linhas em branco de um corte) e foi o corte que terminou o de cima (`cut`): fica
  com ele. Depois de um comando terminado no `;` vale a resposta de antes, o comando seguinte: **o `;` não muda de resposta com a
  preferência ligada** (com `DELETE …;`, a linha em branco e `SELECT …;`, o cursor na linha em branco é o `SELECT`, e não o `DELETE` de
  novo). Um teste confere isso posição a posição, com a preferência ligada e desligada, nos textos em que a linha em branco não corta nada
  e que não começam por linhas em branco (essas, com a preferência, não executam nada). A seleção e o
  `statementCount` não mudam: a conta é sempre só pelo `;`. Custa uma leitura dos pedaços do texto por execução (por volta de 100 ms num
  texto de 1 MB); o `hasStatement` de cada tecla não passa por aqui.
- **O destaque do comando enviado** (RN-SQL-018; `_lib/run-flash.ts`, com teste): ao executar sem seleção (Ctrl+Enter ou o botão), o
  `sendFrom` de `sql-editor.tsx` entrega ao `onRun`, junto com o alvo, o `flash` que manda `flashRun(de, até)` com o trecho que `flashRangeOf`
  deu no instante da tecla, exatamente o texto enviado; a seleção e o "sem comando" não piscam. **Quem acende é a aba, e só quando o comando
  vai mesmo ao banco**: o `handleRun` de `query-tab.tsx` chama o `flash` dentro do `go()`, com `commandWillRun` (um comando, a aba livre) e
  com conexão, depois da pergunta das alterações não salvas (RN-EDIT-007) quando ela vem; com um comando em andamento o executor larga o
  Ctrl+Enter calado, e o destaque nessa hora diria que algo rodou. Se o texto mudou entre a tecla e o envio, nada pisca (`flashEffect`). A
  marca `.cm-run-flash` (um `StateField`) usa o acento do tema, translúcido, numa animação de 700 ms (`runFlashMs`); um `ViewPlugin` a
  apaga no fim e leva o relógio junto quando o editor desmonta, e qualquer edição a apaga antes. Cada destaque tem um
  número (`data-run`): é outra marca, o CodeMirror a redesenha e a animação recomeça mesmo no mesmo trecho. Com `prefers-reduced-motion`,
  a marca aparece parada e some de uma vez. A cor está no `baseTheme` da extensão, e não no `editorTheme`: a animação não precisa ser refeita
  a cada troca de fonte. **Conferido sob Xvfb** (`pnpm dev`, uma conexão para um host que não existe, a tecla e o clique pelo protocolo de
  depuração): o comando do cursor, o `DELETE` com a linha em branco antes do `WHERE` e o cursor na linha em branco piscam, no tema escuro e no
  claro, a marca sai do DOM antes de um segundo, e desligar a preferência faz o texto inteiro piscar, sem recriar o editor. Depois da
  revisão, também: com o comando em andamento (o Cancelar na barra, a conexão tentando abrir para um endereço que não responde, como o
  `192.0.2.1` da faixa de documentação; ele tem de descartar o pacote, e não recusar, ou a falha chega na hora), o Ctrl+Enter não pisca
  nada; e com `DELETE …;`, a linha em branco e `SELECT …;`, o cursor na linha em branco pisca e envia o `SELECT`.
- **A posição do erro vale para o texto que foi enviado, e é em caracteres.** O PostgreSQL conta caracteres (de 1 em diante) e
  o editor conta unidades UTF-16: cada emoji antes do erro valeria dois para o editor e um para o banco, e a marca cairia um
  caractere antes por emoji. `utf16IndexOf` (`sql-statements.ts`, com teste) converte; acento comum não precisa. O editor avisa cada alteração (`onEdited`, sem atraso): a marca
  que estiver na tela some (também a do erro que ficou na tela enquanto outro comando roda), e o erro de um comando que
  ainda roda chega sem posição (`textEdited`).
- **A grade do resultado** (`result-grid.tsx`) é virtualizada nas duas direções, com linhas de altura fixa e larguras de
  coluna medidas uma vez, da primeira página, pela largura de cada caractere na fonte da interface (canvas, `grid-text.ts`; ver "A fonte da
  grade" abaixo). Não meça célula no DOM nem recalcule largura ao carregar mais: é isso que deixa "Carregar mais 200" sem redesenhar o que está
  na tela. A grade recebe `key` por execução (`state.id`), não por página. **No cabeçalho, quem cede espaço é o tipo, e o nome da coluna não cede nada**
  (`GridHeaderCell`): a largura é calculada sem o botão de ordenar, e o espaço dele (sempre reservado, RN-GRADE-021) alguém cede; era o nome, e o `id`
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
- **A fonte da árvore e da grade é a da interface, sempre** (RN-CONFIG-008, seção 42), também a do app (IBM Plex Sans): a caixa que rola da grade tem
  `font-sans` explícito, e o cabeçalho, as células e o `textarea` do `CellEditor` herdam (o preflight põe `font: inherit`); o `navigator-row.tsx` não
  escolhe fonte (sem `monoKinds`). O número da linha e o canto têm `tabular-nums`; **as células não**: o canvas não aplica `tnum`, e a medida divergiria
  da tela (a Plex Sans já tem dígitos de largura igual). Seguem a interface o "N linhas afetadas", o número das Estatísticas e o campo do texto do nulo
  (a prévia da grade); o comando das Estatísticas é SQL e vai em `font-editor`. **Continuam mono do app**: a mensagem do banco (`<pre>`, o `^` do
  PostgreSQL só se alinha em largura fixa), o SQLSTATE, a linha da variável, as etiquetas, a Estrutura, o Diagrama, o título da aba da tabela e os diálogos.
- **A largura das colunas é medida na fonte** (`grid-text.ts`, puro, e `use-grid-text.ts`), porque a fonte da interface é proporcional e contar
  caracteres erra: o nome `WAREHOUSE_ID` em seminegrito desenha 102,5 px onde 7,8 px por caractere reservava 93,6, e o nome em maiúsculas do Informix e
  do Db2 virava reticências (o E1 de volta). `measuredGridText(pilha, measure)` mede **cada ponto de código uma vez por fonte** (`for…of`, um mapa por
  fonte) em três fontes do canvas: `400 13px` (célula), `600 13px` (o nome: o cabeçalho é `font-semibold`) e `400 11px` (o tipo e a marca "somente
  leitura"), e soma, com **1 px de folga por texto** e `Math.ceil`. Sem o ajuste entre pares de letras a soma sobra, que é o lado seguro: o que não
  pode é cortar. **Não meça o texto inteiro** (`measureText` por valor, ~10 mil chamadas na primeira página, cada uma com o desenho do texto) nem a
  célula no DOM. O `limit` para a soma assim que passa dele: o valor de 10.000 caracteres custa só o que cabe (`baseWidths` passa 455 e `fitWidth`,
  575, o teto menos o respiro). O caractere que o canvas mede como 0 ou como número que não serve vale o que valia na mono (sobra). `monoGridText` é a
  conta de antes (7,8 e 6,6 por unidade de `.length`) e o **padrão** de `baseWidths`, `fitWidth` e `GridRow`: sem documento ou sem contexto 2d (o
  vitest roda em Node) a grade usa ele, e os testes de larguras por tabela de casos continuam os de antes. `useGridText(fonte)`: o canvas é um
  `<canvas>` que nunca entra na página, **um por documento** (`WeakMap`) e pelo `useHost().document` (a janela do resultado mede no documento dela:
  é a regra de "código novo na área de resultado não usa `document` global"); a pilha é `resolvedFontFamily("ui", nome)` (`fonts.ts`: a escolhida
  entre aspas e a do app atrás, **sem `var()`**, que o canvas não resolve), e um teste confere `appFontFamilies` contra `--font-app-sans` e
  `--font-mono` do `globals.css`: mudar uma sem a outra faz o canvas medir outra fonte. O `ctx.font` atribuído é conferido (o canvas ignora em silêncio
  a atribuição inválida: sentinela de `10px sans-serif` antes) e o "0" tem de medir mais que zero, senão mono. Antes de medir, `document.fonts.check`
  nas três fontes: a que não carregou (só as do `@fontsource` podem estar assim; a do sistema nem está na lista) mede a reserva, o gancho pede
  `fonts.load` e, quando ela chega, troca o `GridText` **uma vez** (o contador `loads`; a fonte que falha não faz laço). O `GridText` só muda de
  identidade com a fonte, a página ou a carga: a grade (`ResultGrid` recebe a prop `font`; a `ResultPanel` passa `preferences.ui.fontFamily`) refaz só
  as larguras de saída (`base`, no `useMemo`) e o efeito de `measure()` do virtualizador cuida do resto; as larguras escolhidas (`ColumnSizing`, em px
  de 100%) ficam, e "Carregar mais" continua sem refazer nada (`firstPage` congelado). A dica do valor cortado (`GridRow`) usa a mesma medida:
  `text.cell(valor, espaço + 1) <= espaço`, com o espaço na escala de 100% (`item.size / scale - cellPadding`). A altura da linha (32 px × zoom) e o
  zoom não mudam: a medida é a de 100% vezes o fator, a mesma suposição linear de antes.
- **"Conectada" tem uma definição só**, `isConnected` (`workbench-model.ts`): a árvore abriu a sessão da conexão, ou
  alguma aba tem a sua. Vale para o ponto e o "Desconectar" do navegador e para a barra de status. As listas das conectadas
  (`connectedConnectionIds`: a conta e o "Só as conectadas" do navegador, a lista do botão da conexão da aba e o script genérico) tiram dela a que a
  verificação periódica achou sem sessão na API (`notConnectedIds`, o "Sem sessão aberta"; ver "Verificação periódica e Só as conectadas").
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
  sessão volta a ter dado, e o `WorkbenchTabs` a esquece (`forget`) quando uma aba dela tem sessão. O registro é do `WorkbenchProvider` (`disconnectLog` no
  `useWorkbench`), e não da área das abas: as conexões das abas de tabela que voltaram na entrada entram nele antes de as abas existirem (ver "Abas que voltam na próxima entrada"). As vistas das tabelas dessa conexão não
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
  `ignoresContextMenu`; Shift+F10 e a tecla de menu o abrem, e o botão do meio fecha a aba. Ctrl+W (Cmd+W) fecha a ativa com o foco em qualquer
  lugar da janela da área de trabalho (`isCloseShortcut`, tratado em `WorkbenchTabs`, ver "O foco ao abrir, fechar e trocar de aba"): o app empacotado não tem
  menu no Windows e no Linux, então nada mais responde a esse atalho. O X não toma o foco no clique do mouse. **Fechar várias abas usa uma fila** (`tabsToClose` e o `pendingClose` do `WorkbenchTabs`): `closeTab` parte da lista que viu
  quando foi criado, então várias chamadas no mesmo instante valeriam só a última; a primeira fecha agora, e cada mudança de `tabs` fecha a
  seguinte, cada uma pelo caminho de sempre (cancela o que roda e fecha a sessão). Um `closeTabs(ids)` no provedor trocaria a fila.
- **A árvore é plana e virtualizada** (`@tanstack/react-virtual`): `flattenVisible` (`_lib/navigator-model.ts`, testado)
  achata nós abertos em linhas, e só as que se veem existem no DOM. Como uma linha fora da janela não existe, ela não pode
  buscar nada: **quem busca é o `Navigator`, num `useQueries` só, a partir das chaves dos nós abertos**. A busca por nome não
  passa por aí: ela lê o que já está em cache e pede, num `useQueries` à parte, o índice de nomes de cada banco do escopo dela (ver "Navegador: clique,
  menu e busca"); nada disso é nível, e nenhum nó abre.
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
- **Ir ao item pelas primeiras letras** (RN-ARVORE-009, pedido do dono, como no DBeaver; vale para esta árvore e para a da seção Scripts): digitar um
  caractere imprimível (sem Ctrl, Alt nem Cmd, fora da composição de um acento) leva o foco E a escolha ao próximo item visível que começa por ele, com a
  volta ao começo; os digitados até 1 s depois do anterior se juntam num texto (o primeiro item, a partir do atual incluído, que começa pelo texto todo), e
  a mesma letra repetida percorre um a um os que começam por ela. A lógica é uma só e pura, `_lib/type-ahead.ts` (`typeAheadStep`, `isTypeAheadKey`, a janela
  `typeAheadWindow`; compara pelo `fold` da busca: sem caixa e sem acento), com teste de tabela; `useTypeAhead` (`_lib/use-type-ahead.ts`) guarda o texto num
  `useRef` e o que o indicador mostra num estado que some 1 s depois da última tecla; `typeAheadLabels` e `scriptTreeLabels` dão os nomes das linhas à vista
  (a de Carregando… e a de erro, sem nome). Só as linhas à vista contam (com o "Filtrar objetos", as que ele mostra): nada se expande nem se busca. Na
  `NavigatorList` o salto passa por `focusRow`, que pede a rolagem da lista virtual e tenta o foco a cada quadro até a linha existir (no meio-tempo o foco espera na própria árvore, com o destino em `pendingFocus`, para a linha de origem que sai da janela não o deixar cair no `body`; o `onKeyDown` da árvore segue o texto a partir desse destino, e a tecla desse intervalo não se perde); na `ScriptsTreeView` o
  gancho vem da `ScriptsSection` (`typeAhead`, opcional: a árvore continua só desenhando) e o `focus()` rola a seção. O Espaço só entra no meio do texto (sozinho
  é da linha); as teclas de antes (setas, Home, End, Enter, F2, Delete, Shift+F10, a tecla de menu) e o Ctrl+F não mudam. O `TypeAheadIndicator`
  (`type-ahead-indicator.tsx`) é o cantinho sobre a lista ("Ir para: bat", sem tirar espaço dela; na seção Scripts, uma faixa `sticky` sem altura) e a região
  `aria-live="polite"` sempre montada, que só anuncia o "Nenhum item começa com “xyz”". Testes: `type-ahead.test.ts`, `use-type-ahead.test.ts`,
  `navigator.type-ahead.test.ts` (a `NavigatorList` com a lista virtual de mentira), `scripts-section.type-ahead.test.ts` e `type-ahead-indicator.test.ts`.
- **O que o canvas tem e a fatia não**: ocultar o navegador, "Atualizar navegador" e o "+" de nova conexão no título dele, o botão "+" de aba;
  na barra do editor, "Explicar plano", "Formatar", o esquema da aba e a transação (a barra tem Executar e Cancelar,
  seção 9 da especificação, o Executar script, RN-SQL-019, a conexão da aba, RN-ARVORE-008, e o banco, RN-ARVORE-007); na área de resultado, "Mensagens" e "Plano de execução" (no lugar delas, depois de um script, as abas dele, RN-SQL-020; o "Exportar CSV" só existe
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
  `dropIndex` (pela metade de cada aba), `dragKindOf` e os dois tipos do arraste (abaixo). O provedor tem `reorderTab` e `shiftTab`. A ordem vale na próxima entrada (RN-ABAS-006, ver
  "Abas que voltam na próxima entrada").
- **O arrasto é o do HTML** (`draggable` na moldura de cada aba, `data-tab-id`) e carrega o dado `{ windowId, tabId }` (`writeTabDrag`/`readTabDrag`,
  conferido: qualquer programa pode soltar algo na faixa). **Os dois tipos** (`tab-order.ts`): `tabDragType` (`application/x-prism-tab`), a aba de consulta
  e a de tabela, que a faixa e o véu de qualquer janela do Prism aceitam; e `resultTabDragType` (`application/x-prism-result-tab`), a aba do resultado
  (RN-ABAS-012), que só a faixa e o véu da janela de origem aceitam (as outras a reconhecem e a recusam). `dragKindOf(types)` diz `"tab"`, `"result"` ou
  `null` (texto, arquivo) já pelo `dataTransfer.types`, que o Chromium mostra no `dragenter` e no `dragover`; o conteúdo, só no `drop`. `dragTypeOf(kind)`
  é o tipo que cada um escreve. Quem arrasta a aba do resultado (fluxos B e C) escreve o mesmo dado com `resultTabDragType`, chama `drag.begin(id, "result")` e
  termina pelo mesmo caminho (`endTabDrag` com `kind: "result"`, `onDragEnd` do `WorkbenchTabs`).
- **O arraste de uma aba desta janela** (`_lib/tab-drag.ts`, puro e testado): `createTabDragSession()` guarda o arraste (`begin` no `dragstart`, na hora;
  o aviso a quem desenha sai depois, num `setTimeout` de 0, porque o Chromium cancela o arraste cujo elemento muda no próprio `dragstart`), a marca de quem
  recebeu a soltura (`mark("strip" | "veil")`), `finish()` no `dragend` (devolve o que se sabe e solta o que esperava), `whenIdle(tabId, run)` (o
  `detachTab` da aba que outra janela recebeu espera o fim do arraste: o Chromium não avisa o fim do arraste de um elemento que saiu da página) e
  `subscribe`/`getSnapshot`. `veilFor({ kind, fromHere, onlyTab, available })` devolve a frase e se a soltura vale (`null`: sem véu, como a aba do resultado de
  outra janela e o navegador de desenvolvimento); `isOnlyTab` (a aba e a do resultado dela contam como uma) e `dragEndRequest(ended, event, { windowId, onlyTab })`
  monta o `TabDragEnd` do `dragend` (`null` na soltura na faixa, fora do Electron e na aba única). O `WorkbenchTabs` cria a sessão, passa-a à faixa (`drag`,
  `onDragEnd`) e ao véu, e `handleDragEnd` faz: `drag.finish()`, `dragEndRequest`, `endTabDrag` (`lib/api/bridge.ts`, que devolve `{ action: "none" }` para a
  resposta que não confere e para a ponte que não responde) e, com `newWindow`, o `latestMove` de sempre com o `at` que o processo principal leu; a aba do
  resultado (`kind: "result"`) não vai a outra janela de abas: o `at` abre o resultado na janela dele (`changePlace(tabId, "window", "drag", at)`).
- **O véu** (`_components/tab-drag-veil.tsx`, `TabDragVeil`): `fixed inset-0 z-40`, borda tracejada de 2 px no acento, a frase no meio da área das abas (a
  `ref` do `section` do `WorkbenchTabs`), `aria-hidden`. A faixa é `relative z-50` e tem `data-tab-strip` (`tabStripAttribute`, `isInTabStrip`, pelo `nodeType`
  e não pelo `instanceof`: o elemento pode ser de outro documento, RN-ABAS-017), e o que cai nela é dela. A raiz da página (`ownerDocument` da área) escuta
  `dragenter`, `dragover`, `dragleave` e `drop` na captura e para a propagação antes do editor, da grade e dos campos (soltar a aba no `.cm-content` não escreve
  nada); um contador de entradas e saídas evita o pisca; `dragend` e o primeiro `pointermove` depois do arraste apagam um véu que ficou. No `drop` da aba desta
  janela o véu só marca (`mark("veil")`) e o pedido sai no `dragend`; no da aba de outra janela chama `onReceive` (`requestTab`, ela entra no fim da faixa).
- **O fim do arraste é decidido por quem recebeu a soltura, não pelo `dropEffect`**, e o ponto é o do ponteiro lido pelo processo principal.
  `prism:windows-drag-end` (`preload.ts`: `windows.endDrag`; `main.ts`: `hub.endDrag`) leva `tabDragEndSchema` (`tabId`, `kind`, `dropped: "veil" | "none"`,
  `effect`, `at`, `inPage`) e responde `tabDragEndReplySchema` (`none` ou `newWindow` com `at`), ambos em `window-messages.ts`. `endDrag` (`window-hub.ts`):
  `dropped: "veil"` abre a janela nova no ponteiro; sem soltura, com o ponteiro dentro da janela de origem ou sobre outra janela do Prism (`windowAt`),
  nada; fora delas, abre. **A espera pela outra janela**: a aba de consulta e a de tabela esperam `dragClaimWaitMs` (200 ms) que outra janela diga que a
  recebeu (`requestTab` grava a reivindicação por `fromId:tabId`, que vale `claimMemoryMs`, 2 s, e que o fim do arraste lê e apaga, antes ou depois da
  espera); a aba do resultado nenhuma outra janela recebe, então não espera. `cursorPoint` (`screen.getCursorScreenPoint()`, em pixels independentes da
  densidade), `escapeEndsWithoutEffect` e `wait` são dependências do centro (testáveis); o `moveTab` não recusa mais a janela nova sobre outra janela
  (`overWindow` saiu) e passa `normalBounds()` da origem a `createWindow`. **O Esc**: no Linux com o X11 a sonda S-ABAS-1 mostrou que a soltura fora das
  janelas vem com `move` e o Esc com `none` (`escapeEndsWithoutEffect`); nas outras plataformas o Esc fora das janelas vale como a soltura e abre a janela
  nova (a alternativa, um arraste próprio pelos eventos do ponteiro, é decisão do dono, seção 39). **O Wayland** (`isWaylandSession`, `platform.ts`, com
  teste: o `--ozone-platform` vence, depois o `--ozone-platform-hint` e a `ELECTRON_OZONE_PLATFORM_HINT`, `auto` com a sessão Wayland): `cursorPoint` devolve
  `null`, vale o `at` do `dragend` (e `inPage` para o Esc), sem ponto a janela abre `cascade` (32 px) abaixo e à direita da de origem, e `settleBounds` não
  reaplica os limites (o sistema escolhe o lugar). **O lugar da janela nova** (`newWindowBounds`): canto de cima à esquerda no ponto, no monitor do
  ponteiro, no tamanho da origem sem maximizar, trazida para a área útil e nunca abaixo de `appWindowMinimum` (1024×700); `createAppWindow(bounds)` aplica os
  limites de novo ao nascer e antes de aparecer e confere com `boundsMatch` (`settleBounds`, que registra a divergência), por causa do Windows com monitores de
  escalas diferentes. A janela do resultado (RN-ABAS-013) tem o lugar dela (`placeResultWindow`, com o ponto da soltura da aba do resultado) e confere os limites do
  mesmo modo, aplicando-os de novo depois de criada (`adoptResultWindow`).
- A faixa mede 28 px (RN-ABAS-009): botões de 24 px de largura com ícones `size-3.5`, aba `h-7` com o X de 20 px (`size-5`) numa área de clique de 24 px e o
  selo do ambiente de 16 px (`ShownEnvironmentPill` aceita `className`); as abas dos scripts e a barra do resultado seguem a mesma altura (`result-bar.ts`).
- **O menu da aba** ganhou o grupo `moveMenu`: "Mover para nova janela" e "Mover para a janela…" (apagado sem outra janela; abre, no mesmo
  ponto, a lista das outras, pedida ao centro ao abrir o menu, com o número e o resumo que cada uma dá de si, `prism:windows-describe`). Fora do
  Electron o grupo não aparece.
- **O que passa** (`_lib/tab-transfer.ts`, puro e testado): `serializeTab` monta a aba com o texto e a seleção do editor DESTE instante
  (`liveEditors`, `_lib/live-editors.ts`: cada editor se registra pelo id da aba; o `tab.sql` chega com 400 ms de atraso), a sessão do executor
  (`sessionOf`, e não a cópia da aba), o resultado parado (o mapa das células cortadas vira pares) e o que a tela lembrava
  (`recallForTransfer`: divisão, diagrama, filtro dos Registros, seção da Estrutura, larguras; **não** as alterações não salvas). A aba leva o banco em que
  roda (`database`, o de agora, depois de uma troca pela barra do editor). A aba de um script leva o id, o nome, o SQL salvo e o lugar em que foi salvo
  (`savedConnectionId` e `savedDatabase`, ou `generic`; o ponto é refeito na janela que recebe, pelo texto que chegou e pela conexão e o banco da aba), e a aba sem
  conexão passa sem conexão (`connectionId` nulo no schema). Com comando em
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
- **A vez da verificação periódica** (RN-VERIF-002): o centro das janelas também diz qual janela verifica cada conexão conectada em mais de uma, e repassa
  a resposta às outras (`claimVerification`, `finishVerification`); ver "Verificação periódica e Só as conectadas".
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

## Voltar e Avançar entre as abas (RN-ABAS-018)

Pedido do dono, como no DBeaver: o botão "voltar" do mouse levava às Configurações, porque o Chromium andava no histórico das ROTAS da janela (`createHashRouter`) e a
entrada anterior era a delas. A janela de abas passou a ter o histórico das ABAS, e nenhum botão nem tecla anda pelo das rotas.

- **A conta é pura** (`_lib/tab-history.ts`, com teste de tabela): `recordTab` (uma entrada por mudança de aba ativa, a mesma duas vezes seguidas é uma só, no máximo 50, a
  ativação depois de voltar descarta o que está à frente), `pruneHistory` (tira a aba que fechou ou foi para outra janela e junta as iguais que ficam lado a lado) e
  `stepHistory` (Voltar e Avançar, depois de podar; sem entrada para ir, `tabId` nulo). O histórico é só memória, zera no bloqueio, e não vai ao espaço de trabalho.
  `mouseHistoryAction` (botões 3 e 4 do `MouseEvent`) e `keyHistoryAction` (Alt+←/→ no Windows e no Linux, Cmd+[ e Cmd+] no macOS, e onde cada um vale conforme o foco) estão no
  mesmo arquivo.
- **O controlador** (`_lib/tab-history-controller.ts`, sem React): guarda o histórico e decide o que cada botão e tecla faz em cada tela (`HistoryScreen`): na área de trabalho,
  ativa a aba; nas Configurações, o Voltar volta à área de trabalho (`navigate`, como o "Voltar" da página) e o Avançar não faz nada; nas outras telas, nada. Com um diálogo, menu ou lista
  aberta, ou o cofre bloqueado, nada age (no mouse, vale o que havia ao APERTAR o botão: o menu e a lista fecham no `pointerdown` de qualquer botão, e ao soltar já não estariam no DOM;
  `onPointerDown` guarda isso). `focusKindOf` separa o editor de SQL (`data-sql-editor`, posto nos atributos do conteúdo do CodeMirror), os campos de texto
  (`input`, `textarea`, o que é editável, também o filtro) e o resto.
- **O gancho** (`_lib/use-tab-history.ts`, montado por `TabHistory`, em `_components/tab-history.tsx`, ao lado do `SettingsShortcut` em `routes.tsx`): observa `activeTabId` e as abas
  da janela do provedor (poda e registra, nessa ordem), zera quando a época do bloqueio muda, ativa a aba por `setActiveTab` (o caminho do clique na faixa) e põe o foco no
  elemento da aba depois de ativa (`takeFocus`, como o clique deixa). **Os ouvintes (`keydown`, `pointerdown` e `mouseup`) são da fase de captura da `window`**: as setas são de muitos componentes (a faixa de abas, a
  grade, as árvores, o CodeMirror), e nenhum confere o Alt; na bolha a tecla já teria sido gasta por quem tem o foco (sob o Xvfb, o Alt+→ com o foco numa aba andava para a aba do lado
  e o histórico não via a tecla). A tecla tratada leva `preventDefault` e `stopPropagation`, então o Alt+← do CodeMirror não chega a valer; por isso não há tecla no mapa do editor.
- **O Chromium não pode navegar** (`app/_lib/history-buttons.ts`, ligado por `HistoryButtonsGuard`, em `app.tsx` ao lado do roteador, valendo no login, no desbloqueio e em toda tela): `mousedown`, `mouseup` e `auxclick` dos botões 3 e 4 levam
  `preventDefault` na captura. O gancho age no `mouseup`.
- **Como conferir sob o Xvfb**: `xdotool click 8` é o "voltar" e `click 9` o "avançar", com o ponteiro sobre a janela (o `mousemove` do `xdotool` não andou neste Xvfb: `XWarpPointer`
  com `ctypes`); `xdotool key alt+Left` e `alt+Right` são as teclas. As abas das sondas foram trocadas pelo `click()` do protocolo de depuração (o clique esquerdo de verdade do `xdotool` não ativou a aba nas tentativas), e para ver o defeito de antes basta abrir Configurações, fechá-las pelo "Voltar" da página e apertar o "voltar" do mouse: a rota ia para `#/settings`, e agora
  nada muda na rota. Não conferido: o Windows (o `app-command` `browser-backward` que o Chromium pode receber do sistema; o processo principal não trata nada) e o macOS.

## O foco ao abrir, fechar e trocar de aba (RN-ABAS-019)

Pedidos 5 e 6 de 2026-10-27: depois do duplo clique numa tabela o foco ficava no botão da linha do navegador (o Ctrl+Espaço ativava o botão em vez de completar), e depois
do Ctrl+W o segundo não fechava a segunda aba. A raiz é uma só: abrir, fechar e trocar de aba mudava a aba ativa SEM dizer para onde o foco ia. Fechar tirava da página o
painel e a entrada da faixa; o elemento com o foco saía com eles, o Chromium o punha no `body` (sem `blur`), e o `body` está FORA do `section` das abas, o único que tratava o
Ctrl+W, o F5, o Alt+X e o Ctrl+S. No `pnpm dev` o Ctrl+W que ninguém trata caía em Janela › Fechar do menu padrão do Electron e fechava a janela (visto numa reprodução mínima do
Electron sob Xvfb, com teclas de verdade); no app empacotado, sem menu no Windows e no Linux, nada acontecia. Hoje o menu não recebe o Ctrl+W (`menuShortcutIgnored`, acima): no
desenvolvimento, como no pacote, o Ctrl+W sem quem o trate não faz nada.

- **A regra** (`_lib/tab-focus.ts`, sem React, com teste de tabela): `focusAfterChange` decide, depois de uma mudança, entre `"entry"` (a entrada da aba ativa), `"strip"` (a aba
  dela na faixa), `"navigator"` (a linha do navegador que o Tab alcança) e `null`. Com um **pedido** (alguém abriu a aba), vai à entrada se o foco ainda está em quem pediu ou se
  perdeu (`stillWithRequester`, `isLost`); se saiu para outro lugar vivo (o type-ahead andou na árvore, a pessoa clicou num campo), fica: **abrir não rouba o foco**. Sem pedido,
  só age se o foco se PERDEU, e então vai ao mesmo lugar em que estava (`regionOf`: a faixa, o conteúdo de uma aba, fora das abas): faixa -> a aba ativa na faixa; conteúdo ->
  a entrada da aba ativa; sem aba nenhuma -> o navegador; fora das abas -> nada. Bloqueado (diálogo, menu ou lista que TOMOU o foco, cofre bloqueado, outra tela à mostra) ou prometido
  por outra regra (`resultFocus.pending`: o F6 e a troca do lugar do resultado, RN-ABAS-014) -> nada. **A lista de sugestões do CodeMirror não bloqueia** (`popupTakesFocus`, que é o
  `popupOpen` sem o `listbox` dentro de um `.cm-tooltip`): ela é do editor que perde o foco e só fecha quando ele o perde de verdade, mas ainda está no `body` quando o Ctrl+clique no nome de
  uma tabela, logo depois de digitar, esconde o painel do editor; contada como popup, ela bloqueava o foco da aba nova (visto sob Xvfb: a aba abria e o foco caía no `body`). O `popupOpen`
  dos atalhos da janela (o Ctrl+W, o Alt+←/→) continua contando todas as listas.
- **A entrada de cada aba** (`tabEntries`, registro de módulo; cada painel registra a sua e diz COMO se foca, a área das abas decide QUANDO): a de consulta é o editor SQL
  (`QueryTabPanel`; o cursor fica onde estava), ou o resultado (`focusResultIn(slot)`) com o editor escondido (o resultado maximizado, inerte) ou a aba do resultado ativa; a de
  tabela é o campo "Filtro e ordem dos registros" na vista Registros (`FilterField` expõe `ref` com `focus()`, que leva o cursor ao fim: `focusAtEnd`; ali o Ctrl+Espaço
  completa, RN-TABELA-011) e o painel da vista (`tableViewPanelId`, `tabIndex=-1`) na Estrutura e no Diagrama, conectada a conexão ou não. A entrada devolve `false` quando o foco não
  chegou, e a área das abas cai na aba da faixa: o foco nunca fica perdido. O estado de agora (a vista, o editor à vista) é lido por ref na hora de focar. **No `pnpm dev` o
  `StrictMode` desmonta e monta de novo, no fim da mesma tarefa, os efeitos do painel que acabou de nascer** (o `FilterField` e o `SqlEditor` criam o CodeMirror num efeito e o
  destroem na limpeza), e o foco que a entrada acabou de levar cai no `body`: `tabEntries.focus` confere num microtask se ele se perdeu e, só então, chama a entrada de novo (no app
  empacotado a segunda chamada não acontece; sem `document`, nos testes, não confere nada).
- **O pedido** (`tabFocus`, loja de módulo como `resultFocus`; um pedido por vez, o seguinte troca o de antes): quem abre uma aba por um gesto pede com `request(tabId, from)`, onde
  `from` é o elemento com o foco naquela hora. O `WorkbenchProvider` pede em `addTab` (consulta nova, tabela nova, script novo), nos ramos da aba que já estava aberta
  (`openTableTab`, `openScriptTab`: abrir de novo leva o foco para a aba), em `adoptTab` (a aba que chega de outra janela) e no fim de `restoreSaved` (a ativa que volta na
  entrada). **Nada escreve no DOM na hora do pedido**: é um pedido, e quem foca é o efeito. **O menu e o diálogo que abriram a aba contam como quem pediu**
  (`fromPopup`): eles fecham logo depois, devolvem o foco ao item da árvore (RN-MENU-001 diz que a ação que abre uma aba leva o foco a ela), e esse foco devolvido não é "outro lugar vivo".
  **O script espera a API** (`ScriptsSection.open`): o `from` tem de ser lido ANTES do `await`, quando a pessoa pediu (o duplo clique, o Enter), e `openScriptTab(script, place, askedFrom)`
  o leva ao pedido; lido quando a aba aparece, ele seria sempre quem tem o foco agora, e a guarda nunca veria o type-ahead que andou na árvore enquanto o texto vinha (conferido
  num Chromium de verdade: o foco fica na árvore). Limite: o "Abrir" do MENU de um script lento conta como pedido de popup (`fromPopup`), e a aba toma o foco mesmo que a pessoa o tenha
  levado a outro lugar durante a espera: o item do menu que pediu já morreu, e nada diz se o foco que sobrou é o que o menu devolveu à árvore ou o que a pessoa levou.
  `take(tabId)` só leva o pedido DA aba; o de uma aba que ainda não é a ativa espera (a loja avisa antes de a lista de abas chegar a quem pede depois de uma espera, como o script
  que vem da API: o `useSyncExternalStore` da área das abas renderiza no ato, e o `setState` fora de um evento vem depois). `version` muda a cada pedido, para refazer o efeito quando
  a aba pedida já é a ativa e nada mais mudou.
- **O efeito** (`WorkbenchTabs`, passivo, declarado DEPOIS do efeito da fila de fechar): roda depois dos efeitos dos painéis (o `register` da entrada) e do `FilterField` (que cria o
  CodeMirror num efeito), e antes do `WorkbenchSlot` (pai), por isso o `WorkbenchSlot` só devolve o foco antigo se ele está perdido. O `useTabHistory` (irmão que vem antes em `routes.tsx`)
  roda antes: o Voltar e o Avançar já deixaram o foco na aba da faixa (RN-ABAS-018), e a regra não mexe. Só age com a fila de fechar vazia (`pendingClose` e `closingStep`):
  "Fechar as outras" decide no fim, depois da última. **Sem pedido, só olha o foco quando as abas, a ativa ou a entrada ativa mudaram** (`seen`): a lista de abas muda a cada
  texto, título e sessão, e o foco que a pessoa soltou clicando no vazio da janela não é puxado de volta ao editor quando uma consulta termina. A volta da tela (as Configurações por
  baixo) não conta: o foco perdido por ela é do `WorkbenchSlot`.
- **A última região** (`lastRegion`): um `focusin` no `document`, na CAPTURA, guarda a região do que recebeu o foco (`regionOf`; `data-tab-strip` na faixa, `data-tab-content` no
  painel de cada aba e no da aba do resultado). Diálogos, menus e listas (`aria-modal`, `role=menu`, `role=listbox`) NÃO contam: o diálogo que fecha devolve o foco a quem o tinha, e a
  região de antes tem de continuar valendo. `isLost` é nulo, `body`, desligado da página, ou `checkVisibility() === false` (o painel que acabou de ficar `hidden`: o Chromium só
  limpa o foco numa tarefa seguinte, e a decisão é tomada antes; nos testes o elemento de mentira precisa dessa função).
- **O Ctrl+W** (`closeActive()` extraído; o `section` e um ouvinte `keydown` da `window`, na bolha): vale em TODA a janela da área de trabalho, como no DBeaver: com o foco na faixa,
  numa aba, no navegador (também na busca) ou perdido no `body`. O `section` trata o que nasce dentro dele e marca a tecla (`preventDefault`), então a janela a vê tratada e não fecha duas;
  o campo de edição de uma célula e os diálogos param a propagação, e o Ctrl+W deles não fecha a aba. Nunca com diálogo, menu ou lista aberta, com o cofre bloqueado ou com outra tela à
  mostra (o ouvinte só existe com a área de trabalho na tela). Trata a tecla até SEM aba (`preventDefault`: a tecla sem aba fica tratada, e o menu do Electron não a recebe de qualquer modo, `menuShortcutIgnored`), mas as recusas (diálogo, cofre,
  tecla já tratada) deixam a tecla como está. **A tecla segurada (`repeat`) não fecha outra aba**: é tratada, uma aba por toque (segurar passaria por todas as abas, com o foco
  agora indo de uma para a outra). Na janela do resultado, ela continua sendo o "Voltar para o painel" (RN-ABAS-013): a `window` daquela página é outra.
- **O X da faixa** (`keepFocus`, `onMouseDown` com `preventDefault` só no botão principal): o clique não leva o foco ao X, como o do botão do meio já não leva; se o foco estava na
  aba que fecha, a regra do foco perdido o leva à que ficou ativa. O X pelo teclado (Enter no X, que está na ordem do Tab) deixa o foco na faixa. **Preço conferido num
  Chromium sob Xvfb: com o `mousedown` cancelado o arrasto da aba NÃO começa pelo X** (o `dragstart` não dispara; sem o `preventDefault` ele dispara, e pelo título dispara sempre).
  A área de clique do X é de 24 px na ponta da aba. O `pointerdown` cancelado não serve no lugar: ele suprime também o `mousedown` e o arrasto continua morto. Para devolver o arrasto
  seria preciso deixar o foco ir ao X e devolvê-lo a quem o tinha no `focus` do X (`relatedTarget`), sem cancelar nada.
- **O editor SQL deixou o `autoFocus`** (a prop saiu de `SqlEditor`): a aba nova é focada pela regra, com a guarda contra roubar o foco no script lento (o `getScript` da API vem
  depois de a pessoa ter ido digitar na árvore) e na aba que chega de outra janela. A entrada do editor já faz o "cursor onde estava".
- **Testes sem DOM**: `lib/testing/fake-page.ts` é uma página de mentira (o `activeElement` que o `focus()` do elemento de mentira move e que avisa o `focusin`, o `body`, o
  `getElementById`, o `querySelector`, os ouvintes de `document` e `window`, `keyEvent`/`press` para a bolha da tecla): os testes da área das abas (`workbench-tabs.*.test.ts`, que
  precisam dela por causa do `focusin` e do `keydown`) a instalam com `vi.stubGlobal`. `workbench-tabs.focus.test.ts` prova a causa do pedido 6 (dois Ctrl+W com o foco caindo
  no `body` fecham as duas abas) e a fila de fechar; `tab-focus.test.ts` é a tabela da decisão.
- **O que ficou fora** (spec, "Fica para depois"): trocar de aba por Ctrl+Tab e Ctrl+PageUp/PageDown (não existem; o Ctrl+Shift+PageUp/PageDown MOVEM a aba) e levar o foco ao
  conteúdo no clique na faixa e no Voltar/Avançar (mudaria a RN-ABAS-018). Segurar o Enter na linha da tabela fazia a repetição do teclado cair no filtro, que aplicava e
  executava de novo (34 consultas em 2 s, vistas sob Xvfb): o campo ignora o Enter que o teclado repete (`isHeldEnter`, `ignoreHeldEnter`). Segurar o Enter na linha de um script
  ainda deixa a repetição cair no editor, que insere linhas em branco. Logo depois de abrir, o Ctrl+Espaço do filtro só sugere as palavras: as colunas vêm do resultado carregado (`columns` de `RecordsView`),
  que chega com a primeira página (e, na aba restaurada desconectada, só depois do "Atualizar").
- **Como conferir sob Xvfb** (o app de verdade, `pnpm dev` e o empacotado; `webContents.sendInputEvent` ou `xdotool`): duplo clique e Enter numa tabela levam o foco ao filtro, e o
  Ctrl+Espaço abre a lista das colunas; a tabela que já estava aberta; três Ctrl+W seguidos fecham três abas, a partir do editor, da grade e da faixa; o X com o mouse e depois o
  Ctrl+W; "Descartar" numa pergunta e depois o Ctrl+W; a última aba leva o foco ao navegador; seguir uma chave estrangeira e o duplo clique no diagrama; Alt+← deixa o foco na
  aba; o F6 com o resultado numa aba; o type-ahead enquanto um script lento abre não perde o foco; o clique no cabeçalho de uma aba de tabela e o Ctrl+W; "Abrir numa aba de consulta" dá o
  foco ao editor. No `pnpm dev` a conferência registra que a tecla foi tratada (`defaultPrevented`): sem isso o menu padrão fecha a janela (também com um diálogo aberto ou o campo de edição de
  uma célula, onde a tecla não é tratada de propósito), e a prova final é no `dist:dir`. Ao conferir o app construído com `electron-vite preview`, matar o `electron` e não só o
  `electron-vite` (o filho sobrevive ao pai, segura a porta de depuração e serve o pacote velho), e conferir qual `assets/index-*.js` a página carregou.

## Abas que voltam na próxima entrada (RN-ABAS-006)

Seção 24 da especificação (issue 2 do repositório público). As abas de TODAS as janelas vão para o cofre do usuário pela API (`PUT api/user/workspace`, ver o
guia da API) e voltam na janela principal na próxima entrada. **Nada vai ao `localStorage`**, e nenhuma janela fala com outra (RN-ABAS-005): cada uma conta as
suas abas ao processo principal, que junta as de todas e grava.

- **O que vai e o que volta** (`_lib/saved-workspace.ts`, puro e testado). Vai, de cada aba de consulta, o texto do editor DESTE instante (`liveEditors`), a
  conexão, o banco, o script de onde veio, a marca de mudança não salva (`isScriptDirty`, pelo texto, pela conexão e pelo banco) e o lugar do resultado (`resultPlace`, ver
  "O resultado no painel, numa aba ou numa janela"); de cada aba de tabela, a conexão, o banco, o esquema, a tabela e a vista; e a ordem e a ativa. O título não vai (a consulta volta com o número seguinte da janela, o script com o nome que tem hoje), nem a sessão,
  o resultado, o cursor e as alterações não salvas da grade. O texto acima de 1 MB em bytes de UTF-8 não vai: a aba vai vazia com `sqlTooLarge`, e volta vazia
  com o aviso (`restoredEmpty`). Volta (`restoreWorkspace`): ids novos, sem sessão, a aba de um script ligada a ele (o SQL salvo dele é lido pela rota do item
  só para a aba que tinha mudança não salva, para o ponto se apagar ao desfazer até o texto salvo), na conexão em que estava e lembrando o lugar com que o
  script está gravado (o da lista de scripts, por `scriptPlace(...).saved`: a conexão e o banco, o genérico, ou nada se a conexão dele não existe mais; a aba
  que trocou de conexão volta nela, marcada, e o Ctrl+S grava a conexão nova; a pasta do script que a aba lembrava, `folderId`, não volta, RN-SCRIPT-010),
  a de um script excluído como consulta comum, a de consulta
  cuja conexão foi excluída sem conexão (`NoConnectionBarView` com `reason` `restored`: "A conexão desta aba não existe mais"; aviso `restoredWithoutConnection`),
  e a de tabela cuja conexão foi excluída **não volta**, e a entrada avisa (a regra, RN-ABAS-006: a aba de uma tabela sempre tem a conexão dela; aviso
  `restoredTablesDropped`). A ativa que não voltou
  passa à vizinha. O schema é um só, `electron/workspace-messages.ts`, com os nomes da API (`connectionID`, `scriptID`), conferido no processo principal (o
  relato de cada janela) e na tela (a resposta do `GET`, `workspace.service.ts`: a aba que não confere fica de fora, sem derrubar as outras).
- **Nada conecta nem executa sozinho.** As abas voltam sem sessão; as conexões das abas de tabela que voltaram são marcadas como desconectadas
  (`DisconnectLog.mark`, no `restoreSaved` do provedor), e as vistas delas esperam o clique, como as de uma conexão que a pessoa desconectou. A
  árvore não abre nada: os nós abertos da conexão para baixo (a conexão, os bancos, os esquemas, os grupos e as tabelas) não são gravados, e só as pastas
  voltam abertas (RN-NAV-014, ver "As pastas abertas lembradas"), o que não conecta nada.
  **Armadilha: a marca tem de existir ANTES da renderização que mostra as abas.** A primeira carga dos Registros (`needsFirstRun`, em `RecordsView`) é um efeito
  do painel da aba, roda antes de qualquer efeito do pai e lê o `disconnected` da renderização em que a aba apareceu. Até a 0.6.0 as conexões iam do provedor à
  área das abas pelo estado (`restoredTableConnections`) e o `mark` era um `useEffect` do `WorkbenchTabs`, que vinha DEPOIS: a aba de tabela ATIVA que voltava lia
  "conectável" e abria a sessão sozinha (as escondidas só carregam quando se abrem, e aí a marca já estava). Vinha desde o `mark` da 0.3.0, e o foco da
  RN-ABAS-019 não tem nada com ele (focar o filtro não executa nada). Por isso o registro é do provedor, que marca as conexões no `restoreSaved` antes do
  `setTabs`; não volte a entregá-las por estado e efeito, nem leia o registro por um efeito. `workbench-tabs.restore.test.ts` guarda a primeira renderização.
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

## O resultado no painel, numa aba ou numa janela (seção 39: RN-ABAS-011 a 016, RN-CONFIG-010, RN-PAINEL-001)

**A área de resultado de uma aba é UMA só, e o que muda com o lugar é só onde ela está na página.** Ela continua sendo desenhada pela aba de consulta
(`QueryTabPanel`: o mesmo executor, as mesmas pendências, a mesma grade, o mesmo filtro), por um portal do React numa raiz própria (`ResultHost`,
`_components/result-host.tsx`: um `div` criado uma vez por aba, `data-result-host`), e é essa raiz que muda de pai: o lugar do painel (um `div` da aba, abaixo do
editor), o painel da aba do resultado (`ResultTabPanel`, em `workbench-tabs.tsx`) ou a raiz da janela do resultado (quem a abrir). Os lugares de fora do painel se
registram em `resultSlots` (`_lib/result-slots.ts`, pelo id da aba e pelo lugar). Mudar de pai não desmonta nada: a seleção, as larguras, o zoom da grade, a aba do
script escolhida, o filtro e as pendências ficam, e o executor nem fica sabendo. Na árvore do React a área continua dentro da aba de consulta, então as teclas dela
(F5, Alt+X, Ctrl+S, o F6) e as da faixa (Ctrl+W, Ctrl+Shift+PageUp e PageDown) sobem até lá como subiam (por isso a área vai dentro do `div` do `onKeyDown` da
aba). **Não troque o portal por renderizar a área num lugar ou noutro**: o React a desmontaria a cada troca (um portal com outro contêiner é outra fibra), e a
rolagem, a seleção e as larguras sairiam junto.

- **O que depende do DOM da área não pode ir para a raiz da aba de consulta**: variável de CSS herda pelo DOM, e a raiz do portal muda de pai (e de documento). A cor do
  ambiente (`--environment-color`, RN-AMB-002) é posta por isso na `<section>` do `ResultPanel`, que vai junto (ver Design).
- **O que o elemento perde ao sair da página, a raiz devolve.** A rolagem: o Chromium zera o `scrollTop` de um elemento que sai da página e volta; a raiz guarda a
  de cada elemento de dentro a cada `scroll` (na fase de captura, porque quando ela sai o elemento já não tem caixa para ler) e a devolve quando volta a ter
  caixa (um `ResizeObserver` na raiz), também quando o lugar novo ainda está escondido (a aba do resultado não ativa) e só aparece depois. O foco: quem troca o
  lugar pede o foco em `resultFocus` (o resultado, o botão, o editor), e quem desenha o lugar o leva quando pode (a raiz, depois de chegar e ter caixa; o editor, no
  `useLayoutEffect` da aba, quando ele está à vista). O campo de edição de uma célula aberto é confirmado antes (`releaseFocusIn`: o `blur` sai pelo caminho de
  sempre; o Chromium não avisa o `blur` de quem sai da página). `releaseFocusIn` acha a raiz também no documento da janela do resultado, e a própria raiz
  (`ResultHost`) tira o foco de dentro antes de mudar de documento e quando fica sem lugar: o Ctrl+W na janela do resultado e o fechar pelo sistema não
  passam por um clique.
- **O modelo** (`_lib/result-place.ts`, puro e testado): `resultPlace` é da aba de consulta (`QueryTab.resultPlace`, sem ele o painel; a aba de tabela não tem),
  e `placeOf` diz o que vale. A aba do resultado **não é uma aba da lista**: `stripEntries` a põe na faixa logo depois da dela, e o provedor guarda só qual é a
  entrada ativa (`resultActive`, `showEntry`; `activeTabId` continua o da aba da consulta, para a barra de status, a ativa gravada, o "Mover para a janela…" e a
  pergunta de erro do script). Por isso o par anda junto sem código nenhum (o Ctrl+Shift+PageUp move a aba, e a do resultado é derivada), "Fechar as outras" e a
  contagem da pergunta de fechar não a contam, e fechar a aba a leva junto. O arraste mede a aba e a do resultado como uma caixa só (`unitRects`) e o marcador
  (`dropMarks`) nunca cai entre as duas; a aba do resultado se arrasta com outro tipo (`resultTabDragType`), que as faixas não aceitam. O foco depois de trocar
  (`afterPlaceChange`), o F6 (`f6Action`), o resultado "à vista" da atualização automática (`resultOnView`) e os itens dos menus (`placeMenu`) também moram ali.
- **Onde se troca**: o botão "Onde mostrar o resultado" da barra (`ResultPlaceButton`, a propriedade `placeControl` do `ResultPanel`, logo antes de `actions`:
  no painel, antes de recolher e maximizar; numa aba, na ponta), o submenu do menu da aba da consulta (depois dos de mover) e o menu da aba do resultado ("Ir para
  a consulta", o submenu, "Voltar para o painel"). Quem troca é `changePlace` de `WorkbenchTabs`, que anuncia a troca numa região `role="status"` (sem toast).
  Fechar a aba do resultado (o X, o clique do meio, o Ctrl+W com ela ativa, "Voltar para o painel") é trocar para o painel, sem pergunta.
- **O ponto da aba do resultado** (`ResultTabMark`): o comando da pessoa, o script rodando e o "Salvar" das alterações (que a aba publica em `resultActivity`, porque
  quem salva é a edição de dentro dela) acendem; o comando que termina com ela não ativa deixa o "resultado novo" (`trackUnseen`) até ela ficar ativa; o ponto
  vermelho do script parado na pergunta de erro fica no lugar dele. O texto vai no nome da aba, para o leitor de tela.
- **Numa aba e numa janela** a aba da consulta mostra só o editor, sem a divisória nem o recolher e o maximizar; a divisão do painel fica guardada (`tab-memory`) e
  volta, e executar não a mexe (no painel, executar com a área recolhida a restaura, como antes).
- **O lugar volta e viaja**: vai no `PUT api/user/workspace` de cada aba de consulta (`savedTabOf`; o gravado antes da 0.5.0 volta no painel) e na passagem para
  outra janela (`tabTransferSchema.tab.resultPlace`): a aba do resultado vai junto. O lugar que esta versão não conhece, na leitura das abas gravadas, vale o
  painel (a aba volta do mesmo jeito). **Rebaixar para a 0.4.0 foi conferido** (guia da API, "Abas que voltam na próxima entrada").
- **A preferência** (RN-CONFIG-010): `results.resultPlace`, em Configurações › Resultados, lida na hora em que a aba de consulta nasce (`openQueryTab`,
  `openScriptTab`; as que voltam e as que chegam de outra janela ficam no lugar delas).
- **"Numa janela"** (RN-ABAS-013 a 017). Aparece nos menus e em Configurações onde há processo principal para aprová-la (`resultWindowAvailable()` pergunta à
  ponte, `resultWindows.available`); no navegador do desenvolvimento não, e o lugar gravado como "Numa janela" vale ali o painel, sem deixar de ser o gravado.
  A janela do resultado é uma **página em branco da mesma tela**: a aba de consulta continua desenhando a área de resultado (`ResultHost`), e a raiz dela muda
  de DOCUMENTO (o `appendChild` a adota no da janela). Não há segunda tela, segundo executor nem estado a combinar.

### A janela do resultado: o processo principal (`electron/`)

- **Tudo é pedido e aprovado, uma vez.** A tela pede `prism:result-window-request {name, mode, at}` (preload da janela da aba, `assertFromApp` e zod,
  `result-window-messages.ts`); `ResultWindows.request` (`result-windows.ts`, sem Electron, com teste) confere que a janela está pronta com o cofre aberto
  (`hub.isReady`), que não há 32 abertas por ela (as abertas, as nascendo e as concessões contam) e que o nome não está aberto, e guarda uma **concessão de
  uso único** (2 s, daquela janela e daquele nome). `openHandlerOf` (o `setWindowOpenHandler` de cada janela do app) só aprova com todas as condições:
  `about:blank`, o nome casando com `^prism-result-<uuid>$`, `features` exatamente `popup`, disposição `new-window`, sem corpo de envio, janela pronta e a
  concessão, que a aprovação consome. As opções vêm só do processo principal (`resultWindowOptions`, `web-lockdown.ts`): `show: false`, sem `parent`, o mínimo
  de 480×320 e as `webPreferences` com todas as chaves escritas (`contextIsolation`, `sandbox`, `nodeIntegration`, `nodeIntegrationInSubFrames`, `webviewTag`,
  `webSecurity`) e **sem preload**: a janela do resultado não tem `window.prism`. O que o texto das opções diria não conta. O `referrer` não é condição (o
  Chromium o preenche pela página que abre, e pedir `noreferrer` faria o `window.open` devolver `null`).
- **`did-create-window`** (`adoptResultWindow`) confere as `webPreferences` (`getLastWebPreferences`, que o tipo do Electron não declara, ou as opções com
  que nasceu) e **destrói a janela** se alguma chave não bate; nega nela a abertura de outras; guarda-a em `resultWindows` (por janela da aba e nome; fora de
  `appWindows`, do centro das janelas e da gravação das abas, então `window-all-closed`, `liveWindowIds` e as perguntas de fechar não a veem); aplica o zoom
  (ali e no `dom-ready`, e `changeZoom` as inclui); liga os atalhos (`installShortcuts`, os mesmos do zoom e do F5/F6/F11/Ctrl+R); aplica de novo os limites e
  os confere (monitores de densidades diferentes); tira o `setBackgroundThrottling` da janela da aba enquanto ela tem uma aberta; avisa
  `prism:result-window-state {name, minimized}`; grava o lugar; e a fecha quando a janela da aba fecha, recarrega (`did-start-navigation`) ou perde o
  processo, quando a área de trabalho dela desmonta (`prism:windows-ready` falso) e quando o app sai (`before-quit`). **Nasce escondida** e aparece quando a
  tela avisa `prism:result-window-ready` (`show()`+`focus()` no modo `focus`, `showInactive()` no `background`), ou 3 s depois. Se o `show: false` não valer
  numa janela aberta por `window.open`, ela fica transparente (`setOpacity(0)`) até estar pronta; no Linux isso não faz nada: **sonda S-JANELA-1**.
- **Quem fechou.** `closeByHost` marca antes de pedir, e o `closed` da janela avisa a que a abriu `prism:result-window-closed {name, reason}`: `host` quando o
  Prism pediu, `user` nos outros casos (o X da barra, Alt+F4, Cmd+W). Só `user` volta o resultado ao painel.
- **O lugar** (`result-window-file.ts`, `result-window-place.ts`, sem Electron, com teste): `result-window.json` ao lado do `zoom.json` (contrato,
  RN-VERSAO-002; `{x, y, width, height, maximized}`, arquivo ilegível vale "como se não existisse"), gravado de uma vez, no máximo a cada 500 ms (e na hora
  ao fechar). A primeira abre 960×600 no centro do monitor da janela da aba; depois o lembrado (o tamanho sem maximizar, `getNormalBounds()`); o lugar que não
  está em monitor nenhum vira o centro; outra janela do resultado no mesmo lugar desloca 32 px (a cascata volta ao primeiro lugar quando sairia da área útil);
  levada pelo arraste, abre onde a aba foi solta (`at`, que só vale onde o processo principal não lê o ponteiro: o Wayland).
- **Os diálogos do sistema** do resultado (o destino do "Exportar dados", o arquivo do "Importar…") levam o nome da janela (`resultWindow` nos schemas de
  `transfer-messages.ts`); `dialogParent` prende o diálogo a ela, e com nome desconhecido ou de outra janela da aba, à janela da aba.
- **Canais novos** (todos com `assertFromApp` e zod, nomes sem dígito, no `channels.test.ts` e no `result-window-main.test.ts`):
  `prism:result-window-request|ready|focus|close|title` (a tela pede) e `-closed|-state` (o processo principal conta). `-focus` leva `target`: a do
  resultado (padrão) ou a da aba que a abriu, porque a janela do resultado não tem ponte para pedir por si ("Voltar para o painel" e o F6 de dentro dela).

### A janela do resultado: a tela

- **`resultWindows`** (`workbench/_lib/result-windows.ts`, sem React, peças injetadas, com teste) é o ciclo da janela: `open` (pede a concessão, chama
  `window.open("about:blank", name, "popup")`, monta a página, registra a raiz em `resultSlots.set(tabId, "window", raiz)`, espera a área chegar e só então
  avisa `-ready`), `close` (marca a aba como fechando pelo Prism, pede e **espera o aviso, até 3 s**), `reconcile` (a volta das abas), `setTitle`, `focus`,
  `shownTabs` (as abas com a janela aberta e não minimizada: o resultado "à vista" da atualização automática, `resultOnView({ windowShown })`),
  `onUserClosed` e `connect` (liga o que o processo principal conta; ao desmontar a área de trabalho, fecha todas pelo Prism). `open` é **idempotente**: a aba que tem a janela
  ou está abrindo uma não pede outra, e um nome aberto nunca é pedido de novo ao Chromium.
- **Quem abre**: só a ação da pessoa (`changePlace` de `WorkbenchTabs`, que abre depois de pôr o lugar e **volta o lugar com o aviso** se a janela não abrir) e a
  volta das abas (um efeito que só decide quais janelas faltam, `reconcile`, uma a uma, na ordem das abas e a da ativa por último, em `background`; a que não
  abre vira o painel, com o aviso). O bloqueio (`vaultLock`) fecha todas pelo Prism (o `closeAll` também invalida as aberturas que esperam na fila do `reconcile`, e `open`
  recusa, sem marcar falha, enquanto o cofre está bloqueado: o processo principal não sabe do bloqueio ocioso) e o desbloqueio as reabre; o diálogo, o menu, a
  lista e o assistente abertos na página de uma janela do resultado fecham quando ela sai da lista de páginas (`useOnHostGone`, em `host-context.tsx`: a troca
  de lugar, o fechar da pessoa, o bloqueio), e o `closePortals` do bloqueio manda o Esc também a essas páginas; "No painel" e "Numa aba" pelo botão de lugar da
  janela do resultado trazem a janela da aba à frente, como o "Voltar para o painel"; a aba que vai para outra janela fecha a dela antes
  e a janela que a recebe reabre (sem a confirmação em 3 s, a aba vai com o resultado no painel e `resultWindowLost` faz a outra avisar).
- **A página** (`result-window-page.ts`, com teste): a cópia da política de conteúdo e o `<base href>` primeiro, os estilos (as `<link>` pelo endereço, as
  `<style>` pelo texto, as folhas construídas como `<style>`) e a língua, o tema e o `style` da raiz espelhados por `MutationObserver` (que acompanha as
  `<style>` que o Vite troca), e o `<main aria-label="Resultado de …">` onde a área se põe. Um `<a href>` não tratado e um arquivo solto não fazem nada.
  Montar acontece com o documento `complete` e é conferido no `load` (o documento em branco do começo pode ser trocado: monta de novo).
- **Os componentes usam a página de onde estão** (`lib/host/host.ts` e `components/ui/host-context.tsx`): `useHost()` dá `{document, view, resultWindow}`;
  `ResultHost` dá o contexto a tudo o que a área desenha, e `Dialog`, `ContextMenu` (e o submenu), `Select`, `CustomFilterField`, a pilha dos avisos e o
  assistente "Exportar dados" abrem no `body` DELA, medem a janela dela e ouvem o ponteiro dela. O `Dialog` e o `ContextMenu` **fixam a página em que abriram**.
  A conferência de elemento é por `nodeType` (`isElement`, `isNode`, `elementOfTarget`), não por `instanceof`. A grade segue o ponteiro na janela do elemento, o
  `ResizeObserver` do virtualizador, da raiz e das abas do script é o da janela do elemento e é refeito quando o documento muda (o virtualizador é desligado e
  ligado de novo na mesma passada: `enabled`), e o campo de filtro (CodeMirror guarda o documento em que nasceu) recria o editor na página nova (`root`).
  Os diálogos que a aba desenha por ela (confirmação da proteção, Ver SQL, cópia, Gerar SQL, a pergunta de erro do script, o "Personalizado…") abrem na janela
  que tem o foco entre a da aba e a do resultado dela (`ActiveHostProvider`, em `query-tab.tsx`). A área de transferência é `hostClipboard(host?)`
  (`lib/host/host.ts`): o `navigator.clipboard` da janela do elemento, ou da que tem o foco. **Código novo na área de resultado não usa `document`, `window`,
  `instanceof Element` nem `navigator.clipboard` globais.**
- **Os avisos e a atividade**: os toasts vão para a janela com o foco (a pilha na janela do resultado fica 12 px acima da borda); o aviso do bloqueio por
  inatividade aparece também nela (`IdleWarning inResultWindow`, 12 px abaixo da borda de cima) e o que a pessoa faz nela conta como atividade
  (`resultHostRegistry.each` em `use-idle-lock.ts`).
- **As teclas**: a raiz (`ResultHost`), só na janela do resultado, trata o Ctrl+W ("Voltar para o painel", `windowKeyAction`) e não deixa o Ctrl+Shift+PageUp e
  PageDown, o Ctrl+9, o Ctrl+B, o Ctrl+Shift+E e o Ctrl+, subirem pela árvore do React até a aba e a faixa. O F5, o F6, o Alt+X e o Ctrl+S sobem até a aba de
  consulta. O F6 do editor traz a janela do resultado; o dela traz a da aba (`focusOpener`), com a consulta ativa e o foco no editor. "Voltar para o painel" é
  um botão com texto na ponta direita da barra (`BackToPanelButton`); um link usado na janela traz a da aba à frente.
- **O arraste da aba do resultado para fora da faixa** (RN-ABAS-010): a faixa o começa com `drag.begin(tabId, "result")` e o tipo `resultTabDragType`, e o
  `dragend` segue o caminho da aba de consulta (`endTabDrag` com `kind: "result"`, sem a espera pela outra janela). A resposta `newWindow` chama
  `changePlace(tabId, "window", "drag", at)`, que abre a janela com `resultWindows.open(tabId, { mode: "focus", at, title })` (`at` é o ponto do `dragend`, que
  o processo principal devolve; o Wayland usa o do evento). O `PlaceVia` `drag` se comporta como o `menu`.
- **Sondas que ficam para uma máquina de verdade** (Windows empacotado com dois monitores de escalas diferentes, macOS, Linux X11 e Wayland; nenhuma foi
  exercitada aqui, e nada disto foi dado como passando): **S-JANELA-1** (a página em branco tem a origem do app; `getLastWebPreferences` e `window.opener`;
  `show: false` vale numa janela do `window.open`, senão a transparência; a política copiada vale: uma imagem `https://` dispara
  `securitypolicyviolation`; as fontes e os estilos valem no pacote e no desenvolvimento; não tem `window.prism`; **o `will-frame-navigate` não dispara na
  página em branco do começo** (a navegação para `about:blank` é permitida por `navigationAllowed` justamente por isso); aparece sem um quadro em branco; o
  zoom nasce e muda), **S-JANELA-2** (copiar e colar com o foco na janela, `permissions.query`, `writeText` chamado pela tela da aba no `navigator` dela),
  **S-JANELA-3** (o outro documento: a seleção por arraste e a rolagem sozinha, a largura das colunas, o `ResizeObserver`, a rolagem virtual, o filtro com o
  autocompletar, os menus e os diálogos com o foco preso, a troca do documento em branco e o modo estrito; o desenho da grade na janela coberta ou escondida),
  **S-JANELA-4** (a atualização automática de 1 s com a janela da aba minimizada, atrás de outra, e com a do resultado coberta), **S-JANELA-5** (a janela
  aberta sem clique, o `window.open` depois do pedido assíncrono sem ativação do usuário) e **S-JANELA-6** (trazer à frente uma janela minimizada ou
  atrás de outra; o Wayland recusa o foco). Se alguma falhar numa plataforma, a chave é `available` de `resultWindows` na ponte (`preload.ts`, hoje sempre
  `true`): falso nessa plataforma esconde "Numa janela" (nos menus, em Configurações), e o lugar gravado vale o painel. "Numa aba" sai do mesmo jeito.
- **Conferido sob Xvfb** (`pnpm dev`, um PostgreSQL local com 5.000 linhas): com a grade rolada a 1.500 px, "Numa aba" pelo botão levou a área ao painel da aba do
  resultado com a rolagem igual, a aba do resultado ativa, o foco no botão e o anúncio; o F6 alternou as duas abas com o foco no editor e na grade; executar com a
  aba da consulta à frente acendeu o "resultado novo"; o Ctrl+W voltou ao painel com a rolagem (900 px) e o foco na grade; os menus das duas abas e o submenu
  (`menuitemradio`, o lugar marcado) trocaram como a RN-ABAS-014 diz; o clique do meio voltou ao painel; o `GET api/user/workspace` trouxe `tab`; sair e entrar
  reabriu a aba do resultado; e "Mover para nova janela" levou a aba com a do resultado.

## Scripts salvos (RN-SCRIPT-001 a 010)

Seções 23, 27, 28 e 33 da especificação. Os scripts moram no cofre do usuário, cifrados (rotas `api/user/scripts`, ver o guia da API); a tela tem a lista em cache
(`scriptsQuery`, sem o SQL: o schema recusa a lista que o traga) e lê o SQL só para abrir e para copiar, pela rota do item, pelo cache de mutações (não fica
guardado). As regras que a tela confere antes de enviar (`saved-scripts.ts`, puro e testado) são as da API: o nome normalizado como a API o grava, de 1 a 200
caracteres, sem caractere de controle, único sem diferenciar maiúsculas; o SQL de até 1 MB em bytes de UTF-8. Os textos estão em `scripts.copy.ts`.

- **Ctrl+S e Ctrl+Shift+S** (`saveShortcut`, tratado no painel da aba de consulta, com o foco em qualquer lugar dela; o Cmd do macOS vale o Ctrl) passam pelo
  `useScriptSaving` (`_components/use-script-saving.tsx`, usado pelo `WorkbenchTabs`). O texto é o do editor DESTE instante (`liveEditors`). A aba que já é um
  script grava por cima (`PATCH` com o SQL e o lugar da aba: a conexão e o banco; o script genérico, com `generic: true`, e continua genérico); a que não é, e o
  "Salvar como", pedem o nome (`ScriptNameDialog`), com a sugestão: o primeiro "Script N" livre, ou, no "Salvar como" de um script, o nome dele com "(2)",
  "(3)"… (`copyName`), e a caixa "Script genérico (sem conexão)" (a propriedade `generic` do diálogo: marcada no "Salvar como" de um genérico, e presa marcada,
  com o motivo, na aba sem conexão; renomear não a tem). Marcada, o `POST` vai sem conexão nem banco. Gravar por cima de um script que outra
  janela excluiu (404) pede o nome, como na primeira vez. O "Salvar como" faz da aba o script novo. As recusas do nome e do tamanho ficam no campo
  (`refusalProblem`); o resto vai ao aviso central. As chamadas têm o prazo das ações da pessoa. A ligação (o que vai à API, como a caixa nasce e o lugar que a
  aba guarda) é testada com os ganchos simulados (`use-script-saving.test.ts`).
- **O campo "Pasta" ao salvar** (RN-SCRIPT-010, seção 33). O diálogo do nome do primeiro Ctrl+S e do "Salvar como" tem o campo "Pasta" depois do nome e antes
  da caixa do genérico (a propriedade `folder` do `ScriptNameDialog`, controlada por quem chama; renomear não o tem): o `Select` com "Sem pasta" (o
  placeholder, de valor vazio: a raiz) e as pastas com o caminho, na ordem da árvore (`scriptFolderOptions`), lidas pelo `useQuery(scriptFoldersQuery)` do
  `useScriptSaving`. A pasta que ele traz é a do `initialSaveFolder` (`_lib/script-tree.ts`): no "Salvar como", a do script de onde a aba veio, como está na
  lista; no Ctrl+S do script que outra janela excluiu (o 404 que pede o nome de novo), a que a aba lembra (`ScriptRef.folderId`, posto pelo `openScriptTab`
  com a pasta do script aberto e pelo `setTabScript` com a da resposta da gravação; não vai ao cofre, a aba que voltou numa entrada nova não a sabe, e a
  que passa para outra janela a leva, no `folderId` opcional do `tabTransferSchema`); "Sem pasta" no resto e quando a pasta não está mais na lista. O `POST`
  leva `folderID` (nulo na raiz). A pasta que outra janela excluiu antes de gravar (404 `SCRIPT_FOLDER_NOT_FOUND`, que o `createScriptOrRefuse` devolve como
  valor) fica no campo dela ("A pasta escolhida não existe mais.", num `FieldError` com `role="alert"`: o foco está no nome, e o alerta a anuncia), a lista
  das pastas é lida de novo, e nada se grava. Depois disso o `Select` mostra "Sem pasta" (não acha a escolhida entre as opções), mas o valor continua o da
  pasta excluída: o "Salvar" seguinte, e o de uma escolha que saiu da lista lida de novo sozinha, recusa no campo do mesmo jeito sem ir à API, até a pessoa
  escolher de novo (a escolha tira o erro). O aviso do script novo numa pasta diz
  onde ele ficou (`savedIn`: "Script X salvo em Fechamento / Mensal."); na raiz, e no Ctrl+S que grava por cima, o "Script X salvo." de sempre. Gravar por cima
  não muda a pasta, e a árvore não abre a pasta nem tira o foco do editor.
- **A aba de um script** tem o nome dele como título e, com mudança não salva, um ponto na faixa (desenho; o leitor de tela ouve "alterações não salvas", e o
  `title` diz o mesmo: `tabTitleOf`). Só a aba de um script tem o ponto e a pergunta: a consulta que nunca foi salva fecha como antes. O ponto acende na
  primeira tecla (`markScriptEdited`, pelo `onEdited` do editor, sem atraso; as teclas seguintes devolvem a mesma lista de abas e não redesenham nada) e é
  recalculado quando o texto chega com o atraso de sempre (`withEditedSql`): desfazer até o texto salvo o apaga. **Mudança não salva é o texto, a conexão OU o
  banco** (`isScriptDirty`, com `placeChanged`; RN-SCRIPT-003): o `ScriptRef` guarda o lugar em que o script foi salvo ou aberto (`savedConnectionId` e
  `savedDatabase`, sem ele o da conexão), e a aba que trocou de conexão (RN-ARVORE-008) ou de banco (RN-ARVORE-007) fica com o ponto até o Ctrl+S gravar o lugar
  novo, ou até voltar ao lugar salvo com o texto salvo. Sem `savedConnectionId` (o script salvo numa conexão que não existe mais) a referência é "sem conexão": a
  aba abre sem ponto, e dar uma conexão a ela acende. **No script genérico só o texto conta** (`generic` no `ScriptRef`, RN-SCRIPT-005). `setTabScript` recebe
  o lugar que foi gravado (`savedPlaceOfTab`: o da aba quando o Ctrl+S saiu, ou o genérico) e refaz o ponto pelo texto do editor deste instante.
- **Fechar** (uma aba, as outras, todas, a janela): primeiro a pergunta dos Registros, depois a dos scripts com mudança não salva entre as que fecham
  (`scriptsToAsk`, `UnsavedScriptsDialog`: um script, Salvar, Descartar e Cancelar; vários, Salvar todos), depois a do SQL digitado, que deixa de contar as abas de
  script (`closeConfirmation`). Salvar grava cada um, em ordem, e só então segue; um que não gravou (cancelou o nome, a API recusou) para tudo, e a janela fica
  aberta. Mover a aba para outra janela não pergunta: o texto vai com ela.
- **A seção "Scripts" do navegador** (`scripts-section.tsx`; a árvore é `ScriptsTreeView`, sem estado, testada sem DOM; ver também "Pastas de scripts",
  abaixo), abaixo da árvore das conexões e recolhível
  (**lembra se ficou recolhida**, RN-NAV-012: `useScriptsCollapsed`, na chave `prism:navigator:<usuário>` ao lado do navegador escondido, `NavigatorLayout`
  com `hidden` e `scriptsCollapsed`; a loja muda só o campo pedido, e o gravado antes, só com `hidden`, vale com a seção aberta. Cada janela tem o seu
  armazém, que não ouve as outras (a janela aberta fica como está, a que abre depois começa como a última escolha): por isso o `set` grava o pedido sobre o
  que está gravado AGORA, e não sobre o que a janela leu, senão o Ctrl+B numa janela desfazia a seção recolhida na outra, e o contrário; as pastas abertas dela
  têm a loja delas, `folder-memory.ts`, na chave `prism:navigator-folders:<usuário>`, e estão em "As pastas abertas lembradas"): uma árvore, com as
  pastas de scripts e os scripts, uma linha só no Tab, setas, Home e End; duplo clique e Enter abrem o script, F2 renomeia, Delete exclui (com a confirmação),
  Shift+F10 e a tecla de menu abrem o menu (Abrir; Renomear, Editar script…, Mover para…, Copiar SQL e o lugar; Excluir). Renomear muda o título das abas do
  script; excluir deixa as abas com o texto, como consultas sem script.
  O lugar (RN-SCRIPT-005, `scriptMenu`): o script com conexão oferece "Tornar genérico" (`PATCH` com `generic`); o genérico, "Vincular à conexão da aba" (a
  conexão e o banco da aba aberta com ele nesta janela; sem ela, ou com ela sem conexão, o item fica apagado com o motivo). Os dois passam por
  `changeScriptPlace` (`scripts.service.ts`), e as abas do script guardam o lugar novo (`setScriptPlace`, sobre `withSavedPlace`). O genérico (`connectionID`
  nulo na lista) tem a marca discreta "genérico" à direita do nome, e a dica da linha o diz. Abrir o genérico lê as conectadas deste instante (a sessão da
  árvore em cache e as abas com sessão) para `scriptPlace`. Essa ligação e a do lugar têm teste com os ganchos simulados (`scripts-section.wiring.test.ts`).
- **O ícone e a cor** (RN-SCRIPT-006, seção 28, issue #8). Cada script tem um ícone da lista fechada `scriptIcons` (`saved-scripts.ts`: `document`, o padrão,
  o de antes, `code`, `database`, `table`, `chart`, `clock`, `lightning`, `bug`, `wrench`, `star`, `flag`), **a mesma da API** (`ScriptRules.Icons`, na mesma
  ordem; o `saved-scripts.test.ts` lê o `ScriptRules.cs` da API e confere a lista e a ordem: ícone novo entra nas duas), e uma cor opcional. Os desenhos são
  os do app (`components/ui/icons.tsx`: os novos no mesmo traço, 16×16 e linha de 1,5), e `ScriptIconView` (`_components/script-icon.tsx`) os pinta com a
  cor pelo `iconColorStyle` (o contraste de 3:1 em todos os temas, ver "Conexões"); sem cor, o `currentColor` de sempre. O ícone aparece em cada linha da seção e na aba do script, no lugar do documento: a
  faixa o lê da lista dos scripts (`TabStrip.scriptOf`, do `scriptsQuery` no `WorkbenchTabs`; sem a lista ou com o script excluído, o documento), e o
  `ScriptRef` da aba não o guarda (as abas que voltam e as que mudam de janela não mudam). O schema aceita o ícone como texto, e `scriptIconOf` troca o que
  esta versão não conhece pelo padrão, sem derrubar a lista. **"Editar script…"** (a ação `edit` do `scriptMenu`, logo depois do Renomear, sem atalho: o F2
  continua só renomeando) abre o `EditScriptDialog` (`script-dialogs.tsx`, com estado: o ícone e a cor), com o nome, os ícones (botões com `aria-pressed` e o
  nome de cada um em `scriptsCopy.icons`, desenhados já na cor escolhida) e a "Cor do ícone" (o `ColorField` da cor da pasta). Gravar passa pela conferência
  do nome do renomear; sem mudança (`appearanceChanged`) o diálogo fecha sem chamar a API; senão `editScriptOrRefuse` manda o `PATCH` (`editedScriptInput`: o
  nome normalizado, o ícone, e a cor, com "sem cor" como texto vazio, porque o nulo do `PATCH` fica). O nome repetido e o inválido voltam ao campo do nome,
  e o `SCRIPT_ICON_INVALID` traz a frase de cada campo em `errors` ("Escolha um dos ícones da lista.", "Use uma cor no formato #RRGGBB."), que vai à lista
  dos ícones (um `FieldError` abaixo dela, ligado ao grupo por `aria-describedby`) ou à "Cor do ícone" (`editScriptErrors`, `_lib/edit-script-errors.ts`, com
  teste; só a recusa sem erro de campo leva o `title` da API, à cor); o nome novo vai ao título das abas (`renameScript`), e a lista se atualiza. O script novo nasce com o padrão e sem
  cor. **Conferido sob Xvfb** (a API de desenvolvimento, sem banco): as pastas com cor no ícone (a subpasta neutra, a etiqueta do ambiente ao lado), as
  variantes escuras no tema claro (`getComputedStyle`), o menu da pasta com "Renomear F2" e "Editar pasta…", a cor trocada pelo "Editar pasta…" e mantida
  pelo F2 (`GET api/user/folders`), e o "Editar script…" que trocou o ícone e a cor da linha e da aba aberta em seguida.
- **Abrir** (`openScriptTab`): uma aba por script (abrir de novo volta para ela), na conexão e no banco em que foi salvo (`scriptPlace`, que também dá o lugar
  salvo que a aba guarda). Se a conexão não existe mais, a aba abre **sem conexão** (`connectionId` nulo), com aviso: o texto já está no editor, a faixa acima
  dele (`NoConnectionBarView`) pede uma conexão, e "Usar esta conexão" passa pelo mesmo `switchConnection` do botão da conexão (ver "A conexão da aba de
  consulta"): a aba ganha um executor novo, na conexão escolhida e no banco dela. **O script genérico** (RN-SCRIPT-005) abre na única conexão conectada
  (`scriptPlace` recebe as conectadas deste instante: `connectedConnectionIds` sobre o cache das sessões da árvore, as abas e a foto da verificação); com mais de uma, ou nenhuma, abre
  sem conexão, sem aviso, e a faixa pergunta com a frase dele. A frase da faixa vem do `reason` (`scriptMissing`, `generic`, `restored`), e as opções dela
  vêm na ordem da lista do botão da conexão (`connectionChoices`: as conectadas primeiro, com o caminho de pastas e a marca "conectada"); nada vem escolhido. Sem conexão o executor não abre sessão nem chama a
  API (`run` avisa e, sem resultado na tela, diz por quê), a poda da conexão excluída não tira a aba, a barra de status diz "Sem conexão", e gravar por cima
  mantém o lugar antigo (o `PATCH` sem `connectionID`). **O editor segue o banco da aba com ele montado** (a gramática, o separador de comandos, as maiúsculas e o
  completar, por compartimentos): a aba que recebe uma conexão de outro banco não recria o editor, e o texto e o desfazer ficam.

## Pastas de scripts (RN-SCRIPT-007 a 010)

Seção 33 da especificação. As pastas da seção Scripts são as da API `api/user/script-folders` (ver o guia da API), à parte das pastas de conexões: não têm
cor, ambiente nem proteções. A tela tem a lista em cache (`scriptFoldersQuery`, chave `["script-folders"]`, em `_lib/script-folders.service.ts`), e cada script
da lista traz a pasta (`folderID`, que o `scriptSummarySchema` exige: a lista de uma API anterior é recusada). O que a tela decide é puro e testado, em
`_lib/script-tree.ts`; os textos estão em `scripts.copy.ts` (`folders`).

- **A árvore** (`buildScriptTree`): em cada nível as subpastas e depois os scripts, por nome, com o `byName` da árvore das conexões (o português, sem caixa
  nem acento); a pasta ou o script cuja pasta não está na lista vai à raiz até a leitura seguinte, e as pastas em ciclo não aparecem. As chaves levam o tipo
  (`folder:<id>`, `script:<id>`), porque uma pasta e um script podem ter o mesmo nome no mesmo lugar, e cada pasta sabe o que tem direto dentro
  (`contents`, a conta da API). `visibleScriptRows` dá as linhas à vista a partir das pastas ABERTAS (`open`, as chaves `folder:<id>`): a pasta que não está nele está fechada, e
  sem nada lembrado a seção mostra só o primeiro nível. Quem sabe quais estão abertas é a loja das pastas lembradas (RN-NAV-014, `useOpenFolders("scripts")`,
  que guarda GUID, e a seção converte com `folderKey`); a pasta vazia não tem a seta nem o `aria-expanded`. O `ScriptsTreeView` desenha `role="tree"` ("Scripts
  salvos") com `treeitem`s planos, cada um com o `aria-level`, a altura e o recuo da densidade (RN-NAV-011), o ícone de pasta neutro ou o do script
  (RN-SCRIPT-006) e a marca do genérico.
- **O teclado** (`scriptTreeMove` e `scriptTreeRowKey`): as setas para cima e para baixo sem dar a volta, Home e End; a direita abre a pasta fechada e, na
  aberta, vai à primeira linha de dentro; a esquerda fecha a aberta e, na fechada ou no script, vai à pasta pai. Enter e o duplo clique abrem e fecham a pasta
  (a vazia, nada) e abrem o script; F2, Delete, Shift+F10 e a tecla de menu valem nas duas. A seta (`data-chevron`) também abre e fecha. Digitar as primeiras letras de um nome vai à linha à vista que começa por elas (RN-ARVORE-009, o item "Ir ao item pelas primeiras letras" da árvore do navegador).
- **Os menus** (`scriptFolderMenu` e `scriptMenu`, em `saved-scripts.ts`): o botão direito no título da seção ou no espaço vazio dela (a seção tem a altura
  do que mostra, até 40% do navegador: o espaço vazio é a faixa sob a lista e as margens das linhas, e o texto da seção vazia), e Shift+F10 ou a tecla
  de menu no título, dão "Nova pasta" (na raiz); a pasta, "Nova subpasta", "Renomear" (F2), "Mover para…" e "Excluir" (Delete), este desabilitado na pasta que
  tem alguma coisa dentro, com o motivo ("A pasta tem 2 subpastas e 3 scripts: mova ou exclua antes o que está dentro dela.", `folders.notEmpty`, no singular
  e só com a parte que existe; a especificação o escreve entre parênteses, em minúscula e sem ponto, e aqui ele vale sozinho, na dica e no aviso, e vai como
  frase, como as outras dicas e avisos), e o Delete nela dá esse mesmo aviso de erro sem perguntar; o script ganha "Mover para…" logo depois do "Editar script…".
- **Os diálogos e as chamadas** (`useScriptFolderActions`, `_components/use-script-folder-actions.tsx`, que a `ScriptsSection` monta; as vistas sem estado
  em `script-folder-dialogs.tsx`). "Nova pasta" e "Nova subpasta" (`ScriptFolderNameDialog`, com o lugar na descrição: "Na raiz da seção Scripts." ou
  "Dentro de Fechamento / Mensal.") e o "Renomear" da pasta (o mesmo nome, com as mesmas maiúsculas, fecha sem gravar; mudar só as maiúsculas grava, com a
  pasta pai que ela tem: o `PATCH` é a pasta inteira) conferem o nome antes (`scriptFolderNameProblem`: as regras da API, e o repetido entre as irmãs na
  lista) e mostram as recusas do nome no campo (`scriptFolderRefusal`, para o `SCRIPT_FOLDER_NAME_INVALID` e o `SCRIPT_FOLDER_ALREADY_EXISTS` da API, que voltam
  por `allowRefusal`). "Mover para…" (`MoveToFolderDialog`: "Sem pasta" e as pastas, com a de agora escolhida; a da pasta sem ela nem as subpastas dela) não
  chama a API para o mesmo destino, e o do script manda `folderID` ou `root: true` (`moveScript`). As recusas de regra (a pasta pai ou a de destino que outra
  janela excluiu, o nome repetido no destino, o ciclo) lançam e vão ao aviso central com o detalhe da API, o diálogo fica aberto e as duas listas são lidas
  de novo (`afterRefusal`): o destino que saiu da lista volta a "Sem pasta" (o que o campo já mostrava; o "Mover" seguinte faz o que ele diz, em vez de
  mandar de novo a pasta excluída), e o diálogo do item que outra janela excluiu (renomear ou mover a pasta, mover o script) fecha, porque a regra só o deixa
  aberto pela pasta pai e pela de destino. O `PATCH` da pasta (a pasta inteira) leva o nome e a pasta pai da lista mais recente (`currentOf`), e não os de
  quando o diálogo abriu: a janela cuja lista já foi lida de novo não desfaz o "Mover" da outra (a que ainda não leu continua na consequência aceita da
  especificação). "Excluir" na pasta vazia pergunta (`ConfirmDialog`, no tom de perigo, "Excluir pasta"); a recusa `SCRIPT_FOLDER_NOT_EMPTY` (outra janela pôs algo
  nela) fecha a pergunta, vai ao aviso central e as listas são lidas de novo. Os avisos de sucesso: "Pasta criada.", "Pasta renomeada.", "Pasta movida.",
  "Script movido." e "Pasta excluída.".
- **A linha à vista** (RN-SCRIPT-008): depois de criar, renomear ou mover uma pasta ou um script (o renomear do script também), a `ScriptsSection` lê as
  listas de novo, abre as pastas acima dele e as lembra abertas (`ancestorIds`, sobre a lista que acabou de chegar, e `changeFolders({ open })`: é num evento, o fim da chamada à
  API, e por isso pode escrever na loja), abre a seção recolhida e escolhe a linha. A linha que já está na página (nenhuma pasta acima dela a abrir, que é o que
  o `changeFolders` devolve, e a seção aberta) ganha o foco na hora (pelo id, `scriptRowDomId`): sem estado novo não haveria renderização, e um
  pedido armado esperaria uma renderização qualquer depois (a primeira tecla no editor) para tirar o foco de lá. A que ainda vai aparecer fica numa
  referência; um efeito sem dependências, depois de cada renderização, dá o foco a ela quando ela está na página e esquece a chave. Uma referência, e não um
  estado, porque o `setState` num efeito é recusado pelo lint (renderizações em cascata).
- **A barra de ações do navegador é da árvore das conexões** (RN-NAV-002): o nome dela diz isso ("Ações da árvore de conexões"), e nada nela age sobre a
  seção Scripts, que tem os menus dela.
- **Testes**: `script-tree.test.ts` (a árvore, as linhas, o teclado, o nome, o caminho, as escolhas e a pasta do diálogo do nome), `script-folders.service.test.ts`
  (as rotas e as recusas), `scripts-section.test.ts` (a vista), `scripts-section.folders.test.ts` (a ligação, com os ganchos simulados: os menus, os
  diálogos, o que vai à API, as recusas e a linha escolhida depois), `script-folder-dialogs.test.ts`, e, no salvar, `use-script-saving.test.ts`,
  `script-dialogs.test.ts`, `tab-transfer.test.ts` e `workbench-state.connection.test.ts`. O que não tem teste: o foco de verdade na linha depois de criar
  (o vitest não tem DOM; o efeito sai cedo sem `document`), e o app não foi aberto nesta mudança.

## A conexão da aba de consulta (RN-ARVORE-008)

Seção 27 da especificação (issue #9 do repositório público: ao reabrir um script, não se sabia em qual servidor ele ia rodar). A barra do editor mostra, depois de
Executar e antes do banco, o botão da conexão da aba, que o canvas desenhava ("Conexão e esquema desta aba"; o banco fica na lista ao lado e o esquema não
aparece, seção 9), e deixa trocá-la.

- **O botão** (`ConnectionPicker`, `_components/connection-picker.tsx`; o desenho é `ConnectionButtonView`, testado sem DOM): a sigla do banco (`EngineTag`), o
  nome e a etiqueta do ambiente (`ShownEnvironmentPill`, o próprio ou o herdado da pasta); a dica (`title`) é `host:porta`, o usuário e o atalho. O nome
  acessível começa pelo que se vê, na ordem da tela, e só depois diz o que o botão é (WCAG 2.5.3: quem usa comando de voz diz o que vê, e o leitor de tela
  ouve o ambiente): "IFX ERP Informix Produção, conexão desta aba", "Sem conexão, escolher a conexão desta aba"; com `aria-haspopup="dialog"` e
  `aria-keyshortcuts`. Na aba sem conexão, "Sem conexão" com o ícone da tomada. Ele lê só as consultas das conexões e das pastas: montado em cada aba de
  consulta, não redesenha a cada mudança das abas.
- **A lista** abre pelo clique ou por **Ctrl+9** (Cmd+9 no macOS; `connectionShortcut`, pela tecla `Digit9`: abre e fecha). Quem abre é o painel da aba,
  como o Ctrl+S; aberta, o foco está nela e o teclado dela não sobe à aba, então o segundo Ctrl+9 é tratado no `onKeyDown` da própria lista, que fecha e
  devolve o foco como o Esc (com o foco no botão, que fica na aba, o painel da aba fecha). Vai num portal `position: fixed` em `document.body`, como a do
  `Select` (`role="dialog"`), com 400 px de largura, presa à janela, e abre para cima quando não cabe embaixo. A posição nasce nula a cada abertura, e só por isso o efeito que guarda quem tinha o foco (o botão, ou o editor no Ctrl+9) roda
  antes de o campo de busca existir e pegar o foco. O campo é o combobox da lista (`ConnectionListView`, testado sem DOM): as setas marcam (`choiceKeyTarget`,
  sem dar a volta), Enter escolhe, Esc fecha e devolve o foco; o clique fora fecha sem mexer no foco, e o foco que sai da lista também fecha. O teclado da
  lista não sobe à aba (`stopPropagation` no painel): o F5, o Ctrl+S e o Ctrl+W da aba não valem enquanto se digita a busca. O clique numa opção não tira o
  foco do campo (`preventDefault` no `mousedown` da lista). **O foco volta na hora e antes da troca** (`focusBack`, sem `requestAnimationFrame`): escolher
  fecha a lista, devolve o foco e só então chama a troca, porque a troca com alterações não salvas abre a pergunta (`UnsavedEditsDialog`), e o `Dialog` guarda
  quem tem o foco ao abrir para devolvê-lo ao fechar. Adiado, o foco chegava depois do "Cancelar" dela e ia para trás do diálogo, e a pergunta guardava o
  campo de busca, que já saiu da página. O `Select` faz o mesmo (o foco no controle antes do `onChange`): é a troca do banco. Testado com os ganchos simulados
  (`connection-picker.focus.test.ts`, que exporta o `ConnectionListPanel`, e `components/ui/select.test.ts`).
- **O que a lista mostra** (`connectionChoices`, `_lib/tab-connection.ts`, puro e testado): as conectadas primeiro, num grupo com título ("Conectadas" e
  "Desconectadas", só quando há alguma conectada), e em cada grupo por nome (`Intl.Collator` do pt-BR, sem caixa nem acento, com os números pela grandeza); cada
  conexão com a sigla, o nome, o ambiente e o caminho de pastas (`folderPathOf`, "Sem pasta" na raiz), e a da aba marcada (`aria-selected` e o visto). A busca
  acha o pedaço no nome, no caminho e no `host`. "Conectada" é a das listas (`connectedConnectionIds`), pelo `useConnectedIds` (`_lib/use-connected-ids.ts`: as consultas das
  sessões da árvore com `enabled: false`, que nunca abrem sessão, as abas e as que a verificação achou sem sessão, `useNotConnectedIds`, numa chave de texto
  que só muda com elas): só a lista aberta e a faixa da aba sem conexão o usam. No fim, "Mostrar no navegador" pede ao navegador a
  conexão da aba (`connectionReveal`, o mesmo do formulário de conexão): ele abre as pastas acima dela (e elas ficam lembradas, RN-NAV-014), a escolhe, lhe dá o foco e aparece se estava escondido.
- **A troca** (`switchConnection` no provedor, sobre `withConnection`, puro e testado; substitui o antigo `assignConnection`): passa pela pergunta das alterações
  não salvas da grade (o `guard` da edição, como a troca do banco), e então a aba ganha um executor novo na conexão escolhida, no banco padrão dela; o de antes
  sai de cena (`retire`) e a sessão dele fecha em segundo plano (`endInBackground`). Nada executa, o texto fica (o do editor deste instante) e o resultado sai.
  A mesma conexão, a aba de uma tabela e a aba com um comando da pessoa em andamento (`isPersonBusy`) não trocam; com ele a lista abre, mas as conexões ficam
  desabilitadas (`aria-disabled`) com o motivo numa região viva, e "Mostrar no navegador" continua. A execução da atualização automática (RN-GRADE-014) não
  segura a troca: o `retire()` do executor de antes a desliga, e a sessão dela fecha com ele (o teste espelha o da troca do banco). A aba sem conexão recebe a escolhida pelo mesmo caminho (a faixa dela também). A barra de
  status, a etiqueta da faixa, o editor (a gramática do banco novo, sem recriar) e a lista dos bancos (`DatabasePicker` com `key` pela conexão) acompanham.
- **Conferido sob Xvfb** (a API de desenvolvimento, sem banco: as conexões apontam para servidores que não existem): o botão com a sigla, o nome, o ambiente
  herdado da pasta e a dica; a lista aberta com o foco na busca, a busca pelo servidor, o Enter que troca (a barra de status e o botão acompanham), Ctrl+9 e
  Esc que devolve o foco ao editor, "Mostrar no navegador" escolhendo a linha; o ponto da aba de um script ao trocar de conexão, o Ctrl+S que grava a conexão
  nova (`GET api/user/scripts`) e o apaga, "Tornar genérico" pelo menu, a aba do genérico que troca de conexão sem ponto, e o genérico aberto sem conexão
  conectada com a faixa que pergunta. Numa árvore de trabalho sem o binário do Electron (o `pnpm dev` falha com "Electron uninstall"), `ELECTRON_EXEC_PATH`
  aponta para o de outra instalação. Depois do foco na hora: o nome acessível com o ambiente herdado da pasta; a escolha pelo teclado com a lista aberta pelo
  clique devolve o foco ao botão, e a escolha pelo clique com a lista aberta pelo Ctrl+9 o devolve ao editor, que recebe o que se digita. A pergunta das
  alterações não salvas por cima da troca não foi vista na tela: a grade editável precisa de um banco de verdade.

## Trocar o banco da aba de consulta (RN-ARVORE-007)

Seção 24 da especificação (issue 1 do repositório público). A barra do editor da aba de consulta mostra, depois da conexão da aba (RN-ARVORE-008), o banco em
que a aba roda ("Banco", um `Select` com rótulo visível ligado a ele) e deixa trocá-lo. A aba sem conexão não tem a lista (a faixa pede a conexão antes).

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
  conexão). O mesmo banco, a aba de uma tabela, a aba sem conexão e a aba com um comando da pessoa em andamento não trocam (a execução da atualização
  automática não segura a troca: o `retire()` a desliga, RN-GRADE-014). O editor segue o banco com ele montado: o completar e os
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
  `DeleteFolderDialog` da tela de Conexões (`folder-action-dialogs.tsx` só escolhe qual). Exportar e importar conexões (RN-TRANSF-001) têm um grupo
  próprio antes de "Copiar nome" na conexão e na pasta, e um depois de "Nova conexão" e "Nova pasta" no espaço vazio (`backgroundMenu(temItens)`): ver
  "Exportar e importar conexões".
- **F2, Renomear e Duplicar conexão** (RN-NAV-009 e RN-CONN-016). O F2 sem modificador na linha da pasta ou da conexão é `keyActionFor`
  (`_lib/navigator-menu.ts`, pura), que devolve a MESMA `MenuAction` do item do menu que mostra o atalho F2 (o "Renomear" da pasta e o da
  conexão), e a árvore a executa pelo `runMenuAction`, como se viesse do menu; nas outras linhas, e com Shift, Ctrl, Alt ou Cmd, não faz nada.
  O "Editar pasta…" (RN-PASTA-006) não tem atalho, e nenhuma tecla o abre (há teste). A pasta abre o `RenameFolderDialog`, só com o nome (ver
  "Conexões"). A conexão abre o `RenameConnectionDialog` (`connections/_components`), só com o nome: grava pelo
  mesmo `PATCH` do formulário com a conexão como está e o nome novo (`renamedConnectionInput`, em `_lib/rename-connection.ts`, sobre o
  `movedConnectionInput`: senha nula, que a API mantém), e o nome repetido (`CONNECTION_ALREADY_EXISTS`) e o 422 do nome ficam no campo
  (`renameRefusalFields`); o 422 de outro campo vai ao aviso pelo título. "Duplicar conexão" chama `POST api/user/connections/{id}/duplicate`
  (`duplicateConnection`, sem corpo: a senha é copiada dentro do cofre), atualiza as listas e pede ao `connectionReveal` a cópia, que aparece
  escolhida e com o foco, desconectada; a recusa vai ao aviso central.
- **A barra de filtros** (RN-BUSCA-001, RN-NAV-010 e 013, `NavigatorFilters`, `navigator-filters.tsx`, sem estado, é o único lugar que diz a disposição).
  Abaixo da barra de ações, uma coluna de duas linhas de 6 px de intervalo (`gap-1.5`, que cabe o anel de foco de 2 px com 2 de afastamento) e 8 px até a árvore
  (`mb-2`, o do canvas). **Linha 1**: só o campo "Filtrar objetos", na largura toda, como o canvas o desenha (mesmo no navegador largo, em que os três caberiam numa
  linha só: o dono pediu a busca na largura toda). A raiz do `NavigatorSearchField` é `w-full h-8 flex-none`: **dentro do `flex-col` o campo não pode ter base
  flexível** (`flex-[1_1_8rem]` era a dele quando dividia a linha), senão a base vale para a ALTURA e o campo cresce na vertical (128 px de base vencem o `h-8`); o
  teste confere que a raiz não tem `flex-[`, `flex-1` nem `min-w-`. **Linha 2**, `flex-wrap`: "N conectadas" à esquerda (`flex-none` e `whitespace-nowrap`: a conta
  nunca é cortada) e o seletor de ambiente à direita, com o resto da largura (`flex-[1_1_8rem] min-w-28` no invólucro dele, com o `x` "Limpar o filtro de
  ambiente" dentro: escolher ou limpar o ambiente não muda a largura de nada). Quando o seletor não cabe ao lado do botão com 128 px pelo menos, ele desce para uma
  linha só dele, na largura toda. **A base é de 8 rem, e não de 9**: com 9 rem, "Nenhuma conectada" (o estado ao abrir o app, sem nada conectado) só cabe a partir de
  318 px de navegador e sobra 1,6 px nos 320 do padrão, e qualquer fonte da interface mais larga (RN-CONFIG-008) jogaria o seletor para a terceira linha; com 8 rem
  cabem a partir de 303 px, com ≈18 px de folga no padrão (o seletor mede 145,6 px nos 320, e o mínimo é 128). Os limiares, **medidos** de 1 em 1 px (o `NavigatorFilters` de
  verdade e o CSS construído, num Electron sob Xvfb, na IBM Plex Sans do pacote; o desenho tinha calculado os mesmos valores, a menos de 1 px): o seletor passa a ficar ao
  lado do botão a partir de 263 px de navegador com "3 conectadas", 271 com "12", 288 com "1.200" e 303 com "Nenhuma conectada", e abaixo disso desce; a 200 px (o
  mínimo) ele sempre desce. "Todos os ambientes" cabe inteiro a partir de 271, 278, 296 e 310 px; entre o limiar e essa largura, o nome fechado termina em reticências (`[&>span:first-child]:truncate`; a etiqueta de ambiente já tem o nome inteiro na dica). Com a DejaVu Sans no lugar da fonte da interface (bem mais larga), os limiares
  medidos são 272, 279, 298 e 316 px: a 320 px "Nenhuma conectada" ainda fica ao lado do seletor, que fecha "Todos os ambientes" em reticências. O zoom do programa
  (`setZoomFactor`) não muda o layout em pixels CSS: a 125% e a 150% as mesmas larguras dão a mesma disposição. A ordem do DOM é a da tela, e por
  isso a do Tab: barra de ações, campo, "Limpar a busca", "Só as conectadas", seletor, "Limpar o filtro de ambiente", árvore (o teste confere pelo markup, e que
  nada tem `tabindex` positivo). O Ctrl+F, o Ctrl+Shift+E (`aside input[type="search"]`), o Esc, a seta para baixo e o Enter do campo não mudaram. A linha de estado
  da busca (RN-BUSCA-002) fica logo abaixo desta barra, nunca ao lado do campo, e o que a busca precisar de controle novo vai dentro do campo ou nesta segunda
  linha. No navegador largo (acima de ≈413 a 452 px) os filtros ocupam uma linha a mais que antes (+38 px): é consequência do pedido. **Conferido sob Xvfb**, na barra sozinha e no app
  inteiro: de 200 a 640 px o campo tem 32 px de altura e a largura toda do navegador, com a conta 0, 3, 12 e 1.200, o ambiente "Todos", um e um de nome longo (cortado
  dentro do seletor), o "Limpar o filtro de ambiente" sempre dentro do lugar do seletor e nada além da barra; no app inteiro, a divisória pelas setas em 200, 320 e 640 px,
  o Tab na ordem da tela (campo, "Limpar a busca", "Só as conectadas", seletor, "Limpar o filtro de ambiente", linha da árvore), o Ctrl+F, o Esc (com e sem texto), a seta
  para baixo e o Enter no campo e o Ctrl+Shift+E.
- **Filtro por ambiente** (RN-NAV-010). Na linha de baixo da barra, ao lado de "Só as conectadas" (acima), o `NavigatorEnvironmentFilter` (`navigator-environment-filter.tsx`,
  sem estado) é o `Select` do app com "Todos os ambientes" (valor vazio, o padrão), cada ambiente do usuário (RN-AMB-001) e "Sem ambiente". Cada
  ambiente vai como a `EnvironmentPill` dele, na lista e no controle fechado (o `content` da opção do `Select`); o controle fechado fica numa linha
  só, cortado com reticências (`[&>span:first-child]:truncate`), e a lista aberta é larga (`wideList` do `Select`): as opções não quebram ("Todos os ambientes" cabe numa linha num
  seletor de 130 px), a lista mede no mínimo o seletor e cresce até o maior texto, sem passar da janela (`panelWidthOf`, pura e testada: `min-width` do seletor, `max-width` da janela à direita
  dele menos 6 px, `width: max-content`; o que a janela não deixa caber termina em reticências). Com um filtro escolhido aparece o `x` "Limpar o filtro
  de ambiente", que volta a "Todos" e **leva o foco ao seletor** (`clearChoice`: o clique e o Enter no `x` são o mesmo clique; o foco vai ANTES de a escolha mudar, porque o `x` sai da tela com ela e o
  foco que estava nele cairia no `body`). O `ref` do botão do seletor é do `Navigator` (`environmentSelect`, como o `searchInput`), passado pela barra ao `Select` por `triggerRef`. Quem filtra é `filterByEnvironment(folders, connections, escolha, environmentLookup)`
  (`_lib/navigator-environment.ts`, pura e testada): as conexões cujo ambiente mostrado (o próprio ou o herdado) tem a chave escolhida, ou que não
  têm nenhum ("Sem ambiente"), e as pastas no caminho até elas, na ordem da lista; "Todos" devolve as MESMAS listas. O navegador monta a árvore
  (`buildConnectionTree`) sobre o que sai daí, e a busca roda depois, sobre essa árvore: os dois se combinam sem tocar em `searchTree`, e limitam também os bancos de que
  a busca pede o índice de nomes (o escopo, `searchScope`: só as conexões que a árvore mostra, e, delas, as conectadas). A pasta do
  ambiente sem conexão dele dentro não aparece (a regra fala das pastas no caminho). A escolha é estado do `Navigator`, que fica montado enquanto o
  cofre está aberto (`WorkbenchSlot`): vale enquanto a janela está aberta, ir às Configurações e voltar a mantém, e sair do cofre a apaga (uma
  janela nova começa em "Todos"). O ambiente que ninguém mais usa volta a escolha a "Todos" (`choiceAvailable`, um ajuste durante a renderização,
  só com as duas listas já na tela), e a conexão que o formulário salvou ou a duplicada que o filtro esconderia também (no mesmo ajuste do
  `connectionReveal`, como a busca). A árvore vazia pelo filtro diz "Nenhuma conexão em X." (ou "sem ambiente") numa região viva, e não é o
  primeiro uso. As pastas no caminho até as conexões à vista abrem só nessa vista, sem gravar (RN-NAV-014, ver "As pastas abertas lembradas"). **Conferido sob Xvfb**
  (antes da 0.6.0): Develop mostra a pasta Desenvolvimento com a conexão que herda e a conexão da raiz com o próprio; com
  "MES" no campo fica só a da raiz; "Sem ambiente" deu a frase; a inicial "p" escolhe Produção com a lista fechada; o `x` volta a todas.
- **As pastas abertas lembradas** (RN-NAV-014 e RN-SCRIPT-008). As pastas de conexões e as de scripts começam FECHADAS e voltam como a pessoa as deixou, ao abrir o app e
  ao entrar de novo, por usuário. Guarda-se o que está ABERTO, e não o recolhido: "nada lembrado, tudo fechado" sai de graça (a primeira entrada, quem vem da 0.5.0, as
  preferências apagadas), e a pasta nova, a importada e a criada noutra janela já nascem fechadas sem regra nenhuma. `_lib/folder-memory.ts` (a regra pura e a loja):
  `localStorage` na chave `prism:navigator-folders:<usuário>` (o nome sem espaços nas pontas e em minúsculas, como as vizinhas), `{ "connections": [...], "scripts": [...] }`,
  só os GUID das pastas abertas, sem repetidos, até 1.000 por lista (`maxRememberedFolders`: ficam os mais recentes, os do fim). **É uma chave própria, e não um campo
  de `prism:navigator:`**: a 0.5.0 regrava essa chave só com `hidden` e `scriptsCollapsed` (`mergeLayout`), então um campo novo ali se perderia na primeira gravação de quem
  voltasse a ela, e os testes que fixam o JSON exato da outra continuam como estão. Nada de nome, de servidor nem de dado de conexão: os GUID são opacos (RN-CONFIG-001).
  `parseFolderMemory` nunca lança, e o que não é GUID, o que não é lista e o texto quebrado são ignorados (**a leitura filtra GUID; `change` não**: a API só dá GUID, e os
  testes usam `f1` em memória). `applyFolderChange` (pura) aplica `{ open }`, `{ close }`, `{ closeAll }` e `{ retain }` e devolve o MESMO conjunto quando nada muda.
  `createFolderMemoryStore(getStorage)` tem `get(usuário, árvore)`, `change(usuário, árvore, mudança)` (devolve se a janela viu mudar; a mesma escolha de novo não grava nem avisa) e
  `subscribe`; cada conjunto é o MESMO objeto até aquela árvore mudar (`useSyncExternalStore`), e mexer nos scripts não troca o das conexões. **Cada janela tem o seu armazém e
  não ouve as outras**, e a mudança vai para o armazenamento SOBRE O QUE ESTÁ GRAVADO AGORA, e não sobre o que a janela leu (a disciplina da RN-NAV-012): A abre X, B (que
  leu antes) abre Y, e o gravado tem os dois; a janela que abre depois começa como a última escolha. Por isso também se grava quando a janela não vê diferença e o gravado vê:
  "Recolher tudo" numa janela que mostra tudo fechado, com uma pasta que outra janela abriu depois, esvazia o gravado (era o curto-circuito pelo cache da janela que o
  deixava como estava). O cache é de módulo e não relê o armazenamento quando o cofre fecha e abre
  na MESMA janela (como o da seção Scripts recolhida): a janela vê o que ela mesma fez, e o que grava continua sendo a mudança sobre o gravado. Sem armazenamento (ausente,
  recusando ou lançando) a escolha fica na memória da sessão, sem erro. `useOpenFolders(árvore)`, em `use-navigator-layout.ts`, devolve `[conjunto, change]` com o usuário de
  `sessionQuery` (sem usuário: vazio, e `change` não grava); `change` devolve se a janela viu mudar, que é o que a seção Scripts usa para saber se há renderização a esperar.
  **O navegador** (`navigator.tsx`): `openTreeKeys` (`_lib/navigator-folders.ts`, pura) cruza `tree.folderKeys` com os GUID lembrados (`folderKeyOf`) e junta os nós abertos
  de `expanded` (menos a conexão a que faltam usuário ou senha); o identificador que não está na árvore à vista (excluída, ou escondida por um filtro) não tem efeito. **As
  conexões não se lembram** (abrir é conectar, RN-SESSAO-001; nada conecta sozinho, RN-ABAS-006): uma pasta lembrada aberta mostra as conexões fechadas e desconectadas, e os
  bancos, os esquemas, os grupos e as tabelas abertos não passam de uma entrada para a outra (lembrá-los exigiria guardar nome de banco e de tabela: ficou para depois, no
  cofre). "Recolher tudo" fecha o `expanded` e as pastas (`{ closeAll }`), e é isso que volta. **A poda** (`{ retain: ids da lista }`) roda uma vez por montagem, quando a
  lista de pastas chega DEPOIS da montagem (`isFetchedAfterMount`: a do cache pode estar velha), no navegador e na seção Scripts; a lista de uma janela que não conhece a pasta
  recém-criada noutra a poderia podar, e foi aceito (só na janela que monta na mesma hora).
  **Nada de escrever na loja durante a renderização.** As revelações (a conexão salva, a duplicada, o "Mostrar no navegador", a importação) são ajustes durante a renderização
  (uma vez por pedido) que só põem estado: o `reveal` e o `handledImport` levam os IDs das pastas (`folderIdsOfKeys` sobre `plan.folderKeys`), e quem abre é o efeito que já leva o
  pedido embora (`connectionReveal.take`, `importedReveal.take`), por `openForRequest`. Esse é um `useEffectEvent(openFolders)`, de propósito: com `openFolders` nas
  dependências o efeito rodaria a cada troca de filtro (o número do pedido já o protege), e o `useCallback` dele o React Compiler recusa
  (`react-hooks/preserve-manual-memoization`, sobre o `filterView`). A linha da `NavigatorList` não consome o pedido de foco enquanto não está em `rows` e tenta de novo quando
  as pastas abrem. Os eventos (abrir e fechar, `expandFolder` de "Nova conexão" e "Nova pasta" dentro de uma pasta, "Mover para…") escrevem direto. **"Mover para…" revela o que
  moveu**: o `MoveConnectionDialog` e o `FolderDialog` (modo `move`, por `FolderActionDialogs`) têm `onMoved`, chamado depois de as listas serem lidas de novo; a conexão pede ao
  `connectionReveal` (o mesmo do salvar: pastas abertas e lembradas, escolhida, com o foco), e a pasta abre as do destino e fica escolhida e com o foco (`revealMovedFolder`; com
  uma busca no campo só abre, porque a pasta pode não estar na lista filtrada, e o pedido de foco ficaria armado).
  **A vista filtrada** (RN-NAV-010 e 013): com o seletor de ambiente ou "Só as conectadas" ligado, a árvore tem só as pastas no caminho até as conexões à vista, e elas aparecem
  abertas só nessa vista, SEM gravar nem ler o lembrado, como a busca. Recolher uma vale enquanto o filtro está ligado (`FilterFolders`: as chaves recolhidas e a vista a que valem,
  `filterViewOf` = o ambiente e as conectadas; trocar o ambiente, ligar ou desligar "Só as conectadas" começa outra vista e esquece o recolhido na hora, e voltar à primeira não o
  traz de volta: `filterFoldersFor`, no ajuste durante a renderização); desligar o filtro devolve as pastas lembradas, e
  ligar de novo abre tudo outra vez. "Recolher tudo" na vista recolhe só a vista, e a pasta que um evento ou uma revelação abre sai das recolhidas (`openedInFilter`). A busca
  (RN-BUSCA-001) segue com o `searchCollapsed` e `search.open`, e não toca no lembrado.
  **Testes**: `folder-memory.test.ts` (a regra e a loja, inclusive duas janelas), `navigator-folders.test.ts` (`openTreeKeys` e a vista filtrada),
  `use-navigator-layout.folders.test.ts` (o gancho), `navigator.folders.test.ts` (o `Navigator` com os ganchos simulados: nada gravado durante a renderização, as revelações no
  efeito, o "Mover para…", o filtro, a poda; **a loja é de módulo, então cada teste usa outro usuário**) e as da seção Scripts em `scripts-section.folders.test.ts`. **Conferido
  sob Xvfb, no app inteiro** (Electron de verdade e a API de verdade, com os dados criados pela API e a pasta de dados isolada; sem erro de página nem de console): a primeira entrada
  com as pastas das duas árvores fechadas e nada gravado; duas pastas abertas em cada árvore, o app fechado e aberto de novo (outro processo), tudo como estava, com as
  conexões fechadas e desconectadas ("Nenhuma conectada") e o gravado só com os GUID; "Recolher tudo" (que volta, e não toca nas pastas de scripts); o seletor de ambiente
  (abre as pastas do caminho só na vista, recolher vale só nela e nada grava; Produção, Teste e Produção recomeça aberta; limpar devolve as lembradas); a busca (abre a pasta só
  na tela filtrada, não grava, limpar devolve); "Nova subpasta" numa pasta fechada, a conexão salva pelo formulário numa pasta fechada, "Duplicar conexão", "Mover para…" de
  uma conexão, de uma pasta de conexões e de um script, "Mostrar no navegador" pelo seletor de conexão da aba (com tudo recolhido) e "Nova subpasta" em Scripts: a pasta abre, a linha fica à vista e com o foco, e volta aberta na entrada seguinte; o
  Ctrl+B; a pasta excluída (a poda a tira na entrada seguinte, e o identificador inexistente injetado no gravado também); outro usuário do cofre (chave só dele); e duas
  janelas (a de uma pasta e a de outra ficam gravadas, fechar numa não desfaz a outra, e "Recolher tudo" numa janela que não vê pasta aberta esvazia o gravado). **Não
  conferido**: a importação (do DBeaver e de arquivo do Prism), o app empacotado e o macOS.
- **Densidade** (RN-NAV-011; `_lib/navigator-density.ts`, com teste). `navigatorMetrics` tem as medidas de cada uma, com as classes escritas por inteiro
  para o Tailwind as achar: a confortável é a de sempre (linha de 30 px, recuo de 10 px e 16 por nível, botões de ação de 24 px); a compacta tem linha de
  22 px, recuo de 6 px e 12 por nível e botões de 20 px. A árvore da seção Scripts (RN-SCRIPT-008) usa a mesma linha (`rowClass`) e o mesmo recuo
  (`rowIndent`): até a seção 33 a lista de scripts tinha a linha de 28 px na confortável (`scriptRowClass`, que saiu). O texto é o 13/20 nas
  duas, e as etiquetas (18 px) e o ponto de estado cabem (conferido sob Xvfb: as 16 linhas de uma árvore de teste e os 8 scripts à vista numa janela de
  900 px, com os três botões de ação dentro da linha). O `Navigator` lê a preferência e a passa à `NavigatorList` e a cada `NavigatorRow` (`density`;
  sem ela, a confortável), e a `ScriptsSection` à `ScriptsTreeView`. A lista virtual estima a linha pela densidade e, quando ela muda (em
  Configurações, com a árvore escondida por baixo, ou noutra janela, com ela à mostra: as preferências chegam pelo evento `storage`), **esquece as
  alturas medidas na outra e mede de novo as desenhadas** (`remeasureRendered`, em `_lib/row-measure.ts`, num `useLayoutEffect` que só roda na troca):
  as linhas que rolaram para fora não se medem de novo, e ficariam com a altura antiga. Só `virtualizer.measure()` não basta: a linha de erro não muda
  de caixa com a densidade (a altura vem da mensagem e do botão), o `ResizeObserver` não a avisa e o `ref` não é chamado de novo, e ela ficava com a
  estimativa, com as linhas de baixo por cima da mensagem até sair de vista. `remeasureRendered` lê as linhas (`getVirtualItems`, que refaz as
  posições com as estimativas) ANTES de medir: medida logo depois de `measure()`, a linha de erro mede o mesmo que a posição ainda guardada, e a
  biblioteca não grava medida igual. O `row-measure.test.ts` reproduz a troca com o `Virtualizer` de verdade (e as duas causas), e **reprova a lista
  que mede as linhas e esquece as medidas só com `.measure()`**; a grade, que não mede, continua com `measure()`.
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
  `["tree", …]`, a começar pela lista dos bancos de cada conexão, e devolve `{ cached, indexes }`: cada lista é o MESMO objeto enquanto nada dela mudou), e `levelPathOf` é o inverso de `treeKey` (**mudou `treeKey`, mude `levelPathOf`**: há teste de ida e volta).
  **Nunca abre nó, nunca conecta sozinha e nunca toca em `expanded` nem nas pastas lembradas** (RN-NAV-014): limpar o campo devolve a árvore como estava. A única
  chamada à API que ela faz é o índice de nomes, um por banco do escopo (o item seguinte); nenhum nível é buscado (RN-ARVORE-002).
- **A busca em todas as conexões** (RN-BUSCA-002; pedido do dono em 2026-10-27: três ambientes de tabelas iguais, e a busca só achava a tabela no ambiente em que o esquema
  tinha sido aberto). Além do que a árvore carregou, acha as tabelas e as visões de TODOS os esquemas de cada banco do escopo, pelo índice de nomes que a rota
  `object-names` devolve numa consulta só ao catálogo. A busca no servidor a cada tecla ficou de fora (uma ida a cada ambiente por pausa da digitação, e ignorar o acento não se escreve igual nos três
  bancos), e carregar os níveis de cada esquema também (duas consultas por esquema, e a árvore cheia do que a pessoa não abriu). Peças: `_lib/navigator-search-scope.ts` (o escopo, o
  filtro dos índices e a linha de estado, tudo puro), `_lib/navigator-index.ts` (`indexLevels`) e `_components/navigator-search-status.tsx` (a vista).
  - **O índice mora na família da árvore e NÃO é nível.** A chave é `["tree", conexão, …banco, "names"]` (`objectNamesKey`; `objectNamesOf` é o inverso), de propósito: o
    "Desconectar" (`removeQueries(["tree", c])`), a conexão que some, o bloqueio, a sessão reaberta (`ofDatabase`) e o "Atualizar" de qualquer nó do banco (`treePrefixes`) já cuidam dele, e uma
    família à parte exigiria lembrar de cada um desses lugares (esquecer um deixa o índice de uma sessão morta). O preço: **quem lê a família `["tree"]` e supõe `NavNode[]` tem de pular o índice**.
    `levelPathOf` devolve `null` para ele (há teste), o `cachedTree` o entrega à parte (`indexes`) e o `cachedLevels` do autocompletar só recebe nível. Leitor novo da família: filtre por `levelPathOf`.
  - **O escopo** (`searchScope`). As conexões que a árvore mostra (depois do seletor de ambiente e de "Só as conectadas"), e, delas, só as conectadas, na definição única
    (`connectedConnectionIds`: a sessão da árvore aberta ou uma aba conectada; menos as que a verificação achou sem sessão). De cada uma, o banco da conexão e cada outro banco do servidor que
    já tem sessão da árvore em cache (`cachedTreeSessions`). **Nunca abre a sessão de um banco que ninguém abriu**: num servidor com dezenas de bancos seriam dezenas de sessões. A conexão
    conectada só por uma aba ainda não tem sessão da árvore, e o índice a abre sem abrir o nó (`searchSessionQuery`: ela já está conectada, e isso não é conectar); se não tem usuário ou senha
    gravados, fica sem índice (abrir chamaria o "Editar conexão", RN-TRANSF-016). As de fora são `openable` ou `withoutCredentials`, e as que estão conectando (o ponto "Conectando…") não são de fora:
    contam como "buscando" e entram quando a sessão abrir.
  - **Quando o índice é pedido.** Um `useQueries` no `Navigator`, com um `objectNamesQuery` por banco do escopo, `enabled` só com o texto adiado não vazio. Com o campo vazio os observadores ficam
    montados e desabilitados, e é isso que faz o índice que falhou, ou que o "Atualizar" deixou velho, ser buscado na busca seguinte (a biblioteca refaz uma consulta com erro quando `enabled`
    vira `true`; com `enabled` fixo ela não repete, então a falha não vira laço a cada tecla; o teste confere os dois). `keepUntilRefreshed` e `retry: false`: uma vez por banco, a falha aparece na hora, e
    depois a busca não volta à API até o "Atualizar", o "Desconectar" ou o bloqueio; cada tecla filtra no app, sem pausa e sem mínimo de letras. A consulta é calada (`meta.silent`): a falha vai à linha de estado.
  - **Armadilha: o escopo se lê do cache na renderização, não por `useSyncExternalStore`.** O "Desconectar" recolhe os nós, solta as abas e SÓ ENTÃO esquece as consultas, tudo no mesmo lote. Uma
    renderização a mais entre as duas coisas (o que uma assinatura do cache provoca: a atualização dela é urgente e pode sair antes das outras) veria o cache já limpo com os nós e as abas ainda no
    ar, e os observadores refariam a sessão que a pessoa acabou de fechar. As renderizações que importam já vêm das consultas observadas (a sessão de cada conexão, os níveis abertos, os índices).
    As listas de ids entram como texto no `useMemo` (como `connectedKey`), para o escopo e o filtro só se refazerem quando uma delas muda.
  - **O que aparece.** `indexLevels` (pura; depois do `loadedLevels` e antes do `searchTree`, no mesmo `useMemo`, com a identidade estável de sempre) acrescenta SÓ os níveis que faltam: o que a árvore
    carregou de verdade vale mais, e o grupo "Tabelas" ou "Visões" já carregado não recebe nada do índice nem gasta o corte. As linhas têm as chaves da árvore (a visão leva a posição dela na lista inteira do
    esquema em `byName`), então o duplo clique, o Enter, o menu e o "Gerar SELECT" valem sem código novo (`tableTargetOf` e `runMenuAction` leem a chave), e a escolha continua na linha quando o nível carregar.
    Sem a lista dos bancos, a conexão mostra só o banco dela, com o selo "padrão". O grupo diz "3 de 120" (`LevelState.total`); com o índice cortado na API (`truncated`), só o achado.
    **O corte é de 200 tabelas e visões por banco** (`searchIndexCap`), e não do total: o primeiro ambiente da árvore engoliria os outros, que é o caso do pedido. `indexesInScope` tira do resultado o
    índice de quem saiu do escopo (o filtro de ambiente, a conexão cuja verificação diz "Sem sessão aberta" e que deixou o índice no cache). "Nada encontrado" só aparece com a busca terminada em todo o
    escopo (`nothingFoundShown`, pura e testada): sem índice a caminho e sem banco que falhou. Com um a caminho a linha de estado diz "Buscando…" sozinha, e com uma falha diz só "Não foi possível buscar em …":
    o banco que falhou pode ter o nome, e as duas frases juntas se contradiziam. A falha que conta é qualquer uma da linha de estado, também a da conexão de fora que não abriu.
  - **A linha de estado** (`NavigatorSearchStatus`, vista sem estado; o que ela diz é `searchStatusOf`, pura, com tabela de casos) fica logo abaixo do `NavigatorFilters`, nunca ao lado do campo, e só existe
    na busca. Cada texto é um `role="status"` e os botões ficam fora das regiões vivas. A falha de um índice vem do estado da consulta (`isError && !isFetching`, mesmo com resposta velha); se foi a sessão que
    caiu (`DATABASE_SESSION_NOT_FOUND`), o "Tentar de novo" a reabre por `reopenDatabaseSession`, como a árvore (e avisa), e senão refaz só aquele índice (`refetchQueries` exato). A conexão de fora cuja sessão da
    árvore está em erro mostra ali a mensagem do banco, com o "Tentar de novo" que abre de novo; a recusa por faltar usuário ou senha não entra (é do "Editar conexão"). **Os botões saem da tela assim que o pedido
    começa, e o foco que estava neles cairia no `body`: o foco vai ao campo da busca.** A chegada de um índice não move o foco nem a rolagem (`scrollResetKey` continua sendo o texto; nada chama `focus` nem
    `scrollTo`), e o leitor de tela ouve "1.234 resultados, 600 à vista" quando o corte deixa achados de fora.
  - **"Buscar nelas também"** (`openSessionForSearch`, em `database-sessions.service.ts`) abre a sessão da árvore de cada conexão de fora que tem usuário e senha gravados, sem abrir o nó (é conectar, a pedido;
    `expanded` e as pastas lembradas não mudam), e não lança: a falha fica na consulta da sessão, de onde a linha a lê. A conexão de fora que ainda guarda uma sessão em cache é a que a verificação achou "Sem sessão
    aberta" (RN-VERIF-003): a consulta nunca fica velha sozinha, então a abertura é forçada (`staleTime: 0`) e a sessão nova substitui a morta. **O `meta` calado da sessão não é garantido**: o navegador observa a
    sessão de cada conexão (o ponto de estado), e cada renderização troca o `meta` da consulta pelo do observador, então a falha de abrir pode chegar também ao aviso central, como a de abrir o nó.
  - **Medida** (vitest, na máquina de desenvolvimento; os testes exigem menos de 100 ms por tecla): 3 bancos de 50.000 nomes (150.000 nomes, 3.000 com acento e 12.000 visões) mais 20 mil nós carregados em outra
    conexão. A primeira tecla, que dobra os nomes e ordena as visões (uma vez por resposta), leva 55 a 80 ms; as seguintes, 9 a 15 ms (uma letra, que passa do corte, 15 ms; acento ou visão, 10 ms). O escopo e a linha de
    estado custam 0,02 ms por renderização. É a conta do cliente: a da rota (uma varredura do catálogo por banco) ainda está por fazer, e `src/api/AGENTS.md` diz onde.
  - **Testes**: `navigator-search-scope.test.ts` (o escopo, o cache das sessões, o filtro dos índices e a linha de estado, por tabela de casos), `navigator-index.test.ts` e `navigator-search.test.ts` (o índice, o corte, o
    desempenho), `database-sessions.service.index-observers.test.ts` (o comportamento da biblioteca que o desenho pressupõe, com o `QueriesObserver` de verdade: uma vez por banco, a falha que não repete, o "Atualizar",
    a sessão reaberta, o "Desconectar"), `database-sessions.service.search-session.test.ts` (o "Buscar nelas também") e `navigator.search.test.ts` (o `Navigator` com os ganchos simulados e o cache de verdade: o escopo, o que
    aparece, o menu e o "Gerar SELECT", a linha de estado e os botões). **Conferido contra a API de verdade, sem o app** (PostgreSQL de teste: cinco esquemas, um de 300 tabelas, três ambientes e um segundo banco do servidor de Prod): a resposta
    da rota passa pelo `objectNamesSchema`; "cliente" acha a tabela nos quatro bancos, com o caminho aberto; "pedido_acao" acha `pedido_ação`; a chave da tabela e a da visão que o índice monta são as
    de `objects?kind=…`; "t_" corta em 200 por banco; a sessão fechada responde 404 `DATABASE_SESSION_NOT_FOUND`. **Não conferido**: o app inteiro sob Xvfb (o "Buscar nelas também" e o
    "Desconectar" no meio da busca, a rolagem e o foco com o índice chegando).
- **Na tela filtrada** só tem chevron quem tem algo à vista embaixo; recolher um ancestral ali é estado local daquele texto
  (`searchCollapsed`), não `expanded`; o grupo diz "3 de 120"; o destaque é um `<mark>` de texto (o nome vem do banco). O filtro roda
  sobre `useDeferredValue` do texto, para a digitação não esperar uma lista de milhares de linhas: com 20 mil nós carregados ele leva
  dezenas de milissegundos (o teste exige menos de 100 ms medindo o melhor de cinco execuções depois de uma de aquecimento: uma
  medida só falhou na suíte inteira, com a máquina disputada). O filtro está num `useMemo` (texto, o que se recolheu, a árvore, o
  `cachedTree`, de identidade estável, e os índices do escopo): um aviso ou uma tecla no editor, que redesenham o navegador, não o refazem.
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
  `filterProblem` (`statementCount`, no dialeto do banco): ela aparece no próprio campo, antes de a API ser chamada. O botão de ordenar no
  cabeçalho de uma coluna ordena (`nextSort`: crescente, decrescente, sem ordem; outra coluna começa crescente; `aria-sort`; ver "A coluna inteira escolhida
  pelo cabeçalho"); o clique no nome escolhe a coluna. A tela
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
  um `Blob` e um link com `download`, que no Electron abre o diálogo de salvar do sistema. **O "Exportar CSV" não usa canal nenhum, e a ponte não
  grava arquivo**; exportar TODAS as linhas é o "Exportar…" ao lado dele (seção 35, ver "Exportar dados"), que vai pela API e pelo destino do
  processo principal. O nome proposto (`csvFileName`, pela regra de `electron/file-name.ts`, que o processo principal também aplica) é
  `esquema.tabela.csv`, cortado em 120 pontos de código (um emoji não se parte ao meio), sem o que o sistema de arquivos recusa: saem os caracteres de controle, os de direção de
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
- **Chave estrangeira no resultado da consulta e do script** (RN-TABELA-007, alterada a pedido do dono em 2026-10-20). A mesma grade (`links`, `onFollow` e
  `linkable`, que o `ResultPanel` recebe em `follow` na aba de consulta, e em `records` nos Registros), em qualquer lugar do resultado (painel, aba, janela) e
  nas abas de resultado do Executar script, as guardadas também: o `QueryTabPanel` liga `useResultLinks` (`_lib/use-result-links.ts`) às linhas à frente
  (`kept ?? último comando`). A origem de cada coluna é o alvo `purpose: "sql"` (`edits.sqlTarget()`, o `sqlTarget(undefined, true)` do gancho: **sem** `notice`, sem a faixa "Conferindo…" e **sem aviso** se
  falha ou é recusado, também o erro fora das recusas, como o cofre fechado ou a API sem resposta, pelo `silent` do `throughMutationCache`; os valores seguem como texto), perguntado quando o resultado chega com linhas, à vista (`resultShown`, a janela do resultado vale sem
  `onScreen`) e com a aba conectada (`tab.sessionId`; sem sessão, nenhum valor é link: `shownResultLinks`). **Um pedido por comando**: `sqlTargetKey`
  (`_lib/sql-target-key.ts`: conexão, banco, texto do comando com o filtro do resultado e as colunas, nome e tipo, na ordem) é a segunda chave da resposta em
  `useRecordEdits` (a primeira é o `resultId`), e `knownSqlTarget()` cai nela; assim a atualização automática (1 s), o F5 e o "Carregar mais" não acrescentam pedido
  nenhum, a pergunta em andamento vale para o resultado novo do mesmo comando, e o "Gerar SQL" e o "Copiar como" reaproveitam o mesmo alvo (e ele a eles). A
  resposta que falhou não fica guardada. O mapeamento é puro (`resultLinks`, `sourceTables`, em `foreign-key-links.ts`): cada coluna do alvo (`table`, índice
  em `tables`, e `baseColumn`) vale se a tabela é `kind: "table"` (a visão, o sinônimo, a `elsewhere` e a coluna calculada ou sem `baseColumn` não são link) e
  se a coluna base está numa chave estrangeira DELA, pela regra de sempre (`linkOfColumn`); compara-se a coluna base, e não o nome que o resultado mostra,
  então o apelido e a junção funcionam. As chaves de cada tabela de origem vêm de `foreignKeysQuery` por `useQueries` (o cache dos Registros, da Estrutura e do
  Diagrama), só com o resultado à vista, e com `meta: { silent: true }` posto no gancho (e não em `foreignKeysQuery`, que a Estrutura e os Registros mostram no
  próprio lugar): o catálogo que falha não vira aviso. **A resposta que não chegou** (`failed`) **não é guardada e é perguntada de novo na execução seguinte da
  pessoa** (`RowsState.id`, que o F5 e o filtro mudam e a atualização automática de 1 s não; o gancho não pergunta com o alvo do comando na mão), e a `changed`
  (a atualização automática trocou o resultado antes de a resposta pousar) é perguntada uma vez mais, e só uma por execução. **Resultado que a API marca como só
  leitura** (`DISTINCT`, `GROUP BY`, `UNION`, subconsulta no `FROM`, filtro embrulhado: `notEditable`) **não tem link**, por decisão: é o alvo recusado (a API
  não muda); um `SELECT DISTINCT status_id FROM t` fica com texto. O clique (`follow`) é o dos Registros (`followOf`, `filterHandoff.request` com o banco da aba e `onOpenTable`, com a
  conexão e o banco do resultado); o valor é o da célula lida (a célula com alteração pendente não é link, e o item do menu usa o valor lido, como nos
  Registros). Com o resultado numa janela própria, `onOpenTable` abre a aba na janela da aba da consulta e o `onFocusWindow(tab.id, "link")` a traz à frente.
  O item "Ir para o registro referenciado" do menu entra pela `GridFollowSource` da aba (um proxy de identidade fixa, preenchido depois de `useResultLinks`, que
  precisa do alvo que `useRecordEdits` guarda), só nas colunas que são link.
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
  `cell-editing.ts` (o que a célula, a linha nova e a exclusão permitem, com o motivo já na frase "Somente leitura: …"; `deleteRowsAccess`, a exclusão das
  linhas da seleção), `cell-menu.ts` (o menu da grade nos grupos do DBeaver, RN-GRADE-004: ver "A seleção da grade", abaixo; os rótulos da RN-EDIT-001 (até
  a seção 33, "Adicionar linha" se chamava "Linha nova"; as marcas da linha nova na grade continuam com esse nome); o que não se aplica vem desabilitado,
  com o motivo no `hint` do `ContextMenuItem`, embaixo do rótulo), `grid-cursor.ts` (setas, Home, End, PageUp, PageDown, Tab) e `grid-editing.ts` (as linhas e as
  marcas que a grade desenha, e as teclas). As rotas são `record-edits.service.ts` (`allowRefusal` com as recusas que a faixa mostra; o resto vai ao aviso
  central pelo cache de mutações) e os esquemas, `record-edits.schema.ts`. A página traz `resultID` e o motivo de só leitura (`QueryPage.resultId` e
  `readOnly`, que o executor guarda nas linhas), e o executor dá a sessão da aba (`sessionOf`).
  - **Quem liga tudo é `_lib/use-record-edits.ts`** (na vista Registros e na aba de consulta): o estado (as pendências, que ficam na memória da aba, espaço `edits`, pelo
    resultado; o alvo do catálogo, perguntado na primeira tentativa de editar, pela sessão da árvore da mesma conexão quando ela existe; a célula
    ativa e o campo aberto, do resultado; a faixa, o menu, o "Ver SQL" e a pergunta). A grade (`ResultGrid` com `editing`) passa a `role="grid"`,
    com `gridcell`, `aria-activedescendant` e a posição em `data-row`/`data-col`, que o clique, o duplo clique e o botão direito leem por
    delegação na caixa da grade (a linha memorizada não ganha um manipulador por célula). Teclado com o foco na grade: as teclas da seleção (ver "A seleção
    da grade", abaixo), F2 e Enter abrem o campo, começar a digitar o abre com o que foi digitado, Shift+F10 e a tecla de menu abrem o menu, Ctrl+S salva
    as alterações quando há alguma (`savesEdits`; sem nenhuma, ou com Shift, a tecla segue para o script da aba de consulta, RN-SCRIPT-001),
    Alt+Insert adiciona a linha, Ctrl+Alt+Insert duplica e Alt+Delete exclui as linhas da seleção (ver "A barra de edição, o duplicar e os atalhos da linha",
    abaixo). A grade rola até a célula ativa quando ela muda (a linha nova entra depois das lidas). O campo (`cell-editor.tsx`, como
    no canvas) é uma área de texto de uma linha (o `input` tiraria as quebras de linha do valor): Enter confirma, Shift+Enter quebra a linha, Esc
    desfaz, Tab e Shift+Tab confirmam e passam à próxima editável, sair do campo confirma, e as teclas não sobem (o Ctrl+W no campo não fecha a aba).
    **Ao abrir** (RN-EDIT-001), o texto vem todo selecionado e à mostra desde o começo (F2, Enter, duplo clique, "Editar célula", também a edição de várias
    células e o valor com quebra de linha; o Tab, na célula seguinte): `selectEditorText` (`cell-editing.ts`, pura sobre o que o campo expõe) faz
    `setSelectionRange(0, fim, "backward")`, com o cursor no começo, e zera `scrollLeft` e `scrollTop` (o Chromium rola até o fim da seleção). Aberto pelo primeiro
    caractere digitado, o cursor fica depois dele (`typed`, que a grade tira de `touched` no momento de abrir). Quem chama é a referência (callback) da área de
    texto, estável (`useCallback` sem dependências), então roda só ao entrar na tela e não a cada tecla; a `key` do `CellEditor` é a célula, para o campo do Tab
    ser outro. Sem DOM nos testes: o teste chama a referência com um campo falso. Conferido só nos testes, não numa janela.
  - **O que a grade desenha**: a célula pendente com o valor lido riscado (11 px, `text-muted`) ao lado do novo, em `bg-accent/20`; a linha nova
    com `+` no número; a excluída riscada e vermelha (texto e número `text-danger line-through`, fundo `bg-danger/10`, 12% se também falhou, com o tom mantido no passar do mouse; `rowMarkClasses`, em `grid-editing.ts`, decide as classes, e `globals.test.ts` confere o contraste do vermelho sobre o tom em cada tema); a que falhou no Salvar em `bg-danger/15` e o número em negrito vermelho; a coluna que não se edita diz o motivo na dica do cabeçalho (na aba de consulta, também a marca "somente leitura" depois do tipo; ver "Num resultado de junção").
  - **A faixa** (`_components/edits-banner.tsx`), sobre a grade: "N alterações não salvas" com "Ver SQL", "Descartar" e "Salvar"; o aviso do banco sem log; o
    erro do último Salvar (`role="alert"`), que fica até o próximo; e o motivo de só leitura, à vista. Salvar que gravou tudo avisa "N alterações
    salvas." e chama `onSaved`: os Registros leem de novo. Sem o alvo (as pendências lembradas voltam sem ele), o Salvar e o "Ver SQL" o perguntam
    antes. O menu, o "Ver SQL" (`edit-sql-dialog.tsx`) e a pergunta são os elementos de `resultEditDialogs` (`result-edit-dialogs.tsx`), iguais nas duas grades.
  - **A pergunta antes de perder as pendências** (`_components/unsaved-edits-dialog.tsx`, com Salvar, Descartar e Cancelar; o foco em Cancelar): "Atualizar",
    aplicar o filtro, limpar e ordenar passam por `guard`; o filtro que chega por chave estrangeira espera (`handoffToTake` com `unsaved`), e
    Cancelar o tira da passagem; fechar abas pergunta pelo registro `unsaved-edits.ts` (`unsavedQuestion`: uma aba oferece Salvar; várias, ou a aba
    com a vista Registros desmontada, só Descartar e Cancelar), antes da pergunta do SQL digitado. O provedor esquece o registro das abas que
    fecham, como a memória da aba.
  - **Copiar e colar** usam a área de transferência do navegador (`navigator.clipboard`), como o "Copiar nome" do navegador; copiar (Ctrl+C, "Copiar" e
    "Copiar com cabeçalho") leva a seleção, com o valor completo das células cortadas (ver "A seleção da grade" e "Valor completo das células cortadas",
    abaixo); colar vira pendência da célula ativa, como a edição, e só com uma célula escolhida.
  - **Painel lateral de Visualizar valor (`F7`)** (`_components/cell-value-viewer-panel.tsx` e `_lib/cell-value-viewer.ts`, com teste): pressionar `F7` com uma célula ativa na grade (tanto nos Registros da tabela quanto no resultado de um comando ou script SQL) ou escolher "Visualizar valor" no menu da célula abre a guia lateral "Valor" ao lado da `ResultGrid`, mantendo os resultados visíveis ao lado do valor, igual ao DBeaver. O painel mapeia automaticamente o tipo da coluna e o conteúdo (`JSON`, `JSONB`, `BSON` binário decodificado para JSON, `XML`, `HTML`, `BYTEA`/`BLOB`/`VARBINARY`/`BYTE` e texto) para os cinco formatos do DBeaver (`Binary`, `HTML`, `JSON`, `Text` como padrão e `XML`), permite alternar entre "Formatado" e "Cru" em JSON, XML e HTML, exibe o visualizador hexadecimal + ASCII de 16 bytes por linha (`Offset | 00..0F | ASCII`) no modo `Binary` (para colunas binárias `0x…` e textos em UTF-8), e oferece quebrar linhas, copiar valor, salvar em arquivo (`saveCellFile`), abrir no editor externo (`prism:open-external-editor`, em `electron/external-editor.ts`) e, quando a célula é editável, carregar de arquivo, editar, definir `NULL`, reverter e aplicar na célula selecionada.
  - **Na aba de consulta** (`query-tab.tsx`, `subject: "result"`, que muda só as frases da conferência do catálogo): executar outro comando (o botão
    e o Ctrl+Enter) e "Executar de novo" passam por `guard` quando o executor vai de fato enviar o comando (`commandWillRun`; o que ele recusaria
    só avisa). O Salvar que gravou tudo NÃO executa de novo (RN-EDIT-009): `savedResultOf` (`record-edits.ts`) monta a grade que fica (os valores
    salvos, as excluídas fora, a linha nova no fim com o que foi digitado) e `runner.keepSaved` a põe no executor, com `cursorClosed` quando havia
    mais linhas (salvar é um comando na sessão e fecha o cursor; "Carregar mais" dá lugar a "Executar de novo"; numa aba guardada do script, a cópia
    dela fica com o que foi salvo, e o cursor que fecha é o do último, RN-SQL-023). As colunas da linha nova que a
    pessoa não preencheu ficam em `RowsState.generated` ("gerado pelo banco — execute de novo para ver", em itálico e `text-subtle`): a célula não
    se edita e, com a chave entre elas, a linha também não (`cellAccess`, `deleteRowAccess`). `generated` viaja com a aba para outra janela
    (`tab-transfer.ts`), e a aba de consulta que salvou para ir vai com a grade salva (`sendTab`). Os diálogos e o menu ficam fora da caixa que
    trata o Ctrl+S do script: vão por portal, e o teclado deles subiria até ela. Fechar a aba pergunta pelo mesmo registro `unsaved-edits.ts`. A
    aba de consulta ainda não tem o Commit manual na tela (RN-TX-001): o Salvar é sempre uma transação própria.
  - **Num resultado de junção** (RN-EDIT-002, pedido do dono de 2026-10-14; só a aba de consulta tem junção, os Registros são de uma tabela só e
    ficam como estavam): o `edit-target` diz a tabela de cada coluna (`columns[].table`) e a chave de cada tabela, e cada coluna se edita na
    tabela de onde veio (`cell-editing.ts`: `cellAccess` olha a tabela DA COLUNA, e numa tabela só, sempre a 0, como antes; a chave cortada,
    gerada ou NULA vale por tabela, e a nula é a junção externa sem linha ali, "<tabela> não tem linha aqui (junção externa)", pelos valores
    da linha em `RowContext.values`). "Adicionar linha", "Duplicar linha" e "Excluir linha" ficam desabilitados com "num resultado de junção só se alteram células"
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
  - **A barra de edição, o duplicar e os atalhos da linha** (seção 33, RN-EDIT-013 a 016; o canvas não desenha a barra, seção 9). As decisões são puras, com
    teste: `edit-bar.ts` (`editBar`: os quatro botões, "Editar célula", "Adicionar linha", "Duplicar linha" e "Excluir linha", cada um com o atalho da
    plataforma e o motivo de não valer, o primeiro na ordem da RN-EDIT-014: o resultado inteiro só leitura, pelo `resultReadOnly` (a página, a conexão
    somente leitura e o catálogo que diz que nenhuma tabela se edita: os três são "o resultado inteiro só leitura" da regra, e desabilitam os quatro com o
    motivo da barra do resultado, também sem célula ativa, em vez de "Editar célula" pedir uma célula); a aba ocupada (o Salvar também) e a atualização automática; o `rowOperations` falso para os três
    de linha (`newRowAccess`); a célula ativa para "Editar célula" (`cellAccess`); a chave que não se sabe e a linha já marcada para "Excluir linha"
    (`deleteRowAccess`, que passou a recusar a linha riscada, também sem o alvo); e, por último, a grade sem linhas e a falta de célula ativa, que não são de
    só leitura e vêm sem o "Somente leitura:"), `duplicate-row.ts` (`duplicatePlan`: o que a duplicada copia, o que fica com o padrão e a chave copiada) e
    `grid-editing.ts` (`rowShortcut` e `editShortcuts`). **Habilitar não custa consulta** (RN-EDIT-010): sem o alvo, o que depende do catálogo (a tabela, a
    coluna, a chave, o `rowOperations`) vale, e a primeira tentativa pergunta, como o menu; a recusa vai à faixa e, com o alvo guardado, o botão passa a
    dizê-la. O que a linha já diz não espera o catálogo (RN-EDIT-014: "desde o começo, com o motivo, quando ele já é sabido"): `cellAccess` recusa sem o
    alvo a linha marcada para exclusão, a célula cortada e a que o banco preencheu numa linha nova salva, e `deleteRowAccess`, a linha já marcada. A barra é desenhada pelo contrato da edição
    (`GridEditing.bar`: os botões e a ação), que `useRecordEdits` monta a cada renderização (`barOf`, sobre o estado da tela, com a célula ativa só numa
    linha que existe); quem a põe na tela é a `ResultPanel`, só onde a grade recebe a edição e com a grade no corpo (também sem nenhuma linha, e com outro
    comando rodando, desabilitada): nos Registros, no rodapé, logo depois de "Exportar CSV"; no resultado de um comando, numa linha própria (`border-t`,
    alinhada à esquerda) entre a grade e os rodapés ("Carregar mais", o cursor fechado, a nota da aba guardada). A aba guardada do script recebe a
    edição (`kept`, RN-SQL-023), e a barra vem com ela, antes da nota. Recolhida, a área esconde a barra com o corpo (`inert`).
    - **O componente** (`edit-bar.tsx`, `EditBar`): `role="toolbar"` com o nome "Edição da grade", uma parada de tabulação só (o último botão com o foco,
      de começo "Editar célula") e as setas, Home e End pelo `stripKeyTarget`, como a barra de ações do navegador. Os botões são os da área de resultado
      (`Button` `secondary` `compact`, `h-7 px-2.5 text-xs`), com o ícone do traço do canvas (`PencilIcon`, `PlusIcon`, `DuplicateIcon` e o `CloseIcon` em
      `text-danger`) e o texto; o que não vale usa `aria-disabled` (fica nas setas e com o foco), com a dica `"<botão> (<atalho>). <motivo>"` e o motivo num
      `sr-only` ligado por `aria-describedby`; cada um declara `aria-keyshortcuts`. Depois do clique o foco volta à grade (`onDone`, que a área liga ao
      `[role="grid"]` dela); no "Editar célula" o campo nasce com o foco e o devolve à grade ao fechar. Clicar com o campo aberto o confirma antes (o campo
      confirma ao perder o foco, no `mousedown` do botão).
    - **O que cada botão faz** é o item de mesmo nome do menu (`bar.onAction`): `openEditor` na célula ativa, `newRow`, e `duplicateRows` e `removeRows` nas
      linhas da seleção (RN-EDIT-014, seção 37), com a mesma pausa da atualização automática desde o começo (`hold`) e o mesmo descarte quando o resultado
      mudou no meio (`moved`). Com mais de uma linha, os rótulos vão ao plural ("Duplicar linhas", "Excluir linhas"), e a dica e a descrição para o leitor
      de tela dizem quantas ("Excluir as 3 linhas escolhidas (Alt+Delete)", `EditBarButton.description`). Tiradas linhas novas, a seleção passa a ser a
      célula ativa, que vai para a linha que ficou no lugar da primeira tirada, ou para a de cima quando não ficou nenhuma depois dela, e some sem linha
      nenhuma. As linhas são seguidas pela identidade (`refsOf`/`positionsOf`, a lida pela posição, a nova pelo id), e não pela posição: dois "Excluir linha"
      seguidos enquanto o alvo é perguntado (o duplo clique), o "Descartar" ou o "Carregar mais" no meio mudam a linha daquela posição, e a segunda
      exclusão não tira a linha nova que passou ao lugar da primeira. Uma linha da seleção cuja chave não se sabe não deixa excluir nenhuma, com o número
      dela no motivo (`deleteRowsAccess`: "a chave da linha 7 chegou cortada"); a já marcada fica como está. As linhas saem numa passada só
      (`deleteRows` para as lidas e `removeNewRows` para as novas, pelos conjuntos, em `record-edits.ts`): o Ctrl+A com 50.000 linhas carregadas não faz uma
      cópia da lista por linha (com `deleteRow` em laço, eram 15 s de tela parada).
    - **Os atalhos** (`rowShortcut`, conferido no `handleKeyDown` da grade antes das setas): Alt+Insert adiciona, Ctrl+Alt+Insert duplica (a mesma tecla, o
      Ctrl decide: antes o ramo do Alt+Insert casava também o Ctrl+Alt+Insert e o Shift+Alt+Insert) e Alt+Delete exclui a linha da célula ativa, com os
      modificadores exatos; com Shift, nada. O AltGr do ABNT2 chega como Ctrl+Alt: com ele o Insert duplica e o Delete não faz nada. No macOS
      (`navigator.platform`, pelo `isMacPlatform` de `src/lib/utils/platform.ts`, a conferência que todos os atalhos e dicas da tela usam) o Option faz o
      papel do Alt e o Cmd o do Ctrl: Option+Insert, Cmd+Option+Insert, Control+Option+Insert (o do DBeaver) e Option+Delete, que é também o Backspace (a
      tecla "delete" do Mac). O menu da célula e as dicas da barra escrevem os mesmos (`editShortcuts`, com o nome das teclas da web no
      `aria-keyshortcuts`). Ctrl+Alt+Insert e Alt+Delete que a barra mostraria desabilitados (sem célula ativa, a aba ocupada…) dizem o motivo dela na faixa
      (`rowAction`). O Delete sozinho (`deletesRows`; no macOS também a "delete", o `Backspace`) marca na hora, sem pergunta, as linhas das células escolhidas
      (RN-EDIT-015): `deleteKeyRows` (as `selectedRows`, as do Alt+Delete; nenhuma com colunas inteiras ou sem seleção, e então a tecla segue sem `preventDefault`)
      → `onDeleteRows` → `deleteKey`, que confere o mesmo motivo da barra que o Alt+Delete dá (a faixa) e chama `removeRows` com essas linhas, o mesmo do
      Alt+Delete e do menu. Não há diálogo, estado de pergunta nem texto de pergunta: o dono não quis (2026-10-24); a confirmação é a de sempre, a exclusão é
      uma pendência e nada sai do banco antes do "Salvar" (o "Desfazer alteração" e o "Descartar" valem). As linhas ficam pintadas pela marca de exclusão que
      já existe.
    - **Duplicar linha(s)** (`duplicateRows`, no menu, na barra e no Ctrl+Alt+Insert): onde "Adicionar linha" vale (`newRowAccess`), até 1.000 linhas de uma
      vez (`duplicateLimit`), uma linha nova no fim da grade para cada linha da seleção, na ordem da grade (`addRow` com as colunas copiadas; a busca dos
      valores completos é uma só, para todas; o que não vem não duplica nenhuma, com a coluna e o número da linha na frase do plural; depois, a seleção é das
      cópias, inteiras, `selectNewRows`), com o valor que a tela mostra de cada coluna da tabela que se edita (a pendência também, o nulo como nulo; na
      linha marcada para exclusão, o lido; numa linha nova de origem, só o que ela tinha). Não copia a que o banco gera, "sempre" ou "por padrão"
      (`generated`, que no PostgreSQL a API passou a dar também ao `serial`), a que não se edita e, na linha nova já salva, a que o banco preencheu; a
      calculada no comando não é da tabela e não entra na lista. A coluna da tabela que o resultado traz duas vezes (`SELECT id, id AS copia`) se copia uma
      vez, pela primeira que se copia, e a repetição não entra na lista: o `INSERT` não leva a mesma coluna duas vezes (o `EditPlanner` da API recusa). A
      célula cortada vai com o valor completo (`completeValues`, a faixa com "Buscando os valores completos…" e "Cancelar"); o valor que não vem (o teto, a
      sessão que caiu, `RESULT_NOT_FOUND`) e a busca cancelada não duplicam nada, e a faixa diz por quê ("Atualize os registros" nos Registros,
      `subject: "table"`; "Execute o comando de novo" no resultado). A busca de um "Duplicar linha" seguinte (o duplo clique no botão) cancela a do
      anterior, que sai calado (`duplicating`): só o "Cancelar" da pessoa diz que a busca foi cancelada. Depois da busca valem as
      pendências e as linhas de AGORA (a grade ficou livre). A célula ativa vai à primeira coluna editável, ou, com a chave copiada inteira, à coluna dela
      mais à esquerda. **Os avisos da faixa** (a chave copiada e as colunas que ficaram com o padrão) e as recusas do duplicar usam o tom de atenção
      (`say(…, "warning")`, `EditsBanner.noticeTone`: o triângulo `AlertIcon` no lugar do cadeado, que fica para os motivos de só leitura) e duram até a
      próxima ação de edição, o Salvar ou o Descartar (o "Desfazer alteração" passou a limpar o recado, como as outras ações).
    - **Não conferido na tela**: nada disto foi visto numa janela (não há Xvfb nem banco nesta máquina), só nos testes. A linha da barra no resultado de um
      comando fica ACIMA do rodapé ("Carregar mais", "Executar de novo"), entre 69 e 110 px da borda de baixo da janela, e a pilha de avisos (`bottom-20`, 380 px
      à direita) começa a 80 px: numa janela estreita um aviso pode cobrir "Duplicar linha" ou "Excluir linha" enquanto dura. Medir com o
      `document.elementFromPoint`, como em "Avisos e mensagens", e, se cobrir, subir a pilha quando a barra está na tela.
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
  - **Onde vale**: Ctrl+C com o foco na grade, "Copiar" e "Copiar com cabeçalho" copiam a seleção (`copySelection`, ver "A seleção da grade", abaixo:
    só as cortadas que vão no texto, e a busca para quando o texto passa de 10 MiB, `fetchFullValues` com `keepGoing`), "Exportar CSV" dos Registros (as
    cortadas das linhas carregadas; sem nenhuma, o arquivo sai na hora, como antes) e "Duplicar linha(s)" (as cortadas das colunas que ela copia; o que não
    vem não duplica nada, RN-EDIT-016). Vale na aba de consulta e nos Registros, que usam a mesma edição. **Os "Copiar como" e o "Copiar avançado…"
    (RN-GRADE-003 e 016)** pedem o recorte da seleção ao contexto (`GridSelectionContext.slice`) e o completam por `complete`, que passa por
    `completeValues` e por `completeSlice` (`grid-slice.ts`); o `runCopyAs` só pede as cortadas que o documento escreve com o valor (`cutCellsToFetch`) e
    para a busca quando o texto passa de 10 MiB (ver "Copiar como e Copiar avançado", abaixo). O "Gerar SQL" pede só as células cortadas que o item usa (`cutCellsFor`), pela posição na grade (`fullValues`).
  - **As fixtures de ouro da exportação** (RN-EXPORT-024): a API escreve a exportação de todas as linhas (seção 35) com os mesmos valores e escapes
    desta biblioteca, e os dois lados leem as mesmas fixtures, em `src/test-fixtures/export/` (fora de `src/client` e de `src/api`), escritas à mão e
    conferidas por inteiro. Aqui quem as lê é o `_lib/grid-export/export-fixtures.test.ts`, pelo caminho a partir da raiz do repositório: o campo do CSV
    (`toDelimited` com as opções, e o `csvFieldOf` nos padrões do "Exportar CSV"; a aspa "Em todos os valores" é `always` aqui e `all` na API), o texto
    do HTML, a célula do Markdown (`markdownCell`), o valor e as chaves do JSON (`jsonValue` e `jsonKeys`), o literal do SQL (`sqlLiteral` e
    `scriptLiteral`), o texto e o atributo do XML com o `isXmlChar`, e a planilha (`xlsxText`, `spreadsheetNumber`, `sheetNameOf` e `withinCell`).
    `jsonValue`, `markdownCell` e `withinCell` são exportados só por isso. **Mudar um escape destas funções é mudar a fixture**, e a API falha até
    seguir a regra nova (o `ExportFixturesTests` dela lê os mesmos arquivos); a fixture nunca se regera a partir do código. Os casos com o par
    substituto solto vêm como `{ "codePoints": [...] }`, montados por `String.fromCharCode` (o par solto) e `String.fromCodePoint`. Desde a seção 37 a
    tela lê também as que eram só da API (o "Em todos os textos" do CSV, o TXT, o PHP, a data em ISO 8601, o literal do binário, o `INSERT` de várias
    linhas, o nome do XML e o DbUnit), a `document.json` (o documento inteiro de cada formato de texto, dos dois lados) e a `copy-as.json` (só da tela):
    ver "Copiar como e Copiar avançado".
  - **A linha do resultado na API** é a da grade, salvo depois de um Salvar da aba de consulta que tirou ou pôs linhas sem executar de novo
    (RN-EDIT-009): `savedResultOf` devolve `sourceRows` (a linha de antes de cada uma, nula na nova; um segundo Salvar continua a conta), o
    executor a guarda (`RowsState.sourceRows`, por `keepSaved`) e ela viaja com a aba para outra janela (`window-messages.ts`). Sem ela, a cópia de
    uma linha depois de uma excluída pediria o valor da linha errada.
  - **Conferido na tela** (Xvfb, PostgreSQL em contêiner, `text` de 50.000 caracteres com acentos e `bytea` de 100.000 bytes): o Ctrl+C e o
    "Copiar valor" deixaram na área de transferência os 50.000 caracteres, com o MD5 igual ao do banco, e o "Exportar CSV" gravou o texto e o
    binário inteiros (o `Blob` que a tela entrega ao download; o diálogo de salvar do sistema foi trocado no teste). Para ler a área de
    transferência pelo protocolo de depuração: `navigator.clipboard.readText()` com `userGesture: true`.
- **Área de resultado recolhível** (RN-PAINEL-001; o lugar do resultado, numa aba ou numa janela, está em "O resultado no painel, numa aba ou numa janela"): o estado é um redutor puro (`_lib/result-layout.ts`: `split`, `collapsed`,
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

## A seleção da grade, o copiar e o menu (seção 37: RN-GRADE-001 a 004, 014 e 015, RN-EDIT-004 e 013 a 016)

A seção 37 da especificação manda; o que segue diz onde ficam as peças e **o contrato que as frentes do "Copiar avançado" e do "Gerar SQL" usam**. Vale nas
duas grades (os Registros e o resultado da aba de consulta, também nas abas guardadas do script): a seleção é da edição (`useRecordEdits`), e a grade só
desenha e avisa.

- **O modelo é puro** (`_lib/grid-selection.ts`, com teste, sem React e sem DOM). `GridSelection = { active, anchor, shape }`: a célula ativa e a âncora
  são `CellRef` (`{ row: RowRef, column }`), e a forma é `cell` (só a ativa), `cells` (um retângulo: `rows: RowSet` e as colunas `from` a `to`) ou `rows`
  (linhas inteiras: `rows: RowSet`). **As linhas são guardadas pela identidade**: `RowRef` é `{ kind: "read", row }` (a posição no resultado) ou
  `{ kind: "new", id }` (o `NewRow.id`), e `RowSet = { read: [de, até][], added: id[] }` são faixas e uma lista, **nunca célula por célula**: o Ctrl+A em 100
  mil linhas é uma faixa, e a pergunta "esta linha está escolhida?" é uma busca binária (o teste de desempenho confere). O "carregar mais" põe as lidas
  que chegam antes das novas: guardadas assim, a seleção fica nas mesmas linhas, e as lidas que chegam depois de um Ctrl+A não entram nele.
  `GridLayout = { read, added, columns }` é a grade de agora (as lidas, os ids das novas na ordem, as colunas); toda posição que entra e sai (`GridCell`,
  `row`) é a da grade agora.
  - **Os gestos** (devolvem a seleção nova): `select` (o clique, as teclas sem Shift, o Tab do campo), `extend` (Shift+clique, o arraste), `extendByKey`
    (Shift com as teclas: com linhas inteiras, a vertical estende as linhas e a horizontal só move a ativa), `selectRow`, `extendRows` e `toggleRow` (o
    número da linha: clique, Shift, Ctrl/Cmd; com um retângulo, o Ctrl+clique é o clique), `dragRows` (o arraste no número, com Ctrl no começo juntando),
    `selectAll` (Ctrl+A e o canto), `collapse` (Esc, e o Salvar/Descartar/Excluir que tiram linhas), `wholeRows` (Shift+Espaço), `contextCell` e
    `contextRow` (o botão direito), `selectNewRows` (as cópias do "Duplicar linhas") e `afterSave` (o Salvar da aba de consulta, que não executa de novo).
  - **As perguntas**: `activeCell`, `selectedRows` (as linhas da seleção, as que têm uma célula escolhida, pela posição, em ordem: é sobre elas que agem o
    copiar, o "Gerar SQL", "Duplicar/Excluir linhas" e "Copiar número de linha(s)"), `selectedColumns`, `selectedCells` (um gerador, linha a linha),
    `rowSpan` e `columnSpan` (o que a grade desenha em cada linha à vista e no cabeçalho), `isSelected`, `selectionSize` (`{ rows, cells, whole }`, a
    contagem da barra), `hasSeveralCells` (a pausa da atualização automática e o "Colar" de uma célula só; o "Definir como nulo" vale para as escolhidas da coluna da ativa, seção 38) e `deleteKeyRows` (as linhas do Delete sozinho, RN-EDIT-015).
  - **O recorte** (`sliceOf(selection, layout, source, scope)`, `scope` `cells` (o padrão), `rows` ou `loaded`, os três do "O que copiar" da RN-GRADE-003):
    um `SelectionSlice`, que é o `GridSlice` dos formatos (`grid-export`) com `positions` e `columnIndexes` (de volta à grade), `newRows` (as linhas novas
    ainda não salvas, pelo índice no recorte: não têm número na grade, e o "Copiar como SQL" as deixa de fora) e `generated` (as células "gerado pelo
    banco", que vêm nulas). `rowNumbers` é o número da grade (de 1 em diante). A célula cortada vem com o que a grade tem e a marca em `truncated`.
- **Quem guarda é `useRecordEdits`**: a seleção é da execução que está na tela (a chave é `id` mais `resultId`: o "carregar mais" a mantém; outra execução,
  o F5, o filtro, a ordem, a atualização automática e a troca de aba de resultado do script a esquecem, com a célula ativa, na mesma renderização, e voltar
  à aba de antes não a traz). `updateSelection(change)` aplica um gesto e já põe o resultado no `latest` (as ações depois de um `await` o leem); `putEdits`
  põe lá também a grade de agora, para a linha nova acrescentada ser achada antes da renderização seguinte. A célula ativa que as ações usam (`active`) é
  `activeCell` da seleção. Abrir, confirmar e cancelar o campo mantêm a seleção.
- **O que a grade recebe** (`GridEditing`): `selection` e `layout` (para desenhar), `onSelection(change)` (cada gesto, pela função pura), `onSelecting(on)`
  (o arraste e a tecla com Shift presa: a contagem só muda quando a seleção para), `status` (a contagem, "3 linhas escolhidas" ou "12 células escolhidas",
  nula com uma célula ou nenhuma; a `ResultPanel` a põe ao lado do resumo, num `role="status"` que fica na página também vazio), `onCopy()` (a seleção),
  `onCopyAdvanced?` (Ctrl+Shift+C, só com a frente do "Copiar avançado"), `onDeleteRows()` (o Delete sozinho, que marca as linhas na hora) e `onRowMenu(row, point)` (o botão direito no
  número da linha). `onActivate(cell)` continua sendo o clique (`select`), e `onMenu` escolhe antes a célula de fora da seleção.
- **A grade** (`result-grid.tsx`): `aria-multiselectable`, `aria-selected` em cada célula desenhada (escolhida, e não só a ativa), o fundo de escolha
  (`bg-selected`, o do item escolhido do navegador; a pendente escolhida, `bg-accent/35`), o número da linha (`data-rowheader`, que o clique e o botão direito
  leem por delegação) e o cabeçalho das colunas da seleção destacados. A linha memorizada recebe as colunas escolhidas como dois números (`selectedFrom`,
  `selectedTo`), e não a seleção: rolar e desenhar custam o mesmo que sem ela. O canto (o "#") é um `columnheader` com um botão "Escolher todas as linhas" fora
  do Tab (`tabIndex={-1}`, sem roubar o foco no `mousedown`). **O arraste** segue o ponteiro na janela (`mousemove`/`mouseup` no `window`, também fora da
  grade) e, passado da borda, rola sozinho a cada 50 ms (`grid-pointer.ts`, puro: `cellAtPoint`, pela caixa, pela rolagem e pelas larguras desenhadas, e
  `edgeScroll`), lendo a cada passo as linhas, as larguras e o zoom da renderização de agora (`geometry`, uma ref): com "buscar mais linhas ao rolar", a
  rolagem sozinha traz a página seguinte no meio do arraste, e a célula sob o ponteiro entra nela; o `mousedown` numa célula ou no número tem `preventDefault` (o texto da página não é escolhido) e devolve o foco à grade. **As teclas**:
  `movementOf` (`grid-cursor.ts`) diz se a tecla é de movimento, se estende e se é vertical; o PageUp e o PageDown andam `pageRows` linhas e, com Ctrl, Alt ou
  Cmd, não são da grade (o Ctrl+Shift+PageUp/PageDown move a aba, RN-ABAS-001); `selectsAll`, `selectsRows` (Shift+Espaço, antes do "começar a digitar"),
  `copiesAdvanced` e `deletesRows` estão em `grid-editing.ts`; o Esc é da grade quando a seleção não é só a célula ativa (`escapeCollapses`, pela forma, e não
  pela contagem: a linha inteira de uma coluna só é uma célula), e com a célula ativa só segue para quem está acima. O cabeçalho e o
  número da linha, presos, são o `scrollPaddingStart` dos dois virtualizadores: o `scrollToIndex` da célula ativa (Ctrl+Home, PageUp, Home) a deixa logo
  depois deles, e não por baixo. Nada disto foi conferido numa janela:
  o vitest não tem DOM, e o arraste, a rolagem sozinha e o foco são para conferir sob Xvfb.
- **O copiar** (RN-GRADE-002; `_lib/grid-copy.ts`, puro: `copyField`, `buildCopyText`, `copyCeiling`, `copiedNotice`, `utf8Length`, `wellFormed`). O texto é
  montado em partes de `copyChunk` células, cedendo a vez à tela (`setTimeout`), com o tamanho em UTF-8 somado no caminho e o limite de `clipboardLimit`
  (10 MiB); passado meio segundo, a faixa diz "Copiando…" com o "Cancelar" (o mesmo `onCancelFetch`, que desiste também da cópia). Com célula cortada, o teto
  sem montar (`copyCeiling`) quase sempre basta; acima do limite, mede o exato antes de buscar nada. A cópia é da foto de quando começou (as linhas, as
  pendências, a seleção), e a atualização automática fica em pausa até o texto ir para a área de transferência (`hold`). "Copiar nome da(s) coluna(s)" e
  "Copiar número de linha(s)" (RN-GRADE-015) são `columnNamesText` (o `sqlName` do autocompletar, por tabulação; por isso `useRecordEdits` recebe `engine`) e
  `rowNumbersOf`. Os textos estão em `_lib/grid-selection.copy.ts`.
- **O menu** (`cellMenu`, RN-GRADE-004) tem os grupos do DBeaver: Copiar (Ctrl+C), Copiar com cabeçalho, o submenu "Copiar avançado" e Colar; Filtrar (F11),
  Ordenar e Ir para o registro referenciado; Editar célula, Definir como nulo e Desfazer alteração; Adicionar, Duplicar e Excluir linha(s); Exportar dados… e
  o submenu "Gerar SQL"; Atualizar (F5) e Atualizar automaticamente. Cada grupo e cada item de fonte aparece só quando quem usa a edição o entrega: `sort`
  (`GridSortSource = { applied, apply }`: nos Registros, `orderRecords`, o caminho do botão de ordenar do cabeçalho; na aba de consulta, o campo de filtro do resultado com `withOrder`; não
  nas abas guardadas do script), `follow` (`GridFollowSource`, os Registros e o resultado da consulta e do script, nas colunas que são chave estrangeira), `copyAs` e `generateSql`.
  "Desfazer alteração" age nas células escolhidas (`undoWhere`, em `record-edits.ts`, que percorre as pendências e não a seleção).
- **O contrato com as outras frentes** (seção 37: o "Copiar avançado…", os nove "Copiar como", a configuração deles e o "Gerar SQL"). `useRecordEdits`
  recebe `copyAs?: CopyAsSource` e `generateSql?: GenerateSqlSource`, os dois `GridMenuSource<A, S> = { access(context): S; choose(action, context) }`:
  - `access` é chamado ao abrir o menu e devolve o estado dos itens: no `copyAs`, `CopyAsAccess = { dialog, formats?: Partial<Record<CopyAsFormat,
    EditAccess>>, configure }`; no `generateSql`, `Partial<Record<GenerateSqlKind, EditAccess>>`. O que não vem vale. Sem a fonte, o submenu "Copiar
    avançado" tem só os nomes e os números, e o "Gerar SQL" não aparece (o item que não existe não aparece).
  - `choose` recebe a ação (`copyAdvanced`, `copyAs:<formato>` e `copyAsConfigure`, com `copyAsFormats` na ordem do print: `csv`, `sourceCode`,
    `dbUnit`, `html`, `json`, `markdown`, `sql`, `txt`, `xml`; e `sql:<item>`, com `generateSqlKinds`: `selectEquals`, `selectIn`, `insert`, `update`, `delete`
    e `create`), já com o menu fechado, e o contexto de agora. O Ctrl+Shift+C chama `copyAs.choose("copyAdvanced", context)` quando o `dialog` vale.
  - `GridSelectionContext` (também em `RecordEdits.selectionContext()`, para os diálogos relerem): `resultId`, `shown` (as linhas na tela), `engine`,
    `subject`, `target` (o alvo da edição que já se sabe), `selection`, `layout`, `rows` e `columns` (as da seleção), `pending` (as pendências como a grade
    as mostra, com as linhas marcadas para exclusão), `busy` (a aba ocupada, ou `"refresh"` com a atualização automática lendo), `slice(scope)`,
    `complete(slice, keepGoing?, signal?)` (o valor completo das cortadas, pela faixa com o "Cancelar"; nulo quando a pessoa cancelou, também pelo `signal` de
    quem pediu, como o "Cancelar a busca" do diálogo; `stopped` quando `keepGoing` mandou parar), `fullValues(cells, signal?)` (o mesmo, pela posição na
    grade, para quem não monta um recorte), `hold()` (a pausa da atualização automática: quem abre um diálogo a segura até fechá-lo, RN-GRADE-014),
    `moved()` (o resultado já não é o da seleção), `copying(controller)` (a faixa "Copiando…" passado meio segundo, com o "Cancelar" dela abortando a cópia;
    devolve quem a tira), `ensureTarget()` (o `edit-target` da edição) e o alvo do "Gerar SQL" e do "Copiar como" (abaixo).
  - **O alvo do "Gerar SQL" e do "Copiar como"** (RN-GRADE-020 e RN-EDIT-010): `sqlTarget(notice?)` é o `edit-target` com `purpose: "sql"`, o MESMO para os
    dois, perguntado uma vez por resultado e uma vez por comando e colunas (`sqlTargetKey`; os 32 mais recentes de cada ficam, um por aba de resultado do script) e na sessão em que o resultado foi lido; `notice` vai à
    faixa enquanto a API responde ("Conferindo a tabela deste resultado…", do "Copiar como"; o diálogo do "Gerar SQL" diz a dele). `knownSqlTarget()` é o que
    já se sabe sem perguntar (habilitar não custa consulta): o alvo da edição, quando ele traz o `kind` e o `keyColumns` (`sqlTargetOf`); o motivo da página,
    quando ela já disse que o resultado inteiro é só leitura (a união, o `DISTINCT`, o filtro embrulhado), como `notEditable`, menos na conexão somente leitura
    agora (`cachedReadOnly`), em que a página de toda leitura diz "a conexão é somente leitura" e o alvo vale ali (RN-PROT-002): quem diz se há outro motivo é a
    API; ou a resposta de antes. O motivo da página só vale enquanto a conexão é somente leitura (`readOnlyReasonNow`, em `grid-action-context.ts`, também
    para a edição): desmarcada depois da leitura, a página é como a sem motivo, e a edição e o "Gerar SQL" perguntam à API; marcada depois, nada muda na
    página, e a API recusa. O texto do motivo só se compara com o valor fixo que a rota escreve (`connectionReadOnlyReason`, o `ReadOnlySql.ResultReason`
    da API), porque a página não diz a proteção de outro jeito; quem decide é a proteção de agora. A
    resposta guarda o alvo ou a recusa de que o resultado não se edita; a falha não, e a seguinte pergunta de novo. **O alvo do "Gerar SQL" nunca volta à
    edição**: o da conexão somente leitura vem todo só leitura e não serve ao Salvar, e a edição pergunta o dela (o contrário vale: o da edição serve aqui).
  - **A ligação** (seção 37): as fontes são `useCopyAs` (`_lib/copy-as/use-copy-as.ts`, ver "Copiar como e Copiar avançado") e `useGridGenerateSql`
    (`_lib/generate-sql/use-grid-generate-sql.ts`, ver "Gerar SQL"), montadas em `records-view.tsx` (com a tabela da aba como origem) e em `query-tab.tsx` (no
    resultado do último comando e em cada aba guardada do script, que usam a mesma edição); os diálogos entram por `resultEditDialogs(edits, actions)`
    (`GridActionDialogs`). O usuário do cofre, o somente leitura da conexão e o tipo da tabela dos Registros são lidos do cache na hora da escolha
    (`grid-action-context.ts`: `cachedUserName`, `cachedReadOnly`, `cachedObjectKind`), sem disparar consulta, e o "Abrir numa aba de consulta" chega da
    área de trabalho por `onOpenQuery` (`workbench-tabs.tsx` → `TableTabPanel` → `RecordsView`, e → `QueryTabPanel`), estável como o `onOpenTable`.

## A coluna inteira escolhida pelo cabeçalho (seção 38: RN-GRADE-021 a 023)

A seção 38 da especificação manda; o que segue diz onde ficam as peças e **o contrato que a edição de várias células (RN-EDIT-017 a 022) usa**. Vale nas duas
grades, como a seção 37. A edição de várias células e o Salvar da coluna inteira estão na seção seguinte, "Editar várias células e a coluna inteira".

- **O cabeçalho** (RN-GRADE-021; `GridHeaderCell`, em `result-grid.tsx`): o nome é um `<button data-colheader={coluna} tabIndex={-1}>` (fora do Tab, com o
  nome como rótulo e "Escolher a coluna inteira" no `aria-describedby`; a dica diz o Ctrl ou o Cmd, `chooseColumnHint(mac)`) e, quando a edição entrega a
  ordem, o botão de ordenar (`data-sort`, 24 px, `aria-disabled` com o motivo na dica, "Indisponível: …") num espaço **sempre reservado** (`w-6 flex-none`,
  antes da área da divisa): sem ordem ele só aparece com o mouse sobre o cabeçalho (`invisible group-hover/header:visible`), com ordem fica a seta da
  direção (`ArrowUpIcon`/`ArrowDownIcon`; a de duas pontas, `ArrowsUpDownIcon`, é a sem ordem). Os dois têm `preventDefault` no `mousedown` (o foco fica na
  grade, o texto não é escolhido), lido por delegação no `mousedown` do corpo da grade, como o número da linha, com qualquer botão do mouse (o direito
  também: senão o nome tomaria o foco, e o menu o devolveria a ele ao fechar); o clique do leitor de tela (`detail` 0) chega pelo `onClick` do nome. O gesto
  no nome não rola a grade na vertical até a linha da ativa (`heldRow`, `followsActiveRow`): só a coluna vem à vista, e o teclado, o clique numa célula ou
  no número e o campo que abre voltam a rolar até ela. O `columnheader` tem `aria-sort` quando a grade ordena e `aria-selected` quando a coluna está escolhida inteira. A divisa, o
  duplo clique que ajusta e as larguras de saída não mudaram: a largura é contada com o espaço do botão (`sortArrowWidth`, 16 px em `grid-columns.ts`: os
  24 do botão e os 4 até a divisa, menos o respiro da direita que o nome deixa de ter), e quem cede é o tipo, como antes.
- **Quem ordena** é a edição: `GridEditing.sort?: HeaderSort = { applied, reason, onSort(coluna) }` (em `grid-editing.ts`), montado em `useRecordEdits` só
  quando quem a usa entrega `sort` (`GridSortSource = { applied(), apply(sort) }`: nos Registros, `applied` é a ordem em vigor e `apply` o caminho do
  "Ordenar" do menu; na aba de consulta, a ordem escrita no campo de filtro do resultado; nas abas guardadas do script não há, e o botão não aparece).
  `onSort` é `nextSort(applied(), coluna)` (crescente, decrescente, sem ordem) pelo mesmo `apply` do menu, com a pergunta das alterações não salvas.
  O motivo é `sortReasonFor` (o mesmo do item "Ordenar" do menu, que agora também o mostra desabilitado com "Indisponível: …"): a aba ocupada, salvando, a
  atualização automática lendo, sem resultado; na aba de consulta, também o comando que não é uma leitura (`read` falso). A `ResultGrid` não recebe mais
  `sort`/`onSort`, nem a `ResultPanel` (o `RecordsMode` perdeu os dois).
- **A forma nova** (RN-GRADE-022; `_lib/grid-selection.ts`): `{ kind: "columns", columns: number[] }`, as posições das colunas escolhidas em ordem, **sem
  linhas guardadas**: as linhas são todas as da grade na hora da pergunta (`allRowsOf`/`rowSetOfSelection(selection, layout)`), então as que o "carregar
  mais" traz entram sozinhas e a linha nova também. Os gestos: `selectColumn` (o clique no nome), `extendColumns` (Shift+clique, da âncora), `toggleColumn`
  (Ctrl/Cmd+clique; a última que sai deixa a célula ativa), `dragColumns(base, início, coluna, layout, juntando)` (o arraste nos nomes, `startDrag` com o
  modo `columns`), `wholeColumns` (Ctrl+Espaço, `selectsColumns` em `grid-editing.ts`: as colunas da seleção de agora), `contextColumn` (o botão direito no
  nome: fora das escolhidas escolhe a coluna; o menu abre sobre a célula ativa, que vai para ela, por `editing.onColumnMenu(coluna, ponto)`), e o Shift com as
  setas horizontais pelo `extendByKey` (as verticais só movem a ativa). `wholeRows` com colunas escolhe a linha da ativa; `contextRow` deixa as colunas
  (toda linha tem uma célula escolhida, RN-GRADE-001); `afterSave` as mantém; `afterRowsRemoved(selection, layout)` acerta a ativa quando o Descartar tira linhas novas. As perguntas: `chosenWholeColumns`
  (nulo com outra forma), `choseWholeColumns`, `wholeColumnSet` e `headerChosen` (o desenho), e `selectionSize` traz `columns`. `rowSpan` e `columnSpan`
  são nulos com colunas (a grade desenha pela `wholeColumns` da `GridRow`, um `Set` estável por seleção); `selectedRows` são todas as da grade agora.
- **A contagem e a pausa**: `wholeColumnsStatus` ("Coluna preco: todas as linhas", "Colunas a, b: as 1.200 linhas", "… as 200 carregadas", com o total
  quando se sabe); a forma conta como várias células (`hasSeveralCells`), e a atualização automática fica em pausa (RN-GRADE-014). A seleção vive o mesmo que
  as outras formas: o "carregar mais" a mantém, outra execução a esquece.
- **As ações** (`openMenu`, `barOf`): "Duplicar linha(s)" e "Excluir linha(s)" (menu, barra e atalhos) vêm desabilitados com "Escolha as linhas pelo número
  da linha." (depois dos motivos de só leitura e ocupado); "Copiar número de linha(s)" e o copiar carregam antes; o "Desfazer alteração" desfaz as pendências
  das colunas escolhidas (as linhas excluídas não, porque nenhuma linha está inteira); o "Exportar dados…" abre o assistente com só as colunas escolhidas
  marcadas (`chosenColumns()` do retorno → `checkedColumns` de `recordsSource`/`resultSource`, `initialChecked` em `export-source.ts`, e a frase
  `fromGrid` no passo da extração), que exporta todas as linhas como sempre.
- **Carregar as linhas que faltam** (RN-GRADE-023): `GridSelectionContext.loadRest(options?)` (com `wholeColumns`, `rowsToLoad` e `total` no contexto) pede
  as páginas seguintes pelo `runner.loadMore` (que agora devolve `LoadMoreOutcome`: `loaded`, `end`, `busy`, `closed`, `failed` com a mensagem do banco,
  `gone`) até o fim, e devolve `LoadRestOutcome` (`ready` com o contexto novo, `stopped`, `refused` com a frase e o `detail` do banco, `cancelled`). Recusa
  na hora com o cursor fechado ou a aba guardada do script, a aba ocupada, a atualização automática lendo e passadas `loadRestLimit` (100.000) linhas. Sem
  `onProgress`, a faixa sobre a grade mostra "Carregando as linhas que faltam…" com o "Cancelar" (`EditsBanner.loading`, o mesmo `onCancelFetch`) e diz as
  recusas; o cancelar para depois da página em andamento (o cursor não é cancelado). Quem usa: o copiar (`copySelection`, com `loadedRowsMeter` de
  `grid-copy.ts` como `keepGoing`: passado o limite de 10 MiB pela medida baixa, `cellsFloor`, para antes de ler o resto), "Copiar número de linha(s)",
  `useCopyAs` (o direto carrega com a faixa; o diálogo do "Copiar avançado" mostra o tamanho com as linhas que faltam, `whole`, e o andamento com o
  "Cancelar" dele, nos escopos das células e das linhas) e o "Gerar SQL" (`SqlFlowDeps.loadRows`, fase `loading`, medindo o SQL de cada página contra o 1 MB).
- **O contrato com a edição de várias células** (RN-EDIT-017 a 022, outra frente):
  - "Que células desta coluna estão escolhidas?" é `columnChoice(selection, layout, coluna)` (ou `activeColumnChoice(selection, layout)`, a da coluna da
    célula ativa, nula com a ativa fora da seleção): `ColumnChoice = { column, rows, allRows }`, com `rows` as posições na grade agora (as lidas carregadas
    e as novas, em ordem) e `allRows` verdadeiro quando a escolha é a coluna inteira, que vale também para as linhas que o cursor ainda não leu.
  - "A escolha cobre linhas não carregadas?" é `allRows` com `context.rowsToLoad` (ou `shown.hasMore`); `context.total` diz quantas, quando se sabe.
  - "Todas as linhas do resultado nesta coluna" é `context.loadRest()` (as linhas na grade, com a recusa já pronta) ou, para o Salvar que vale no banco
    sem as trazer, `allRows` com `context.wholeColumns`: o comando é da outra frente.
  - Os pontos de entrada da edição são os de hoje em `use-record-edits.ts`: `openEditor(cell)` (o "Editar célula", o F2, o duplo clique, o começar a digitar
    e o botão "edit" da barra, `bar.onAction`), `commit(move?)` (o Enter e o Tab do campo), `applyValue(cell, valor)` (o confirmar e o "Colar", que continua
    com uma célula só: `several`) e `undoSelection`. O teste das colunas inteiras é `use-record-edits.columns.test.ts`.

## Editar várias células e a coluna inteira (seção 38: RN-EDIT-017 a 022)

A seção 38 da especificação manda (as regras, as frases e o contrato da API); o que segue diz onde ficam as peças. Vale nas duas grades e nas abas guardadas
do script. As decisões são puras, com teste: `_lib/multi-edit.ts` (para quem a edição vale, a conferência das linhas, o leitor do limite e do sorteio, o
literal da faixa), `_lib/record-edits.ts` (o grupo, a coluna inteira e o pedido do Salvar), `_lib/whole-column-question.ts` (a pergunta) e os textos em
`_lib/multi-edit.copy.ts`; quem liga é `use-record-edits.ts`.

- **Para quem a edição vale** (`editScopeOf(selection, layout)`, sobre o `activeColumnChoice` da seção anterior): `one` (sem outras escolhidas na coluna da
  ativa, ou com a ativa fora da seleção; o duplo clique escolhe antes, e por isso edita só a célula), `cells` (as posições escolhidas da coluna da ativa: num
  retângulo de várias colunas, só a dela) ou `all` (a coluna escolhida inteira). O F2, o Enter, o começar a digitar, o "Editar célula" do menu e da barra e o
  "Definir como nulo" passam por `whenScopeEditable`; o "Colar" continua com uma célula só. Com o escopo de uma célula, é o `whenEditable` de sempre.
- **A conferência antes de abrir** (RN-EDIT-017): primeiro o que vale para a ativa SEM a linha dela (`accessOf(cell, alvo, null)`: o resultado, a aba ocupada,
  a tabela e a coluna, os de todas); depois, com o alvo, `groupRefusal` sobre as linhas escolhidas (a primeira que não pode, na ordem da grade, com o número:
  "linha 7", ou "linha nova 2" na linha nova já salva, pelo `sourceRows` nulo; a ordem é a de `rowProblem`, em `cell-editing.ts`, a mesma do `cellAccess`), e o
  teto de 100.000 células (`groupLimit`). Com a coluna inteira, no lugar das linhas, `wholeColumnBlocker` (a junção ou o `rowOperations` falso, a coluna da
  chave, a chave com o nome repetido, o `read` falso da página, o limite sem `ORDER BY` e o `TABLESAMPLE`, pelo `commandLimits`, um leitor do texto como o
  `WholeColumnSql.Read` da API, sobre o `sqlTokens`; o `ORDER BY` do filtro do resultado conta como a ordem de fora), em "Indisponível: …". A recusa vai à
  faixa no tom de atenção, e nada muda.
- **O campo** guarda o escopo (`OpenScope`, as linhas do grupo pela identidade, `RowRef`: o "Carregar mais" no meio não as troca), `touched` (o `onDraft`
  marca; começar a digitar já é mexer) e a dica (`CellEditorState.hint`, que o `CellEditor` desenha logo abaixo do campo, acima quando passaria do fim da
  grade, medido num efeito de layout, e liga por `aria-describedby`; a linha com o campo aberto fica por cima das outras, `z-[15]`, abaixo do cabeçalho
  preso). **Confirmar sem ter mexido não aplica nada** (também com uma célula só: antes, abrir uma célula nula e confirmar gravava o texto vazio); com várias,
  a faixa diz por quê (`untouched`). Mexido, `applyScope`.
- **O grupo** (`groupBuilder(edits, coluna, valor)`): as pendências viram um mapa uma vez, cada célula lida é uma pendência comum (numa junção, pela `change`,
  uma por linha da tabela), a que volta ao valor de referência (`referenceOf`: o lido, ou o da coluna inteira) perde a pendência, e as linhas novas recebem o
  valor; `done()` troca tudo num passo. Até `groupChunk` (5.000) células, na mesma chamada; acima, em partes com `setTimeout`, com "Aplicando o valor a N
  células…" e o "Cancelar" na faixa (`banner.building`, `onCancelBuild`), e as outras ações de edição esperam (`latest.building`: o `accessOf`, as de linha,
  o "Desfazer", o "Ver SQL", e os quatro botões da barra, pelo `barOf`; o "Salvar" da faixa e o Ctrl+S, pelo `saveByPerson`, que diz "Aplicando o valor às
  células escolhidas." e deixa o grupo continuar). O `guard` (RN-EDIT-007), a troca de resultado (o `scope`), o desmonte, o Descartar e o `saveNow` de
  quem não é a pessoa (o fechar da aba) cancelam a montagem antes. O `undoWhere` passou a uma passada só pelas chaves, como o grupo (o grupo de 100.000
  células desfeito de uma vez).
- **A coluna inteira** (RN-EDIT-018) é `PendingEdits.columns` (`ColumnEdit = { column, value, uncertain? }`, opcional no tipo: `columnEditsOf`), uma por
  coluna, a última vale no lugar dela (`editWholeColumn`, que tira as pendências daquela coluna nas linhas lidas e põe o valor nas linhas novas que já
  existem; a criada depois não o recebe). Conta como uma alteração (`pendingCount`). A grade a desenha pelo `GridEditing.columnPending` (um mapa por
  coluna, o mesmo enquanto as pendências não mudam, `columnPendingOf`): o `GridRow` mostra, na linha lida que não está marcada para exclusão, o valor novo com
  o lido riscado, e a célula com pendência própria com o da coluna inteira riscado; o cabeçalho ganha o ponto (`pendingHint`, com a dica e o nome para o
  leitor de tela). O que a grade mostra a vê: `valueAt` e `valuesOf` (o copiar, o "Copiar como", o duplicar) e o `sqlSelectionOf` do "Gerar SQL". A faixa tem a
  linha `allRowsLine` ("Em todas as linhas do resultado: preco = 10.00.", o literal do banco cortado em 60), e, no banco sem log, a frase a mais. O "Desfazer
  alteração" com a coluna escolhida inteira é `undoWholeColumns`, com a conta no rótulo (`cellsPendingIn`); com só algumas células escolhidas que só têm ela,
  fica desabilitado com o motivo (`undoPlan`, que o menu e a ação usam).
- **O Salvar com a coluna inteira** (`saveWholeColumn`, RN-EDIT-019 a 021): a grade fica tomada (`saving`) da contagem à resposta, com a atualização
  automática em pausa (`hold`), e `phase` diz à faixa em que parte está (`counting`: "Contando as linhas do resultado…"; `asking`: os botões esperam;
  `saving`: "Salvando…", com o tempo depois de 2 s, `savingLabel`, e o "Cancelar", que manda `queries/cancel` pela sessão do resultado, `cancelSave`; o
  "Salvando…" com o "Cancelar" vale para todo Salvar). Os passos: o alvo; o teto de 32 MiB do corpo (`bodyTooLarge`, que o preview e o Salvar sem coluna
  inteira também conferem); `countWholeColumnOrRefuse` com só a `updateAll` (sem `rows`); o cursor fecha (`closeCursor`, pelo `runner.keepSaved` com as
  mesmas linhas, também na falha e na pergunta cancelada, menos na recusa que a API dá antes de qualquer comando na sessão, `countReachedTheSession`: a
  alteração inválida, só leitura, a sessão ocupada); a contagem cancelada (`outcome`) volta calada, como o "Cancelar" que chega depois de ela responder
  (`cancelAsked`, conferido depois da contagem e depois do preview), e a recusada diz "Não foi possível contar…" com a mensagem do banco;
  `previewEditsOrRefuse`; a pergunta (`wholeColumnQuestion`, entregue por `confirmWholeColumn`, que as vistas montam com o `always` de
  `useCommandConfirmation`: pergunta também sem proteção, com o ambiente, e a frase da proteção quando há; o `confirmSave` da proteção não pergunta à parte);
  e `saveEditsOrRefuse` com a `updateAll` primeiro e o `rows` contado (`changesOf(…, rows)`). A pergunta compara a contagem com o total só com o
  resultado lido até o fim (`total` nulo com linhas a ler, também depois do "Contar total"); senão, só com as linhas lidas. O "Ver SQL" com a pergunta aberta
  mostra os comandos que ela já tem (`askedPreview`), com a nota embaixo de cada um (`EditSqlDialog`). O `saveNow` devolve `SaveOutcome` (`saved`, `failed`,
  `cancelled`): o "Salvar" do "Há N alterações não salvas" cancelado fecha o aviso sem seguir com a ação; o `save` de antes continua devolvendo se gravou tudo.
- **As recusas** (`failureOf(erro, plano, semLog, nomes)`): o cancelamento pelo `outcome` (RN-SQL-010), nunca pelo texto (`canceled`, com as já gravadas sem
  log; `unknown`); a da coluna inteira com os nomes dela (a recusa do banco, a conversão, o `EDIT_ALL_ROWS_NOT_SUPPORTED` pelo `reason`); e, no Informix sem
  log, `whole: "written"` (o `EDIT_ROW_MISMATCH` dela com `applied` 1, ou uma alteração por linha que falhou depois dela) e `whole: "uncertain"` (a falha no
  meio, `outcome: unknown`; o `SQL_EXECUTION_FAILED` sem `outcome` é a recusa de antes do `UPDATE`, a contagem ou a leitura das chaves no Salvar, e diz
  "falhou. Nada foi gravado."). O `refuseSave` tira o gravado das pendências (`withoutApplied`, com a origem `all`), marca a coluna `uncertain` (a nota na
  dica da célula e do cabeçalho), e chama `onSaved` com `partial` e a grade com o gravado (`withColumnsWritten`: a coluna e, por cima, as células das
  alterações por linha gravadas depois dela, sem tirar nem pôr linhas).
- **Depois do Salvar** (RN-EDIT-022): o aviso "Coluna preco atualizada em 1.234 linhas." (`multi.saved`, com as outras pelo `applied` menos um) e `onSaved` com
  `whole` e `kept`. Os Registros leem de novo como sempre (`reread`), e com `partial` só guardam a grade (`runner.keepSaved`). A aba de consulta guarda a grade
  e, no resultado do último comando, chama `runner.rerun()` (o F5, com o filtro e o `keep`, sem a pergunta da proteção: a da coluna inteira já disse);
  na aba guardada do script, não lê de novo, e a nota dela ganha a frase (`keptNotes`, `KeptResultNote.note`). Com `reread` falso (o "Salvar" do aviso das
  alterações não salvas), não lê: a ação que segue executa ou sai; a troca de aba de resultado do script não executa nada, e pede o
  `guard(escolher, true)`, cujo "Salvar" lê de novo (`rereads`).
- **A API** (as rotas e os códigos são os da seção 6): `POST …/queries/edits/count` `{ resultID, changes: [updateAll] }` → `{ rows }` (o `transaction` é
  tolerado); `changes` ganhou `{ kind: "updateAll", table: 0, set, rows? }` (`ApiChange`); o preview lê o `note` de cada comando (o que não é texto vira nulo);
  as recusas do Salvar, do preview e da contagem ganharam `EDIT_ALL_ROWS_NOT_SUPPORTED`, e a da contagem também `TRANSACTION_FAILED`; o `editErrorDetails`
  lê o `outcome`. O endereço é `prismEndpoints.userDatabaseSessionQueriesEditsCount`.
- **O que não foi feito**: o Commit manual (a tela não o tem: a frase das travas e o "sem commit" do aviso ficam para quando ele entrar); conferir na tela (o
  vitest não tem DOM: a dica do campo, o ponto do cabeçalho e a pergunta foram vistos só nos testes); o teste dos Registros com o `partial` (a ligação é uma
  linha, e o gancho tem o teste dele, `use-record-edits.multi.test.ts`).

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
  **O tema do campo nunca usa `&` sozinho** (`fieldThemeSpec`, com teste): o recipiente que o CodeMirror cria no `body` para a lista leva as classes de tema
  do editor, e o `"&": { height: "28px" }` de antes fazia dele um bloco de 28 px no fim do `body`, um por campo montado. O documento passava da janela e a
  área de trabalho rolava como página (a roda do mouse na barra de status, no editor curto ou no fim da grade). A caixa do campo é a de `&.cm-editor`.
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
  limpa o filtro (`clearResultFilter`, só quando o comando vai de fato ser enviado). **O filtro é do executor da aba**: trocar o banco (RN-ARVORE-007) ou a
  conexão (RN-ARVORE-008), e o bloqueio por inatividade, dão à aba um executor novo, sem resultado, e o painel limpa o filtro ao ver o executor trocado
  (ajuste durante a renderização, `filterRunner`). Até a 0.3.0 o campo ficava à vista depois da troca do banco com o comando fixado (`pinned`) do resultado
  anterior, e "Aplicar" o executava, com o filtro, no banco novo. No resultado, o botão de ordenar do cabeçalho e o "Ordenar" do
  menu escrevem a ordem no campo (`withOrder`), e valem só quando o comando é uma leitura.
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

## Contar de novo e atualizar automaticamente (RN-SQL-006 e RN-GRADE-014)

Seção 29 da especificação (issues #10 e #11), com as correções da revisão de 2026-10-15. Vale nas duas grades, os Registros e o resultado da aba de
consulta: a área é a mesma (`ResultPanel`) e o menu da célula também (`useRecordEdits`).

- **Contar de novo.** O executor não recusa mais a contagem com o total na tela (conta de novo também com as linhas todas carregadas), e a contagem que
  falha ou é cancelada deixa o total de antes (`patchRows` sem `total`). Na barra, "Contar total" e "Contar de novo" são **UM botão** (`CountButton`, em
  `result-panel.tsx`), sempre depois do total, no mesmo lugar dos filhos com ou sem ele: clicado, ele continua na página e com o foco. Antes ele virava o
  `<span>` do total, o foco caía no `body`, fora da aba, e o F5 da aba parava de valer. Ocupado (contando, carregando mais) ele usa `aria-disabled`, e não
  `disabled`: o botão desabilitado perde o foco. Enquanto conta de novo, o total de antes fica, em `text-muted`, com "contando de novo…". Enquanto outro
  comando da pessoa roda sobre as linhas na tela, o resumo, o total e o botão **ficam** (o botão ocupado pelo `busy` da área), com "Executando…" depois:
  antes eles davam lugar a "Executando…", e o F5 seguinte achava o foco no `body`. Quando o botão sai da página com o foco (o resultado novo cabe numa
  página), a limpeza da ref dele (React 19) avisa `onFocusLost`, e a área leva o foco para a grade ou, sem ela, para a própria `<section>` (`tabIndex={-1}`,
  num `useLayoutEffect`). O `result-panel.count.test.ts` confere o tipo e a posição do botão nos estados (é o que o React compara para reaproveitar o
  elemento) e o foco que volta; a runtime de ganchos (`lib/testing/react-hooks.ts`) trata `useLayoutEffect` como `useEffect`.
- **O relógio é do executor** (`runner.autoRefresh`, montado por `createAutoRefresh` em `_lib/auto-refresh.ts`, sem React, com os temporizadores e o relógio
  injetáveis e com teste de temporizadores falsos). Por ser do executor, ele sobrevive a trocar de aba, de vista e de tela, e o que tira o executor de cena
  o desliga sem mais nada: `release()` (desconectar) e `retire()` (fechar a aba, trocar de banco ou de conexão, ir para outra janela, o bloqueio, sair do cofre) chamam
  `halt()`. Ele **observa** o executor (`subscribe`), e não o contrário: o fim de qualquer ocupação da aba (a execução automática, o F5, "Carregar mais",
  "Contar total") recomeça o tempo, e o fim de uma EXECUÇÃO diz se ela trouxe um resultado de leitura novo (`outcomeOf`: o mesmo objeto de linhas de volta é
  "não rodou"; erro, cancelado, gravou). Sem leitura nova, ele para com o motivo (`stopped`), que a barra mostra numa nota curta até a próxima execução da
  pessoa (`ranByPerson`) ou até ligar de novo. A próxima execução só é marcada quando a anterior termina: nunca duas ao mesmo tempo.
- **Os intervalos** (`autoRefreshChoices`): 1 s (o primeiro, seção 39), 5 s, 10 s, 30 s, 1 min e 5 min; o "Personalizado…" aceita de 1 a 3.600 segundos
  (`customSecondsLimits`). Com um comando que demora mais que o intervalo, o real é maior (conta do fim), e o controle continua dizendo o escolhido. O
  `running` do estado ligado (o "atualizando…" e o relógio pulsando) só acende depois de `runningShownAfterMs` (300 ms) de execução, num temporizador do
  próprio relógio que o fim, o abandono (`yielded`) e o desligar apagam: no de 1 s a leitura costuma voltar antes, e o controle não pisca a cada segundo.
  Quem decide se ela roda continua sendo o `firing`, que nasce na hora.
- **A sessão que cai** (`DATABASE_SESSION_NOT_FOUND` no "Carregar mais", no "Contar total" ou na própria execução automática) a desliga com a nota "a sessão
  com o banco caiu" (`stopped: "disconnected"`): quem chama `lost()` é `sessionLost()`, só onde a sessão FICA caída, e não `setSession(null)`. A execução
  automática não reabre a sessão (`execute(…, reopen: false)`: a recusa volta calada, e as linhas de antes ficam), e o relógio confere `connected()` antes de
  executar. O comando da pessoa continua reabrindo uma vez: o mesmo comando (o F5) que reabre e executa a mantém ligada, e a sessão que não reabre a desliga
  com a nota.
- **Só liga sobre uma leitura** (`autoRefreshBlocker`): o motivo sai do resultado que está na tela, sem ler o SQL de novo: `totalRows` (o comando que gravou e
  devolveu linhas, RN-SQL-013, que no PostgreSQL é o banco quem decide pela transação só de leitura) e as linhas afetadas são "grava"; sem linhas, a aba
  ocupada e a aba sem sessão (nada reconecta sozinho, RN-SESSAO-004) também recusam. Ligada, nada a impede de trocar o intervalo ou desligar.
- **O comando da pessoa**: `run` avisa o relógio antes de enviar (`ranByPerson`, só depois das recusas da tela: dois comandos na seleção não a desligam).
  Outro comando (`sameCommand`: outro texto ou outro filtro do resultado) a desliga, sem nota; o mesmo (F5, "Atualizar", "Executar de novo", o "Atualizar"
  dos Registros depois do Salvar) a mantém. `runWith(target, kind)` tem três tipos: `person` (`run`: o editor, os Registros, o filtro do resultado),
  `again` (`rerun`, o F5: o comando das linhas na tela) e `auto` (o estado `running` leva `auto: true`). Só `person` zera `editedSinceRun`: o F5 e a
  execução automática repetem o comando com o lugar no texto de quando ele foi enviado, e o erro deles não marca o texto que a pessoa já mudou.
- **A execução automática não toma a aba da pessoa.** Há dois "ocupados": `isBusyState` (tudo, inclusive ela: o relógio e o executor, que mandam um comando
  por vez na sessão) e `isPersonBusy` (sem ela: a tela e o bloqueio por inatividade). Tudo o que a pessoa vê e aciona usa `isPersonBusy`: a barra do editor
  ("Executar" não vira "Cancelar"), o seletor de banco e `switchDatabase`, o botão da conexão e `switchConnection`, o rodapé dos Registros ("Atualizar" e "Exportar CSV"), o campo de filtro, a ordem
  pelo cabeçalho, o F5 das duas abas, os planos dos Registros (`table-view.ts`; o `isBusy` de `result-paging.ts` saiu) e `applyResultFilter`. O que a
  pessoa pede enquanto ela roda é atendido: o comando da pessoa (`run`, `rerun`) **a abandona** (`abandonAuto`: `epoch++`, então a resposta dela não muda a
  tela nem avisa; `yielded()` no relógio, que não conta o desfecho dela; e o cancelamento à API, calado), mostra o comando da pessoa rodando desde já (o
  resultado de antes com `cursorClosed`, porque o banco executou a automática) e só o envia quando a resposta dela e a do cancelamento chegaram
  (`autoBusy`), para o cancelamento não o alcançar; Cancelar nesse meio-tempo não envia nada. **Desligar** (o X, "Desligar") com ela rodando também a
  abandona (`stopAuto`, o `stop` que o executor entrega): o resultado de antes volta na hora, com `cursorClosed`, e o próximo comando, da pessoa ou da
  atualização ligada de novo, espera `autoBusy`; antes ela seguia sem nada na tela dizer, e o resultado ou o erro chegavam depois de desligada.
  "Carregar mais", "Contar total" e "Exportar CSV" esperam por
  ela (`afterAuto`, `autoRunSettled`) e seguem sobre o resultado novo (o de antes já não está na API); o executor aposentado durante a espera (a troca do
  banco ou da conexão, que a desliga) faz o "Carregar mais" e o "Contar total" desistirem calados (`retiredWhileWaiting`), sem o registro do `refuse`, que
  fica para o pedido que chega a um executor já aposentado. A edição da célula não começa: `cellAccess` recebe
  `busy: "refresh"`, com o motivo "a atualização automática está lendo as linhas de novo" na faixa, e o alvo não é perguntado à API por um resultado que vai
  mudar; o resto do menu ("Atualizar", "Filtrar") segue `isPersonBusy`. A aba que vai para outra janela passa por `handOffTab` (`_lib/tab-handoff.ts`):
  a pausa `moving` desde o começo, a espera da execução em andamento, e a pausa tirada no fim (a aba que foi é solta, e isso a desliga). **Depois da espera
  vale a lista de abas DE AGORA**: `sendTab` relê a aba de `latestTabs` (o título, o banco e o script podem ter mudado; a que fechou não vai, sem aviso), e
  `detachTab` a tira da lista de agora (`setTabs` funcional, a vizinha escolhida pela lista da última renderização): com a lista da renderização em que a
  pessoa pediu, a aba aberta durante a espera sumia (e a sessão dela ficava aberta) e a fechada voltava sem executor (`workbench-state.detach.test.ts` e
  `workbench-tabs.move.test.ts`).
- **O que a execução automática não faz**: não esmaece a grade nem diz "Executando…" (o `running` do `ResultPanel` exclui `auto`); não repete o aviso de
  valores cortados (`truncationWarned` só é zerado pelo comando da pessoa: o "Carregar mais" depois dela também não avisa de novo o resultado que já avisou);
  com as mesmas colunas, fica com o `id` de antes (a chave da grade: a grade não é refeita, e a rolagem fica); ligada, a grade não busca a página seguinte
  sozinha (`autoLoadMore` desligado pela aba enquanto o relógio está ligado: a rolagem que ficou no fim pediria a seguinte a cada intervalo); e **não segura
  o bloqueio por inatividade** (`isPersonBusy`, que `anyRunnerBusy` usa): sem isso, uma consulta a cada 5 s recomeçaria a contagem do bloqueio a cada
  execução, porque o tempo conta do fim do último comando. O que conta como atividade continua sendo só tecla, ponteiro e roda de verdade (`watchActivity`).
- **As pausas** (`pause("hidden" | "editing" | "moving", on)`): `useAutoRefresh` (`_lib/use-auto-refresh.ts`) põe a de fora de vista com a aba escondida e com a vista
  desmontada (a aba de consulta lê `useWorkbenchOnScreen` ela mesma, para não mexer em `workbench-tabs.tsx`; a de tabela recebe `visible`); `useRecordEdits`
  põe a da edição com alteração não salva, célula aberta, menu da célula, "Filtrar por valor…" ou o campo do "Personalizado" abertos, mais de uma célula
  escolhida (RN-GRADE-001) e a cópia em andamento (RN-GRADE-002); `handOffTab` põe a da
  ida para outra janela. Ao sair da pausa, executa na hora se o prazo passou. **A pausa da edição vale desde o começo da ação**: o duplo clique, o menu, a
  linha nova, "Duplicar linha" (também durante a busca dos valores completos), "Excluir linha" e o "Colar" (com a leitura da área de transferência), pelo
  menu, pela barra de edição ou pelo atalho (seção 33), perguntam o alvo à API (`ensureTarget`) antes de agir, e a execução que
  saísse nesse meio-tempo trocava as linhas e a ação caía em OUTRA linha do banco. `hold()` põe a pausa na hora e a solta por um estado (`released`), numa
  renderização em que o campo ou o menu já contam, sem um instante livre; depois da pergunta, `moved(from)` (a última renderização e o executor lido na
  hora) descarta a ação se o resultado mudou; `ensureTarget` não põe o alvo de um resultado que saiu no `latest`; e o menu é do resultado em que abriu
  (`menuState.resultId`, como o campo): a execução que já rodava quando ele abriu e troca as linhas o fecha, e a escolha sobre a célula não age. A pausa da
  edição sai do executor de antes num efeito próprio, ao desmontar a vista ou trocar o executor. O `records-view.test.ts` tem a pergunta do alvo presa
  (`slowTarget`) e o resultado trocado no meio.
- **A tela**: o submenu é `autoRefreshMenuItem` (`_lib/auto-refresh-menu.ts`, com os intervalos em `autoRefreshGroups`, os mesmos do menu da barra), logo
  depois do "Atualizar" (F5) em `cellMenu`. O intervalo em uso vem marcado: o `ContextMenu` ganhou `checked` (`menuitemradio` com `aria-checked` e a marca no
  lugar do ícone; as setas e o foco acham os dois papéis pelo `itemSelector`, por `firstItemOf` e `moveFocus`, exportados para o teste sem DOM). O controle é `AutoRefreshControl` (`_components/auto-refresh-control.tsx`),
  ao lado de "Atualizar": nos Registros, no rodapé, logo depois do botão (o menu abre para cima, `opensUp`); na aba de consulta, que não tem o botão, na
  barra, antes do zoom (fica também com a área recolhida). O botão do relógio (`TimerIcon`) está **sempre** lá: desabilitado por `aria-disabled` com o
  motivo no nome e na dica (depois de um DDL ou de um UPDATE, "o comando grava no banco"; sem resultado, "não há linhas"), ou, ligada, "Atualiza a cada 10 s
  · última às 14:32:05" (`onText`) com o X. **O botão do relógio é o mesmo elemento ligada ou não** (`data-auto-refresh-opener`): escolher um intervalo devolve o foco a ele, e o X,
  que sai da página, passa o foco a ele: pelo clique e, quando ela para sozinha com o foco no X (o erro depois de um F5 dado no X), pela limpeza da ref
  (`keepFocusInBar`, no módulo para ser estável, o mesmo cuidado do `CountButton`). Nada ali é região viva. O "Personalizado…" é `AutoRefreshDialog` (só desenha; quem confere o texto é
  `customInterval`, pelo `submitCustom` do gancho). Os textos estão em `_lib/auto-refresh.copy.ts`.
- **O que não foi feito**: a marca na faixa de abas da aba com a atualização ligada (fica para depois na seção 29), e ela não viaja com a aba para outra
  janela (o executor de lá nasce com ela desligada).
- **Conferido na tela** (Xvfb, `pnpm dev` com a API desta árvore, PostgreSQL 16 local num cluster próprio na porta 55431): `select * from loja.fila` com 500
  linhas; "Contar total" deu 500 e o foco ficou no botão, agora "Contar de novo"; 12 linhas inseridas pelo `psql` e o clique (no mesmo elemento) deram 512.
  Na barra, o relógio abriu o menu com os seis `menuitemradio`; "A cada 5 s" ligou, o foco voltou ao relógio, e a linha inserida pelo `psql` apareceu sozinha
  ("Atualiza a cada 5 s · última às …"). O menu da célula mostrou "Atualizar automaticamente" depois de "Atualizar" (F5), com "A cada 5 s" marcado, e a
  barra disse "em pausa" com o menu aberto. A tabela renomeada no `psql` deu o erro do banco uma vez, com a nota "A atualização automática parou: o comando
  deu erro." A vista Registros usa a mesma barra e o mesmo menu, e foi conferida só pelos testes (`records-view.test.ts`). Depois das correções da revisão
  (mesmo arranjo, porta 55461, `CDP` por um roteiro de `Input.*` e `Runtime.evaluate`): com uma consulta que dorme 2 s (`(select pg_sleep(2))`) e "A cada
  5 s", durante a execução automática o botão seguiu "Executar" e a grade não esmaeceu; Ctrl+Enter com `select 42` nesse meio-tempo executou na hora (a
  automática foi cancelada, sem aviso), e a atualização automática desligou sem nota; depois de um `UPDATE` o relógio ficou na barra, desabilitado, com "o
  comando grava no banco…"; nos Registros de `loja.fila` o relógio ficou no rodapé, entre "Atualizar" e "Exportar CSV", o menu abriu para cima, e ligada
  ele disse "Atualiza a cada 5 s · última às …" ali (com o texto longo, o rodapé quebra em duas linhas a 1400 px). Depois da segunda revisão (mesmo arranjo,
  porta 55471; o usuário criado pela tela e a conexão por `fetch` à API com `window.prism.getApiConfig()`, que só aparece no navegador depois de Sair e
  Entrar): com "A cada 5 s" sobre uma consulta que dorme 1,5 s, o X durante "atualizando…" voltou na hora ao resultado de antes, com "O cursor foi fechado"
  e "Executar de novo", sem aviso depois, e o relógio habilitado; com o foco no X, a tabela renomeada no `psql` e F5, o comando deu erro, ela parou com a
  nota, e o foco ficou no relógio, de onde o F5 seguinte (com linhas na tela) executou. A corrida do alvo da edição e a sessão reaberta pelo F5 foram
  conferidas só pelos testes. **Para um PostgreSQL sem
  Docker**: o `initdb` e o `pg_ctl` rodam como `postgres` (`runuser -u postgres --`), que não atravessa a pasta da sessão (é do root, 700): o cluster vai numa
  pasta do `postgres` (`/var/lib/postgresql/<nome>`), com porta e soquete próprios, e sai no fim. Encerre só os PID que você iniciou: um `pkill -f` com o
  caminho da árvore mata também o shell que o roda, e outra frente pode ter um Xvfb e um `pnpm dev` de pé ao lado.

## Executar script (RN-SQL-019 a 024)

Seção 31 da especificação, pedido do dono em 2026-10-15 ("igual a do dbeaver do alt + x"): os comandos do editor um depois do outro, uma aba por
resultado, as Estatísticas e a pergunta no erro. Cada comando é um `POST …/queries`, como no Ctrl+Enter, com o `keep` da seção 33 (abaixo, "As abas
guardadas se editam").

- **Onde mora cada parte.** `_lib/script-run.ts` (puro, com teste): o atalho (`scriptShortcut`, `scriptShortcutLabel`, e `platformScriptShortcut`
  para os textos que o ensinam), o estado do script (`ScriptRun`, `ScriptEntry`, as funções que o mudam, `entryAt` e `entriesOf`), os totais, as
  linhas das Estatísticas enquanto ele roda (`statisticsRange`), a aba à frente (`shownScriptTab`), as setas nas abas, o aviso do fim, o `keep` de cada
  execução (`keptResultIds`) e a aba guardada que fica com o que foi salvo (`withSavedResult`); os textos em
  `script-run.copy.ts` (não confundir com `scripts.copy.ts`, que é o dos scripts salvos). A divisão é `scriptStatements` em `sql-statements.ts`; o
  executor é o `runScript` de `use-query-runner.ts`; a tela é `script-tabs.tsx` (as abas, a nota da aba guardada e a marca da faixa de abas,
  `ScriptWaitingMark`), `script-statistics.tsx` (com `useCoalescedRun`), `script-error-dialog.tsx`, a marca do editor (`_lib/script-mark.ts`) e as
  propriedades `tabs`, `progress`, `statistics` e `kept` do `ResultPanel` (o `kept` é `{ busy, onRunAlone }`: quem desenha a nota é a área, que tem o
  resgate do foco).
- **O atalho é Alt+X, e no macOS Cmd+Option+X.** Lá o Option+X escreve um caractere (`≈` no teclado americano, outros em outros), e o atalho o tiraria
  do editor. A tecla vale pelo caractere ou pela posição (`code === "KeyX"`: no macOS o Option muda o caractere), e nunca com Ctrl (o AltGr do Windows
  chega como Ctrl+Alt) nem com Shift. Quem trata é o `onKeyDown` do `QueryTabPanel`, e não um mapa do CodeMirror: assim vale no editor e em qualquer
  ponto da aba (a barra, a grade, o campo de filtro); o campo de edição da célula para a propagação e fica com as teclas dele. Nada mais usa a tecla: o
  mapa padrão do CodeMirror tem `Alt-l`, `Alt-u` e `Alt-A` (Shift), mas não `Alt-x`; o `before-input-event` do Electron só pega Ctrl (zoom, F5, Ctrl+R);
  o menu de desenvolvimento não tem mnemônico X, e o app empacotado do Windows e do Linux não tem menu. O botão escreve o atalho da plataforma
  (`aria-keyshortcuts`). Segurar as teclas repete o evento (`event.repeat`): a repetição só é consumida, e o script começa uma vez, no primeiro (com a
  pergunta de erro à espera o executor não está ocupado, e a repetição a responderia e começaria outro).
- **A divisão é o leitor do Ctrl+Enter** (`scan`), com uma peça a mais: os `;` que estão no corpo de um bloco não separam (`innerSemicolons`, com o
  mesmo `dialect.body()` do `statementCount`, recomeçado no `;` que fecha e em cada corte da linha em branco; o corpo que chega aberto ao fim prende os
  `;`, menos com o `extra` do Informix, a rotina sem `END PROCEDURE`, em que todo `;` separa). O `splitStatements` e o `statementAt` seguem separando
  em todo `;`, como antes. A garantia que o teste confere em textos dos três bancos: cada pedaço conta 1 no `statementCount` (a conta da API, que
  repete a conferência e recusaria o pedaço com `MULTIPLE_STATEMENTS_NOT_SUPPORTED`), e o número de pedaços é a conta do texto inteiro. No script a
  linha em branco divide também a seleção (no Ctrl+Enter a seleção vai inteira). No Db2 o bloco vai até o fim do texto, como na conta.
- **O executor** (`runScript`). O estado do script é um observável à parte (`runner.script`, com `useScriptRun`), e não um estado novo do `RunnerState`:
  o resto da tela (a barra, o bloqueio, a ida para outra janela, a troca do banco e da conexão) continua lendo só o estado do executor. Ele fica
  `running` do primeiro ao último comando (ocupado para a pessoa e para o bloqueio por inatividade), com o `previous` sendo o que o comando anterior
  deixou, e termina com o do último. **A pergunta de erro não ocupa**: o estado é o do comando que falhou (o editor marca a posição do erro, pelo
  `offset` do comando no texto inteiro, como no Ctrl+Enter), e o bloqueio pode vir; ele aposenta o executor (`retire`), que responde "Parar" à
  pergunta (`deciding`) e tira o script. `release` (Desconectar) para o script: o comando em andamento fica "cancelado". **Uma execução nova na aba com
  a pergunta à espera** (`run`, `runScript`, `runCommand` e `rerun`: o caminho não passa pela tela, em que o diálogo cobre a aba, mas o executor o aceita)
  é a resposta "Parar" (`afterPausedScript`), como a RN-SQL-020 manda trocar os resultados do script por uma execução nova: o script para com o que já
  rodou e o aviso do fim, e o comando novo só sai depois de o laço dele terminar (`scriptLoop`); antes, a promessa do script ficava esperando para sempre, e
  uma resposta atrasada o retomava por cima do comando novo. O que o executor recusaria antes de enviar (`sends`: mais de um comando, nada a enviar, a aba
  sem conexão; o F5 sem resultado de linhas na tela) não mexe na pergunta, e sem pergunta à espera nada muda (quem chama vê a aba ocupada na mesma chamada). Cada comando passa por
  `execute`, com as recusas do comando a mais (`scriptCommandRefusals`: o controle de transação, o comando que não roda em transação, mais de um
  comando e, na conexão somente leitura, o que não é leitura, `CONNECTION_READ_ONLY`), que perguntam como o erro do banco, sem o aviso central; o resto (a sessão ocupada, a API fora do ar, a sessão que caiu) para o script
  sem perguntar. A sessão que cai só é reaberta antes da primeira resposta (`!answered`): depois, o que os comandos de antes deixaram nela se perdeu.
  **Sem resposta sobre comando nenhum** (a conexão que não abre, o cancelamento antes do primeiro), a tela fica como estava: o script de antes volta
  (`untouched`), e o executor faz o que o Ctrl+Enter faria. O `failed` ganhou `notify`: no script os avisos de cada comando calam, e sai um no fim
  (`scriptEndToast`), com o nome da aba (o `title` de `createQueryRunner`, lido no fim: a aba pode ter sido renomeada ou salva como script enquanto ele
  rodava; o `WorkbenchProvider` o tira de um mapa guardado por `useState`, e não de uma ref, porque o `createRunner` vai ao `createLockHandles` durante
  a renderização e o lint do React não deixa a ref ir junto); o de valores cortados, um por script. Os avisos da seleção com mais de um comando
  (`tooManyStatements`, o da área e o do canto) e a área vazia (`emptyHint`) ensinam o atalho.
- **Um script de milhares de comandos** (uma carga de `INSERT`, o caso que leva ao Alt+X em vez do Ctrl+Enter) custa o mesmo por comando do começo ao
  fim. O script muda duas vezes por comando, e três coisas cresciam com o tamanho dele: (1) a lista dos comandos era copiada inteira a cada mudança
  (`withEntry` e `startEntry`); agora ela vai em páginas de 256 (`ScriptRun.pages`, lida por `entryAt` e `entriesOf`), e mudar um comando copia a
  página dele e a lista das páginas; (2) os totais percorriam o script a cada desenho; agora vão no próprio script (`totals`), acertados a cada
  mudança (o teste confere que dão o mesmo que contar tudo de novo); (3) as Estatísticas, à frente enquanto ele roda, refaziam, mediam e pintavam a
  tabela inteira a cada comando; agora, enquanto ele roda, só os 50 comandos em volta do que está em execução (`statisticsRange`, com ele perto do
  alto e duas linhas dizendo quantos ficaram antes e quantos estão na fila), a tabela inteira uma vez no fim, e o redesenho no máximo a cada 250 ms
  (`useCoalescedRun`: o relógio conta da última troca, e não do último comando; a pergunta, o fim e um script novo vêm na hora). As publicações do
  executor e o `set` dele no mesmo trecho síncrono (o fim de um comando e o começo do seguinte) já saem num desenho só: o React junta as atualizações
  de `useSyncExternalStore` numa microtarefa. Medido na tela (abaixo): antes, 3.000 comandos levavam 115 s no app de produção com as Estatísticas à
  frente (contra 23 s com uma aba de resultado à frente), com a janela parada por até 27 s.
- **O começo do comando** nas abas e nas Estatísticas (`commandHead(target)`) pula os espaços e os comentários de cima pelo leitor do projeto, no banco do
  comando (`commandStart` de `sql-statements.ts`: o comentário de bloco aninhado do PostgreSQL e do Db2, o primeiro fecho no Informix, o `{ … }` só no
  Informix, o `--` que no PostgreSQL acaba também no retorno de carro), e não por uma expressão regular, que lia o aninhado errado e tomava `{` por
  comentário em todo banco. **"Linhas alteradas"** soma só as linhas afetadas dos comandos que não devolvem linhas: o que grava e devolve linhas (RN-SQL-013)
  traz da API o total devolvido (`totalRows`), e não o de alteradas, e fica de fora, contado em `ScriptTotals.returning`, que o total diz ("Linhas
  alteradas: 12 (sem contar 1 comando que gravou e devolveu linhas)"); a especificação diz por quê.
- **As abas e o cursor.** Cada comando que devolve linhas guarda a página dele (`results`, até `scriptResultCap`, 20); no fim, o do último comando
  executado, quando devolveu linhas, fica sempre (`live`), também depois do limite: é o do cursor aberto (RN-SQL-007: um por sessão, e cada comando
  novo fecha o anterior), e a aba dele desenha o **estado do executor**, e não a cópia guardada, com tudo o que vale num resultado. As outras desenham a
  cópia (`kept`), que se edita (ver "As abas guardadas se editam"), sem contar, sem "Carregar mais", sem filtro nem atualização
  automática, e a nota com "Executar este comando" (`runCommand`: o "executar de novo" do comando, com o lugar no texto de quando o script rodou, que
  troca os resultados do script). Com um comando em andamento na aba o botão fica `aria-disabled`, com o porquê na dica (o executor recusaria calado),
  e o `handleRunAlone` só pergunta das alterações, limpa o filtro e abre a área quando o comando vai rodar (`commandWillRun`, como os outros caminhos);
  quando o comando troca os resultados do script, o botão sai da página com o foco, e a área o leva à grade nova (`onFocusLost` e `rescueFocus`, o
  mesmo do botão de contar, RN-SQL-006). A aba à frente: as Estatísticas enquanto roda, a do último no fim, e a que a pessoa escolheu enquanto ela existe
  (pelo `id` do script; o seguinte volta às Estatísticas). Cada executor numera os scripts dele desde o 1, e o painel continua montado quando a aba
  ganha outro (o banco, a conexão, o bloqueio): a escolha sai junto com o filtro, no ajuste do `filterRunner`. O F5 só executa de novo com a aba do
  último à frente, e a atualização automática espera (`hidden`) com outra aba do script à frente.
- **A pergunta de erro se fecha só pelo Esc**, que é o "Parar" da especificação (`dismissible="escape"` do `Dialog`: sem o X e sem o clique fora, que
  paravam o script calados; `canClose` diz por qual caminho, o Esc, o fundo ou o X).
- **A pergunta de erro só na aba à vista** (`active && onScreen`, como a atualização automática). O `Dialog` vai por portal ao `body`, fora do `hidden`
  da aba e do `inert` da área de trabalho escondida: sem isso, o script de uma aba de trás abria a pergunta por cima da aba da frente, ou de
  Configurações, tirava o foco de quem digitava (um Espaço ou Enter caía no "Parar") e dois scripts empilhavam dois diálogos iguais. O de outra aba
  espera; a faixa de abas mostra a marca dele (`markOf` do `TabStrip`, que o `WorkbenchTabs` preenche com `ScriptWaitingMark`, um ponto vermelho com
  o texto para o leitor de tela), e a pergunta aparece quando a pessoa vai até ela.
- **Quem troca os resultados do script**: o comando aceito do `run` (o Ctrl+Enter), o `runCommand` e outro `runScript`. O filtro do resultado manda
  `run(…, { keepScript: true })`, e o F5 e a execução automática não trocam: mudam só o resultado do último. A recusa antes de executar (a sessão
  ocupada, o controle de transação sem `executed`) deixa o script, como deixa o resultado (`next !== shown`), e a API também não esquece os
  guardados nela (RN-SQL-024: a recusa antes do banco não aplica o `keep`).
- **A barra e o leitor de tela.** "Executando 3 de 12…" é o `progress` da barra (um `role="status"` só, em qualquer aba e com a área recolhida); as
  Estatísticas marcam a linha do comando com `aria-current="step"` e não repetem o progresso. As abas são uma lista de abas (`role="tablist"`, só a
  escolhida no Tab, setas com a volta, Home e End, o foco vai à escolhida); o corpo da área é o `tabpanel` dela, e entra no Tab nas Estatísticas, que
  não têm o que focar. As abas dos resultados rolam numa caixa só delas, e a escolhida vem à vista a cada troca (`revealOffset`, o mesmo da faixa de
  abas, e um `ResizeObserver` para a faixa que estava sem largura); "Estatísticas" fica fora da rolagem, na ponta direita. Sem isso, com umas oito
  abas, a do último comando, que vem à frente sozinha no fim, e as Estatísticas ficavam fora da faixa. Cada linha das Estatísticas é memorizada: o
  script publica um estado novo a cada comando, e só a linha que mudou é outro objeto.
- **As abas guardadas se editam** (seção 33, RN-SQL-023 e 024). A API guardava um resultado só por sessão; agora ela guarda o que a edição precisa
  dos resultados que a tela lista em `keep` no `POST …/queries` (`executeQuery`, que só põe o campo no corpo com a lista cheia), e as rotas da edição
  aceitam o `resultID` deles. **Quem manda o quê** (`runWith` e `runScriptNow`, pelo `keptResultIds`): cada comando do script manda os das abas que o
  script já tem (enquanto ele roda não há `live`, e vão todas, a do comando anterior também), e o "Tentar de novo" a mesma lista; o F5, "Executar de
  novo", o filtro e a execução automática do resultado do último (`clearsScript` falso) mandam os das outras abas, menos a do `live`, que eles
  substituem; o Ctrl+Enter, "Executar este comando" e o primeiro comando de outro script não mandam nenhum, e a API esquece os guardados. A lista
  nunca passa de 20: a aba do último que passou do limite (`live` além dos 20) não vai. **A edição** é a mesma `useRecordEdits` da aba, com `kept` (as
  linhas da aba guardada à frente, no lugar das do executor) e `scriptBusy` (o script roda ou espera a pergunta de erro: com a pergunta, o executor
  não está ocupado, e a edição está, em todas as abas); o `moved` de uma aba guardada confere se o script ainda a tem, e não o resultado do executor (a
  cópia do `live` em `results` guarda o `resultID` de antes do F5, e por isso a aba do último segue conferindo pelo executor). O menu da aba guardada não
  tem "Filtrar", "Atualizar" nem "Atualizar automaticamente" (a aba de consulta não passa `filter`, `refresh` nem `autoRefresh`), e a área mostra a faixa
  e passa a edição à grade também com `kept`, e com ela a barra de edição (RN-EDIT-013), entre a grade e a nota; a barra e o menu têm o "Duplicar
  linha", e os quatro botões ficam ocupados com o mesmo motivo enquanto o script roda (`personBusy` conta o `scriptBusy`). Copiar a célula cortada
  leva o valor cortado, com o aviso: a rota das células responde 404 para um guardado, que `cellRefusals` já tratava; pela mesma resposta, duplicar
  a linha que tem célula cortada numa coluna que se copia não duplica nada, e a faixa diz "Execute o comando de novo para duplicá-la." (RN-EDIT-016).
  **O Salvar** passa pelo `onSaved` de sempre: `runner.keepSaved` acha o resultado na cópia guardada
  (`withSavedResult`, sem mexer nas Estatísticas, que continuam com as linhas que cada comando leu) e, como o Salvar foi um comando na sessão, fecha o
  cursor do resultado do executor (`cursorClosed`, calado, como no Salvar dele mesmo). **Trocar de aba** (`chooseScriptTab`) com alterações não
  salvas pergunta antes, pelo `guard` (a pendência é uma só por aba de consulta, a do resultado à frente): a aba que já está à frente não pergunta, e
  `ScriptTabs` leva o foco à escolhida na hora quando `onChoose` não devolve `false`; a troca pelo teclado que espera a pergunta fica guardada
  (`awaiting`), e o foco vai à escolhida quando a pergunta troca de aba ("Salvar" ou "Descartar"), num efeito sobre `shown` que roda depois de o diálogo
  devolver o foco à aba de antes (que já saiu da ordem do Tab); "Cancelar" não troca a aba, e outra escolha a esquece. A sessão que caiu responde como no
  resultado do último ("Não foi possível saber o que se edita neste resultado." com o motivo da API). **Cada resultado lembra a sessão em que foi lido**
  (`RowsState.sessionId`), e a edição dele pergunta e grava nela (`sessionOfShown`, em `use-record-edits.ts`; sem ela, a da aba): depois de o F5 ou o
  filtro reabrirem a sessão que caiu, a sessão nova não conhece os guardados da de antes, e a aba guardada responde que a sessão com o banco não existe
  mais, como a que caiu, e não o 409 de "outro comando foi executado nela depois dele". Levar a aba para outra janela pergunta pelo
  registro `unsaved-edits.ts`, que conta as pendências da aba guardada também.
- **O que não foi feito**: levar a aba para outra janela leva só o resultado do último comando (o resto fica, como diz a especificação); guardar as
  pendências de várias abas do script ao mesmo tempo e o valor completo das células cortadas nas abas guardadas, o script que é uma transação só e
  continuar o script a partir de um comando escolhido ficam para depois (seções 31 e 33). Não há atalho para "Cancelar": o botão da barra.
- **Conferido na tela** (Xvfb, `pnpm dev` com a API desta árvore, PostgreSQL 16 local num cluster próprio na porta 55481, o usuário e a conexão criados
  por `fetch` à API com `window.prism.getApiConfig()`, o login pelo formulário): com um script de cinco comandos separados por `;` e por linha em
  branco, o Alt+X de verdade (`xdotool key alt+x`, no `pnpm dev` com o menu padrão do Electron) rodou os três primeiros e parou no `SELECT * FORM
  pedido` com a pergunta (o erro do PostgreSQL como veio, o SQLSTATE 42601, "Parar" com o foco) e o `FORM` marcado no texto inteiro; "Pular" seguiu,
  o último ficou à frente com o filtro, o relógio da atualização automática e o zoom, a aba do primeiro mostrou as 200 linhas com a nota, as
  Estatísticas mostraram o pulado com o erro na linha de baixo e os totais, e o aviso disse "Script executado com 1 erro: 4 de 5 comandos
  executados.". Com `pg_sleep`, a barra disse "Executando 2 de 3…", o editor marcou o segundo comando, a barra do editor mostrou "Cancelar", e o
  "Cancelar" deixou o segundo cancelado e o terceiro não executado, com "Script cancelado: 1 de 3 comandos executados."; as setas andaram nas abas, e
  o Ctrl+Enter seguinte trocou as abas pelo resultado dele. No macOS e no Windows o atalho não foi aberto: só os testes.
- **Conferido na tela depois da revisão** (Xvfb a 1440×900, PostgreSQL 16 local num cluster próprio na porta 55491 com `cliente` de 3.000 linhas, o
  usuário e a conexão por `fetch`, o login pelo formulário, o texto posto no editor pela `EditorView` que o CodeMirror pendura no `.cm-content`
  (`cmTile.view`), o tempo do clique em "Executar script" até o aviso do fim, medido na página, com a maior pausa entre dois `requestAnimationFrame`):
  `update cliente set nome = nome where id = N;` repetido. No `pnpm dev`, com as Estatísticas à frente (antes do redesenho a cada 250 ms): 300
  comandos em 4,2 s, 1.000 em 16,2 s, 2.000 em 28,7 s e 3.000 em 37,9 s (a revisão tinha medido 27,8 s e 98,4 s para 1.000 e 2.000). No app de
  produção (`pnpm build` e o Electron na pasta, com `--remote-debugging-port`), 3.000 comandos: com as Estatísticas à frente, 29,5 s antes do redesenho
  a cada 250 ms e 26,1 s e 22,7 s depois; com uma aba de resultado à frente (o mesmo script com `select 1 as a;` antes, e a aba 1 clicada), 20,9 s e
  22,9 s. A maior pausa da janela foi de 330 a 370 ms, a tabela inteira desenhada uma vez no fim (era de 27 s). No meio dos 3.000, as Estatísticas
  tinham 52 linhas ("510 comandos antes destes, que aparecem quando o script terminar.", "Mais 2.440 comandos na fila."), a barra dizia "Executando
  525 de 3.000…", e "Cancelar" parou o script em 0,3 s ("Script cancelado na aba consulta-1.sql: 525 de 3.000 comandos executados."). Com 12
  `select n`, a faixa de 706 px rolou até a aba "12 · select 12 as n12", e as Estatísticas ficaram à vista; "Executar este comando" na aba 1, com o
  foco nele, levou o foco à grade do resultado novo ("Linhas do resultado"). Um script parado no erro com a área de trabalho por baixo de
  Configurações não abriu a pergunta; de volta à área de trabalho, ela apareceu com "Parar" focado, e "Parar" deu "Script parado na aba
  consulta-1.sql: 1 de 3 comandos executados.". A área vazia mostrou "… Alt+X executa os comandos da seleção ou do texto inteiro, um depois do outro.".

## A linguagem das variáveis (seção 41: RN-VAR-001 a 018, 020 e 036, RN-SQL-009)

Parte 9, frente 1: a linguagem, pura, em `src/app/workbench/_lib/variables/`. A execução ligada ao `use-query-runner` e o painel das variáveis são a frente 3
(a seção seguinte); a marca no editor é da frente 4. As frentes seguintes só chamam o que está aqui. A API não lê nada disto: o texto que ela recebe já vem com os
marcadores, e os valores vão ao lado, como parâmetros (RN-VAR-017).

- **Os arquivos.** `lexer.ts` e `parser.ts` (o leitor da gramática inteira da RN-VAR-002; o que fica para depois é lido e recusado pela conferência com as frases
  provisórias), `ast.ts`, `catalog.ts` (nomes fechados, palavras reservadas, membros dos espaços de nomes), `values.ts` (valores e tipos), `numbers.ts`,
  `dates.ts`, `operators.ts`, `functions.ts` (as tabelas de funções e métodos, em `Map`), `evaluate.ts` (o avaliador), `meter.ts` (os limites), `random.ts`
  (xoshiro128**), `script.ts` e `script-items.ts` (o script em itens), `run.ts` (a execução e a conferência), `at-names.ts` e `markers.ts` (o `@nome` e os
  marcadores que já estão no texto), `bind.ts` (a troca), `sent-sql.ts` ("SQL enviado"), `positions.ts` (o mapa das posições), `wire.ts`,
  `evaluator-service.ts`, `evaluator.worker.ts` e `evaluator-host.ts` (o Worker), `boundary.ts` (o único lugar que escreve no console) e
  `variables.copy.ts` (os limites, `limits`, e as frases, `phrase`).
- **O que a execução chama, nesta ordem.**
  1. `readScript(source, engine?, { blankLines? }): ScriptModel` divide o script em itens (comando, declaração, reatribuição, RN-VAR-019), lê cada declaração e
     acha os `@nome` de cada comando. Os itens têm `index`, `line`, `kind`, `parsed` (a declaração lida, ou nulo) e `error` (por que não leu). O
     `sql-statements.ts` aprendeu o item de declaração por um `DeclarationReader` injetado (`declarationReader(engine)` em `script-items.ts`; `splitScript`,
     `scriptItemAt`, `scriptItemCount`): o leitor do SQL não importa a linguagem. A declaração vira `;` e espaços na máscara, e as posições não mudam.
  2. `staticDiagnostics(model): ItemDiagnostic[]` são os erros que se sabem sem executar (gramática, nomes, `const` reatribuído, `@nome` antes da declaração,
     marcador já escrito no texto). `checkScript(model, clock?, now?)` é essa conferência mais a execução em seco do que é determinístico (RN-VAR-012).
     **A tela mostra a conferência do script inteiro**: o serviço do Worker só devolve o erro dos itens pedidos, e o item que o leitor recusou não está na
     lista (quem usa a variável recusada ouve "x não foi declarada", e a causa vem do `staticDiagnostics`).
  3. `dependencyPlan(model, index, tab): number[]` diz quais atribuições avaliar antes do item (a regra do Ctrl+Enter, RN-VAR-020 e 023): as de que ele depende e
     que a aba ainda não tem em dia (o texto da atribuição é o mesmo e foi avaliada depois das de que depende).
  4. Avaliar: `new ScriptRun(model, { engine?, random, clock, now }, tab?, counter?)` e `run.evaluate(index): AssignmentResult` (`{ ok: true, stored, steps }` ou
     `{ ok: false, error }`), `run.tab`, `run.counter`, `run.valueOf(name)`, `run.forget(name)`. `evaluateScript(model, config, tab?, counter?)` faz o script
     inteiro. Em produção a avaliação roda no Worker (abaixo); o `ScriptRun` direto serve aos testes e às sondas.
  5. Trocar: `run.bind(index): BindResult` devolve `{ ok: true, command: BoundCommand }`, com `command.sql` (os marcadores do banco: `$n` no PostgreSQL, `?` no
     Db2 e no Informix; uma lista vira marcadores separados por `, `, só entre parênteses; o `sql` entra no texto), `command.params` (`{ type, value, variable,
     item }`, o valor sempre como texto, ou `null`) e `command.replacements` (onde estava cada `@nome` e onde ficou o que o trocou). `bindCommand(text, engine,
     declared, scope, types?)` é a função por baixo.
  6. `sentSql(command, engine): SentSql` é o "SQL enviado" com os literais da exportação (`scriptLiteral`, `sqlLiteral`): `text`, `header` (o comentário do alto
     quando um valor ficou só com o marcador), `rows` (o quadro dos parâmetros), `notes` e `sqlRanges`. `parameterLiteral(engine, parameter)` é o literal de um
     parâmetro, ou nulo.
  7. O erro do banco: `editorOffset(statementStart, command, databasePosition)` leva a posição do erro (1 em diante, no texto enviado) ao texto do editor; dentro
     de um marcador, de uma lista expandida ou do texto de um `sql` cai no começo do `@nome` (`originalOffset` é a parte sem o começo do comando).
- **O Worker** (RN-VAR-013 e 014). `EvaluatorHost({ createWorker, timers?, perItemMilliseconds?, perRunMilliseconds? })` com `evaluate(request): Promise<EvaluateOutcome>` e
  `dispose()`; `createBrowserWorker()` abre o Worker do pacote. O pedido (`EvaluateRequest`) leva o texto do script, o banco, os índices dos itens, a aba, o
  contador, a semente e a hora, tudo como dado; a resposta vem item a item (`start`, `item`, `done`, `failed`). O host termina o Worker (`terminate()`) quando uma
  declaração passa de 250 ms ou a execução de 5 s, devolve `{ kind: "timeout" }` com a frase e abre outro Worker no pedido seguinte. O núcleo mede os mesmos 250 ms e os
  passos sozinho (a segunda defesa). `handleEvaluateRequest(request, post, clock?)` é o corpo do Worker, e os testes o rodam sem Worker. Os valores atravessam por
  `toWire`/`fromWire` (e `storedToWire`/`storedFromWire`, `typeToWire`/`typeFromWire`): a cópia estruturada perderia o congelamento e o `Map`, e o dado de fora só vira
  valor pelos construtores da linguagem, que conferem a forma.
- **Os valores.** Registros congelados e sem protótipo, de oito espécies: `number` (o `double` e, quando veio escrito, o texto exato `exact`, com `inexact` se o
  `double` não o escreve inteiro; a conta e a comparação recusam o inexato), `string` (até 1.000.000 de unidades UTF-16, sem U+0000 nem metade de par), `boolean`,
  `null`, `date` (campos do calendário e precisão `day` ou `instant`; as contas passam pela hora local da máquina), `list` (até 10.000 itens do mesmo tipo, sem lista de
  lista), `object` (até 100 campos, num `Map` congelado: a chave nunca é propriedade) e `sql`. O tipo (`Type`) tem `nullable`, `list` e `never` (a lista vazia). A frase curta
  de um valor é `displayValue`/`inlineValue`/`typeLabel`; o texto de uma interpolação é `textOf`.
- **Segurança do avaliador (RN-VAR-014).** Nada do texto vira nome de propriedade do JavaScript: o membro se lê por regra positiva (campo de objeto pelo `Map`,
  `length`, os métodos das tabelas), as palavras do JavaScript que a linguagem não tem são recusadas pelo leitor, e nenhum valor é função, `Symbol`, `undefined` nem
  `Proxy`. O teste de ataques confere que `Object.prototype`, `Array.prototype` e os globais ficam como estavam. Sem `eval` nem `new Function`: a política de conteúdo
  do app (`default-src 'self'`, RN-SHELL-001) vale para o Worker.
- **Os limites** (`limits`, RN-VAR-013): 100.000 passos por declaração e 1.000.000 por execução, 250 ms por declaração e 5 s por execução, aninhamento 64, texto
  1.000.000, lista 10.000, objeto 100 campos, declaração 64 KiB, 500 declarações, 10.000 parâmetros e 4 MiB, corpo do pedido 30.000.000 de bytes, valores da aba 128
  MiB, `sql` 10.000 caracteres. As operações longas contam passos ponderados (`weigh`, 1 passo por 1.000 unidades). O relógio entra por parâmetro (`Clock`), e os testes
  o falseiam.
- **O `random`** (RN-VAR-010) é o xoshiro128** de Blackman e Vigna, um por execução, com a semente do `crypto.getRandomValues` na produção (`productionRandom()`); os
  testes dão a semente (`new Random([a, b, c, d])`). `int` usa rejeição (uma saída até 2^32; duas, de 53 bits, acima), `float` é `u / 2^32` e `uuid` usa quatro
  saídas com os bits de versão e variante. Não serve de segredo.
- **As frases provisórias.** O que a gramática lê e esta frente ainda não executa é recusado, na conferência, com estas frases (em `phrase`; saem quando o passo
  de cada uma entrar): `provisionalQuery` ("A variável de consulta chega numa próxima versão."), `provisionalSample` ("`random.of` chega numa próxima versão."),
  `provisionalColumnType` ("O tipo de coluna chega numa próxima versão.") e `provisionalNoValue(nome)` ("`nome` não tem valor: escreva `= valor` (a pergunta dos
  valores chega numa próxima versão)."). `StoredValue.origin` já traz `consulta`, `pergunta` e `diálogo` para quando elas entrarem.
- **O log (RN-VAR-036).** Nenhuma exceção do JavaScript que escape do leitor, do conferidor ou do avaliador chega à pessoa: vira "Erro interno do Prism ao avaliar
  <nome>." (`reportInternalError`), e ao console de desenvolvimento vai só o nome do tipo do erro, nunca a mensagem, o texto do script nem um valor. Nenhum outro arquivo
  da linguagem usa o `console` (um teste confere).
- **Os testes.** Os casos de tabela são `*.cases.json` escritos à mão a partir da especificação e nunca regerados do código (`reader`, `placement`, `types`,
  `evaluation`, `functions`, `attacks`, `limits`, `at-names`, `binding`, `positions`), cada um com um `*.cases.test.ts` que os lê por `cases-runner.ts` (que fixa
  `TZ=America/Sao_Paulo`, porque as datas valem na hora local). `properties.test.ts` sorteia 10.000 textos e árvores por execução, de uma semente nova a cada vez (a de
  `PRISM_PROPERTY_SEED`, se estiver no ambiente) que a mensagem de falha traz. A fixture compartilhada com a API é `src/test-fixtures/variables/markers.json` (a conta
  dos marcadores de cada banco; `markers.fixture.test.ts` a lê; a API tem de contar igual, RN-VAR-017).
- **O contrato com a API (RN-VAR-017 e 032; `api-contract.test.ts`).** O pedido leva só `{ type, value }` em cada parâmetro: `requestParams(command.params)` tira o `variable`
  e o `item`, que ficam na tela para o "SQL enviado" (uma terceira chave é 422 `QUERY_INVALID`). A tela recusa antes, com a frase dela, o que a API recusaria: o `number` de
  mais de 100 caracteres, o decimal de mais de 31 dígitos no Db2 e no Informix (o driver; "pelo driver" na frase do Informix), a lista de mais de 10.000 valores e os
  valores de mais de 4 MiB. O corpo de `POST queries` vai até 30.000.000 de bytes (`limits.requestBodyBytes`), o das rotas `transfers` (exportação e cópia, `source.params`)
  até 16 MiB (`limits.transferBodyBytes`): quem monta o pedido da exportação confere `requestBodyBytes(sql, params)` contra o segundo. O `timestamp` com fuso só vai no
  PostgreSQL; o texto exato de um instante que veio do Db2 pode ter até 12 casas, e a API aceita 6 (a consulta da variável, que traz esse texto, ainda não entrou). As
  recusas voltam como `ApiError`: `QUERY_INVALID` (`errors["params[i].value"]`, `["params[i].type"]` ou `["params"]`, e o `errorCodes` do mesmo campo em `extensions`), na
  exportação `EXPORT_OPTIONS_INVALID` e na cópia `IMPORT_OPTIONS_INVALID` em `source.params[i].value`, `QUERY_PARAMETERS_MISMATCH` com `extensions.markers` e `extensions.values`
  (números; a tela e a API contam igual pela fixture, então ele só vem se o texto mudou no caminho) e `FILTER_INVALID` quando o filtro de um resultado com parâmetros
  tem `$n` ou `?`. Os valores nunca vão a mensagem nenhuma.
- **A sonda S-VAR-4** (Node 22 e Electron 44 sob Xvfb, numa VM de 4 vCPU a 2,1 GHz; o app empacotado não foi aberto): nenhuma declaração dentro dos limites passa de
  ~45 ms (a conta mais longa que cabe em 64 KiB; o `replaceAll` sobre 1.000.000 de caracteres, 24 ms); a execução mais cara (400 declarações de 1.000 termos, 400.400
  passos) leva 1,6 a 2,4 s dos 5 s; a troca de uma lista de 10.000 valores leva 60 a 280 ms nos três bancos; o host para um Worker que não volta em 250 ms (mais 10 a 45
  ms) e em 5 s (mais 1 a 4 ms), e o Worker seguinte responde em 20 a 62 ms. Não exercitados: o app empacotado (a política de conteúdo e o endereço do Worker feito pelo
  Vite), Windows e macOS, e uma chamada nativa que passe de verdade dos 250 ms.

## Executar com variáveis e ver os valores (seção 41: RN-VAR-012, 018 a 024, 032 e 033, RN-SQL-009, RN-SEG-001)

Parte 9, frente 3: o executor da aba, os valores da aba, o painel "Variáveis", o "SQL enviado" e os `params` em tudo o que executa de novo. O texto do editor segue sendo
da pessoa; o que vai ao banco é o comando trocado pelos marcadores (RN-VAR-017), e a API só recebe `{ type, value }` (`requestParams`).

- **O alvo guarda o comando trocado** (RN-VAR-033). `RunTarget.sent` (um `BoundCommand`: `sql` com os marcadores, `params` com `variable` e `item`, `replacements`, o mapa
  das posições) vive ao lado do `sql` do editor, e é ele que o F5, o "Executar de novo", o filtro, a atualização automática, "Executar este comando", a exportação e a
  cópia mandam (`sentTextOf`, `queryParamsOf`, `parametersOf`, em `command-wire.ts`): o `random` não sorteia de novo e as variáveis nunca são avaliadas de novo. A
  exportação leva `source.params` (`ExportOrigin.params`, `requestSource`) e o corpo das rotas `transfers` vai a 16 MiB (`limits.transferBodyBytes`, `maxRequestBytes`,
  `maxImportRequestBytes`; a tela confere o corpo escrito em JSON antes de mandar). `sameCommand` compara o texto enviado, o filtro e o tipo e o valor de cada
  parâmetro. O `executeQuery` leva `params` só quando há; `QUERY_PARAMETERS_MISMATCH` e `QUERY_INVALID` são erros do comando no script (quatro escolhas), e no comando
  avulso vão ao aviso central com a frase da API. A posição do erro do banco volta ao texto do editor por `editorOffset` (RN-SQL-009), e o filtro do resultado a
  deixa sem marca, como antes. A passagem da aba para outra janela leva o alvo inteiro (`sent` no schema de `electron/window-messages.ts`: o texto do editor, o
  enviado, os parâmetros e o mapa) e os valores da aba (`values`, dado puro de `wire.ts`, reconstruído pelos construtores da linguagem). A janela do resultado
  (RN-ABAS-017) não precisa de nada: é a mesma tela, com o mesmo executor.
- **Os valores da aba** (RN-VAR-023) são do executor: `runner.values` (`variables/tab-values.ts`, `createTabValuesStore`) com `snapshot()` (imutável, outro objeto a
  cada mudança: `{ values, counter }`), `subscribe(listener)` (devolve a função que desfaz) e `replace`/`clear`. `declaredValues(snapshot, model)` é o que o editor lê: por
  nome declarado, `{ type, value, stale, detail, origin, at }` (`type` como `typeLabel`, `value` até 60 caracteres como no fim da linha, `detail` até 200 para a dica,
  `stale` quando o texto da declaração mudou ou uma atribuição de que ela depende foi avaliada de novo: `staleNames`, a mesma regra do `dependencyPlan`). O contador de
  avaliações e os valores saem com o `retire()` (aba fechada, banco ou conexão trocados, bloqueio, "Sair"), que também larga o Worker; o `release()` (Desconectar) não os
  esquece. `runner.reveal` (`createRevealStore`) é o pedido de trazer o painel à frente (`serial` cresce a cada pedido). **Quem liga o editor** lê `runner.values` com
  `useSyncExternalStore` e a leitura do texto (`readScript`), e chama `declaredValues`; a frente do editor não precisa de mais nada daqui.
- **O executor** (`createQueryRunner`). `runner.runItem({ doc, engine, from, to }, hooks)` é o Ctrl+Enter (RN-VAR-020) e `runner.runScriptDoc(...)` o Alt+X (RN-VAR-019);
  `doc` é o texto inteiro do editor (`{ text, blankLines }`) e `from` a `to` o que vai (a seleção, o texto inteiro, ou o cursor com `from` igual a `to`). O `query-tab`
  os chama quando o texto declara variáveis (`variableRange`, pelo `liveEditors.snapshot`, e não pelos argumentos do `onRun`/`onRunScript` do editor), e sem
  declarações o caminho é o de sempre (`run`, `runScript`). Os ganchos (`RunHooks`): `confirm(make)` devolve `true` ou a resposta da pessoa (é o `confirmed` do
  `useCommandConfirmation`) e `begin()` roda quando a execução vai mesmo começar (o filtro do resultado sai, a área recolhida volta, o destaque acende). A ordem do Alt+X:
  a conferência (`planScript`: `checkScript` filtrado aos itens que vão e às atribuições de que dependem; a declaração sem valor é recusada com a frase provisória), a
  avaliação no Worker de toda atribuição que vai e das de fora da seleção que a aba não tem em dia (`evaluateIndices`, um pedido só: `preparing` impede outro), a troca dos
  `@nome` de cada comando com os valores daquele ponto (`scopeBefore`, `bindItem`), a pergunta da proteção com os valores como literais (`confirmedOf`,
  `numberedScriptQuestion`: o número é o do item no script, e o comando com uma variável `sql` é irreversível na dúvida, `irreversibleOfCommand`, com o trecho dela marcado
  em `ranges`) e então o laço (`runScriptNow(commands, declarations, closing)`). A declaração toma o valor já avaliado (atualiza o painel e as Estatísticas, `ScriptEntry.kind`
  `declaration`, "—" nas linhas, os totais "Declarações avaliadas" à parte); no erro dela só valem "Parar" e "Tentar de novo" (que a avalia de novo), e o diálogo
  desabilita "Pular" e "Pular todos os erros" com o motivo. O Ctrl+Enter numa declaração só avalia (o resultado na tela fica, o painel vem à frente com a linha dela);
  no comando, `dependencyPlan` diz o que avaliar antes e o valor que a aba tem serve quando está em dia. Erro da conferência ou da avaliação: `RunnerState`
  `variableErrors` (a lista "Erros nas variáveis" com a linha de cada um; o clique leva o cursor, `editor-goto.ts`, pelo `EditorView.findFromDOM`), o aviso "O script não foi
  executado: N erros nas variáveis." e nada executado. `variable-execution.ts` é o planejamento (puro), `variable-run.copy.ts` os textos.
- **A tela.** O painel "Variáveis" (`variables-panel.ts` é o modelo, puro: as linhas, `navigate`, `copyTextOf`; `variables-panel.tsx` o `treegrid`) é uma aba logo antes de
  "Estatísticas" (`ScriptTab` ganhou `"variables"`; sem script, `ResultTabs` traz "Resultado" e "Variáveis"). O "SQL enviado" (`sent-sql-dialog.tsx`, com o botão
  `SentSqlButton` na barra do resultado e nas linhas das Estatísticas, e "Ver o SQL enviado" na pergunta de erro) mostra o `sentSql` do alvo.
- **Provisório, até as partes seguintes.** A pergunta dos valores que faltam (RN-VAR-021) ainda não existe: a declaração sem valor é recusada na conferência. O
  "Executar com valores…" e a aba de execução (RN-VAR-026 a 029) não existem, e a variável de consulta, o `random.of` e o tipo de coluna ainda são recusados pelas frases
  provisórias da linguagem. O editor conhece as declarações (a seção "O editor e as variáveis", abaixo) e recebe os valores da aba pela prop `variables`;
  o `runTarget`/`scriptTargets` ainda usam o `statementAt`, então o destaque de execução (RN-SQL-018) de uma declaração avaliada pelo Ctrl+Enter não existe. O Ctrl+Enter chega ao `onRun` mesmo
  com o texto só de declarações (a tecla não consulta `isRunnable`, e `hasStatement` já conta o `let`), e a aba o desvia para o `runItem` quando o texto declara variáveis.

## O editor e as variáveis (seção 41: RN-VAR-025, RN-CONFIG-004)

Parte 9, frente 4: o editor lê o script com a linguagem acima e pinta, confere, avisa e completa. Não executa nem avalia nada que fale com o banco.

- **Os arquivos**, em `src/app/workbench/_lib/`. `variables-analysis.ts` é puro: `analyze(texto, banco, linhaEmBranco)` devolve as marcas (cores), os erros, as dicas, as variáveis
  declaradas e onde cada declaração acaba (`EditorAnalysis`), sem CodeMirror. `variables-extension.ts` é a extensão: o estado (`variablesField`), a pausa
  (`AnalysisScheduler`), a dica do ponteiro (`hoverAt`) e o valor no fim da linha. `variables-completion.ts` é o autocompletar. `variables-editor.copy.ts` tem as frases das dicas
  (as dos erros são as da linguagem, `variables/variables.copy.ts`). `sql-keyword-case.ts` ganhou a regra das declarações. `sql-completion.ts` aceita `variables` (as fontes e a pergunta
  que cala as palavras-chave e os nomes da árvore onde o SQL não completa).
- **A prop.** `SqlEditor` recebe `variables?: VariablesStore` (`variables-extension.ts`): `{ snapshot(): ReadonlyMap<string, { type: string; value: string; stale: boolean }>; subscribe(listener: () => void): () => void }`.
  É o armazém dos valores da aba (frente 3, RN-VAR-023); o editor só lê. A chave é o nome da variável. `type` é o tipo como o painel o escreve (`number`, `string[]`, `Date (dia)`, `number | null`:
  o autocompletar deduz daí os métodos); `value` é o texto do valor como o painel o escreve (`7`, `'Ana'`, `[1, 2, 3]`), que o editor só corta (200 caracteres na dica do ponteiro, 60 com `…` no
  fim da linha); `stale` é o valor de antes de a declaração mudar, que não aparece no fim da linha e na dica leva "desatualizado". **Quem avisa a mudança do texto da declaração é o armazém**: ele
  marca `stale` quando a declaração (ou uma de que ela depende) muda, e `subscribe` avisa. O editor também esconde, por conta própria, o valor da declaração que a pessoa acabou de mexer
  (RN-VAR-025), e a leitura seguinte (300 ms) não o devolve: ele só volta quando o armazém assume (marca `stale`, 400 ms depois da última tecla) ou traz uma avaliação nova, ou quando a pessoa
  desfaz a mudança. A origem e a hora vêm em `from` ("diálogo · 14:32:05"), e a dica do ponteiro mostra "nome: tipo = valor · origem · hora" (sem `from`, só "nome: tipo = valor"). `short` é o texto do
  fim da linha quando difere do `value` (a lista leva o " · 3 itens"); sem ele o editor corta o `value` em 60.
- **A ligação na aba.** `QueryTabPanel` (a aba de consulta e a de script são a mesma, e o único lugar onde o `SqlEditor` é montado) chama `useEditorVariables` (`use-tab-variables.ts`): o
  `declaredValues` do armazém do executor (`runner.values`) com a leitura do texto de agora, entregue a um armazém por aba (`editor-variables.ts`, de identidade estável, para o editor não se religar)
  que só avisa o editor quando o tipo, o valor, a origem ou o `stale` de algum nome mudou. O texto que a aba lê é o do editor (`liveEditors`), com o atraso da aba (`updateTab`, 400 ms), e o editor
  esconde por conta própria o valor da declaração que a pessoa acabou de mexer até lá. O fluxo inteiro (declarar, Alt+X, o painel, a dica do ponteiro e o fim da linha, o F5 e a atualização automática
  com os mesmos parâmetros) tem teste em `editor-variables.test.ts`, e a ligação na aba em `query-tab.test.ts`.
- **A leitura em segundo plano.** `analyze` roda 300 ms depois da última tecla (a primeira, ao abrir o editor, sem espera), e o atraso cresce com o que a leitura custou (quatro vezes o custo, de
  300 ms a 2 s), então um script grande é lido menos vezes. Entre uma leitura e outra as marcas só acompanham a edição (`RangeSet.map`): a tecla nunca espera pela leitura. Texto sem `let`, `const`, `@` nem `//` não
  é lido; acima de 100.000 caracteres (`analysisMaxChars`; medido: 0,4 a 0,5 ms por 1.000 caracteres, e a leitura do script é o custo; 165 a 200 ms para 190.000 com 500 declarações e 3.000 comandos com `@v`) não é lido e o editor fica sem as marcas.
  **Decisão (RN-VAR-014):** a leitura do editor roda na thread da tela, e não no Worker que a especificação pede. Ela não avalia o que depende da hora, da sorte ou do banco, a execução em seco
  tem 40 ms e o texto lido tem esse teto, de modo que a pausa de uma leitura fica abaixo de 50 ms; mover `readScript` e `checkScript` ao Worker custaria uma cópia do texto a cada pausa e um
  segundo canal de resposta. Se a medida passar disso, o caminho é o Worker (`evaluator-host`), e não subir o teto. A execução em seco do
  `checkScript` (os erros de tipo que se sabem sem o banco) tem 40 ms (`dryRunBudgetMs`): passado o tempo, o que só ela acharia é descartado, e os erros da leitura (`staticDiagnostics`) ficam. O
  `readScript` não tem versão incremental: o orçamento é a pausa, o atraso adaptativo e o teto. Os testes que leem a árvore do `lang-sql` usam `freezeParseBudget`.
- **O que cada coisa usa.** O realce e os erros vêm de `readScript` e `checkScript`; o `@nome` e a dica dele, de `findAtReferences` (`at-names.ts`); o corpo de rotina, de `statementHasBody`. Os textos entre aspas
  duplas e as crases das declarações são pintados como texto (o `lang-sql` os leria como nome entre aspas), e o `//` como comentário, só nos lugares da RN-VAR-001 (dentro das declarações e entre os itens, e só no script que declara alguma variável: sem nenhuma a execução é a de sempre, que não conhece
  o `//`, e ele vai ao banco como está); o `//` dentro de um comando, ou em um script sem declaração, é SQL, e a dica diz. As marcas ficam por dentro das cores do `lang-sql` (`Prec.highest`) e, por garantia, a cor vale também para os pedaços que o `lang-sql` pintou por dentro.
  O comentário colado ao valor (`i--`, `a //2`) só leva a dica quando o `--` ou o `//` está sem espaço antes dele, ou o resto da linha é só um número ou o nome de uma variável: `let x = 5 // nota` é um comentário
  comum e não leva dica (a especificação cita `a // b`, que não se distingue de um comentário no fim da linha).
- **A cor da variável** é a ficha `--color-syntax-variable` (a especificação a chama de `--editor-variable`: o nome segue as outras fichas de sintaxe, e o teste de contraste a confere em cada um dos temas (os seis do canvas e o Kanagawa)
  sobre as cinco superfícies, como as quatro de sintaxe). O `@nome` de uma variável `sql` leva o sublinhado pontilhado no tom do acento.
- **O valor no fim da linha** é um `Decoration.widget` (não é texto do documento: não se seleciona, não se copia, não entra no `getText` nem no Ctrl+S) com `aria-hidden`. A preferência é
  `editor.showVariableValues` (Configurações › Editor SQL, ligada por padrão; efeito `setShowVariableValues`).
- **O autocompletar** lê o script de novo a cada versão do texto (o nome que a pessoa acabou de declarar tem de aparecer, e a leitura em segundo plano pode não ter rodado), até 200.000 caracteres. Depois de `@`
  completa os declarados acima do comando; dentro do valor de uma declaração, os declarados acima, a lista fechada (`closedNames`), os membros de `Math.`/`random.`/`date.`/`Date.`/`Number.` e, depois de
  `.`, os métodos da espécie do valor (`methodNames`), quando o tipo se sabe pelo armazém ou pela anotação. Não completa no nome, na anotação, em texto nem em comentário. Dentro das declarações e depois do `@` de uma variável
  as palavras-chave e os nomes da árvore se calam. Segue a chave "Autocompletar ao digitar".
- **A caixa das palavras-chave** (`keywordCase(banco, linhaEmBranco)`) não converte dentro de uma declaração ou reatribuição: pergunta ao `scriptItemAt`, e só quando o texto tem `let` ou `const`.
- **O que muda de `SqlEditor`**: a prop `variables`; as preferências `blankLineSeparates` e o banco da aba disparam uma leitura nova (`reanalyzeVariables`).

## Proteções da conexão e da pasta (RN-PROT-001 a 006)

Seção 32 da especificação, pedido do dono em 2026-10-15 ("um modal pedindo confirmação do usuário antes de executar qualquer comando em uma conexão ou
pasta que o usuário desejar", e a conexão "apenas readonly, ou seja, permite apenas select"). Quem impõe o somente leitura é a API, que recusa o que não é
leitura antes de ir ao banco; a confirmação é da tela, que pergunta antes de enviar. A seção Proteções do formulário, a senha do somente leitura e o PATCH
que leva tudo estão em "Conexões", acima. O painel "Sessão da conexão" está lá também, e a verificação periódica e o "Só as conectadas" do navegador, na
seção seguinte.

- **O que é irreversível** (`_lib/irreversible.ts`, `irreversibleOf`, com teste nos três bancos). Lido pelo leitor único do projeto (`sqlTokens`): texto,
  nomes entre aspas, comentários de cada banco (o `{ … }` do Informix, o aninhado do PostgreSQL e do Db2) e `$tag$` não contam. É irreversível o `DROP`
  de qualquer objeto, o `ALTER` com um `DROP` dentro (`ALTER TABLE … DROP COLUMN`, também `DROP DEFAULT`: na dúvida, pergunta), o `TRUNCATE`, e o
  `DELETE` e o `UPDATE` sem `WHERE` no nível de fora: o `WHERE` de uma subconsulta não conta (o `UPDATE t SET a = (SELECT … WHERE …)` altera todas as
  linhas), e quem diz o nível é a profundidade de parênteses do comando. Contam as palavras que podem começar um comando: a primeira, a de depois de um
  `;`, de um `BEGIN` ou de um `ATOMIC` (o bloco do Db2), e, para `DELETE` e `UPDATE`, a de depois de `(` e de `)`: o comando principal depois do `WITH`,
  o `DELETE` de dentro das consultas dele (o `WITH` que grava, do PostgreSQL) e o `FINAL TABLE (UPDATE …)` do Db2. Na dúvida, pergunta: a coluna
  `update` sem aspas logo depois de um parêntese conta. Não contam: o `CREATE` (criar uma rotina ou um gatilho não executa o corpo dele), o `EXPLAIN`
  sem `ANALYZE` (só planeja; com `ANALYZE` vale o comando explicado), o `UPDATE STATISTICS` do Informix, o `ON CONFLICT DO UPDATE`, o `FOR UPDATE`, o
  `GRANT … UPDATE` e o `THEN UPDATE` do `MERGE`, que não começam um comando. O motivo volta com o objeto como foi escrito (`producao.apontamento`, com as
  aspas), que o aviso usa na frase ("Este DELETE não tem WHERE: ele apaga todas as linhas de producao.apontamento.").
- **Quando pergunta** (`_lib/command-confirmation.ts`, puro e testado): `commandQuestion` (o comando: em "Todos os comandos", sempre, com o motivo quando é
  irreversível; em "Só comandos irreversíveis", só o irreversível, e nunca na conexão somente leitura, em que a API o recusa antes do banco),
  `scriptQuestion` (uma vez, com os comandos que pedem e o número de cada um no script, e o total), `saveQuestion` (só em "Todos os comandos": cada
  comando do Salvar é pela chave da linha, com `WHERE`) e `autoRefreshQuestion` (só em "Todos os comandos": ela só repete uma leitura). A pergunta do Salvar
  com a coluna inteira (`wholeColumn`, RN-EDIT-019) vem sempre, pelo `always` do gancho, também sem proteção (o `level` do contexto é nulo então), e é a
  única daquele Salvar: ver "Editar várias células e a coluna inteira". As proteções
  vêm de `shownProtections` (`connections/_lib/protections.ts`): o `protections` da API, com a pasta de onde vem cada uma.
- **Quem pergunta** (`_lib/use-command-confirmation.ts`): a aba, pela conexão e pelo banco dela, com as proteções da lista de conexões do cache
  (`connectionsQuery`): mudar a proteção vale para o comando seguinte, depois do `invalidateLists` (outra janela tem o cache dela, e relê a lista quando
  ganha o foco). `confirm(monta, segue, cancelou)` monta a pergunta na hora do pedido; **sem pergunta, `segue` roda na mesma chamada**, e tudo fica como
  era sem a proteção (o destaque do comando, os testes que esperam o envio na hora). Com ela, o aviso abre (`open`), e só "Executar mesmo assim" chama
  `segue`. Um aviso por vez: o pedido novo cancela o de antes; desmontar a vista cancela o que esperava. `confirmed` é o mesmo como valor (verdadeiro na
  hora, ou a promessa da resposta), para o Salvar, que espera. Sem a conexão na lista, nada pergunta.
- **Onde** (`query-tab.tsx`): depois da pergunta das alterações não salvas (RN-EDIT-007) e logo antes de o comando sair, só quando o executor vai mesmo
  enviar (`commandWillRun`, `scriptWillRun`: com mais de um comando, ou a aba ocupada, ele só avisa, e nada pergunta). No "Executar" e no Ctrl+Enter
  (o destaque do comando acende só quando ele sai), no "Executar este comando", no "Executar script" (confirmado, roda inteiro, também o "Tentar de
  novo" da pergunta de erro), no F5, no "Executar de novo" e no "Atualizar" do menu da grade (pelo comando das linhas na tela, `rowsTargetOf`), no
  filtro e na ordem do resultado (pelo comando com o filtro junto; cancelado, o campo e o filtro em vigor ficam), no Salvar da grade (`confirmSave` de
  `useRecordEdits`, que espera a resposta e segue só se o resultado ainda é o mesmo; também nos Registros, que montam o aviso deles) e ao ligar a
  atualização automática (`confirmStart` de `useAutoRefresh`, só com ela desligada e livre para ligar: trocar o intervalo não pergunta). Os Registros
  (com o filtro e a ordem deles), a Estrutura, os diagramas, "Carregar mais" e "Contar total" não perguntam: é o que o Prism monta para mostrar o que a
  pessoa abriu.
- **O aviso** (`confirm-command-dialog.tsx`, o `ConfirmarComando` do canvas): um `alertdialog`, com a faixa do ambiente (o próprio ou o herdado) na cor
  dele e o texto em contraste (`environmentTextColor`), com a conexão e o banco da aba; sem ambiente, a faixa neutra. O título é "Executar comando
  irreversível?" quando ele é (também em "Todos os comandos": dizer que é irreversível é mais do que dizer que vai executar), senão "Executar
  comando?"; no script, "Executar script com comandos irreversíveis?" ou "Executar script?"; no Salvar, "Salvar as alterações?", com quantas vão e o "Ver
  SQL", que abre os comandos (`EditSqlDialog`) por cima do aviso; ao ligar, "Ligar a atualização automática?". O comando vai em código, que rola, com o
  filtro do resultado embaixo quando há; no script, a lista. Embaixo, por que o aviso aparece: a proteção da conexão, ou a herdada da pasta, com o nome
  dela. Os botões são os do canvas: "Executar mesmo assim" ("Executar script", "Salvar mesmo assim", "Ligar mesmo assim") só com o contorno do erro, e
  "Cancelar" cheio, com o foco. Esc, o X e o clique fora cancelam. O leitor de tela ouve, com o título, o que o comando faz e o comando (o
  `aria-describedby` do canvas, pelo `describedBy` do `Dialog` e os ids de `describedIds`), e não só o título e o "Cancelar"; no script e no Salvar, o
  resumo ("2 comandos de 12 são irreversíveis…"), sem a lista, que ele percorre no corpo. O script de um comando só em "Todos os comandos" diz "O comando do
  script pede confirmação", e não "Todos os 1 comando".
- **O somente leitura na tela** (RN-PROT-002). O cadeado do canvas (`ReadOnlyMark`) fica ao lado do nome da conexão na árvore (`NavigatorRow.readOnly`,
  do mapa que o `Navigator` monta), no botão da conexão da aba e na lista dele (`ConnectionButtonView.readOnly`, `ConnectionListView.readOnlyOf`), e a
  barra de status diz "Somente leitura". A dica é `readOnlyHintOf` ("Somente leitura" ou "Somente leitura, herdado da pasta Fábrica"), que é também o
  nome acessível do cadeado e entra no do botão da conexão. A grade não se edita: a página já vem com `editable: { known: true, reason: "a conexão é
  somente leitura" }`, e os itens ficam desabilitados com "Somente leitura: a conexão é somente leitura."; a conexão que passou a ser somente leitura
  depois do resultado responde o `edit-target` com `CONNECTION_READ_ONLY`, tratado como o resultado só leitura, com o mesmo motivo
  (`recordsCopy.edit.reasons.connectionReadOnly`), e o Salvar recusado assim mostra a frase na faixa. Esse motivo, o da página e o da recusa, só vale
  enquanto a conexão é somente leitura: `useRecordEdits` lê a proteção da lista das conexões em cache (`cachedReadOnly`, assinando o cache por
  `useSyncExternalStore`) e, desmarcada (RN-PROT-003), trata a página como a que não se sabe e pergunta o `edit-target` de novo (`readOnlyReasonNow`).
- **A recusa do comando** (`CONNECTION_READ_ONLY`, 422): o executor a trata no lugar, como o controle de transação recusado antes de executar (`failed`):
  nada foi ao banco, então com linhas na tela elas e o cursor ficam ("Carregar mais" continua), e a frase da API vai no aviso de erro; sem resultado, ela
  vai à área de resultado, com o aviso curto. No script, ela é o erro do comando (`scriptCommandRefusals`), e o script pergunta o que fazer.
- **O que não foi feito**: o cadeado na faixa de abas; e a conferência na tela (só os testes).

## Verificação periódica e Só as conectadas (RN-VERIF-001 a 003, RN-NAV-013)

Seção 32 da especificação, pedidos do dono e de um colega em 2026-10-15 ("validar a conexão fazendo o select 1 ou o usuário se informar qual select ele
quer fazer", "podia ter um filtro de conexões abertas"). A API já tinha a rota (`POST api/user/connections/{id}/verification`, que responde `ok`, `failed`,
`busy` ou `notConnected`, a falha do banco como resposta 200); o painel do formulário está em "Conexões".

- **Onde mora cada parte.** `_lib/connection-checks.ts` (puro, com teste): `createConnectionChecks`, a verificação de uma janela, com as dependências de
  fora (o pedido, a vez entre as janelas, o fim, o relógio e o bloqueio), e `checkView`, o que o indicador diz; os textos em `connection-checks.copy.ts`.
  `_lib/use-connection-checks.tsx`: a instância da janela (`connectionChecks`, de módulo, como o `vaultLock`), as conexões a verificar (`checkTargets`,
  puro), o `ConnectionChecks` que as entrega e avisa das passagens, e os ganchos dos indicadores (`useConnectionCheck`, `useConnectionChecksSnapshot`).
  `_components/connection-check.tsx`: o ponto (`CheckDot`), o ponto com o texto (`CheckLabel`, `ConnectionCheckLabel`) e a janela da falha
  (`CheckFailureDialog`). A rota é o `verifyConnection` de `connections.service.ts`, com o `connectionVerificationSchema`.
- **Um relógio por conexão conectada, numa instância por janela, e não um por componente.** Quem alimenta é o `ConnectionChecks`, montado UMA vez em
  `routes.tsx`, dentro do `WorkbenchProvider` (ele lê as abas; montado no provedor, o arquivo do provedor e o da verificação se importariam um ao outro).
  Ele monta os alvos a cada desenho (`checkTargets`: as conexões com a verificação ligada e conectadas nesta janela, na conta de `isConnected`, a sessão da
  árvore em cache, lida com `enabled: false`, ou uma aba com sessão; o intervalo; e as sessões numa chave) e os entrega por um efeito com a chave em texto.
  Os indicadores só leem: o navegador lê a foto inteira uma vez (as linhas não cabem num gancho por linha), e o botão da conexão da aba, a barra de status e
  o formulário leem a da conexão deles (o mesmo objeto enquanto nada muda: o botão fechado de cada aba não redesenha a cada verificação).
- **Um pedido por vez, e o intervalo conta do fim.** A conexão que entra espera um intervalo antes da primeira verificação (a sessão acabou de abrir, e a
  abertura já respondeu; até lá o indicador diz "Conectada, ainda não verificada"); a resposta agenda a seguinte, e com o pedido a caminho não há relógio.
  A conexão que desconecta (ou some da lista, ou desliga a verificação) sai na hora: o pedido a caminho é abandonado pelo `AbortSignal`, e a resposta dele
  não volta ao indicador. `notConnected` para a verificação da conexão até a chave das sessões mudar (uma sessão nova abriu, pela próxima ação na árvore ou
  na aba); a chamada que falhou (a API fora do ar) deixa o indicador como estava e tenta no intervalo seguinte. A falha nunca reconecta nada.
- **Entre as janelas, uma verificação por intervalo** (decisão desta entrega: a especificação diz "a tela", e cada janela tem a árvore e as abas dela). A
  conexão conectada em duas janelas seria verificada duas vezes por intervalo. Nenhuma janela fala com outra: antes de chamar a API a janela pede a vez ao
  processo principal (`claimVerification`, `prism:verification-claim`), que a dá (`window-hub.ts`, `claimVerification`) se nenhuma outra está verificando
  a mesma conexão e se a última verificação dela, feita por outra janela, não acabou há menos que o intervalo menos um segundo (`verificationSlackMs`). O
  fim (`finishVerification`, `prism:verification-finish`) solta a vez e manda a resposta às outras janelas com a área de trabalho montada
  (`prism:verification-peer`, `verificationPeerSchema`, conferido nos dois lados), que a mostram e recomeçam o relógio dela (`peer`): quem verificou por
  último é quem verifica de novo, e as outras só a ouvem. Sem a vez, a janela não chama a API e volta a contar. A resposta de outra janela com a verificação
  daqui a caminho, ou para uma conexão sem sessão aqui, fica de fora, e o `busy` e o `notConnected` de lá (que dizem das sessões de lá) só recomeçam o
  relógio. A janela que fecha no meio solta a vez (`remove`), e a que travou a solta em dois minutos (`verificationClaimTtlMs`). Fora do Electron a vez é
  sempre da janela. Só ids, o intervalo e a resposta da API passam: nada de nome, endereço ou SQL; o processo principal não chama a API.
- **Não é atividade nem comando em andamento** (RN-SEG-001). O pedido sai pelo `apiRequest`, e não pelo cache de mutações (a falha da chamada não vira
  aviso central) nem por um executor de aba (o bloqueio só olha a tecla, o ponteiro e os executores), então a verificação não segura o bloqueio nem o
  adia. Bloqueado, nada sai: os alvos ficam vazios (o `ConnectionChecks` lê o `vaultLock`), o relógio que disparar antes do desenho não pede a vez
  (`paused`), e o pedido a caminho é abandonado (a barreira dos pedidos o soltaria só no desbloqueio). Sair do cofre desmonta o `ConnectionChecks`, que
  esvazia a verificação.
- **O indicador** (`checkView`, RN-VERIF-003): "Respondeu na última verificação", o ponto do canvas, com "Respondeu às 14:32:05, em 3 ms" na dica (a hora
  do relógio da máquina, `clockOf`); "Não respondeu", no tom de erro, com a hora, o SQLSTATE e a mensagem do banco na dica; `busy` deixa como estava, com
  "Ocupada: verificada na próxima" na dica; "Sem sessão aberta" (o anel no tom do acento); antes da primeira resposta, o anel verde. Com a verificação
  desligada não há indicador: fica o ponto de conectada de sempre. Na árvore ele fica no lugar do ponto de conectada, e a dica dele vai também na dica da
  linha: com o mouse em cima, as ações da linha cobrem o ponto. No botão da conexão da aba (o pedido desta entrega, além da barra de status que a
  especificação cita) ele vai na ponta, depois do cadeado, e entra no nome acessível depois dele. Na barra de status ele troca o "Conectada", com o
  texto; no formulário, à direita da linha da caixa.
- **A falha num clique**, como o erro de um nó da árvore (RN-ARVORE-005): na árvore, um botão das ações da linha ("Ver por que MES Produção não
  respondeu", o `AlertIcon`), só com a conexão sem responder; na barra de status, o próprio texto "Não respondeu". Os dois abrem a `CheckFailureDialog`
  (a hora, o tempo, a mensagem como veio, o SQLSTATE, e que o Prism não reconecta sozinho), que acompanha as respostas seguintes e fecha de vez quando a
  conexão volta a responder (ajuste durante a renderização: a falha seguinte não a reabre sozinha).
- **Os avisos de passagem**: de responder (ou de ainda não verificada) a não responder, um aviso de atenção ("MES Produção não respondeu à verificação"),
  uma vez, e não de novo enquanto ela continuar sem responder; de volta, um de sucesso ("MES Produção voltou a responder à verificação"). Cada janela que
  verifica a conexão avisa na dela, também com a resposta que veio de outra (a pessoa pode estar olhando qualquer uma). O nome é o de agora.
- **"Só as conectadas"** (`navigator-connected-filter.tsx`, `_lib/navigator-connected.ts`, RN-NAV-013): um botão de alternar (`aria-pressed`) na linha
  abaixo do campo de busca, antes do seletor de ambiente (`NavigatorFilters`, ver "A barra de filtros"), com a largura do texto, que nunca é cortado, e a conta das conectadas ("3 conectadas", "1
  conectada", "Nenhuma conectada"), ligado ou não. O nome acessível é o rótulo com a conta ("Só as conectadas: 3 conectadas", o rótulo num `sr-only`), e a
  dica diz o que o clique faz agora. Conectada é a definição única (`connectedConnectionIds`), então a que desconecta sai na hora e a que conecta por uma
  aba ou por um script entra. A que a verificação achou sem sessão na API (`notConnected`) também sai, e a conta não diz "conectada" ao lado do indicador
  que diz "Sem sessão aberta": a sessão da árvore em cache e o `sessionId` das abas continuam lá, mortos, e ninguém os apaga (a próxima ação na árvore ou na
  aba abre uma nova, a chave das sessões muda e ela volta a contar). O ponto, o "Desconectar" e a barra de status seguem com o `isConnected`: com a
  verificação ligada o indicador já diz o estado, e "Desconectar" encerra o que ainda houver. O filtro (`filterConnected`, puro) roda sobre o que o seletor de ambiente deixou, pelo mesmo `withFolderPath` (as pastas no
  caminho até as conexões), e a busca filtra depois; os memos do `Navigator` dependem de uma chave em texto com as conectadas, só com o filtro ligado, e a
  árvore não se refaz com ele desligado. Ligado, as pastas no caminho até as conexões à vista abrem só nessa vista, sem gravar (RN-NAV-014). Ligado e vazio, `NavigatorFilteredEmpty` diz "Nenhuma conexão conectada." (com o ambiente, quando há) com "Mostrar
  todas", que o desliga. É estado do navegador, como o ambiente: vale enquanto a janela está aberta. A conexão que o formulário acabou de salvar, ou a
  duplicada, desliga os dois filtros quando eles a escondem.
- **O que não foi feito**: a verificação de cada banco aberto da conexão (RN-ARVORE-006; uma sessão qualquer da conexão responde por ela, como a
  especificação deixa para depois) e a conferência na tela (só os testes; o arrasto entre janelas sob o Xvfb não foi refeito para a vez da verificação).

## Exportar e importar conexões (RN-TRANSF-001 a 016)

Seção 34 da especificação, pedido do dono em 2026-10-16 ("compartilhar alguns dos bancos ou todos os bancos e eu decidir se deve ir o usuário e senha
junto"). **Quem monta e quem lê o arquivo é a API**: a tela nunca recebe uma senha de banco (RN-CONN-001). Na exportação ela recebe o texto do arquivo já
cifrado e o entrega ao diálogo de salvar do sistema; na importação ela lê o arquivo escolhido como texto e o manda à API, que o abre e devolve a prévia. O
Electron não ganhou canal novo.

- **Onde mora cada parte** (`src/app/connections`). `_lib/transfer.schema.ts` (o contrato das três rotas, com zod: a prévia que traga `password` é recusada
  por inteiro, e o item que não pode ser importado vem como veio, com os textos nulos e o banco que este Prism não conhece nulo), `_lib/transfer.service.ts`
  (as rotas, as recusas que cada diálogo mostra no lugar, `exportRefusals` e `importRefusals`, e as mutações `exportMutation`, `previewMutation` e
  `importMutation`), `_lib/transfer.copy.ts` (todos os textos), `_lib/passphrase.ts` (a senha de exportação), `_lib/check-tree.ts` (a árvore de marcar, a
  mesma nos dois diálogos), `_lib/export-model.ts` e `_lib/import-model.ts` (o que cada diálogo decide), todos puros e testados; e os diálogos,
  `export-connections-dialog.tsx` e `import-connections-dialog.tsx`, com `check-tree-view.tsx` (a caixa de três estados, a linha e a busca). O navegador os
  abre (`TransferDialog` em `navigator.tsx`, um de cada por janela).
- **As entradas** (RN-TRANSF-001, `navigator-menu.ts`): "Exportar conexão…" na conexão (só ela marcada), "Exportar conexões…" e "Importar conexões aqui…" na
  pasta (ela e tudo o que está dentro marcados; ela como o lugar), e, no espaço vazio, "Exportar conexões…" (nada marcado; desabilitado, com "Não há pastas
  nem conexões para exportar.", sem pasta e sem conexão no cofre) e "Importar conexões…" (na raiz). Valem em qualquer estado da conexão. A barra de ações não
  ganhou botão (não cabe, RN-NAV-002), e a seção Scripts não tem as entradas. Os ícones são a seta de baixar (`DownloadIcon`) e a de subir (`UploadIcon`).
- **Nada sobra quando o diálogo fecha.** As marcas, as escolhas, as senhas digitadas, o arquivo lido e a prévia são estado do diálogo, e mais nada: nem o
  navegador, nem as preferências, nem `localStorage`. O bloqueio e o "Sair" os fecham (o navegador guarda a época do bloqueio com o diálogo aberto e o tira
  quando ela muda; o "Sair" desmonta tudo). **As chamadas que levam senha ou arquivo não ficam no cache de mutações**: as três mutações têm `gcTime: 0` (a
  mutação sem observador, do diálogo que fechou antes da resposta, sai do cache quando ela chega) e o diálogo chama `reset()` assim que a resposta chega,
  também na recusa e na falha (assinada, ela ficaria lá com `variables` e `data`). O `transfer.service.test.ts` roda as mutações num cache de verdade e
  confere o cache vazio depois de cada chamada; os testes dos diálogos conferem o `reset()`.
- **A árvore de marcar** (`check-tree.ts`, RN-TRANSF-002 e 011). **O que se marca são as folhas**: as conexões e as pastas vazias; na prévia, também a pasta que
  pode ser importada e só tem dentro o que não pode (ela vai sozinha, e a API a conta marcada na prévia), que tem a caixa dela e continua com a seta de abrir e
  fechar (`node.end > node.index + 1`, e não `!leaf`). A caixa da pasta com algo que se marca dentro mostra o estado de tudo o que está dentro dela, à vista ou
  não (`checkStates`, de baixo para cima, de uma vez), e o clique nela marca ou desmarca esse conteúdo; com a busca, "Marcar todas", "Desmarcar todas" e a caixa
  da pasta agem só no que a busca mostra (`visible`). **As pastas fechadas são guardadas como no navegador** (`Collapsed`, `collapsedFor` e `toggleCollapsed`,
  RN-BUSCA-001): as fechadas sem busca e as fechadas na busca de agora, à parte; com a busca, o que casa aparece com os ancestrais abertos (a pasta fechada
  antes dela abre), outro texto começa com tudo aberto, e limpar a busca devolve as fechadas de antes. As pastas do caminho de cada folha marcada vão sozinhas
  (`foldersInFile`): por isso a pasta de uma conexão marcada fica mista e não há como deixá-la de fora. O que outra janela excluiu sai com a marca
  (`validMarks`), e o que ela criou aparece desmarcado. A lista não é virtual: o Tab anda por todas as caixas e escolhas, e as linhas têm
  `content-visibility: auto` para o navegador pular o desenho das que estão fora da vista (com 4.000 linhas, RN-TRANSF-006). A caixa mista é o `indeterminate`
  do próprio `<input>`, posto pela referência a cada desenho (`indeterminateRef`, testada sem DOM). **Acessível**: a caixa tem o nome do item e, por
  `aria-describedby` (um texto `hidden`, que o leitor lê pela ligação e não de novo ao percorrer a lista), o caminho de pastas (`pathOf`, "Na pasta Estoque /
  Production PRD": as "NOMINAL" se repetem em cada ambiente), também na escolha do que vai; na prévia, também a segunda linha e cada marca com a explicação dela
  (`rowDescription`), que na tela só está na dica do mouse. A seta da pasta tem um nome que não muda ("Conteúdo de Estoque") e o `aria-expanded`. O motivo do
  item que não pode ser importado aparece inteiro, numa linha que quebra (`note`), e não no fim da segunda linha, que corta. **O Enter nunca envia o formulário
  sem querer**: o botão de enviar fica no rodapé (o atributo `form`), e o navegador transformaria o Enter numa busca, numa caixa, num rádio ou em "Mostrar
  senha" em envio. Os dois diálogos barram o Enter num `<input>` (`enterInputID`, no `onKeyDown` do formulário): na exportação, menos nos dois campos da senha,
  onde ele exporta; na importação, sempre (importar é só o botão), e na senha de exportação, antes da prévia, ele é o "Abrir arquivo". A busca engole o Enter
  dela também.
- **Exportar** (RN-TRANSF-002 a 008). A árvore é a das listas do navegador, inteira, sem os filtros dele; aberto pela conexão ou pela pasta, o diálogo rola
  até ela. Cada conexão tem a escolha do que vai ("Sem usuário e senha", o padrão; "Só o usuário"; "Usuário e senha"), só com o que ela tem gravado
  (`credentialsOffered`) e desabilitada quando desmarcada; os botões "Para as marcadas:" põem a escolha em todas (as que a busca mostra), cada uma com o mais
  perto que ela tem (`closestCredentials`). A senha de exportação (`passphrase.ts`): NFC antes de contar e de usar, de 12 a 128 unidades UTF-16, sem espaço
  nas pontas pela lista da RN-TRANSF-004 (e não o `trim()`), sem caractere de controle; as duas comparadas em NFC; a mesma lista de casos de teste vale na
  API. A ordem ao clicar "Exportar…": os limites que a tela sabe (2.000 conexões, 2.000 pastas, 32 níveis da raiz, `exceedsLimits`), as recusas da senha,
  e só então, com alguma senha de banco no arquivo, o "Confirme a sua senha" (o `UserPasswordDialog` genérico, com o texto e o botão da exportação, na
  mesma contagem de cinco erros); sem senha de banco, o pedido sai direto, sem `userPassword`. A recusa que não é da senha do Prism fecha o "Confirme a sua
  senha" e volta ao diálogo: a senha de exportação igual à do Prism no campo dela (a frase é da tela), os limites acima dos botões, e o item que outra janela
  excluiu (as listas vêm de novo, o aviso de erro diz o que fazer e o diálogo fica). Feita a exportação, o texto vai ao `saveText` (o do "Exportar CSV")
  como `conexoes-prism-AAAA-MM-DD.prismconexoes` (a data da máquina), tipo `application/octet-stream`, e o aviso de sucesso diz o que foi; a resposta que
  chega com o cofre bloqueado, ou depois de um bloqueio (a época mudou), é descartada.
- **Importar** (RN-TRANSF-009 a 014). Um `<input type="file" accept=".prismconexoes">` escondido, aberto pelo botão "Escolher arquivo…"; o de mais de 5 MiB é
  recusado antes de ser lido, e o resto é lido por `File.text()`. A senha perde os espaços das pontas (a mesma lista) e passa a NFC. "Abrir arquivo" pede a
  prévia; trocar o arquivo ou a senha a apaga (`generation`: a resposta de um pedido de antes é ignorada), e com ela o que era dela: a busca, as pastas fechadas (as
  chaves `f1`, `c1`… se repetem de um arquivo para outro), a escolha dos conflitos e a caixa "Manter as consultas de verificação do arquivo", que volta
  desmarcada (o arquivo de outra pessoa não herda o "manter" do de antes); o lugar fica; trocar "Onde colocar" com ela à vista a refaz e
  mantém as marcas, um pedido por vez (a troca durante o pedido espera e refaz uma vez, com o último lugar). As recusas da leitura vão ao campo a que se
  referem, com a frase da tela (`readRefusal`), sem aviso: a senha recusada fica no campo, selecionada; a do arquivo leva o foco ao "Escolher arquivo…"; a
  pasta escolhida que sumiu deixa "Onde colocar" sem escolha. As frases do arquivo e do lugar têm `role="alert"`, e a frase de cima da prévia (a que diz
  como chegar a ela, "Abrindo…" e o resumo) é uma região `aria-live` que está sempre na tela, para o resumo ser anunciado quando chega. A prévia mostra o resumo, o aviso de conferir os servidores, a árvore do arquivo (o que não pode ser importado sem caixa que se marque, com o
  motivo) e as marcas de cada linha (`folderTags`, `connectionTags`: "já existe", "entra como …"/"não será importada", o que a importação grava para não
  ficar mais fraco, com a pasta do arquivo que dava a proteção na dica, e "consulta própria", com a consulta inteira); a escolha dos conflitos e a caixa
  "Manter as consultas de verificação do arquivo" só aparecem quando há o que escolher. Importado, as listas vêm de novo (na `onSuccess` da própria
  mutação), o aviso diz o que aconteceu (`importToast`), e o navegador abre as pastas até o que entrou e dá o foco à primeira linha importada
  (`importRevealOf`, em `navigator-reveal.ts`, depois de as listas trazerem tudo, `importArrived`); com um filtro que a esconda, à pasta de destino ou à
  primeira linha à vista, e os filtros ficam.
- **A conexão sem usuário e senha** (RN-TRANSF-015 e 016, `workbench/_lib/credentials-missing.ts`). A dica da linha na árvore ganha " · sem usuário e senha"
  ou " · sem senha" (`credentialsHint`); a linha não ganha marca. Abrir uma sessão com ela é recusado pela API com 422 `CONNECTION_CREDENTIALS_MISSING` no
  campo que falta (`credentialsMissingField`), que não vira aviso (é erro de campo). Quem abre sessão pede o "Editar conexão" pelo `credentialsRequests` (um
  pedido só, o último): o executor da aba pede direto (a aba fica com o resultado de antes e o comando sem sair), e as sessões da árvore (o nó, a Estrutura,
  o Diagrama, a lista dos bancos da barra do editor, outro banco do servidor) são observadas no cache (`watchCredentialsMissing`, ligado pela página da área
  de trabalho). O nó da conexão recusada fica fechado e desconectado, sem a linha de erro (`lacksCredentials`, em `navigator.tsx`). A página atende o
  pedido uma vez, com a área de trabalho na tela, e não abre por cima de um diálogo de conexão já aberto. O formulário, aberto assim ou pelo menu, diz no
  topo o que falta e põe o foco no campo (`missingCredentials`); salvar a edição de uma conexão sem senha gravada exige a senha
  (`editWithoutPasswordSchema`), e "Testar conexão" com a senha em branco leva a recusa da API ao campo da senha.
- **O contrato** (conferido, campo a campo, com o `UserConnectionTransfersController` e os DTOs da API desta versão): `POST api/user/connections/export` com
  `{ folderIDs, connections: [{ id, credentials }], passphrase, userPassword? }` → `{ content, folders, connections, withUser, withPassword }`; `POST
  api/user/connections/import/preview` com `{ content, passphrase, targetFolderID }` → `{ folders, connections }` (os campos da tabela da seção 34); `POST
  api/user/connections/import` com `{ content, passphrase, targetFolderID, items, onConflict, keepVerificationQueries }` → `{ folderIDs, connectionIDs,
  mergedFolders, renamed, skipped }`. As recusas de campo vêm com o nome da propriedade em PascalCase (`Passphrase`, `UserPassword`, `Content`, `Items`,
  `UserName`, `Password`), como em toda a API, e o `apiRequest` as entrega com a primeira letra minúscula (`toFieldErrors`). Os diálogos decidem pelo código;
  o campo diz qual falta na `CONNECTION_CREDENTIALS_MISSING`, e dá o texto da API só onde a tela não tem frase própria. `IMPORT_FILE_NEWER` é 409, e as
  demais recusas da leitura, 422. Os testes simulam a API.
- **O que não foi feito**: a conferência na tela com a API de verdade (cada lado tem os testes dele, e o contrato foi conferido no código), e o diálogo de
  salvar do sistema concluído por uma pessoa, como no "Exportar CSV".

## Importar do DBeaver (seção 40, RN-DBEAVER-001 a 018 e RN-CONFIG-011)

- **A origem é o `sourceId`** da cópia que o processo principal fez (acima); a tela nunca recebe caminho nem senha, e a prévia diz só se a conexão leva senha. As
  rotas (`connections/_lib/dbeaver.service.ts`, `dbeaver.schema.ts`): `GET api/user/connections/dbeaver` → `{ invitedAt, lastImportAt }` (a consulta
  `dbeaverStateQuery`); `PUT …/dbeaver/invite` → 204 (`markInvited`, que nunca lança: a falha só faz o convite voltar); `POST …/dbeaver/scan` `{ sourceId }` →
  `{ where, projects: [{ name, connections, importable, withPassword, protected, nameInvalid, credentialsUnreadable, credentialsProtected }] }`; `POST
  …/dbeaver/import/preview` `{ sourceId, project?, targetFolderID, withPasswords, drdaPorts? }` → `{ folders, connections, notes }`; `POST …/dbeaver/import` com
  o mesmo mais `{ items, onConflict, overwrite }` → `{ folderIDs, connectionIDs, updatedIDs, mergedFolders, renamed, skipped }`. `project` é o nome inteiro do
  projeto e some do corpo para "Todos os projetos". As recusas que o diálogo mostra no lugar (`dbeaverRefusals`): `DBEAVER_SOURCE_MISSING`,
  `DBEAVER_SOURCE_INVALID`, `DBEAVER_PROJECT_NOT_FOUND`, `DBEAVER_LIMITS_EXCEEDED` e `FOLDER_NOT_FOUND`; `IMPORT_EMPTY` e `IMPORT_INVALID` vão ao aviso central.
  O schema tolera o que a API pode omitir (`notes`, `existing` e `overwrite` nulos, o `leftOut` com código que a tela não conhece é ignorado). A conexão da prévia
  traz também `dbeaverPort` (a SQLI do DBeaver no Informix; `port` é a que a conexão terá), `drdaPort` e `authModel` (o `<modelo>` de "o login do DBeaver"), o
  `existing` traz o que a conexão do Prism tem hoje (`host`, `port`, `database`, `userName`, `environmentName`) e o `notes`, `unreadableProjects` (os projetos de
  que nenhum arquivo foi lido, que levam a frase no plural).
- **O diálogo** (`connections/_components/import-dbeaver-dialog.tsx`; o que se decide está em `_lib/dbeaver-model.ts`, puro e testado): o "Importar conexões" da seção 34
  com outra origem. Reusa a árvore de marcar, as marcas e a conta do rodapé (`import-model.ts`), as linhas de pasta e as marcas (`ImportFolderRow`, `Tags`). Abre
  procurando sozinho (`start: { type: "find" }`), pedindo a pasta (`choose`) ou com a cópia do convite (`copy`); a prévia vem sozinha, sem botão. A cópia é solta ao
  fechar, ao trocar de origem e em qualquer saída (a limpeza do efeito; a resposta que chega depois de fechar solta a que trouxe). Trocar "Levar as senhas", o lugar
  ou as portas DRDA refaz a prévia com as marcas, um pedido de cada vez; **trocar o projeto pede a prévia dele e as marcas continuam** (`marksAfterScopeChange`): a API dá a mesma chave
  (`p2`, `f2_1`, `c2_1`: a posição do projeto e a ordem dentro dele) ao mesmo item em "Todos os projetos" e com o projeto escolhido, então valem as marcas que ainda existem na árvore
  nova, e o que a árvore de antes não tinha chega marcado; sem prévia à vista (a anterior foi recusada), abre de novo, tudo marcado. A recusa da importação deixa o diálogo aberto; só `DBEAVER_SOURCE_MISSING` apaga a
  origem. **Importar com alguma marcada que já existe no Prism abre a pergunta** (RN-DBEAVER-017), que ocupa a janela (o foco começa em "Cancelar", Esc volta ao
  diálogo): "Sobrescrever todas", "Escolher quais…" (a lista com caixas, o que muda e, quando a prévia traz os valores de antes, "host a → b") e "Não sobrescrever
  nenhuma"; as três mandam todas as marcadas em `items` e as que se sobrescrevem em `overwrite`.
- **A porta DRDA do Informix** (RN-DBEAVER-010 e 015, emenda do arquiteto): uma tabela com uma linha por servidor do DBeaver (host, porta
  SQLI e `INFORMIXSERVER` como a prévia os dá, porque a API os compara assim; `drdaRows`) com conexão Informix marcada, cada uma com um campo opcional (1 a 65.535). O preenchido vai em `drdaPorts: [{ host, port,
  server, drdaPort }]` na prévia e na importação (`port` é a SQLI do DBeaver, o `dbeaverPort` da prévia, e não o `port` dela, que já é a DRDA depois de aplicada: a chave que a API casa) e vale para as conexões novas e as
  sobrescritas daquele servidor; a segunda linha mostra a porta digitada e a marca "porta do DBeaver" sai. A prévia se refaz 500 ms depois da última tecla, e
  "Importar" com uma porta ainda não vista por ela refaz primeiro e segue.
- **O "Comece por aqui"** (`workbench/_components/start-here.tsx`) é decidido uma vez por entrada pela página (`startHerePhaseOf`, em `dbeaver-entry.ts`): o cofre sem
  conexão e o convite por fazer; enquanto as duas respostas não chegam, a área fica vazia. O cartão do DBeaver procura e conta ao aparecer e **solta a cópia assim que
  a contagem responde**; fora do Electron diz que só funciona no app. Clicar em qualquer botão do painel, ou em "Agora não", grava o convite (a página). **O convite em
  forma de diálogo** (`inviteStep`): `Entrar` e `Criar usuário` armam `dbeaverEntry` (a janela de entrada é a única que convida; o desbloqueio não passa por ali), e a
  página, com o cofre já com conexão e o convite por fazer, procura e conta sem mostrar nada: achando o que importar abre o diálogo com a cópia (`invite: true`, "Agora
  não"), senão solta a cópia e não grava o convite. O bloqueio e o "Sair" fecham o diálogo sem gravar.
- **Os diálogos de passar conexões são da página** (`workbench/page.tsx`, um por janela; `transfer-requests.ts`): o "Exportar conexões", o "Importar conexões" e o
  "Importar do DBeaver" não abrem juntos nem com o formulário de conexão (a entrada de um, com outro aberto, leva o foco ao aberto), e somem com o bloqueio e quando a
  área de trabalho sai da tela (`keepsTransfer`). O navegador pede por `onTransfer`; Configurações › Importar (RN-CONFIG-011, `settings/_components/import-section.tsx`)
  pede por `transferRequests` e vai à área de trabalho. O que a importação criou volta ao navegador por `importedReveal` (e ele aparece, se estava escondido).
- **O que não foi feito**: a conferência com a API de verdade (o contrato é o da seção 40 mais a emenda da porta DRDA, e cada lado tem os testes dele), com um DBeaver
  instalado (as sondas S-DBEAVER-1 a 3 são do arquiteto) e sob o Electron (os testes cobrem o processo principal em pastas de verdade, mas não o diálogo de pasta do sistema).

## Copiar como e Copiar avançado (RN-GRADE-003, 016 e 017)

Seção 37 da especificação. Os escritores, as escolhas lembradas e os dois diálogos são puros ou só de propriedades e estado; a ligação com a seleção da
grade (o submenu "Copiar avançado" do menu, o Ctrl+Shift+C, a pausa da atualização automática, a busca dos completos, a área de transferência e os
avisos) é `use-copy-as.ts` (ver "A ligação", no fim desta seção), nos Registros, no resultado da aba de consulta e em cada aba guardada do script.

- **Os nove documentos de texto** (`_lib/grid-export/`: `document.ts` com os tipos, `documents.ts` com o escritor de cada formato e as duas montagens, e
  um arquivo por formato: `to-csv.ts`, `to-txt.ts`, `to-html.ts`, `to-markdown.ts`, `to-json.ts`, `to-source-code.ts`, `to-sql.ts` e `to-xml.ts`, com o
  XML e o DbUnit). **Cada um é o escritor da API portado linha a linha** (`Prism.Infrastructure/Transfers/Writers`): `begin`, `write` a cada linha e
  `end`, cada um devolvendo o pedaço que escreveu, com as mesmas contagens (`DocumentCounts`: os valores cortados do TXT, os caracteres tirados, as linhas
  comentadas do SQL, e `notWhole`, só da tela, os valores que ficaram cortados). As opções são as da exportação (`FormatOptions`, de
  `data-export/export-options.ts`), os números ainda como o texto do campo. O texto sai com o par substituto solto como U+FFFD (`wellFormed`, a troca do
  UTF-8 da API) e o tamanho conta em UTF-8 (`utf8Length`). `writeDocument` monta de uma vez; `buildDocument` monta em partes, cede a vez à tela a cada
  5.000 células (`pause`), para no limite (`clipboardLimitBytes`, 10 MiB: passar recusa, chegar não) e desiste pelo sinal. O que a linha da grade tem e o
  arquivo da API não: `number` (o da grade, que o comentário do SQL escreve; `null` na linha nova ainda não salva), `cut` e `generated` (a célula "gerado
  pelo banco"), que viram o nulo nos formatos de dados e o comentário de frase fixa no SQL (`document.copy.ts`, RN-GRADE-016); no JSON e no Código fonte o
  valor cortado nunca é número. O binário chega como a grade o escreve (`0x…`): o hexadecimal nos formatos de dados, o nulo com "Deixar vazio", e no SQL o
  literal (`binaryLiteral`: o `decode('…', 'hex')` do PostgreSQL; no Db2, pelo tipo da coluna, o `BX'…'` do `BINARY` e do `VARBINARY`, o `BLOB(X'…')`
  do `BLOB` e o `X'…'` do texto `FOR BIT DATA`, em pedaços de 16.336 bytes; e no Informix a linha comentada), como a RN-EXPORT-011 e a API dizem. **Mudar
  uma regra de formato é mudar os dois lados e a fixture.**
- **O nome do XML** (`xml-name.ts`) é o `XmlConvert.EncodeLocalName` do .NET, unidade UTF-16 por unidade, com o `_x` já escrito ganhando o `_x005F_`. O
  que cabe num nome é o do XML 1.0 da **4ª** edição (o Apêndice B, do Unicode 2.0), e não o da 5ª: um caractere mais novo vira escape também no meio do
  nome. As duas tabelas de faixas vieram do próprio .NET 10 (caractere por caractere do plano básico, uma vez, por um programa descartável) e o
  `xml-name.test.ts` confere a forma delas; a regra, a `xml-name.json`, dos dois lados. As maiúsculas do DbUnit são as do `ToUpperInvariant`
  (`upperInvariant`): a maiúscula simples de cada ponto de código (o `ß` e o `ﬁ` ficam), o `ı` fica (como o .NET faz com o ICU), e as formas gregas com
  iota subscrito vão à simples (`ᾳ` → `ᾼ`); comparado em todos os pontos de código contra o .NET 10, só diferem os caracteres que o Unicode de um dos
  dois ainda não tem (cinco do plano básico, `U+019B`, `U+0264`, `U+1C8A`, `U+A7CD` e `U+A7DB`).
- **A prova de que os dois lados escrevem o mesmo**: as fixtures (`export-fixtures.test.ts` aqui, `ExportFixturesTests` na API), com a `document.json`
  dos dois lados (as opções como a rota as recebe: a API as lê pelo `ExportOptionsReader`, e o binário deixado vazio chega nulo, como na leitura dela) e a
  `copy-as.json` só daqui. Além delas, uma conferência descartável (não está no repositório) escreveu 20 mil documentos sorteados (os nove formatos, os três
  bancos, opções sorteadas, nomes e valores hostis, lotes do TXT de mais de 200 linhas) pelos dois lados e comparou o texto e as contagens: nenhuma
  diferença. **Para repetir depois de mudar um escritor**: um teste temporário escreve os casos e o texto da tela num JSON (as cadeias como unidades UTF-16,
  porque o `System.Text.Json` recusa o par solto), e um programa do .NET que referencia o `Prism.Infrastructure.dll` chama `ExportFormats.Create` (é
  `internal`: por reflexão) e compara.
- **A origem da cópia e a cópia** (`_lib/copy-as/copy-as.ts`, puro). `CopySource` é o contrato com a seleção: o banco, o nome da origem (o da tabela nos
  Registros, `resultSourceName` no resultado), a tabela de destino quando se sabe (a dos Registros, ou a do alvo da edição de uma tabela só, RN-GRADE-020;
  `null` quando não) e as colunas (`CopyColumn`: o nome, o tipo do banco, o da grade e o `generated` do alvo) e as linhas (`CopyRow`: os valores como a
  grade os mostra, com a pendência, o lido na linha excluída e o preenchido na nova; `number`, `cut` e `generated`). `pickColumns` restringe às colunas da
  seleção. `runCopyAs(pedido, peças)` recusa no SQL, antes de tudo, a coluna repetida (`duplicateColumn`: duas das colunas que vão no `INSERT` com o mesmo
  nome, pelo `duplicateOf` da exportação, que diz o nome que aparece primeiro, como o `GroupBy` da API, e lê só os nomes, sem montar as linhas; com a frase do "Copiar como", "O resultado tem duas colunas chamadas id: deixe uma de fora da seleção.",
  `duplicateColumnRefusal`; a tabela de destino não a resolve, e os outros formatos copiam o nome repetido), confere a tabela do SQL e do DbUnit (`needsTable`: sem ela, `needsTable`, e a tela abre o "Copiar avançado…" no
  formato, com `focusTable`), tira do SQL as colunas `generated: always` sem "Incluir as colunas que o banco calcula" (sem nenhuma que sobre, `noColumns`,
  com uma frase que a especificação não escreve), e, com célula cortada que o documento escreve com o valor (`cutCellsToFetch`, RN-SQL-017: nas colunas
  que vão, menos o binário com "Deixar vazio", ou "NULL" no SQL, que sai nulo, e o binário no SQL do Informix, que não tem literal e comenta a linha com
  qualquer valor; o `sqlWriter` não comenta como "não pôde vir inteiro" a cortada desses dois), monta antes com o que a grade tem e recusa sem buscar o que
  já passa do limite; depois busca os completos só dessas (`complete(origem, células, keepGoing, sinal)`, a peça da tela, que devolve a mesma origem com os
  valores inteiros e as marcas das que não vieram e das não pedidas, e `stopped`; ou `null` cancelada). O `keepGoing` é exato (`fetchMeter`): a cada lote, as
  linhas do começo que já têm todos os valores são escritas pelo escritor do formato, só para medir, e passado o limite a busca para (`tooLarge`); a largura
  do TXT, o que o HTML e o XML tiram e a linha que o SQL comenta já estão na conta, e nenhuma cópia que caberia é recusada. Monta e põe na área de
  transferência (`write`; a recusa, a promessa rejeitada e a exceção na hora, sem `navigator.clipboard`, são `failed`, "Não foi possível copiar."). As fases (`onPhase`: `writing`, `fetching`)
  são para a faixa e o diálogo. O aviso é `copyAsNotice` ("3 linhas copiadas em JSON.", e o resumo depois do ponto, no tom de atenção). A prévia,
  `previewOf`: o começo do texto (até 100 linhas e 64 KB, sem partir um par), escrito só com as linhas que ele precisa (no TXT, o primeiro lote inteiro,
  para as larguras serem as de verdade), com as cortadas como a grade as tem; no SQL com a coluna repetida, vazia, com a recusa (`refusal`), que o diálogo
  mostra no lugar do texto.
- **As escolhas lembradas** (`copy-as-choices.ts`): `prism:copy-as:<usuário>` no `localStorage`, separada da `prism:data-export:` da exportação
  (RN-GRADE-017), com o último formato do "Copiar avançado…" e as opções de cada formato, lidas pela mesma leitura tolerante da exportação
  (`parseFormatOptions`, `rememberedFormatOptions` e `storedObject`, de `export-choices.ts`); a tabela de destino é da origem e não se grava
  (`readCopyAsChoices(usuário, targetOf(origem))`). O "Copiar como" direto lê as escolhas na hora do clique.
- **Os diálogos** (`_components/copy-as/`, só de propriedades e estado; o teste os roda com os ganchos simulados). `CopyAdvancedDialog` recebe as três
  origens de "O que copiar" (`sources`: `cells`, `rows`, `loaded`), as escolhas, o formato e o foco iniciais, e `onCopy` (o `runCopyAs` da tela, que avisa
  quando copiou), `onRemember` (no clique em "Copiar") e `onClose`; o "Cancelar a busca" aborta o sinal que ele passa ao `onCopy`. `ConfigureCopyAsDialog`
  recebe as escolhas e entrega todas as opções no `onSave` (quem o abre grava, avisa "Opções do 'Copiar como' salvas." e fecha). Os dois usam a lista
  `CopyFormatList` (a marca do formato com campo recusado também para o leitor de tela; a coluna repetida do SQL vai em `columns`, pelo `copyProblems`, e
  desabilita "Copiar" como um campo recusado) e a `FormattingStep` da exportação, que ganhou `target` (sem a
  tabela de destino, no configurar) e `focusTable`. O `focusTable` do "Copiar avançado…" é só do abrir: a primeira troca de formato o desliga (no evento,
  `tableFocus`), e o campo da tabela que aparece depois, com as setas na lista passando pelo SQL ou pelo DbUnit, não tira o foco dela. O `onCopy` que lança
  não deixa o diálogo em "Copiando…" (`try`/`finally`): a fase volta, e "Não foi possível copiar." aparece no alto. **Decisões onde a regra deixava espaço**: no configurar, "Incluir as colunas que o banco calcula"
  aparece sempre, e as linhas por comando ficam editáveis também numa aba do Informix (as opções valem para qualquer banco; o Informix escreve sempre uma);
  o diálogo grava as escolhas no clique em "Copiar",
  antes de saber se copiou.
- **A ligação** (`_lib/copy-as/use-copy-as.ts`, o gancho, e `copy-source.ts`, puro, os dois com teste). `useCopyAs({ records, userName })` devolve a fonte do
  submenu (`CopyAsSource`, que `useRecordEdits` recebe) e as propriedades dos dois diálogos abertos (`advanced`, `configure`), que `resultEditDialogs` monta.
  - **A origem** (`copySourceOf`, do recorte da seleção, `GridSelectionContext.slice`): as colunas da grade com o `generated` do alvo, as linhas na ordem da
    grade com os valores que ela mostra, o número da grade (nulo na linha nova ainda não salva), as cortadas e as "gerado pelo banco". O que a origem diz
    além das linhas é `copyOriginOf`: o nome da tabela nos Registros, sem o esquema, e `resultado` no resultado (RN-EXPORT-006); a tabela de destino, a dos
    Registros ou a do alvo de uma tabela só (`singleTableOf`: o `tables` com um item que não é `elsewhere`, qualquer que seja o `kind`, e não o
    `rowOperations`, RN-GRADE-020); e as colunas que o banco calcula, as que esse alvo diz da tabela.
  - **O alvo**: o "Copiar como SQL", o "Copiar como DbUnit" do resultado e o "Copiar avançado…" usam o que a tela já sabe (`knownSqlTarget`), e, sem ele e
    com a aba livre, perguntam o alvo do "Gerar SQL" (`sqlTarget`, o mesmo, uma vez) com "Conferindo a tabela deste resultado…" na faixa; com a aba ocupada,
    não perguntam, e a tabela fica como não conhecida. Sem tabela, o SQL e o DbUnit abrem o "Copiar avançado…" no formato, com o foco no campo da tabela, e a
    pausa da atualização automática passa a ser do diálogo. Os outros formatos não perguntam nada.
  - **A cópia**: o recorte é tirado no clique, antes de qualquer espera (a cópia leva as linhas de quando começou); `runCopyAs` busca os completos pelo
    `complete` do contexto (com o sinal do "Cancelar a busca" do diálogo) e escreve pelo `navigator.clipboard.writeText`. No "Copiar como" direto, a faixa diz
    "Copiando…" passado meio segundo (`copying`, com o "Cancelar" dela), e a pausa vai do clique ao texto; os avisos: o copiado (`copyAsNotice`, no tom que
    ele diz), a recusa do limite e as das colunas (nenhuma no `INSERT`, ou duas com o mesmo nome; erro) e a falha da área de transferência (atenção). No diálogo, só o copiado vira aviso: a recusa fica no
    alto dele. As opções são lidas na hora do clique (`readCopyAsChoices`), do usuário do cofre (`cachedUserName`).
  - **Uma frase só**: a recusa do limite de 10 MiB é a do "Copiar" (`gridSelectionCopy.copy.tooLarge`), a falha da área de transferência é a de hoje
    (`recordsCopy.edit.menu.notCopied`), os rótulos do submenu são os do menu da grade (`gridSelectionCopy.menu`), e o limite, o tamanho em UTF-8 e o par
    substituto solto do "Copiar" (`grid-copy.ts`) são os desta biblioteca (`grid-export/document.ts`).

## Exportar dados (seção 35, RN-EXPORT-001 a 024)

A seção 35 da especificação manda; o que segue diz onde ficam as peças e o que não é óbvio. A API exporta num trabalho em segundo plano
(`api/user/transfers`, seção 6), numa conexão à parte, e escreve o arquivo na pasta `transfers` da pasta de dados; a tela acompanha o trabalho e o
processo principal leva o arquivo pronto ao destino que a pessoa escolheu (ver "O destino das exportações de dados", em "Processo principal").

- **As entradas** (RN-EXPORT-001). O "Exportar dados…" do menu da tabela e da visão no navegador (`navigator-menu.ts`, grupo próprio depois de
  "Gerar SELECT"; a origem é a tabela inteira, e as colunas vêm do catálogo ao abrir a Extração), o "Exportar…" do rodapé dos Registros (logo depois de
  "Exportar CSV") e da barra da área de resultado (depois do zoom, antes de recolher e maximizar, também com a área recolhida), e o "Exportar dados…" do
  menu da célula (`cell-menu.ts`, `exportData`, grupo próprio depois do da vista). Estão sempre lá; o motivo de não valer vem de `exportBlocker`
  (`_lib/data-export/export-entry.ts`, com teste), na ordem: as Estatísticas do script à frente, a aba ocupada (o comando da pessoa, o "Salvar", o
  script rodando ou parado na pergunta de erro; a execução da atualização automática não conta), sem resultado, e o comando que não é só de leitura.
  **O "só leitura" é o `read` da página do resultado** (`query.schema.ts`, nulo quando a API não o deu): `read !== true` desabilita, e o resultado que
  gravou e devolveu linhas (`totalRows` preenchido, RN-SQL-013) também. O `read` viaja com as linhas (o executor, o script, a aba que vai para outra
  janela). Desabilitado é `aria-disabled`, com o motivo no `title` e num `sr-only` ligado por `aria-describedby` (`ExportButton`, em `result-panel.tsx`).
  A conexão desconectada e a tela fora do Electron não desabilitam nada.
- **A origem** (`export-source.ts`): `table` (a do navegador), `records` (o comando que a grade dos Registros mostra, `rows.target.sql`, com o filtro
  aplicado só para o subtítulo) ou `result` (o comando daquele resultado, com o filtro dele, o nome da aba e o número do comando no script). No resultado,
  a tabela de destino do SQL e do DbUnit vem de `singleTable` de `useRecordEdits`, quando o alvo da edição já disse que o resultado é de uma tabela só
  (`rowOperations`), e em branco quando não (o campo é obrigatório). As alterações não salvas da grade vão com a origem, para o aviso da Confirmação.
- **O assistente** (`_components/data-export/export-wizard.tsx` e `export-wizard-steps.tsx`; as decisões em `_lib/data-export/export-wizard.ts`,
  `export-options.ts`, `export-file-name.ts` e `export-request.ts`, puras e com teste). Um por janela (`openExportWizard`, em `data-exports.ts`,
  montado por `ExportWizardHost` em `page.tsx`). As cinco etapas, as voltas só para trás, e os números dos campos como texto até o pedido. Com o
  destino **"Banco de dados"**, as etapas são seis (ver "Importar dados e copiar para outro banco"). As escolhas lembradas
  (`export-choices.ts`) ficam no `localStorage`, por usuário (`prism:data-export:<usuário>`), lidas campo a campo com o padrão no lugar do que não
  confere (o que não é um objeto, também uma lista, vale o padrão inteiro); a tabela de destino e as colunas não se lembram. **O motivo que segura uma
  etapa fica no campo**, porque o "Avançar" desabilitado não recebe o foco e a dica dele não chega ao leitor de tela: "Marque ao menos uma coluna." na
  lista das colunas, descrevendo cada caixa (`extractionProblem`); e, nos Registros, o SQL sem "Incluir as colunas que o banco calcula" espera o catálogo
  dizer quais são (`generatedUnknown` do contexto, `generatedProblem`: "Lendo as colunas…", ou a mensagem do banco com "Tentar de novo", no campo da
  opção), para a coluna calculada não ir no `INSERT` sem o aviso. A linha "Conexão" da Confirmação é a do cabeçalho (`ExportConnection`). **A ordem do "Exportar"**: fora do Electron, a recusa "Exportar só funciona no app do
  Prism." sem pedir nada; o diálogo de salvar (desistir deixa o assistente como estava); o tamanho do pedido (8 MiB, `requestBytes`); o `POST`, com as
  recusas de `startRefusals` no lugar (`refusalsOf`: a de campo vai ao campo pelo caminho da API, em minúsculas, e o assistente pula para a etapa dele;
  `CONNECTION_CREDENTIALS_MISSING` vira a frase de cada campo no alto da Confirmação). **A recusa de um campo que o assistente não desenha** (`source.sql`,
  o comando de mais de 1 MB que o `queries` aceitou; `format`; `windowID`; uma opção de escolha; a opção de outro formato) vai ao alto da Confirmação
  (`placeRefusals`, pelos campos de `fieldsShown`): sem isso ela ia para um campo que não existe, e o "Exportar" voltava sem dizer nada. Qualquer recusa
  ou falha depois do diálogo solta o destino escolhido (`releaseExportDestination`). Aceito o 202, as escolhas são gravadas, a exportação entra no
  acompanhamento e o assistente fecha.
- **O acompanhamento** (`transfer-tracker.ts`, um objeto fora do React com as peças injetadas, e `exportTracker`, o desta janela, em
  `data-exports.ts`). Uma consulta por segundo para todas as exportações da janela (um laço só, que para quando não há o que consultar); pronta, a
  entrega (`deliverExport`) ou a cópia para a área de transferência (`copyExport`), e o aviso de sucesso com "Mostrar na pasta" (ou com a pasta aberta,
  quando a pessoa pediu "Mostrar na pasta ao terminar"); falhou, o aviso de erro com a mensagem do banco e o SQLSTATE; cancelada pela exclusão da
  conexão, o de atenção. A entrega que falhou fica na barra com o motivo, "Salvar como…" (solta o destino, abre o diálogo de novo e entrega o mesmo
  arquivo pronto) e "Descartar". `TRANSFER_NOT_FOUND` tira a exportação da barra com o aviso de erro ("se perdeu antes de ser gravada"); três consultas
  seguidas que falham a deixam na barra com "Não foi possível saber como está a exportação." e "Cancelar" (que tenta o `DELETE` de novo); ela deixa
  de ser consultada e não segura o bloqueio. A exportação é da
  janela, e não da aba: fechar a aba ou levá-la para outra janela não a muda. **O desmonte da área de trabalho** (`connectExports`, chamado pelo
  `WorkbenchProvider`) cala os avisos, fecha o assistente e esquece tudo (`reset`, que solta os destinos); ao montar, os trabalhos da lista da API
  com o número desta janela que ninguém acompanha (da página que recarregou) são cancelados.
- **A barra de status** (`transfer-status.tsx`, RN-EXPORT-021): a exportação mais antiga, com o nome isolado em `<bdi>`, a porcentagem (com o total)
  e "Cancelar" com o nome no `aria-label`; com mais de uma, "+N exportações" abre a lista (Esc fecha e devolve o foco ao botão, também com o foco ainda
  nele: `closeListOnEscape` está no grupo da barra, e não na lista, que não toma o foco ao abrir). A barra de progresso tem `aria-valuetext` com as
  linhas e o tamanho; sem o total, não tem medida.
- **As saídas** (RN-EXPORT-023 e RN-IMPORT-021; `createTransferExits`, em `export-exits.ts`, e a instância `transferExits` com `useTransfersAhead`, em
  `data-import/data-imports.ts`, que vê os dois acompanhamentos; os textos em `data-import/transfer-exits.ts`). A conta é da lista da API, de todas as
  janelas e de todos os tipos (`transfersInProgress`: as exportações que rodam e as prontas não entregues, e as importações e as cópias que rodam; pela
  conexão, as em que ela é a da origem ou a do destino), e só com a área de trabalho montada e o cofre aberto: fora disso, nenhuma, sem pedir (o pedido com
  o cofre bloqueado esperaria o desbloqueio). "Sair" (`top-bar.tsx`) pergunta antes, com "Continuar exportando" (ou importando, copiando, transferindo) no
  foco e no Esc; o reinício do serviço (o diálogo e a faixa, `useDriverActions`) e a instalação que encerra o Prism (só o instalador do Windows,
  `update-dialog.tsx`) põem a frase no aviso que já existe (`canceledAheadNote`, com a conta de `useTransfersAhead`, relida a cada 3 s enquanto o aviso está
  na tela). Com só exportações, os textos são os de antes (`exitQuestion` cai nos de `dataExportCopy.exits`). Confirmada a saída, `cancelForExit` lê a
  lista de novo, cancela as das outras janelas pelo `DELETE` e as desta pelos acompanhamentos (o das exportações solta os destinos), e só então a saída
  segue. **Fechar a janela** (`workbench-tabs.tsx`, `windowCloseStep` e `windowTransfers`) pergunta pelas transferências começadas nela antes das perguntas
  das abas, com o texto de fechar o Prism quando ela é a última; nada é cancelado antes da última resposta (o cancelamento fica em `finishWindow`). O
  diálogo de excluir a conexão diz quantas serão canceladas (`connectionDeleteNote`; quem cancela é a API). O "Bloquear" do menu do usuário ainda não existe.
- **O que não tem teste**: o assistente montado com as consultas de verdade (as etapas e as decisões têm), o diálogo de salvar do sistema, a entrega
  numa unidade de rede, e a conferência num app empacotado com a API desta seção. A tela foi escrita contra o contrato da seção 6 e da seção 35, com a
  API simulada nos testes.

## Importar dados e copiar para outro banco (seção 36, RN-IMPORT-001 a 028)

A seção 36 da especificação manda; o que segue diz onde ficam as peças e o que não é óbvio. A importação lê um arquivo CSV, TSV, JSON ou XLSX e grava as
linhas numa tabela que já existe; a cópia ("Banco de dados", no "Exportar dados") lê as linhas de uma origem da exportação e grava numa tabela que já existe,
nesta ou em outra conexão. As duas são trabalhos da API no registro das transferências (`api/user/transfers`, `kind` `import` e `copy`), numa conexão à
parte, com o mesmo carregador; quem lê e interpreta o arquivo é a API, e quem o escolhe e o copia para a pasta `transfers` é o processo principal (ver "O
arquivo das importações de dados", em "Processo principal"). Tudo em `_lib/data-import/` (sem React, com teste) e `_components/data-import/`.

- **As entradas** (RN-IMPORT-001). O "Importar dados…" do menu da tabela no navegador (`navigator-menu.ts`, no grupo de "Exportar dados…", logo depois
  dele; a visão não tem o item) e o "Importar…" do rodapé dos Registros de uma tabela (`ImportButton`, em `result-panel.tsx`, logo depois de "Exportar…").
  Os dois abrem o assistente com a tabela de destino já escolhida (`openImportWizard`). O motivo de não valer vem de `importBlockerOf` (`import-entry.ts`): a
  conexão somente leitura (`readOnlyHintOf`, também pela pasta) e, nos Registros, a visão que as listas do navegador já mostraram (`objectKindOf`, só o
  cache, como a Estrutura). No menu, o motivo vai na linha embaixo do rótulo (`hint` do `MenuItem`); no botão, no `title` e num `sr-only`
  (`aria-disabled`, sem sair do Tab). A conexão desconectada, as alterações não salvas e a aba ocupada não desabilitam.
- **O assistente "Importar dados"** (RN-IMPORT-002 a 013; `_components/data-import/import-wizard.tsx` e `import-wizard-steps.tsx`). O estado e os pedidos
  são do `createImportFlow` (`import-flow.ts`, fora do React, criado a cada abertura por `data-imports.ts`): o arquivo e a cópia dele (a consulta a cada
  250 ms), a leitura (`imports/read`), a prévia convertida (`imports/preview`) e o "Importar" (`imports`). A leitura e a prévia vão **um pedido de cada vez**
  (`serial`): a mudança durante um espera e refaz uma vez, com as últimas escolhas, e a resposta de um arquivo (ou de uma leitura) de antes não muda nada
  (as gerações `fileGeneration` e `readGeneration`). Os corpos são montados só em `import-request.ts`: a leitura manda as escolhas (`auto` inclusive, e a
  codificação já achada neste arquivo, que é a única que percorre o arquivo inteiro); a prévia e o começo mandam o que a leitura achou (a codificação, o
  separador, as chaves do JSON, a planilha). O mapeamento é uma escolha por coluna do arquivo (`import-mapping.ts`: o automático pelo nome ou pela
  posição, a escolha à mão que tira a coluna de quem a tinha, o que fica com o padrão, os avisos, o comando do aviso de confirmação), e a carga é de
  `import-load.ts` (os avisos das chaves que apontam para a tabela, o N do commit, a linha "Carga" da Confirmação). As escolhas lembradas
  (`import-choices.ts`, `prism:data-import:<usuário>`) são lidas campo a campo; o arquivo, o formato, a planilha, o mapeamento e "Esvaziar" não se
  lembram. "Tirar o apóstrofo da proteção contra fórmula" vem ligado, como a RN-IMPORT-004 diz ("a confirmar com o dono"). Fechar o assistente sem
  importar (Cancelar, Esc, o X, o bloqueio, o "Sair", o desmonte da área de trabalho) solta o arquivo; aceito o 202, o arquivo é do trabalho e não é solto.
  Com o diálogo do sistema aberto, o arquivo de antes continua do assistente: o estado é `{ status: "choosing", before }` (`heldSource`), o fechamento
  nesse meio solta o `before`, desistir do diálogo o devolve, e o campo continua desenhando o de antes, com o mesmo botão em `aria-disabled` (o foco não
  cai); quando o diálogo fecha e o botão sai da página (a cópia começou), o foco vai ao botão do campo. O que segura o "Avançar" no Arquivo fica à vista
  no campo ("Escolha o arquivo a importar.", "Espere a cópia do arquivo terminar."). A prévia convertida que falha sem recusa (o 500, a rede) vira a
  recusa da etapa com "Tentar de novo" ("Não foi possível ler as colunas de …", ou "… atualizar a prévia." com a lista na tela), e "Avançar" de novo a
  pede. No Mapeamento, o que a etapa espera ("Lendo as colunas…", "Atualizando a prévia…", `mappingProgress`) vai à linha de estado; embaixo da lista
  fica só a recusa do mapeamento. A lista tem os títulos das colunas, monta as opções da escolha uma vez por tabela (na cópia, uma por coluna da
  origem), desenha cada linha num `MappingRow` com `memo` (a escolha numa linha não redesenha as outras) e com `content-visibility: auto` por linha; os
  botões e as escolhas ocupados ficam em `aria-disabled` (o `Select` aceita `aria-disabled`: a lista não abre, e o foco fica).
  "Importar" pergunta antes pelas proteções da conexão de destino (`loadQuestion`, em `command-confirmation.ts`: em "Só comandos irreversíveis", só com o
  esvaziamento), com o `DELETE` e o `INSERT` como a API os escreve.
- **O destino "Banco de dados"** (RN-IMPORT-022 a 025), no próprio "Exportar dados": `choices.database` troca as etapas (`stepsOf`, `copySteps`, em
  `export-wizard.ts`) e guarda o formato de arquivo de antes, para a volta; a Extração é a da exportação, com "Contar as linhas antes" travada no Db2 e no
  Informix com a origem e o destino no mesmo servidor, porta e banco (`countForcedReason`). As decisões ficam em `copy-wizard.ts` (a lista das conexões na
  ordem do navegador, a própria origem, as classes da origem pelo tipo e pelo `kind` da coluna, os pares desabilitados e as notas da conversão, os
  pedidos, as recusas e o comando que lê a tabela de destino); o estado, em `useCopyWizard` (`_components/data-import/use-copy-wizard.ts`): as listas da
  "Tabela de destino" são as da árvore, nas mesmas consultas e no mesmo cache (`databaseSessionQuery` e `treeQuery`, caladas no aviso central: a falha
  aparece na etapa), e **escolher uma conexão desconectada a conecta, como expandi-la**, e o navegador passa a mostrá-la conectada; o esquema e a tabela de
  mesmo nome que a origem vêm escolhidos uma vez, quando a lista chega. A prévia da cópia (`copies/preview`) é pedida ao entrar no Mapeamento e vai **sem
  o mapeamento**: a API devolve a tabela e o sugerido, e as escolhas de antes seguem pelo nome quando a tabela é a mesma (`carryTargets`), sem nunca
  esbarrar numa recusa do mapeamento velho. O mapeamento, a carga e a Confirmação desenham com as peças da importação (`MappingStep`, `LoadStep`,
  `ConfirmationStep`). "Copiar linhas" pergunta pelas proteções da conexão de **destino**; a origem só é lida. A cópia funciona fora do Electron (sem
  processo principal), com o número de janela 1 quando a ponte não dá um.
- **O acompanhamento** (RN-IMPORT-019 a 021; `load-tracker.ts`, um objeto fora do React como o das exportações, e `loadTracker`, o desta janela, em
  `data-imports.ts`). A consulta a cada segundo; o fim lido diz o que ficou (`stayedText`, pelo `committed`, pelo `uncertain`, pela fase e pela carga),
  avisa com "Abrir registros" (a aba da tabela nesta janela, `connectLoads` a liga ao `openTableTab` do `WorkbenchProvider`) e esquece o trabalho; a falha
  deixa a entrada "Ver o erro" na barra, só da tela. O "Cancelar" pergunta quando algo já ficaria na tabela (`cancelQuestionOf`). A ordem das
  transferências da janela é uma só para os dois acompanhamentos (`nextTransferSeq`, em `data-exports.ts`). Ao montar a área de trabalho, os trabalhos da
  página de antes desta janela, de todos os tipos, são cancelados (`connectExports`, que não leva os que esta página já começou).
- **A barra de status** (`transfer-status.tsx`, com `load-status.tsx` e as peças comuns em `transfer-progress.tsx`). As exportações, as importações e as
  cópias numa lista só, pela ordem em que começaram (`barEntries`, em `transfer-bar.ts`); aparece a que pede ação (a entrega que falhou, a importação que
  parou), ou a mais antiga, e o botão das outras diz o tipo ("+2 importações", "+2 transferências"). A pergunta do "Cancelar" e o diálogo "Importação
  interrompida" moram na `TransferStatus`, e não na entrada (ela aparece duas vezes com a lista aberta), e fecham sozinhos quando a entrada some.
- **Os Registros abertos da tabela** (RN-IMPORT-020): `markImported` sobe um número por tabela (a conexão, o banco, o esquema e o nome) quando o fim pode
  ter deixado linhas; a vista guarda o número do começo da leitura que está na tela (`imported-note.ts`, pelo executor da aba, que sobrevive à troca para
  a Estrutura) e mostra a nota com "Atualizar" (o da aba, que pergunta pelas alterações não salvas) até ler de novo.
- **As fixtures da importação** (RN-IMPORT-028): a tela confere a proteção contra fórmula (`csvFieldOf`) contra `src/test-fixtures/export/import-unguard.json`
  (`grid-export/import-fixtures.test.ts`), escrita à mão com a API, que confere a volta com os mesmos casos; sem o arquivo o teste falha, e não fica de
  fora. As outras fixtures da importação (o campo do CSV, os números e as datas, a ordem do nulo, o `_xHHHH_` lido) são só da API.
- **O que não tem teste**: os assistentes montados com as consultas de verdade (as decisões, as etapas e o gancho da cópia têm), o diálogo de abrir do
  sistema, a cópia de um arquivo de 2 GiB e a conferência num app empacotado com a API desta seção. A tela foi escrita contra o contrato das seções 6 e
  36, com a API simulada nos testes. A aba em Commit manual (o aviso da transação aberta da RN-IMPORT-013) não existe ainda na tela, e o aviso não sai.

## Gerar SQL (seção 37, RN-GRADE-006 e 018 a 020)

O submenu "Gerar SQL" da grade e o diálogo dele: o texto de cada item, o plano do resultado, o motivo dos itens desabilitados, o diálogo e o gancho que o
move, e a ligação com a seleção da grade (seção 37, RN-GRADE-001), o menu (RN-GRADE-004) e o alvo que a edição já pediu (ver "A ligação", abaixo), nos
Registros, no resultado da aba de consulta e em cada aba guardada do script. O "CREATE" é o DDL aproximado da Estrutura (`approximateDdl`, RN-TABELA-008), e
não o `CREATE` das colunas do resultado, que a especificação deixou para depois.

- **As peças** (`_lib/generate-sql/`, puras, com teste, menos o gancho):
  - `generate-sql.ts`: o texto de cada item (`generateSql(item, plano, linhas, opções)`, RN-GRADE-019) sobre os tipos `SqlPlan` (a tabela, as colunas DELA no
    resultado, cada uma com `at`, a posição no resultado, e `name`, o nome na tabela, e a chave: `complete`, `partial` ou `none`), `SqlRow` (por linha
    escolhida que está no banco: `number` na grade, `values` como a grade mostra, `read` como o banco leu, `changed`, `cut` e `generated`, tudo pela posição
    no resultado) e `SqlOptions` (`qualified`, `compact`, `excludeGenerated` e, no INSERT da tabela que o Prism não conhece, `target`). O SELECT lista as
    colunas da tabela que estão no resultado; a condição é a chave LIDA (`read`), e os valores, os da grade (`values`); a chave com pendência entra no `SET`
    do UPDATE. O `IN` da chave composta é a lista de linhas no PostgreSQL e o `OR` de `AND`s no Db2 e no Informix (e sem chave nos três). Sem chave, a
    condição deixa de fora os tipos que o banco não compara com `=` (`comparable`: o tipo sem o tamanho e sem o `[]`). A linha que fica de fora vai para o
    comentário do motivo, no fim (`rowList` faz as faixas). `valueLiteral` é o literal da exportação em SQL: `scriptLiteral` e `binaryLiteral`.
  - `sql-plan.ts`: o plano a partir do alvo pedido com `purpose: "sql"` (`sqlPlanOf`: "de uma tabela só" é o `tables` com um item que não é `elsewhere`, e a
    chave está inteira quando cada nome do `keyColumns` é o `baseColumn` de uma coluna do resultado daquela tabela; o `key` e o `rowOperations` não decidem),
    `planRefusal` (o motivo do item que o plano não permite, já como frase), `sqlMenuStates` (o motivo de cada um dos seis itens no submenu, também antes do
    alvo: sem linhas, só linhas novas, a aba ocupada, a atualização automática, a visão dos Registros), `neededColumns` e `cutCellsFor` (as células cortadas que
    o item usa: só elas vão à rota das células, RN-SQL-017), `completeRows` (as linhas com o valor completo; a pendência já é inteira) e `optionRefusal` (o
    que as opções impedem: a tabela de destino que falta ou que um campo recusa, as colunas de mesmo nome, o INSERT sem coluna que o banco não gere).
  - `generate-sql-flow.ts`: o caminho do diálogo (`runSqlFlow`: "Conferindo…", "Buscando os valores completos…" com "Cancelar", "Lendo o catálogo…", o texto,
    a recusa, a falha com "Tentar de novo", o resultado que mudou) com as peças que falam com a API injetadas (`SqlFlowDeps`: `target`, `fullValues`,
    `catalog`, `stillCurrent`), e o que o diálogo desenha de cada fase (`sqlDialogView`: o cabeçalho, as caixas que o item tem, os campos da tabela de
    destino, os avisos, o lugar do SQL e se as saídas valem). O teto de 1 MB é medido em UTF-8 (`utf8Bytes`, pelo `TextEncoder`); antes, o `generateSql`
    recebe o teto (`stopAfter`) e para quando os comandos passam dele em caracteres, que em UTF-8 têm ao menos um byte cada (`tooLarge`): 100.000 linhas não
    montam 40 MB para jogar fora.
  - `generate-sql-choices.ts`: as três caixas, lembradas por usuário em `prism:generate-sql:<usuário>` (o `localStorage` desta instalação, como as escolhas
    da exportação e as do "Copiar como"), lidas campo a campo; a tabela de destino não se lembra.
  - `use-generate-sql.ts`: o gancho (`useGenerateSql({ userName, deps })` devolve `open(pedido)`, `close()`, `dialog` (as propriedades do componente, nulo
    fechado) e `planOf(resultId)`, o plano depois da primeira resposta, para o `sqlMenuStates`; o do CREATE dos Registros, que não vem do alvo (`recordsPlan`,
    sem colunas nem chave), não fica, e não desabilita os outros itens), e a peça do CREATE, que não depende da grade:
    `catalogReader` (as três listas da Estrutura, pelo mesmo cache). A resposta do alvo fica guardada por resultado: a segunda escolha não pergunta de novo, e
    o "Tentar de novo" pergunta. O `hold` das dependências segura a atualização automática do abrir ao fechar (RN-GRADE-014), e fechar interrompe o que estava em andamento.
    A execução que troca as linhas com o diálogo aberto (`stillCurrent` falso) deixa o lugar do SQL em "O resultado mudou…", sem saídas. O `sqlDialogView`
    é memorizado pela fase e pelas opções (`useMemo`): renderizar de novo quem mostra o diálogo não gera o texto outra vez.
  - Os textos estão em `generate-sql.copy.ts`; os comentários do SQL são frases fixas e números.
- **O componente** (`_components/generate-sql/generate-sql-dialog.tsx`, `GenerateSqlDialog({ dialog, engine, connection })`): o diálogo grande, com o que se
  gera embaixo do título e a linha da conexão (`connection`: quem liga passa o `ExportConnection` do assistente da exportação, com o ambiente e o cadeado), as
  "Opções" pelo `CheckboxRow` da exportação, os campos "Esquema" e "Tabela" com o motivo de recusa no campo, os avisos no tom de atenção e o lugar do SQL; no
  rodapé, "Fechar" à esquerda, e "Abrir numa aba de consulta" e "Copiar" (o principal), desabilitados até o texto ficar pronto. O texto fica no
  `SqlViewer` (`sql-viewer.tsx`): um CodeMirror só de leitura (`EditorState.readOnly`, focável, com seleção e Ctrl+C), com o realce do banco, a fonte do
  editor e as linhas quebradas na largura (`EditorView.lineWrapping`); o foco começa nele, menos no INSERT da tabela não conhecida, em que ele apareceria no
  meio da digitação do nome. O documento troca a cada opção sem recriar o editor. O bloqueio por inatividade fecha o diálogo pelo Esc (`closeOpenPortals`).
- **O alvo na tela** (`record-edits.schema.ts` e `record-edits.service.ts`, RN-GRADE-020): `sqlTargetSchema` (cada tabela com `kind`, o que a tela não conhece
  vale `other`, e `keyColumns`, os dois exigidos) e `sqlTargetOrRefuse` (com `purpose: "sql"`; o `RESULT_NOT_EDITABLE`, o `RESULT_CHANGED` e as falhas
  voltam como valor). O `editTargetSchema` da edição ficou com os dois campos opcionais, para guardar o que vier sem exigir: `sqlTargetOf` diz se o alvo que
  a edição já pediu serve ao "Gerar SQL" (RN-EDIT-010: o mesmo alvo, uma vez). O contrário não vale na conexão somente leitura: o alvo do "Gerar SQL" dali
  não vai para a edição.
- **O literal do binário** (`binaryLiteral` e `binaryDigitsOf`, em `grid-export/script-literal.ts`, ao lado do `scriptLiteral`): `decode('…', 'hex')` no
  PostgreSQL; no Db2, pelo tipo da coluna, `BX'…'` no `BINARY` e no `VARBINARY`, `BLOB(X'…')` no `BLOB` e `X'…'` no texto `FOR BIT DATA` (o `X'…'` é um
  texto, que o Db2 recusa numa coluna `BINARY` ou `VARBINARY`), em pedaços de 16.336 bytes; e nenhum no Informix, conferido pela fixture `sql-binary.json`,
  que a API também lê. É o único: o `to-sql.ts` do "Copiar como" usa este (e o `binaryDigitsOf`), sem cópia, e o "Gerar SQL" e o "Copiar como SQL" passam
  a ele o tipo da coluna como o banco o diz.
- **A fixture de ouro** (RN-EXPORT-024): `src/test-fixtures/export/generate-sql.json`, só da tela (a API não gera estes comandos), com cada item nos três
  bancos, com e sem chave, a chave composta, compacto e não, com e sem os nomes completos, a tabela não conhecida, o binário, a quebra de linha, o Unicode
  fora do plano básico, os nomes hostis e as linhas de fora com os comentários; quem a lê é `generate-sql.fixtures.test.ts`. As formas de condição também
  rodam nos três servidores, no teste de integração da API (`GeneratedSql_TheConditionsOfEachItem_FindTheRightRowsOnTheServer`, compilado, sem rodar).
- **Saiu**: o `generate-sql.ts` antigo da `grid-export` (o `generateSql` de `SELECT *` e o `generateInsertInto`, que confiava no nome digitado) e o
  `formats.ts` dos oito formatos, que nenhuma tela usava.
- **A ligação** (`_lib/generate-sql/use-grid-generate-sql.ts`, o gancho, e `sql-selection.ts`, puro, os dois com teste). `useGridGenerateSql({ connectionId,
  database, userName, records, readOnlyConnection, openQueryTab })` devolve a fonte do submenu (`GenerateSqlSource`, que `useRecordEdits` recebe) e o diálogo
  aberto, que `resultEditDialogs` monta com a linha da conexão (`SqlDialogConnection`, a do assistente da exportação, pelas listas em cache).
  - **O submenu** (`access`, ao abrir o menu, sem consulta): o motivo de cada item é o `sqlMenuStates`, com as linhas da grade, as da seleção que estão no
    banco e as novas, o `busy` do contexto (a aba ocupada, ou a atualização automática lendo), o plano do alvo que a tela já sabe (`knownSqlTarget`: o da
    edição, o do "Copiar como", o motivo da página) ou o da primeira escolha (`planOf`), e, nos Registros, a tabela da aba com o tipo que a árvore já
    carregou (`cachedObjectKind`).
  - **O pedido** (`choose`): as linhas da seleção daquele instante (`sqlSelectionOf`): as que estão no banco viram `SqlRow` (a lida com o valor da grade e o
    lido, a marcada para exclusão com os lidos, a nova já salva com as células `generated`), e as novas não salvas só contam; nos Registros, `records` com a
    tabela e o tipo; o somente leitura da conexão pelo cache (`cachedReadOnly`).
  - **As dependências**: o alvo é o do contexto (`sqlTarget`, o mesmo do "Copiar como", uma vez por resultado, e nunca volta à edição); o valor completo pela
    linha da grade (`fullValues`, o número da linha menos um; o resultado que mudou no meio responde `changed`); o catálogo do CREATE pelo `catalogReader`, no
    banco da aba; `stillCurrent` e `hold` pelo contexto; e o "Abrir numa aba de consulta" pelo `onOpenQuery` da área de trabalho, com a conexão e o banco da
    aba (a aba nova é a do "Nova consulta", à frente, com o texto no editor).
- **Não conferido numa janela**: nada disto foi visto na tela (não há Xvfb nem banco nesta etapa), só nos testes; o `SqlViewer` não tem teste (o vitest não
  tem DOM). Falta conferir sob Xvfb que a aba nova do "Abrir numa aba de consulta" nasce com o cursor no começo e o foco no editor (o diálogo, ao fechar,
  devolve o foco à grade da aba de antes, que já está escondida; o editor da nova deixou o `autoFocus`, e quem o foca é a regra do foco das abas (RN-ABAS-019): o
  diálogo conta como quem pediu, e o foco perdido que ele deixa vai à entrada da aba nova).

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
  interface, e `navigatorDensity`, a densidade do navegador), `editor` (fonte,
  tamanho, tabulação, `autocomplete`, `uppercaseKeywords` e `blankLineSeparates`), `results` (`nullText` e `autoLoadMore`) e `security` (`lockEnabled` e `lockAfterMinutes`); `update` aceita um grupo pela metade, e o
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
  variável `--font-editor`, porque reconfigurar o compartimento é o que faz o CodeMirror medir o texto de novo. A preferência que não muda
  nada no editor, só o que ele faz numa ação, não precisa de compartimento: `blankLineSeparates` (RN-SQL-018) vive numa ref
  (`blankLinesNow`, como o `engineNow`) e é lida na hora de executar.
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
  da interface, em todo o texto fora do código **e também na árvore do navegador e nas grades** (consulta, abas do Executar script e Registros),
  mesmo quando é a do app (seção 42, pedido do dono de 2026-10-27: antes eram `font-mono`; a grade mede as colunas nela, ver "A largura das colunas é
  medida na fonte"); a do editor, no CodeMirror e no SQL que a tela mostra fora dele (`font-editor`): o campo do filtro dos Registros e o comando
  executado embaixo dele, o "Ver SQL", o "SQL enviado", o DDL aproximado e o comando de cada linha das Estatísticas. A mensagem de erro do banco, as
  etiquetas, a Estrutura, o Diagrama e o resto do que é `font-mono` não mudam. As dicas dos dois campos (`settings.copy.ts`) dizem isso. **A lista** é a da API de fontes locais do Chromium (`window.queryLocalFonts`, liberada em `permissions.ts`), lida na
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
  tabelas, visões e colunas). Os nomes vêm do cache (`cachedLevels`: `getQueriesData(["tree", conexão])`), que **nunca busca**: `sql-completion.ts` só
  lê; o que a árvore não abriu não existe para ele (o índice de nomes da busca, RN-BUSCA-002, mora na mesma família mas não é nível: `cachedLevels` o pula por `levelPathOf`, e o
  autocompletar não o usa), e as duas buscas que o autocompletar faz, as colunas de `tabela.` e as chaves estrangeiras da junção
  (`sql-catalog-completion.ts`, logo abaixo), são de outro módulo. Depois de `esquema.` saem as tabelas; depois de
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
- **As colunas de `nome.` e a junção** (RN-CONFIG-004 e RN-SQL-025; pedido do dono em 2026-10-24): as duas únicas coisas que o autocompletar busca no banco,
  em três módulos puros e uma fonte fina. `_lib/sql-references.ts` lê o comando do cursor (`statementAt` + `sqlTokens`, o leitor do projeto, então texto,
  comentário e `$tag$` nunca são nome): `analyzeAt` devolve as tabelas e os apelidos do `FROM`/`JOIN`/`UPDATE`/`INTO` **do nível do cursor** (a subconsulta
  `SELECT`/`WITH` mais de dentro em que ele está, ou o comando; os grupos entre parênteses viram um item e o que está dentro não conta; a chamada de função e a
  subconsulta da lista não são tabela, mas o apelido delas entra em `used`; `OUTER` do Informix vem antes da tabela e o `USING` só traz tabela em `DELETE`/`MERGE`), os níveis de fora
  (`outerReferences`, um grupo por subconsulta que contém o cursor, do mais de dentro ao comando: só `resolveQualifier` os usa, para o `p.` de uma subconsulta correlacionada
  achar o apelido de fora; a junção e `used` ficam no nível do cursor), o que o cursor pede (`member`, `join`, `on` ou `none`) e `usesAliases`. A palavra
  do cursor é tirada do texto antes de ler (a aspa aberta, e a que a tela fechou, também), e o `;` antes do cursor, fora de parênteses, faz o comando ser outro.
  `resolveQualifier`/`resolveReference` acham a tabela pelo catálogo da árvore (`linkCatalog` e o esquema padrão de `defaultSchemasOf`, como o link da
  RN-LINK-001; o apelido vale mais que o nome do catálogo). `_lib/sql-join.ts` monta as sugestões a partir de `TableLink` (`linksOf`: a chave vista de cada
  lado, `own` e `other` na ordem da chave): `joinSuggestions` (depois de `JOIN`), `onSuggestions` (depois de `ON`), `aliasFor` (as iniciais das partes do nome
  por `_`, só letras, 2, 3… quando em uso ou reservada) e `writtenTable` (`sqlName`, com o esquema fora da lista padrão; no Informix, sempre com ele). O apelido
  gerado vai cru e em minúsculas (nunca por `sqlName`, que no Db2 o poria entre aspas); o já escrito no comando vai como está. A chave que liga uma tabela a si
  mesma sai nos dois sentidos, com apelido novo. **O escopo da junção**: `joinScope` (em `sql-references.ts`; `Reference.start` é onde o nome da tabela começa) dá à fonte só as tabelas escritas ANTES
  do cursor, sem o alvo do `INSERT INTO` (`via: "into"`); depois de `ON`, só as que vêm antes da tabela do `JOIN`. As escritas adiante continuam em `used` (o apelido novo
  não as repete), mas não ligam nada nem pedem as chaves delas. `_lib/sql-catalog-completion.ts` (`catalogCompletion`) é a fonte: `sources` (colunas e junção) e `owns`, que
  cala a fonte de nomes do `lang-sql` onde as colunas são das novas (`unlessOwned` em `sqlCompletion`), para nenhuma coluna sair duas vezes; as colunas do
  cache saem de `columnOptions` (a mesma montagem do `completionNamespace`) e as aspas abertas voltam por `requoted`. As fontes usam `unlessQuiet` das
  variáveis como as outras. **A busca**: só com a sessão da árvore da conexão e do banco já aberta (`getQueryData(databaseSessionKey(...))`; nada abre nem
  reabre sessão), uma vez por lista (`fetchQuery` divide a requisição em andamento), com `meta: { silent: true }` (sem aviso). As colunas vão pela
  `columnsQuery` (a chave `table-structure` da Estrutura, o dado cru) e a lista pronta é posta também na chave `tree` do nível `columns` (`columnNodes`, o mesmo mapa da
  árvore); a que uma das duas já tem em dia vale e vai para a outra (`cachedColumns`), então o navegador e a Estrutura não perguntam de novo. As chaves vão por
  `foreignKeysQuery` e `referencedByQuery` (`table-structure.service.ts`, a rota `referenced-by` da RN-CAT-004, `referencingForeignKeySchema`), na mesma chave da
  Estrutura. **O "Atualizar"**: o `invalidateQueries` só busca de novo a consulta que alguém observa, e a lista que o autocompletar buscou sozinho não tem
  observador; por isso `listOf` olha `isInvalidated` (`peek`), busca de novo a invalidada (o `fetchQuery` busca mesmo com `staleTime` infinito) e, se a busca falha
  ou não há sessão, responde a velha (e, na falha, devolve a consulta ao estado de antes, velha e sem o erro, com `invalidateQueries({ refetchType: "none" })`).
  O "Atualizar" do navegador também invalida a família da Estrutura sob o nó (`invalidateStructure`/`structureScopes`, `table-structure.service.ts`), porque o
  `treePrefixes` só conhece a `tree`. A lista que falha vira nada, entra nas marcas de `catalog-fetch-failures.ts` (por conexão e sessão, para não repetir a cada tecla;
  o "Atualizar" do navegador e o da Estrutura as esquecem por `forgetFailedLists`) e sai do cache se ninguém a observa e nunca veio, para a árvore não mostrar um erro que a pessoa não
  pediu. O resultado é síncrono quando tudo está no cache (a lista não pisca) e uma promessa quando falta algo, descartada se `context.aborted`. Sem conexão
  na aba ou com o texto de mais de 200.000 caracteres, nada. A conferência rápida `mayAsk` (um ponto, ou `JOIN`/`ON` e o espaço, antes do cursor) poupa a
  leitura do comando a cada tecla. O editor cria um `catalogCompletion` por editor e lê a conexão, o banco e o usuário na hora (`useEffectEvent`), como o
  `readLevels`; a `boost` das junções cai na ordem (a lista abre com elas no topo).
- **Converter palavras-chave para maiúsculas** (RN-CONFIG-004; `_lib/sql-keyword-case.ts`): converte a palavra que a pessoa acabou de digitar, na
  MESMA transação da tecla (um Ctrl+Z desfaz a palavra e o caractere), só numa inserção do teclado cujo primeiro caractere termina a palavra
  (espaço, vírgula, parêntese, ponto e vírgula, quebra de linha); colar, aceitar uma sugestão e desfazer não convertem. Só o que está na lista
  fixa `uppercaseWords` (as reservadas e as que montam o comando), e só onde a gramática do dialeto diz que é palavra-chave, `null` ou
  booleano: fora de aspas, de comentário e de nome depois de ponto. **A lista é fixa de propósito**: o dialeto do PostgreSQL marca `id`,
  `name`, `type` e `count` como palavra-chave, e converter "tudo o que o dialeto marca" reescreveria o nome das colunas do usuário. Um falso
  negativo deixa a palavra como foi digitada; um falso positivo reescreve um nome dele. O preço: `PRIMARY KEY` sai `PRIMARY key`.
- **A linha em branco separa os comandos** (RN-SQL-018; `editor.blankLineSeparates`, ligada por padrão, a caixa `cfg-linha-em-branco`
  depois das duas do RN-CONFIG-004; não está no canvas, seção 9 da especificação): desligada, o comando do cursor volta a ser separado só
  pelo `;`, exatamente como antes. Ver "A linha em branco separa o comando do cursor", na área de trabalho.
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
- **Zoom do programa** (RN-ZOOM-001; `_components/app-zoom-control.tsx`, `_lib/app-zoom.ts`), em Aparência: o valor de agora (`<output>`, lido pelo leitor
  de tela quando muda), − e + (desabilitados nos limites) e "Restaurar 100%" (desabilitado em 100%), por `aria-disabled` e não `disabled`, para o botão
  que se desabilita ao ser usado não perder o foco (conferido sob Xvfb: Enter no "Restaurar 100%" em 110% e no − até 50% deixam o foco no botão); a
  dica diz os atalhos na tecla da plataforma e que o zoom vale para quem entra nesta conta do computador (a pasta de dados é da conta: no Prism instalado
  para todos os usuários do Windows, cada conta tem o seu). **Não é
  preferência**: o valor vem do processo principal (`appZoomQuery`, relida a cada visita às Configurações, porque os atalhos o mudam com elas fechadas), o
  pedido vai pela ponte (`requestAppZoom`, com o passo calculado por `nextAppZoom`) e o aviso `onAppZoomChanged` põe o valor novo na consulta enquanto a
  seção está aberta; a ponte é conferida em `lib/api/bridge.ts` (`currentAppZoom`: só um dos passos é resposta). Fora do Electron (o zoom é o do
  navegador) a resposta é `null` e o controle não aparece.
- **Densidade do navegador** (RN-NAV-011), em Aparência, ao lado do zoom: dois botões de opção, "Confortável" (o padrão, o desenho do canvas) e
  "Compacta", em `ui.navigatorDensity`. As medidas são do navegador (ver "Navegador: clique, menu e busca").
- **Resultados** (RN-CONFIG-005; `results-section.tsx`): o texto do valor nulo na grade (de 1 a 12 caracteres, que não sejam só espaços nem
  tenham caractere de controle ou de direção de texto) e "buscar mais linhas ao rolar até o fim" (`autoLoadMore`, desligado de saída).
  Com ele ligado a grade pede a página seguinte sozinha (`autoLoadArmed`, em `result-paging.ts`): uma por vez, com linhas na tela, mais a
  ler e nada em andamento (página, contagem, comando ou cancelamento), e o cursor fechado é o fim; com a atualização automática do resultado
  ligada, a aba o desliga (RN-GRADE-014). "Linhas por busca" depende da API
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
andamento em nenhuma aba (a execução da atualização automática não conta: `isPersonBusy`, RN-GRADE-014), o Prism avisa 60 s antes (30 s com 1
minuto) e bloqueia: a API fecha o cofre, e a tela pede a senha do MESMO
usuário. Desbloquear devolve as abas e o texto de SQL; os resultados são descartados; as outras telas de dentro do cofre voltam ao estado
inicial; "Sair" encerra de verdade.

- **As janelas do resultado** (RN-ABAS-013 a 016): o que a pessoa faz nelas conta como atividade e o aviso de antes do bloqueio aparece nelas também; o
  bloqueio e o "Sair" as fecham pelo Prism (`resultWindows.closeAll` no `WorkbenchTabs`, e o `windows-ready` falso no processo principal), com o lugar da aba
  guardado, e o desbloqueio as reabre vazias, no tamanho e no lugar lembrados.
- **Quem faz o quê.** `lib/api/vault-lock.ts` (o estado "bloqueado", a época e a barreira dos pedidos). Em `app/_lib/`: `idle-timer.ts` (a
  contagem, pura, com relógio injetado), `idle-watch.ts` (`watchActivity`: os eventos da janela ligados ao temporizador), `use-idle-lock.ts`
  (o gancho), `lock-vault.ts` (**a ordem dos passos de bloquear e de desbloquear, e o que cada falha faz**, com dependências injetadas),
  `lock-dialog.ts` (o que o diálogo da tela de bloqueio faz com o que lhe acontece) e `close-portals.ts`. Em `app/_components/`:
  `vault-lock.tsx` (liga as peças; é montado pelo `WorkbenchProvider`, ao lado das telas, e não acima dele: bloquear não o desmonta),
  `idle-warning.tsx` (o aviso), `lock-screen.tsx` (a tela) e `remount-on-lock.tsx`. E `workbench/_lib/workbench-lock.ts` (o que sai do
  cache e das abas). **A ordem dos passos e as falhas ficam em `lock-vault.ts` e no teste dele; este guia não as repete.**
- **Com mais de uma janela** a contagem é de todas e o bloqueio também (RN-ABAS-004): `peers` do `useIdleLock`, `peerAction` e
  `closedByAnotherWindow`, descritos em "Abas que se movem e outras janelas".
- **A exportação de dados é comando em andamento** da janela que a começou, do começo até a entrega (`exportTracker.holdsLock()`, no `isBusy` do
  `WorkbenchProvider`), e segura também as outras janelas. A entrega que falhou e espera o "Salvar como…" não segura: o aviso de antes do bloqueio diz
  quantas serão descartadas (`discardedExports` do `VaultLock`; o `IdleAnnouncer` diz o mesmo ao leitor de tela, junto da frase fixa, porque o desenho do
  aviso é `aria-hidden`), e o bloqueio as descarta (`exportTracker.vaultClosed()`, que solta os destinos)
  (RN-EXPORT-023). **A importação de dados e a cópia para outro banco também** (RN-IMPORT-021), do começo ao fim lido (`loadTracker.holdsLock()`); a
  entrada da falha ("Ver o erro") não segura, e o bloqueio a descarta sem perguntar (`loadTracker.vaultClosed()`). O assistente "Importar dados" aberto
  fecha no bloqueio, como os outros diálogos, e solta o arquivo copiado.
- **A verificação periódica das conexões** (RN-VERIF-002) não é atividade nem comando em andamento: ela não passa pelos executores das abas nem pelos
  eventos da janela, e bloqueado nada dela sai (ver "Verificação periódica e Só as conectadas").
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
- **Release sem o pacote desta instalação não é oferecida (RN-ATUALIZA-002, 003 e 005).** A pipeline publica a release com as
  plataformas que vieram inteiras (a falha do pacote de uma plataforma não segura as outras), e o macOS só é empacotado nas estáveis:
  um beta nunca tem o pacote de macOS. `offerable` (`releases.ts`, pura e testada) tira da consulta as releases em que o pacote que
  `choosePackage` escolheria (plataforma, arquitetura e FORMATO da instalação em uso) não está nas somas das notas, e que são mais
  novas que a mais nova que o tem; a oferta é essa, e a lista de notas vai até ela (as mais antigas ficam, mesmo sem o pacote:
  as notas contam o que mudou). Nenhuma com o pacote: o Prism está atualizado (`check` responde `upToDate` com `withoutPackage`, a
  mais nova que saiu sem ele, e o aviso a cita; no macOS os betas não entram nessa conta, porque a falta do pacote neles é o
  esperado e não uma falha, e um Mac só com um beta mais novo vê só "o Prism está atualizado"). O sistema para o qual não existe pacote nenhum (`choosePackage` sem resposta,
  Linux arm64) não filtra: a tela já diz que não há pacote, e baixar é recusado. As versões instaladas até a 0.5.0-beta.2 não têm
  esta regra: nelas a release sem o pacote aparece, e a atualização é recusada com a causa de antes (a soma que falta nas notas).
  Em Configurações › Atualizações, no macOS, "Receber versões beta" continua e ganha a dica de que os betas não têm pacote ali.
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
  `electron-builder.yml` não declaram `arch` de propósito: com `arch` lá, o `--arm64` não restringe e as duas saem de uma vez. Sem publicação e
  sem certificado: nenhum token ou variável de segredo. Windows e Linux saem sem assinatura; o macOS sai com **assinatura ad hoc**
  (issue #33): `identity: "-"`, `hardenedRuntime: false` e `notarize: false` no `electron-builder.yml`, que não pedem certificado nem
  keychain (o comentário do arquivo diz o que cada linha faz e que não foi aberto num Mac de verdade). O `dist` tira as `CSC_*` do
  ambiente no macOS (`builderEnvironment`, em `dist-plan.mjs`), para um certificado esquecido ali não mudar a assinatura. A atualização
  no macOS não depende da assinatura: o app só baixa o `dmg`, confere as somas e o deixa na pasta de downloads (RN-ATUALIZA-006), sem
  verificar assinatura nem mexer em quarentena. Windows e Linux são só x64.
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

- **A raiz não rola nunca** (`globals.css`, com teste em `globals.test.ts`): `html` e `body` com `overflow: clip`, e o `body` com `position: relative`.
  No `html` o `clip` vai para a janela como `hidden` (a regra do CSS para a raiz), e com `hidden` o `scrollIntoView` e o `scrollTop` ainda rolam: quem corta
  é o `body`, e o `position: relative` faz dele o bloco de quem é `absolute` sem ancestral posicionado, que senão escaparia do corte (conferido no Electron:
  sem ele, o `scrollIntoView` de um `absolute` além da janela rolava 257 px). Só as áreas de dentro rolam, e **toda tela que precisa rolar numa janela
  baixa tem a própria área**: o login (`h-full overflow-y-auto` por fora, `min-h-full` por dentro), as Configurações (e os Drivers, que são uma seção
  delas), o primeiro uso, a falha da API e a do cofre (`overflow-y-auto` com `justify-center-safe`, que não esconde o topo do que passa da altura) e a
  tela de bloqueio (o `<dialog>` de `h-dvh overflow-auto`). Para conferir: `document.scrollingElement.scrollHeight === innerHeight` (e a largura) na área
  de trabalho, e quem passa da borda é o elemento com `getBoundingClientRect().bottom > innerHeight` fora de um ancestral que o corte.
- Os tokens estão em `src/styles/globals.css` e vêm do canvas (`docs/design/canvas/`). A paleta
  padrão do Tailwind está desligada: só existem as cores do Prism (`background`, `panel`, `raised`,
  `selected`, `border`, `border-strong`, `ink`, `body`, `muted`, `subtle`, `accent`, `postgres`,
  `db2`, `informix`, `danger`, `success`, `scrim`, mais `selection`, as quatro de sintaxe, `syntax-keyword`, `-string`, `-number` e
  `-comment`, e `link`, o azul de link de cada tema: RN-LINK-001; o canvas não o desenha, e os quatro temas além dos do Prism trazem o da paleta deles). **Cada uma é `light-dark(claro, escuro)`** (seis temas: ver "Configurações"), então
  nenhuma cor fixa (`#rrggbb`, `text-white`, `fill` nomeado) entra em componente: só os tokens. As exceções são a ilustração da
  marca, a lista de cores de ambiente da conexão e o texto que a etiqueta calcula sobre ela, a cor do ambiente nos destaques da área de resultado
  (a variável `--environment-color`, abaixo), as prévias do tema e os `.svg` do splash.
- **A cor do ambiente nos destaques da área de resultado** (RN-AMB-002). Na área de resultado de uma aba (os Registros da tabela e o resultado da consulta,
  no painel, numa aba ou na janela do resultado), estes destaques levam a cor do ambiente da conexão da aba, o próprio ou o herdado da pasta: o sublinhado do
  título "Registros"/"Resultado" (`ResultPanel`) e o da aba escolhida do Executar script e de "Resultado | Variáveis" (`script-tabs.tsx`); o contorno da
  célula ativa (`GridRow`) e a borda do campo de edição dela (`cell-editor.tsx`, para o contorno não trocar de cor no F2); o anel do foco da grade; e as
  barras de rolagem da grade (a vertical, a horizontal e o canto). Sem ambiente, com ambiente sem cor (só o nome), com cor sem nome, com cor fora de
  `#RRGGBB` ou na aba sem conexão, tudo fica como no tema: o acento nos contornos, e na rolagem o `border-strong` (**não** o acento: sem ambiente a barra não
  ganha cor).
  - **`--environment-color` NÃO é token.** Não está no `@theme` nem no `globals.css` (o `environment-accent.test.ts` confere que o `globals.css` nem a cita), não
    é `--color-*`, não tem as duas colunas `light-dark` que as fichas têm (o teste dos temas as leria e cobraria o par) e não vira classe de cor. É uma variável de
    estilo, posta por `environmentColorStyle(cor)` (`workbench/_lib/environment-accent.ts`), cujo valor já é o `light-dark(<clara>, <escura>)` do `iconColorStyle`:
    3:1 sobre as superfícies de todos os temas (RN-CONFIG-003, ver "O ícone colorido"), e quem escolhe a coluna é o `color-scheme` do tema, a janela do resultado
    inclusive (ela copia o `data-theme` e o `style` do `<html>`). O Âmbar vira `#A77E2F` nos temas claros; o azul-marinho `#1B2A80` vira `#848CBA` nos escuros.
  - **Onde é posta, e por quê: no `style` da `<section>` do `ResultPanel` (a propriedade `environmentColor`), e só ali.** Variável de CSS herda pelo DOM, não pela
    árvore do React, e a área de resultado da aba de consulta vai por portal para uma raiz que MUDA de lugar (o painel, a aba do resultado, a janela do
    resultado: outro documento). Posta na raiz da aba de consulta, ela não chegaria à aba nem à janela do resultado, e nenhum teste sem DOM perceberia. O
    `ResultPanel` é a passagem única: só ele desenha o `ResultGrid`, e só existem dois (`QueryTabPanel` e `RecordsView`). O `style` de quem chama (o `flex` do
    painel) continua, e sem cor a `<section>` fica sem a variável.
  - **A variável só existe com `#RRGGBB` válido**, e `environmentColorStyle` é a única barreira: a leitura de `connections.schema.ts` só confere que o campo é
    texto, e uma cor que o CSS não entende (um cofre antigo, uma importação) deixaria a propriedade inválida no cálculo, e a borda cairia no `currentColor`, e
    NÃO na reserva do `var()`. A cor chega pelas propriedades como texto (`string | null`), sem validar no caminho, para o painel memorizado comparar pelo valor.
  - **Como se lê**: `environmentAccent` (`border`, `outline`, `focusOutline`, `scrollbar`) são classes de valor arbitrário com a reserva do tema DENTRO do
    `var()`: `border-[color:var(--environment-color,var(--color-accent))]`, e a barra `[scrollbar-color:var(--environment-color,var(--color-border-strong))_var(--color-panel)]`,
    que sem a variável é, letra por letra, o `scrollbar-color` do `:root`. Destaque novo que deva levar a cor usa uma delas (o Tailwind as acha porque as cadeias
    são literais no `.ts`: não as monte por pedaços). O anel do foco só troca a COR do `:focus-visible` do `globals.css` (a espessura e o recuo `-outline-offset-2`
    continuam os de lá). **A linha da grade (`GridRow`) é memorizada e NÃO tem propriedade de cor**: o contorno herda a variável, e trocar o ambiente da aba não
    redesenha linha nenhuma (um `@ts-expect-error` no `result-grid.test.ts` falha se alguém criar a propriedade).
  - **A ligação é só por propriedade, como a do `environment` do `TableTabPanel`**: `WorkbenchTabs` (`environmentOf(connectionId)?.color ?? null`, recalculado a
    cada desenho, então trocar a conexão da aba, editar o ambiente da pasta ou mover a conexão muda a cor na hora) → `QueryTabPanel.environmentColor` →
    `ResultPanel`; `TableTabPanel` (`environment?.color ?? null`) → `RecordsView.environmentColor` → `ResultPanel`. Contexto do React não serve de atalho
    aqui: o portal o atravessaria, mas a janela do resultado não, e o resto do projeto passa o ambiente por propriedade. A aba de execução do "Executar com
    valores…" (RN-VAR-029) ainda não existe; quando existir, usa o mesmo `ResultPanel` e passa a mesma propriedade.
  - **Fica de fora, no acento ou no token de hoje**: a faixa de abas, o editor SQL (cursor, realce do comando enviado, rolagem), o campo de filtro, o foco das
    linhas de Variáveis, a Estrutura e o Diagrama, o seletor Registros/Estrutura/Diagrama, as marcas de pendência (`bg-accent/20` e `/35`, a marca da coluna, o
    "+" da linha nova), a divisa das colunas, as setas de ordenar, os botões e a dica, o ícone e o botão de confirmar do campo de edição (ali o acento é atenção e
    ação, e não contorno); as outras barras de rolagem da área (Estatísticas, Variáveis, lista das abas do script) ficam na do tema. Pôr a cor trocando o
    `--color-accent` num contêiner foi descartado: pintaria tudo o que é acento ali dentro (pendência, atenção, botões) e misturaria "ambiente" com "atenção".
  - **Armadilhas**: (1) o vermelho do canvas (`#FF8A7A`) é o `danger` do Prism Escuro: num ambiente vermelho, o contorno da célula ativa e o da linha marcada para
    exclusão têm o mesmo tom (a linha excluída segue riscada e com fundo vermelho); (2) o 3:1 vale sobre as quatro superfícies dos temas, e **não** sobre o fundo
    tingido da célula pendente (`bg-accent/20` e `/35`) nem da linha excluída (`bg-danger/10`), onde ele cai (medido com as seis cores do canvas: de 1,9 a 2,8:1 nos
    temas claros, e abaixo de 3:1 sobre a pendente mais forte também no Monokai, no Dracula e no Nord), como já caía com o acento; (3) a barra de rolagem na cor
    do ambiente (3:1) pesa mais que a do tema (o `border-strong` sobre o painel dá de 1,7 a 2,4:1 na maioria dos temas): é o pedido. **Conferir sob
    Xvfb** (o vitest não tem DOM, e nenhum teste vê o valor calculado): `getComputedStyle` da célula ativa (`outlineColor`), do `<h2>` (`borderBottomColor`) e da caixa
    da grade (`scrollbarColor`), no Prism Escuro, no Prism Claro, no GitHub Claro e no Kanagawa, com o resultado no painel, numa aba e na janela do resultado, e a
    conexão sem ambiente igual à 0.5.0.
- A escala de texto reaproveita os nomes padrão com os tamanhos do canvas: `text-xs` 12/18,
  `text-sm` 13/20 (a área de trabalho inteira, pela raiz dela: RN-CONFIG-009), `text-base` 14/22 (o corpo: formulários, diálogos, login e
  Configurações), `text-lg` 18/24. `rounded-xl` é o raio do diálogo
  (10px) e `shadow-2xl` a sombra do que flutua.
- O sucesso usa o mesmo verde do Db2 (`#5ED3A3` no escuro, `#097244` no Prism Claro: o `#0B7A4B` do canvas dava 4,37:1 sobre a linha
  selecionada), como a especificação pede; o canvas não tem outro.
- Primitivos (`@/components/ui`): `Button`, `Field`, `FieldLabel`, `Input`, `TextField`, `FieldError`,
  `FormMessage`, `Dialog`, `ConfirmDialog`, `Select`, `Segmented`, `navItem` (a classe da entrada de uma lista de navegação vertical: a lista de Configurações e a de seções da Estrutura), `StatusBadge`, `EngineTag`,
  `EnvironmentPill`, os ícones (`icons.tsx`), `ToastProvider`, `useToast`. Vieram do etio com o que esta fatia usa (o `ContextMenu` é do
  Prism, não do etio: ver "Navegador: clique, menu e busca"): o `Select` não tem busca, e a lista mais larga que o controle é opcional
  (`wideList`, só o seletor de ambiente a usa; sem ela a lista tem a largura do controle e o texto quebra) (e tem `triggerRef`, o `ref` do botão para quem leva o foco a ele, e `onOpen`, para quem busca as opções só quando a pessoa abre a lista, `aria-describedby`, e o `content` da opção, que
  a desenha no lugar do rótulo, na lista e no controle fechado: a etiqueta de ambiente do navegador; o rótulo segue sendo o da busca pela inicial), o `Dialog` não tem os tamanhos `xl` e `full`, e não há `lucide-react` (os
  ícones são SVG de `icons.tsx`, no traço do canvas). O `Dialog` aceita um `icon` ao lado do título e uma faixa no topo do painel (`banner`, a do
  ambiente no aviso de confirmação, RN-PROT-001; com ela o painel recorta o que passa da borda arredondada), e o `describedBy`, os ids do que, no
  corpo, o leitor de tela lê com o título (`describedByOf`: a `description` do cabeçalho vem antes, quando há). O `ConfirmDialog` é um `Dialog` com
  as duas respostas no rodapé: foco preso, Esc, clique fora e portal moram num lugar só.
- As fontes IBM Plex vão dentro do app (`@fontsource`), nos pesos 400, 500 e 600. São o padrão e a reserva das que o usuário escolhe
  (RN-CONFIG-008): `font-sans` é a da interface, `font-editor` a do editor SQL (para SQL fora do CodeMirror) e `font-mono` a mono do app, que
  nenhuma escolha muda (a mensagem do banco, as etiquetas, a Estrutura e o Diagrama). Texto novo que é SQL usa `font-editor`; **o dado do banco
  na grade e na árvore usa a da interface (`font-sans`, herdada)**; a mensagem do banco, o código e as etiquetas, `font-mono`.

## Dependências

- Tudo fica em `devDependencies`: o Vite empacota a tela, e `main` e `preload` só usam o Electron
  e os módulos do Node. O `electron-builder` copia para o app o que estiver em `dependencies`.
- React e Electron em versão exata. O Electron está na 44.9.3, a mais nova da linha 44 com mais de três dias em 24/10/2026
  (a 44.9.1 é a primeira com a correção do aviso de segurança do Electron); subir quando a trava deixar. A 45 pede revisão à parte.
- O `undici` é dependência transitiva (`electron` > `@electron/get`, na linha 7.x, e `electron-builder` > `node-gyp`, na 6.x) e
  não tem `overrides`: os intervalos dos pais já aceitam a versão corrigida, então o aviso de segurança se resolve só no
  `pnpm-lock.yaml` (`pnpm update undici`, que regera o arquivo; nunca à mão). Só criar um `overrides` no
  `pnpm-workspace.yaml` se um pai passar a pedir uma versão que não aceita a corrigida.
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
- **A largura das colunas medida na fonte da interface (RN-CONFIG-008, seção 42)**: a soma dos caracteres do canvas mais 1 px por texto foi conferida contra o
  texto na tela, no Chromium do Electron no Linux, sob Xvfb: o nome e a célula medidos no DOM contra o que a coluna deixa ao texto (`Math.round((largura + 25)
  × fator) − 24 × fator − 1`), e o `GridHeaderCell` e a `ResultGrid` de verdade, montados com o CSS do app. Com a IBM Plex Sans e com a DejaVu Sans, na grade
  de 100% a 200% (e, com a escala do dispositivo em 1, 1,25, 1,5 e 2 e o zoom do programa em 125% e 150%, a 100% e 150%), nenhum dos mais de 1.100 textos
  (nomes em MAIÚSCULAS e em minúsculas, com acento, números, aleatórios; 500 UUIDs, 300 datas com hora, 300 números, 400 nomes em maiúsculas com `_`) passou
  da coluna: a menor sobra foi 0,39 px no nome e 0,63 px na célula, e 27 nomes de coluna, com o tipo ligado e desligado, a marca "somente leitura" e a seta de
  ordenar, não vieram cortados em nenhum zoom de 100% a 200% (a conta de antes, da mono, cortava 17 dessas combinações a 100% ou mais). **O que a soma não
  vê**: o ajuste entre pares de letras. Quase sempre sobra (a soma é maior), mas há pares com ajuste positivo (`TT`, `WW`, `g_`, `_j`, `fT`: até 0,7 px por
  par), e um texto de um par só repetido passa da soma e da folga: `TTTTTTTT` por 0,6 px, 32 `W` por 0,7 px (a célula ganha as reticências sem a dica). Dados
  de verdade não chegam lá. **Abaixo de 100% da grade (50% a 80%)** alguns textos passam da coluna, por até 0,45 px (um nome aleatório de 16 caracteres; entre
  67 nomes de coluna comuns, só 3, por até 0,16 px), e o cabeçalho que ordena e não mostra o tipo corta o nome em até 2 px: é a aritmética do zoom, que já era
  assim com a mono (140 de 1.512 combinações cortadas, 17 delas a 100% ou mais, contra 48 com a IBM Plex Sans e 61 com a DejaVu Sans, nenhuma a 100% ou mais):
  a largura vira pixels inteiros (`gridMetrics.width` usa `Math.round`), e a margem de 4 px do botão de ordenar e a borda de 1 px não escalam (o tipo, quando
  está à vista, absorve a diferença). Com uma fonte de alternativas contextuais (a Inter troca o `x` entre algarismos) um texto de letras e algarismos pode
  passar da soma por alguns décimos. **No Windows (e no macOS) não foi conferida**: se o Chromium arredondar o avanço de cada glifo ali (sem posição de
  subpixel), a soma do canvas e a tela podem divergir, e a folga de 1 px por texto cobre pouco disso. Conferir os cabeçalhos em MAIÚSCULAS (`WAREHOUSE_ID`,
  `NOME_MUNICIPIO`), com o tipo ligado e desligado, ordenados, em 50, 100, 150 e 200%, e, se divergir, calibrar a folga por uma régua única (um texto fora do
  fluxo, medido uma vez por fonte). Com a fonte do app ainda carregando no primeiro desenho da grade, o canvas já pede a fonte e a primeira medida é a da
  reserva (o `WAREHOUSE_ID` de 105 px passa a 104 px, e uma célula de 104 a 101 px, quando ela chega): a grade se refaz uma vez, como previsto. A conferência
  e o carregamento olham a faixa latina do `@fontsource` (a que cobre o português): um caractere de outra faixa (cirílico, latino estendido) é medido na
  reserva até a faixa chegar, e a medida não é refeita por ele (um `loadingdone` de `document.fonts` refaria).
- Pacote de macOS: não provado por inteiro: o `dmg` só se gera no macOS, e nenhum pacote foi aberto no macOS. Num contêiner Linux o electron-builder aceita a
  configuração e gera o `zip`, e recusa o `dmg` (`sips process failed ENOENT`: o `dmg` só se gera no macOS). O `.icns` existe e
  traz a ilustração inteira, mas o app nunca foi aberto no macOS.
- **As pastas abertas lembradas e a barra de filtros do navegador (0.6.0, RN-NAV-014, RN-NAV-010 e 013)**: provadas nos testes (a regra, a loja e o navegador com os
  ganchos simulados) e vistas sob Xvfb no app inteiro, também em duas janelas de verdade (ver "As pastas abertas lembradas"); faltam a importação (do DBeaver e de arquivo do
  Prism), o app empacotado e o macOS. Os limiares em que o seletor de ambiente desce foram medidos (ver "A barra de filtros").

- A `TopBar` tem a marca (com a versão e "Verificar atualizações"), "Área de trabalho", "Conexões", "Drivers" (com um ponto quando há
  reinício pendente), "Configurações" (ícone e texto, como os outros itens), o usuário e "Sair". O link da marca para a área de
  trabalho ainda não existe.
- O `sqlLiteral` foi conferido contra um PostgreSQL de verdade (com aspa, barra invertida, zeros à esquerda, notação científica e ponto e
  vírgula no valor); o Informix e o Db2 nunca foram vistos num servidor para o literal e para o DDL aproximado, só nos testes de função pura.
  O CSV foi conferido até o início do download e pelos bytes do `Blob`: o diálogo de salvar do sistema precisa ser concluído por uma pessoa
  numa janela de verdade. Não exercitados na tela: macOS e Linux, leitor de tela, método de entrada (IME) e `prefers-reduced-motion`.
