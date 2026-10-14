# O instalador do Windows como o do DBeaver (seção 25 da especificação, RN-INSTALA-001 a 004). O `electron-builder.yml` gera o
# instalador assistido (`oneClick: false`), que é o modelo do electron-builder com os dois modos (`multiUser.nsh`: só o usuário,
# em HKCU e na pasta de programas do perfil; todos os usuários, em HKLM e na pasta de programas do sistema) e com o plugin UAC.
# O manifesto do instalador continua sem exigir administrador (`installer.nsi`, `RequestExecutionLevel user`): por isso o
# atualizador do app o abre com `spawn` (um executável que exige administrador o Windows recusa assim, ERROR_ELEVATION_REQUIRED)
# e a pessoa o abre sem aviso. Quem pede a permissão é este arquivo, pelo pedido do próprio Windows (`UAC::RunElevated`): com
# ela, uma segunda instância, a elevada, instala para todos; sem ela, esta segue e instala só para o usuário.
#
# Os modelos citados são os do electron-builder 26.15.3 (`app-builder-lib/templates/nsis`). Este arquivo entra no cabeçalho do
# instalador E no da compilação do desinstalador (`NsisTarget.js`, `computeCommonInstallerScriptHeader`), antes de tudo o que os
# modelos definem: aqui só há macros e variáveis, e só na compilação do instalador, porque o electron-builder compila com `-WX`
# (todo aviso é erro, e uma função ou variável que não se usa é aviso). As macros usam o que os modelos definem depois
# (`INSTALL_REGISTRY_KEY`, `APP_EXECUTABLE_FILENAME`, `setInstallModePerUser`…), e funcionam porque o texto delas só é lido onde
# o modelo as insere: `customInit` no fim do `.onInit` (`installer.nsi`), depois de `initMultiUser`, e `customInstallMode` na
# página da escolha do modo (`multiUserUi.nsh`).

!ifndef BUILD_UNINSTALLER

# A pasta de cada instalação que existe, lida do registro no `customInit`.
Var prismMachineDir
Var prismUserDir

# A frase no idioma que o instalador escolheu pelo do Windows ($LANGUAGE: 1046 é o português do Brasil; 3082 e 1034, o espanhol);
# em qualquer outro, inglês.
!macro prismText OUT EN PT ES
  ${If} $LANGUAGE = 1046
    StrCpy ${OUT} "${PT}"
  ${ElseIf} $LANGUAGE = 3082
    StrCpy ${OUT} "${ES}"
  ${ElseIf} $LANGUAGE = 1034
    StrCpy ${OUT} "${ES}"
  ${Else}
    StrCpy ${OUT} "${EN}"
  ${EndIf}
!macroend

# Não instala: diz por quê (no modo silencioso o aviso não aparece, `/SD`) e sai com o código. 2 é o "abortado" do NSIS; 1223 é o
# ERROR_CANCELLED do Windows, o da permissão negada.
!macro prismStop CODE EN PT ES
  !insertmacro prismText $R0 "${EN}" "${PT}" "${ES}"
  MessageBox MB_OK|MB_ICONEXCLAMATION "$R0" /SD IDOK
  SetErrorLevel ${CODE}
  Quit
!macroend

# Pede a permissão de administrador pelo pedido do Windows. Se ela vem, quem instala é a instância elevada, e esta só espera por
# ela e sai com o código dela. `UAC.nsh` diz o que volta: $0 é o erro do Windows (0, ou 1223 quando a pessoa nega); com $0 = 0,
# $1 = 1 quando a instância elevada rodou, e $2 é o código de saída dela, que é 0x666666 quando ela, afinal, não tem administrador
# (uma conta sem administrador no pedido; `assistedInstaller.nsh`, `initMultiUser`). A macro só termina quando a permissão NÃO
# veio: negada, recusada pelo Windows ou de uma conta sem administrador.
!macro prismRunElevated
  !insertmacro UAC_RunElevated
  ${If} $0 = 0
  ${AndIf} $1 = 1
  ${AndIf} $2 <> 0x666666
    SetErrorLevel $2
    Quit
  ${EndIf}
!macroend

# A atualização de dentro do app (`--updated --force-run`, `electron/update/install.ts`) de uma instalação para todos, com a
# permissão negada: nada foi instalado, e o Prism abre de novo na versão que está (RN-INSTALA-003); é ele quem avisa
# (`electron/update/install-attempt.ts`). Antes, espera até 30 s o Prism que abriu este instalador (o processo pai) terminar de
# fechar: aberto, ele seguraria o bloqueio de instância única, e o Prism novo fecharia sozinho. `getProcessInfo.nsh` dá o pai e o
# nome dele; SYNCHRONIZE (0x00100000) basta para esperar.
!macro prismReopenApp
  ${GetProcessInfo} 0 $R1 $R2 $R3 $R4 $R5
  ${GetProcessInfo} $R2 $R1 $R3 $R4 $R5 $R6
  ${If} $R5 == "${APP_EXECUTABLE_FILENAME}"
    System::Call "kernel32::OpenProcess(i 0x00100000, i 0, i $R2) p .R7"
    ${If} $R7 <> 0
      System::Call "kernel32::WaitForSingleObject(p R7, i 30000) i"
      System::Call "kernel32::CloseHandle(p R7) i"
    ${EndIf}
  ${EndIf}
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

