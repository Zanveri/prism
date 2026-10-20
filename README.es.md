# Prism

[English](README.md) · [Português (BR)](README.pt-BR.md) · **Español**

[![Pipeline](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml/badge.svg?branch=develop)](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml?query=branch%3Adevelop)
[![Versión](https://img.shields.io/github/v/release/Zanveri/prism?sort=semver&display_name=tag&label=versi%C3%B3n)](https://github.com/Zanveri/prism/releases)
[![Descargas](https://img.shields.io/github/downloads/Zanveri/prism/total?label=descargas)](https://github.com/Zanveri/prism/releases)
[![Licencia](https://img.shields.io/github/license/Zanveri/prism?label=licencia)](LICENSE)
[![Plataformas](https://img.shields.io/badge/plataformas-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#descargar)
[![Documentación](https://img.shields.io/badge/documentaci%C3%B3n-zanveri.github.io%2Fprism-blue)](https://zanveri.github.io/prism/es/)

**[Descargar](https://github.com/Zanveri/prism/releases/latest)** · [Documentación](https://zanveri.github.io/prism/es/) · [Reportar un problema](https://github.com/Zanveri/prism/issues)

**Prism** es un cliente de bases de datos de escritorio, una alternativa a DBeaver y DataGrip para quien trabaja todos los días
con **PostgreSQL**, **Db2** e **Informix**: conectar, explorar los objetos, ejecutar SQL y ver el resultado, rápido y sin rodeos.
Funciona en Windows, macOS y Linux, y guarda las carpetas y las conexiones de cada usuario en una bóveda cifrada.

Prism nació de nuestra frustración con las versiones recientes de DBeaver: queríamos recuperar una herramienta ligera y directa
para el trabajo de todos los días.

La interfaz de la aplicación está por ahora en portugués de Brasil.

![El editor SQL de Prism con el resultado de una consulta](site/img/editor-resultado.png)

## Descargar

Descarga la versión más reciente desde la **[página de releases](https://github.com/Zanveri/prism/releases/latest)** y, en
**Assets**, elige el archivo de tu sistema:

| Sistema | Archivo | Para qué |
| --- | --- | --- |
| Windows x64 | `Prism-<versión>-win-x64.exe` | el instalador (recomendado): pide administrador para instalar para todos los usuarios; si lo niegas, instala solo para ti. Se actualiza desde dentro de la app, y la instalación para todos pide administrador en cada actualización |
| Windows x64 | `Prism-<versión>-win-x64.zip` | la copia portátil, sin instalación; cada actualización es una descarga nueva |
| Linux x64 | `Prism-<versión>-linux-x86_64.AppImage` | funciona en la mayoría de las distribuciones, sin instalar |
| Linux x64 | `Prism-<versión>-linux-amd64.deb` | Debian, Ubuntu y derivadas |
| Linux x64 | `Prism-<versión>-linux-x86_64.rpm` | Fedora, RHEL, openSUSE y derivadas |
| Linux x64 | `Prism-<versión>-linux-x64.tar.gz` | la carpeta de la aplicación, para descomprimir |
| macOS Apple Silicon | `Prism-<versión>-mac-arm64.dmg` y `….zip` | los Mac con procesador M |
| macOS Intel | `Prism-<versión>-mac-x64.dmg` y `….zip` | los Mac con procesador Intel |

Los paquetes de macOS salen solo con las versiones estables: las betas salen para Windows y Linux. Si una versión salió sin el paquete
de tu sistema, el comienzo de sus notas lo dice, y Prism solo ofrece la actualización que tiene paquete para tu sistema.

El driver de PostgreSQL viene incluido. El de Db2 e Informix es el de IBM: Prism lo descarga por ti en **Configurações › Drivers**
(Configuración › Drivers); IBM no lo publica para Mac con procesador Intel. Para verificar el paquete, compara su SHA-256 con la
línea del archivo `SHA256SUMS` de la release.

Los paquetes todavía no están firmados, y el sistema avisa en la primera apertura:

- **Windows:** en "Windows protegió su PC", haz clic en **Más información** y en **Ejecutar de todas formas**.
- **macOS:** haz clic derecho sobre la aplicación y elige **Abrir**; en macOS 15 o más nuevo, habilítala en **Ajustes del Sistema
  › Privacidad y seguridad › Abrir de todos modos**, o ejecuta `xattr -dr com.apple.quarantine /Applications/Prism.app`.

## Documentación

Instalación, primer uso, conexiones, editor SQL, registros de una tabla, configuración y actualizaciones:
**<https://zanveri.github.io/prism/es/>** (también en [inglés](https://zanveri.github.io/prism/) y
[portugués](https://zanveri.github.io/prism/pt-br/)).

## Problemas y sugerencias

¿Algo no funcionó o falta algo? [Abre una issue](https://github.com/Zanveri/prism/issues), en español, inglés o portugués: ahí
lo ajustamos. Las fallas de seguridad van por el reporte privado descrito en [SECURITY.es.md](SECURITY.es.md).

## Desarrollo

Necesitas el .NET SDK 10, Node.js 22 con pnpm 10 y, para las pruebas de integración, Docker.

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

Las pruebas, el empaquetado y el flujo de contribución están en [CONTRIBUTING.es.md](CONTRIBUTING.es.md); la pipeline y los
lanzamientos, en [docs/ci.md](docs/ci.md) y [docs/versionamento.md](docs/versionamento.md) (en portugués).

## Licencia

GNU GPL versión 3 (`GPL-3.0-only`): cualquier persona o empresa puede usar, estudiar, modificar y redistribuir Prism, siempre que
quien distribuya una copia entregue también el código fuente completo bajo la misma licencia. El texto está en [LICENSE](LICENSE);
el aviso de copyright y el permiso adicional para el driver de IBM, en [NOTICE](NOTICE). Las marcas y los logotipos no están bajo
la GPL.
