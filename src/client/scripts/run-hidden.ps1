<#
.SYNOPSIS
  Abre um programa numa area de trabalho (desktop) separada do Windows, para que a janela dele
  nao apareca na tela de quem esta usando o computador.

  FERRAMENTA DE DESENVOLVIMENTO, so para conferir o build deste projeto (o Prism.exe empacotado). Nao e
  parte do produto nem se destina a abrir outros programas: -Exe, -ExtraArgs e -EnvVars rodam o que
  receberem, com os direitos de quem chamou, numa area de trabalho que ninguem ve.

.DESCRIPTION
  CreateDesktop + CreateProcess com STARTUPINFO.lpDesktop: a janela do app nasce na area de
  trabalho "prism-hidden", que nao e a que o usuario ve (WinSta0\Default), e la fica. Tudo o que o
  app faz continua valendo (janelas, GPU, protocolo de depuracao); so nao ha tela para ver. Para
  olhar a tela use a porta de depuracao: `/json/list`, `Runtime.evaluate`, `Page.captureScreenshot`.

  Imprime um objeto com Pid (do processo principal do app), DebugPort, UserDataDir, LogFile e
  Desktop. O script segura a area de trabalho ate o app abrir a primeira janela nela: sem isso o
  Windows a destroi e o app morre na partida (0xC0000142 ou 0x80000003).

.EXAMPLE
  # Abre o app empacotado com dados descartaveis (nunca os dados reais do usuario em %APPDATA%):
  .\scripts\run-hidden.ps1 -Exe .\release\win-unpacked\Prism.exe -UserDataDir $env:TEMP\prism-teste -LogFile $env:TEMP\prism-teste.log
  # Depois: http://127.0.0.1:<DebugPort>/json/list. Para ver as janelas e se alguma tem barra de menu:
  .\scripts\run-hidden.ps1 -ListWindows
  # Para encerrar o que ficou na area de trabalho escondida:
  .\scripts\run-hidden.ps1 -Stop

.PARAMETER Exe
  O programa a abrir (por exemplo release\win-unpacked\Prism.exe).
.PARAMETER DebugPort
  Porta de depuracao do Chromium (0: escolhe uma livre). Vai como --remote-debugging-port.
.PARAMETER UserDataDir
  Vai como --user-data-dir. O Prism guarda o cofre no diretorio de dados do Electron: use sempre
  uma pasta de teste, para nao tocar nos dados de quem usa o app.
.PARAMETER LogFile
  Recebe a saida do processo (o log `[prism] ...` do processo principal). O app passa por um
  `cmd /c ... > arquivo`, porque dar o arquivo direto ao CreateProcess faria o app herdar tambem
  os handles de quem chamou este script (um pipe do terminal, por exemplo, que nunca fecharia).
.PARAMETER EnvVars
  Variaveis de ambiente a mais para o processo, por exemplo @{ ELECTRON_RENDERER_URL = 'http://localhost:1' }.
.PARAMETER WindowTimeoutSeconds
  Quanto esperar a primeira janela do app (30 s). Passado o prazo, ou se o app morreu, o script encerra o
  que lancou (o cmd e o app, com os filhos) e falha.
.PARAMETER Desktop
  Nome da area de trabalho escondida (prism-hidden). O nome tem de comecar por prism-, para que o -Stop nunca
  atinja a area de trabalho de quem usa a maquina nem a de outra ferramenta.
.PARAMETER ListWindows
  Lista as janelas da area de trabalho escondida (titulo, classe, visivel, tem barra de menu).
.PARAMETER Stop
  Encerra os processos que tem janela na area de trabalho escondida.
#>
[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
  [Parameter(ParameterSetName = 'Run', Mandatory)] [string] $Exe,
  [Parameter(ParameterSetName = 'Run')] [int] $DebugPort = 0,
  [Parameter(ParameterSetName = 'Run')] [string] $UserDataDir,
  [Parameter(ParameterSetName = 'Run')] [string] $LogFile,
  [Parameter(ParameterSetName = 'Run')] [string[]] $ExtraArgs = @(),
  [Parameter(ParameterSetName = 'Run')] [hashtable] $EnvVars = @{},
  [Parameter(ParameterSetName = 'Run')] [int] $WindowTimeoutSeconds = 30,
  [Parameter(ParameterSetName = 'List', Mandatory)] [switch] $ListWindows,
  [Parameter(ParameterSetName = 'Stop', Mandatory)] [switch] $Stop,
  # O -Stop encerra os processos que tem janela nela: so uma area de trabalho criada por este script (prism-*), nunca a de
  # quem usa a maquina (Default, Winlogon, Disconnect) nem a de outra ferramenta.
  [ValidateScript({
    if ($_ -match '^prism-[A-Za-z0-9_-]+$') { $true }
    else { throw "Area de trabalho invalida: '$_'. O nome tem de comecar por prism- (depois, letras, numeros, - e _)." }
  })] [string] $Desktop = 'prism-hidden'
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class HiddenDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct RECT { public int Left, Top, Right, Bottom; }

  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, string device, IntPtr devmode, int flags, uint access, IntPtr sa);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenDesktopW(string name, int flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] static extern bool EnumDesktopWindows(IntPtr desktop, EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  const uint GenericAll = 0x10000000, DesktopEnumerate = 0x0040;
  static IntPtr held = IntPtr.Zero;

  /// Cria (ou abre, se ja existe) a area de trabalho, segura o handle dela e inicia o processo nela.
  /// Quem chamou tem de chamar Release() quando o app ja tiver aberto uma janela.
  public static int Launch(string desktop, string exe, string commandLine, string cwd) {
    held = CreateDesktopW(desktop, null, IntPtr.Zero, 0, GenericAll, IntPtr.Zero);
    if (held == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "CreateDesktop");

    var si = new STARTUPINFO { lpDesktop = desktop };
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    PROCESS_INFORMATION pi;
    // bInheritHandles = false e CREATE_NO_WINDOW (0x08000000): o app nao herda nada de quem chamou, nem o console (o pipe do terminal que chamou o script).
    if (!CreateProcessW(exe, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, cwd, ref si, out pi)) {
      int error = Marshal.GetLastWin32Error();
      Release();
      throw new System.ComponentModel.Win32Exception(error, "CreateProcess");
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }

  public static void Release() {
    if (held != IntPtr.Zero) { CloseDesktop(held); held = IntPtr.Zero; }
  }

  public class WindowInfo { public long Handle; public uint Pid; public string Title, Class; public bool Visible; public bool HasMenuBar; public int MenuItems; public string Rect; }

  public static List<WindowInfo> Windows(string desktop) {
    var list = new List<WindowInfo>();
    IntPtr hDesktop = OpenDesktopW(desktop, 0, false, DesktopEnumerate);
    if (hDesktop == IntPtr.Zero) return list;
    EnumDesktopWindows(hDesktop, (hwnd, _) => {
      var title = new StringBuilder(256); var cls = new StringBuilder(256);
      GetWindowTextW(hwnd, title, 256); GetClassNameW(hwnd, cls, 256);
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      RECT r; GetWindowRect(hwnd, out r);
      IntPtr menu = GetMenu(hwnd);
      list.Add(new WindowInfo { Handle = hwnd.ToInt64(), Pid = pid, Title = title.ToString(), Class = cls.ToString(), Visible = IsWindowVisible(hwnd),
        HasMenuBar = menu != IntPtr.Zero, MenuItems = menu == IntPtr.Zero ? 0 : GetMenuItemCount(menu), Rect = r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top) });
      return true;
    }, IntPtr.Zero);
    CloseDesktop(hDesktop);
    return list;
  }
}
'@

