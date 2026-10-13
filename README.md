# Prism

**English** · [Português (BR)](README.pt-BR.md) · [Español](README.es.md)

[![Pipeline](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml/badge.svg?branch=develop)](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml?query=branch%3Adevelop)
[![Version](https://img.shields.io/github/v/release/Zanveri/prism?sort=semver&display_name=tag&label=version)](https://github.com/Zanveri/prism/releases)
[![Downloads](https://img.shields.io/github/downloads/Zanveri/prism/total?label=downloads)](https://github.com/Zanveri/prism/releases)
[![License](https://img.shields.io/github/license/Zanveri/prism?label=license)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#download)
[![Documentation](https://img.shields.io/badge/documentation-zanveri.github.io%2Fprism-blue)](https://zanveri.github.io/prism/)

**[Download](https://github.com/Zanveri/prism/releases/latest)** · [Documentation](https://zanveri.github.io/prism/) · [Report a problem](https://github.com/Zanveri/prism/issues)

**Prism** is a desktop database client, an alternative to DBeaver and DataGrip for people who work every day with
**PostgreSQL**, **Db2** and **Informix**: connect, browse the objects, run SQL and see the result, fast and without detours.
It runs on Windows, macOS and Linux, and keeps each user's folders and connections in an encrypted vault.

Prism was born out of our frustration with recent versions of DBeaver: we wanted a lightweight, direct tool for everyday work
again.

The app's interface is currently in Brazilian Portuguese.

![Prism's SQL editor with the result of a query](site/img/editor-resultado.png)

## Download

Get the newest version from the **[releases page](https://github.com/Zanveri/prism/releases/latest)** and, under **Assets**, pick
the file for your system:

| System | File | What it is |
| --- | --- | --- |
| Windows x64 | `Prism-<version>-win-x64.exe` | the installer |
| Windows x64 | `Prism-<version>-win-x64.zip` | the portable copy, no installation |
| Linux x64 | `Prism-<version>-linux-x86_64.AppImage` | runs on most distributions, no installation |
| Linux x64 | `Prism-<version>-linux-amd64.deb` | Debian, Ubuntu and derivatives |
| Linux x64 | `Prism-<version>-linux-x86_64.rpm` | Fedora, RHEL, openSUSE and derivatives |
| Linux x64 | `Prism-<version>-linux-x64.tar.gz` | the app folder, to extract |
| macOS Apple Silicon | `Prism-<version>-mac-arm64.dmg` and `….zip` | Macs with an M processor |
| macOS Intel | `Prism-<version>-mac-x64.dmg` and `….zip` | Macs with an Intel processor |

The PostgreSQL driver ships with the app. The Db2 and Informix driver is IBM's: Prism downloads it for you in **Configurações ›
Drivers** (Settings › Drivers); IBM does not publish it for Macs with an Intel processor. To verify a package, compare its
SHA-256 with its line in the release's `SHA256SUMS` file.

The packages are not signed yet, and the system warns you on first launch:

- **Windows:** under "Windows protected your PC", click **More info** and then **Run anyway**.
- **macOS:** right-click the app and choose **Open**; on macOS 15 or newer, allow it in **System Settings › Privacy & Security ›
  Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Prism.app`.

## Documentation

Installation, first use, connections, the SQL editor, the records of a table, settings and updates:
**<https://zanveri.github.io/prism/>** (also in [Portuguese](https://zanveri.github.io/prism/pt-br/) and
[Spanish](https://zanveri.github.io/prism/es/)).

## Problems and suggestions

Did something not work, or is something missing? [Open an issue](https://github.com/Zanveri/prism/issues), in English,
Portuguese or Spanish: that is where we fix it. Security flaws go through the private report described in
[SECURITY.md](SECURITY.md).

## Development

You need the .NET SDK 10, Node.js 22 with pnpm 10 and, for the integration tests, Docker.

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

Tests, packaging and the contribution flow are in [CONTRIBUTING.md](CONTRIBUTING.md); the pipeline and the releases are in
[docs/ci.md](docs/ci.md) and [docs/versionamento.md](docs/versionamento.md) (in Portuguese).

## License

GNU GPL version 3 (`GPL-3.0-only`): anyone, person or company, may use, study, modify and redistribute Prism, as long as whoever
distributes a copy also provides the complete source code under the same license. The text is in [LICENSE](LICENSE); the
copyright notice and the additional permission for the IBM driver are in [NOTICE](NOTICE). Trademarks and logos are not under the
GPL.
