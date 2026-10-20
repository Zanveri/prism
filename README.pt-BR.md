# Prism

[English](README.md) · **Português (BR)** · [Español](README.es.md)

[![Pipeline](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml/badge.svg?branch=develop)](https://github.com/Zanveri/prism/actions/workflows/pipeline.yml?query=branch%3Adevelop)
[![Versão](https://img.shields.io/github/v/release/Zanveri/prism?sort=semver&display_name=tag&label=vers%C3%A3o)](https://github.com/Zanveri/prism/releases)
[![Downloads](https://img.shields.io/github/downloads/Zanveri/prism/total?label=downloads)](https://github.com/Zanveri/prism/releases)
[![Licença](https://img.shields.io/github/license/Zanveri/prism?label=licen%C3%A7a)](LICENSE)
[![Plataformas](https://img.shields.io/badge/plataformas-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#baixar)
[![Documentação](https://img.shields.io/badge/documenta%C3%A7%C3%A3o-zanveri.github.io%2Fprism-blue)](https://zanveri.github.io/prism/pt-br/)

**[Baixar](https://github.com/Zanveri/prism/releases/latest)** · [Documentação](https://zanveri.github.io/prism/pt-br/) · [Relatar um problema](https://github.com/Zanveri/prism/issues)

O **Prism** é um cliente de banco de dados para desktop, uma alternativa ao DBeaver e ao DataGrip para quem trabalha todo dia
com **PostgreSQL**, **Db2** e **Informix**: conectar, navegar pelos objetos, rodar SQL e ver o resultado, rápido e sem rodeio.
Roda no Windows, no macOS e no Linux, e guarda as pastas e as conexões de cada usuário num cofre cifrado.

O Prism nasceu da nossa frustração com as versões recentes do DBeaver: queríamos de volta uma ferramenta leve e direta para o
trabalho de todo dia.

![O editor SQL do Prism com o resultado de uma consulta](site/img/editor-resultado.png)

## Baixar

Baixe a versão mais nova na **[página de releases](https://github.com/Zanveri/prism/releases/latest)** e, em **Assets**, escolha o
arquivo do seu sistema:

| Sistema | Arquivo | Para quê |
| --- | --- | --- |
| Windows x64 | `Prism-<versão>-win-x64.exe` | o instalador (recomendado): pede administrador para instalar para todos os usuários; se você negar, instala só para você. Ele se atualiza de dentro do app, e a instalação para todos pede administrador a cada atualização |
| Windows x64 | `Prism-<versão>-win-x64.zip` | a cópia portátil, sem instalação; cada atualização é um download novo |
| Linux x64 | `Prism-<versão>-linux-x86_64.AppImage` | roda na maioria das distribuições, sem instalar |
| Linux x64 | `Prism-<versão>-linux-amd64.deb` | Debian, Ubuntu e derivadas |
| Linux x64 | `Prism-<versão>-linux-x86_64.rpm` | Fedora, RHEL, openSUSE e derivadas |
| Linux x64 | `Prism-<versão>-linux-x64.tar.gz` | a pasta do app, para descompactar |
| macOS Apple Silicon | `Prism-<versão>-mac-arm64.dmg` e `….zip` | os Macs com processador M |
| macOS Intel | `Prism-<versão>-mac-x64.dmg` e `….zip` | os Macs com processador Intel |

Os pacotes de macOS saem só nas versões estáveis: os betas saem para Windows e Linux. Se uma versão saiu sem o pacote do seu sistema,
o começo das notas dela diz isso, e o Prism só oferece a atualização que tem pacote para o seu sistema.

O driver do PostgreSQL vai junto. O do Db2 e do Informix é o da IBM: o Prism o baixa para você em **Configurações › Drivers**
(a IBM não o publica para Mac com processador Intel). Para conferir o pacote, compare o SHA-256 dele com a linha do arquivo
`SHA256SUMS` da release.

Os pacotes ainda não são assinados, e o sistema avisa na primeira abertura:

- **Windows:** em "O Windows protegeu o computador", clique em **Mais informações** e em **Executar assim mesmo**.
- **macOS:** clique no app com o botão direito e escolha **Abrir**; no macOS 15 ou mais novo, libere em **Ajustes do Sistema ›
  Privacidade e Segurança › Abrir Mesmo Assim**, ou rode `xattr -dr com.apple.quarantine /Applications/Prism.app`.

## Documentação

Instalação, primeiro uso, conexões, editor SQL, registros de uma tabela, configurações e atualizações:
**<https://zanveri.github.io/prism/pt-br/>**.

## Problemas e sugestões

Algo não funcionou ou faltou alguma coisa? [Abra uma issue](https://github.com/Zanveri/prism/issues), em português, inglês ou
espanhol: é por lá que a gente ajusta. Falha de segurança vai pelo relato privado descrito no [SECURITY.pt-BR.md](SECURITY.pt-BR.md).

## Desenvolvimento

Precisa do .NET SDK 10, do Node.js 22 com pnpm 10 e, para os testes de integração, do Docker.

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

Testes, empacotamento e o fluxo de contribuição estão no [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md); a pipeline e os lançamentos, em
[docs/ci.md](docs/ci.md) e [docs/versionamento.md](docs/versionamento.md).

## Licença

GNU GPL versão 3 (`GPL-3.0-only`): qualquer pessoa ou empresa pode usar, estudar, modificar e redistribuir o Prism, desde que quem
distribuir uma cópia entregue também o código-fonte completo sob a mesma licença. O texto está em [LICENSE](LICENSE); o aviso de
copyright e a permissão adicional para o driver da IBM, em [NOTICE](NOTICE). As marcas e as logos não estão sob a GPL.