if ($ListWindows) {
  [HiddenDesktop]::Windows($Desktop) | Where-Object { $_.Title -ne '' -or $_.Visible } | Format-Table Handle, Pid, Visible, HasMenuBar, MenuItems, Class, Title, Rect -AutoSize | Out-String -Width 250
  return
}

if ($Stop) {
  [HiddenDesktop]::Windows($Desktop) | ForEach-Object { $_.Pid } | Sort-Object -Unique | Where-Object { $_ -ne 0 } | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  return
}

$exePath = (Resolve-Path -LiteralPath $Exe).Path

if ($DebugPort -eq 0) {
  $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $probe.Start(); $DebugPort = $probe.LocalEndpoint.Port; $probe.Stop()
}

$arguments = @("--remote-debugging-port=$DebugPort")
if ($UserDataDir) { $arguments += "--user-data-dir=$UserDataDir" }
$arguments += $ExtraArgs
$appCommand = '"' + $exePath + '" ' + (($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')

if ($LogFile) {
  $logPath = [IO.Path]::GetFullPath($LogFile)
  $application = $env:ComSpec
  $commandLine = '"' + $application + '" /d /s /c "' + $appCommand + ' > "' + $logPath + '" 2>&1"'
} else {
  $application = $exePath
  $commandLine = $appCommand
}

# O processo herda o ambiente deste; as variaveis pedidas valem so para ele.
$saved = @{}
foreach ($name in $EnvVars.Keys) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, [string]$EnvVars[$name], 'Process') }
$started = Get-Date
try {
  $launched = [HiddenDesktop]::Launch($Desktop, $application, $commandLine, (Split-Path $exePath))
} finally {
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}

try {
  # Espera a primeira janela do app na area de trabalho. Com LogFile, o processo lancado e o cmd, e o app
  # e filho dele.
  $mainPid = $launched
  while ($true) {
    Start-Sleep -Milliseconds 300
    if ($LogFile) {
      $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$launched" | Where-Object { $_.Name -ieq (Split-Path $exePath -Leaf) } | Select-Object -First 1
      if ($child) { $mainPid = $child.ProcessId }
    }
    if ([HiddenDesktop]::Windows($Desktop) | Where-Object { $_.Pid -eq $mainPid }) { break }

    $seconds = ((Get-Date) - $started).TotalSeconds
    $alive = [bool](Get-Process -Id $mainPid -ErrorAction SilentlyContinue)
    if ($seconds -gt $WindowTimeoutSeconds -or ($seconds -gt 5 -and -not $alive)) {
      $tail = if ($LogFile -and (Test-Path $LogFile)) { (Get-Content $LogFile -Tail 10) -join "`n" } else { '' }
      throw "O app nao abriu janela na area de trabalho escondida.`n$tail"
    }
  }
} catch {
  # Sem janela, o -Stop nao os acha: encerra aqui o cmd e o app (com os filhos). So mata processo iniciado por
  # este script (hora de inicio depois da partida), para um PID reaproveitado nao levar outro programa junto.
  foreach ($id in @($launched, $mainPid | Sort-Object -Unique)) {
    $running = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $running) { continue }
    # Ler StartTime de um processo protegido (ou que acabou de morrer) lanca; dentro do catch isso trocaria o erro original
    # e pularia o processo seguinte. Sem a hora de inicio nao ha como saber de quem e: nao se mata.
    try { $startedAt = $running.StartTime } catch { continue }
    if ($startedAt -ge $started.AddSeconds(-2)) { & taskkill.exe /PID $id /T /F | Out-Null }
  }
  throw
} finally {
  [HiddenDesktop]::Release()
}

[pscustomobject]@{ Pid = $mainPid; DebugPort = $DebugPort; UserDataDir = $UserDataDir; LogFile = $LogFile; Desktop = $Desktop }