# O modo, decidido no fim do `.onInit`. `initMultiUser` (`assistedInstaller.nsh`) já leu o registro e os argumentos `/allusers` e
# `/currentuser`; aqui entram as regras do Prism:
#  - RN-INSTALA-002: a instalação que existe manda. A para todos (HKLM) é atualizada para todos, pedindo a permissão quando esta
#    instância não a tem; sem ela, nada é instalado (instalar só para o usuário faria a segunda instalação). A só do usuário (HKCU)
#    é atualizada sem pedir nada. Um `/allusers` ou `/currentuser` que pede o outro modo é recusado: quem quer trocar desinstala
#    antes.
#  - RN-INSTALA-004: `/allusers` numa máquina sem o Prism instala para todos (pedindo a permissão, e sem ela não instala); e
#    `/currentuser`, só para o usuário.
#  - RN-INSTALA-001: aberto pela pessoa, sem instalação e sem modo na linha de comando, pede a permissão; negada (ou numa conta sem
#    administrador), instala só para o usuário, sem erro. O silencioso sem modo instala só para o usuário, como sempre.
# A instância elevada (`UAC_IsInnerInstance`) só existe para instalar para todos. `$hasPerMachineInstallation` e
# `$hasPerUserInstallation` acompanham o modo: é por eles que a seção de instalação (`installer.nsi`) decide se ainda pede a
# permissão no modo silencioso.
!macro customInit
  ${If} ${UAC_IsInnerInstance}
    StrCpy $hasPerMachineInstallation "1"
    StrCpy $hasPerUserInstallation "0"
    !insertmacro setInstallModePerAllUsers
  ${Else}
    ReadRegStr $prismMachineDir HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $prismUserDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation

    ${If} $prismMachineDir != ""
      ${If} ${isForCurrentUser}
        !insertmacro prismStop 2 \
          "Prism is already installed for all users of this computer. To install it only for you, uninstall it first." \
          "O Prism já está instalado para todos os usuários deste computador. Para instalá-lo só para você, desinstale-o antes." \
          "Prism ya está instalado para todos los usuarios de este equipo. Para instalarlo solo para usted, desinstálelo antes."
      ${EndIf}
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
      !insertmacro setInstallModePerAllUsers
      ${IfNot} ${UAC_IsAdmin}
        !insertmacro prismRunElevated
        ${If} ${isUpdated}
        ${AndIf} ${isForceRun}
          !insertmacro prismReopenApp
        ${EndIf}
        !insertmacro prismStop 1223 \
          "Prism is installed for all users of this computer, and updating it needs administrator permission. Nothing was installed." \
          "O Prism está instalado para todos os usuários deste computador, e atualizá-lo pede a permissão de administrador. Nada foi instalado." \
          "Prism está instalado para todos los usuarios de este equipo, y actualizarlo requiere permiso de administrador. No se instaló nada."
      ${EndIf}
    ${ElseIf} $prismUserDir != ""
      ${If} ${isForAllUsers}
        !insertmacro prismStop 2 \
          "Prism is already installed only for you. To install it for all users, uninstall it first." \
          "O Prism já está instalado só para você. Para instalá-lo para todos os usuários, desinstale-o antes." \
          "Prism ya está instalado solo para usted. Para instalarlo para todos los usuarios, desinstálelo antes."
      ${EndIf}
    ${ElseIf} ${isForAllUsers}
      ${IfNot} ${UAC_IsAdmin}
        !insertmacro prismRunElevated
        !insertmacro prismStop 1223 \
          "Installing Prism for all users needs administrator permission. Nothing was installed." \
          "Instalar o Prism para todos os usuários pede a permissão de administrador. Nada foi instalado." \
          "Instalar Prism para todos los usuarios requiere permiso de administrador. No se instaló nada."
      ${EndIf}
    ${ElseIf} ${isForCurrentUser}
    ${ElseIf} ${Silent}
    ${ElseIf} ${UAC_IsAdmin}
      StrCpy $hasPerMachineInstallation "1"
      StrCpy $hasPerUserInstallation "0"
      !insertmacro setInstallModePerAllUsers
    ${Else}
      !insertmacro prismRunElevated
      StrCpy $hasPerMachineInstallation "0"
      StrCpy $hasPerUserInstallation "1"
      !insertmacro setInstallModePerUser
    ${EndIf}
  ${EndIf}
!macroend

# A página "para quem instalar" (`multiUserUi.nsh`, `PAGE_INSTALL_MODE`) nunca aparece: o modo já foi decidido no `customInit`, e
# esta macro, que a página chama antes de se desenhar, o confirma. No modo "todos" esta instância já é a de administrador (as outras
# saíram no `customInit`), e a página o aplica e se pula; no do usuário, também.
!macro customInstallMode
  ${If} $installMode == "all"
    StrCpy $isForceMachineInstall "1"
  ${Else}
    StrCpy $isForceCurrentInstall "1"
  ${EndIf}
!macroend

!endif
