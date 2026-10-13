# Cómo contribuir a Prism

[English](CONTRIBUTING.md) · [Português (BR)](CONTRIBUTING.pt-BR.md) · **Español**

Gracias por querer ayudar. Esta guía explica cómo entra el trabajo al proyecto, cómo preparar el entorno, dónde están las
convenciones, qué debe traer un pull request, qué ejecuta en su propia máquina quien revisa y cómo escribir los mensajes de
commit.

La participación sigue el [CODE_OF_CONDUCT.es.md](CODE_OF_CONDUCT.es.md). **Una vulnerabilidad no va en una issue, un comentario
ni un pull request**: mira el [SECURITY.es.md](SECURITY.es.md).

## Flujo

El flujo es el de la RN-GITHUB-003, decidido por el dueño del proyecto:

1. **Primero la issue.** Todo trabajo empieza en una issue: un defecto o una sugerencia, cada uno con su formulario. Los
   mantenedores evalúan si se vuelve trabajo y dicen cuándo. Puedes escribirla en español, inglés o portugués. Así nadie gasta
   tiempo en una dirección que el proyecto no va a seguir.
2. **Ramas solo por los mantenedores**, con un prefijo del tipo de cambio: `feat/`, `fix/`, `chore/`, `docs/`, `ci/`,
   `refactor/` y `test/` (por ejemplo, `fix/separador-de-comandos`). Una rama nace de `develop`:
   `git switch -c fix/asunto origin/develop`.
3. **Pull request a `develop`**, que es la rama predeterminada del repositorio. La plantilla del pull request trae la lista de
   verificación, y cita la issue que resuelve.
4. **Quien es externo contribuye mediante un fork**: haz un fork del repositorio, crea la rama en tu fork, con el mismo
   prefijo, y abre el pull request desde tu fork hacia `develop` de aquí.
5. **De `develop` a `main`, solo el pull request de lanzamiento** (`release: vX.Y.Z`), abierto por los mantenedores
   ([docs/versionamento.md](docs/versionamento.md), en portugués).
6. Responde a la revisión con nuevos commits en la misma rama.

**Ningún pull request ejecuta la pipeline** (RN-ABERTO-005): solo se ejecuta después del merge, en `develop` y en `main`. Quien
revisa ejecuta las verificaciones en su propia máquina, con los comandos de [Qué ejecuta quien revisa](#qué-ejecuta-quien-revisa),
y la pipeline confirma después del merge. Cada merge en `develop` publica una beta: un merge es una entrega, y por eso el pull
request debe llegar verificado.

## Preparar el entorno

Los requisitos previos y los comandos de desarrollo están en el [README](README.es.md#desarrollo): .NET SDK 10, Node.js 22,
pnpm 10 (la versión exacta está en el campo `packageManager` de `src/client/package.json`) y, para las pruebas de integración de
la API, Docker. En resumen:

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

Las bóvedas de la aplicación en desarrollo quedan en `Zanveri/Prism-dev`, en la carpeta de datos de aplicaciones del sistema, y
nunca se mezclan con las de la aplicación empaquetada (mira [Dónde quedan los datos](#dónde-quedan-los-datos)).

## Probar y empaquetar en tu máquina

### Pruebas

```bash
dotnet build src/api/Prism.slnx          # cero advertencias
dotnet test src/api/Prism.slnx           # unitarias y de integración (Docker encendido)
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test
```

### Empaquetar

El paquete de una plataforma lleva la API publicada para la misma plataforma, y hay una sola API en `src/client/resources/api`:
publica la API y después genera el paquete.

```bash
pnpm --dir src/client build:api -- win-x64      # o linux-x64, osx-arm64, osx-x64; sin argumento, el de la máquina
pnpm --dir src/client dist -- win               # win, linux o mac (mac acepta arm64 o x64 después: dist -- mac arm64)
pnpm --dir src/client dist:dir                  # solo la carpeta de la aplicación, sin instalador: src/client/release/win-unpacked/Prism.exe
```

Los paquetes salen en `src/client/release/`, como `Prism-<versión>-<sistema>-<arquitectura>.<extensión>`. Cada uno lleva la API en
`resources/api` y no necesita .NET ni Node en la máquina; no hay firma de código. `dist` falla si la API de la plataforma no se
publicó antes. En macOS, una arquitectura a la vez: `build:api -- osx-arm64` y `dist -- mac arm64`, después `osx-x64` y
`mac x64`. El deb y el rpm exigen la URL del proyecto (`PRISM_HOMEPAGE`, que en la pipeline es la página del repositorio del
workflow); el resto está en [docs/ci.md](docs/ci.md) (en portugués).

`build:api` modifica los `packages.lock.json` de la API: agrega el destino vacío `net10.0/<identificador>` (por ejemplo,
`net10.0/win-x64`). Provisional: después de publicar, mira `git diff -- "src/api/*/packages.lock.json"` y deshaz el cambio
(`git checkout -- "src/api/*/packages.lock.json"`) solo si la única diferencia es ese destino.

### Dónde quedan los datos

Las bóvedas y el log de la API quedan en la carpeta de datos de la aplicación:

- Windows, aplicación empaquetada: `%APPDATA%\Zanveri\Prism`
- Linux y macOS, aplicación empaquetada: la subcarpeta `Zanveri/Prism` de la carpeta de datos de aplicaciones del sistema
- en desarrollo (`pnpm dev`): `Zanveri/Prism-dev` en el mismo lugar, para que la aplicación de desarrollo nunca abra las
  bóvedas reales

Dentro de ella: `vaults/`, con un archivo cifrado por usuario (`<usuario>.vault.json`), `logs/` y los archivos de perfil de
Chromium que Electron escribe ahí.

`--user-data-dir=<carpeta>` en la línea de comandos cambia la carpeta en los dos casos (usa una carpeta de prueba para probar la
aplicación empaquetada sin tocar los datos de nadie). El log del proceso principal trae la línea
`[prism] pasta de dados: ...` (carpeta de datos).

### Estructura del repositorio

| Ruta | Qué es |
| --- | --- |
| `src/client/` | La interfaz: Electron, React y Vite. Orientación en [src/client/AGENTS.md](src/client/AGENTS.md). |
| `src/api/` | La API en C# (.NET 10) y las pruebas. Orientación en [src/api/AGENTS.md](src/api/AGENTS.md). |
| `docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md` | Especificación de la primera entrega: reglas `RN-*`, rutas, códigos de error y criterios de aceptación. |
| `docs/design/canvas/` | El canvas de diseño aprobado: la medida de colores, espaciados y textos. |
| `site/` | El sitio de documentación (HTML y CSS estáticos, en inglés, portugués y español), publicado en GitHub Pages por la pipeline en <https://zanveri.github.io/prism/>. |
| `docs/versionamento.md` | Cómo se versiona Prism y cómo se lanza una versión (el pull request de lanzamiento de `develop` a `main`). |
| `docs/ci.md` | La pipeline: qué hace cada workflow y cada job, qué publica cada merge, cómo ejecutarla en la máquina, los runners, la lista de verificación del repositorio en GitHub y el ensayo con el repositorio privado. |
| `.github/workflows/`, `.github/actions/`, `scripts/ci/` | La pipeline (GitHub Actions: el workflow de entrada, los reutilizables y las actions compuestas) y los scripts que llama, uno por paso, con sus pruebas. |
| `cliff.toml` | La configuración de `git-cliff`, que genera el changelog y las notas de las releases. |
| `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | Los formularios de issue (defecto y sugerencia) y la plantilla de pull request. |
| [AGENTS.md](AGENTS.md) | Orientación para quien programa, en la raíz. |

## Dónde están las convenciones

- [AGENTS.md](AGENTS.md), en la raíz: lo que vale para todo el proyecto.
- [src/api/AGENTS.md](src/api/AGENTS.md): la API en C#.
- [src/client/AGENTS.md](src/client/AGENTS.md): la interfaz.
- [Especificación](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md): la fuente de los requisitos. Las reglas tienen
  código (`RN-COFRE-003`, por ejemplo) y, cuando el código implementa una, el comentario cita la regla. No cambies el
  comportamiento de una regla por tu cuenta: abre una issue.
- [Canvas de diseño](docs/design/canvas/): la medida de colores, espaciados y textos de la interfaz.
- [docs/ci.md](docs/ci.md): la pipeline, para quien toca `.github/` o `scripts/ci/`.

Idioma: los nombres en el código (tipos, funciones, archivos) están en inglés; los textos de pantalla, los mensajes de error y los
comentarios están en portugués.

## Qué debe traer un pull request

- **Pruebas** para el comportamiento que cambia: unitarias y, cuando haya HTTP o base de datos en el camino, de integración.
- **Build de la API sin advertencias**, la suite de la API y la de la interfaz pasando, y los scripts de la pipeline, si los
  tocaste (los comandos están justo abajo).
- **Paquetes bloqueados:** si cambiaste un `PackageReference`, ejecuta `dotnet restore src/api/Prism.slnx --force-evaluate` e
  incluye los `packages.lock.json` en el mismo commit. En la interfaz, el `pnpm-lock.yaml` entra junto con el cambio en el
  `package.json`.
- **Documentación** actualizada cuando el cambio altera un comando, una carpeta o una regla. Los textos públicos (README,
  CONTRIBUTING, SECURITY, CODE_OF_CONDUCT y el sitio) existen en inglés, portugués y español: cambia los tres.
- **Título del pull request** en el formato de los commits (mira abajo).

## Qué ejecuta quien revisa

La pipeline no se ejecuta en el pull request; quien revisa ejecuta esto en su propia máquina, en la rama del pull request
(`gh pr checkout <número>`, o `git fetch origin pull/<número>/head:pr-<número>` y `git switch pr-<número>`). **Lee el código
antes de ejecutarlo**: es código de otra persona corriendo en tu máquina.

```bash
# La interfaz
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test

# La API (las pruebas de integración necesitan Docker encendido)
dotnet build src/api/Prism.slnx            # cero advertencias
dotnet test src/api/Prism.slnx

# Los scripts y los workflows, cuando el pull request toca scripts/ci/ o .github/
bash scripts/ci/test-scripts.sh
bash scripts/ci/check-workflows.sh
bash scripts/ci/actionlint.sh              # descarga el actionlint fijado (Linux x64)

# Lo que no puede entrar al repositorio (RN-ABERTO-003); con los términos de la empresa, en un archivo fuera del repositorio
bash scripts/ci/leak-guard.sh
LEAK_GUARD_EXTRA=/ruta/de/los/terminos bash scripts/ci/leak-guard.sh --messages origin/develop..HEAD

# Las dependencias (alta o crítica reprueba)
bash scripts/ci/audit-deps.sh client
bash scripts/ci/audit-deps.sh api

# Lo que el merge va a lanzar: develop (la beta) o, en el pull request de lanzamiento, main (la estable)
bash scripts/ci/check-version.sh develop
```

Lo que la pipeline hace después del merge, y lo que cada comando de arriba verifica, está en [docs/ci.md](docs/ci.md).

## Mensajes de commit

Prism sigue [Conventional Commits 1.0.0](https://www.conventionalcommits.org/es/v1.0.0/). El mensaje es en portugués:

```
tipo(alcance): descripción corta
```

El alcance es opcional y, hoy, suele ser `api` o `client`. Los tipos aceptados:

| Tipo | Cuándo usarlo |
| --- | --- |
| `feat` | funcionalidad nueva |
| `fix` | corrección de un defecto |
| `perf` | mejora de rendimiento |
| `refactor` | cambio de código que no altera el comportamiento |
| `docs` | solo documentación |
| `build` | empaquetado, dependencias y scripts de build |
| `ci` | la pipeline |
| `test` | solo pruebas |
| `chore` | lo que no cabe en los otros |

Un `!` después del tipo (o del alcance) marca un cambio que rompe el contrato que protege el número de la versión: el formato de
la bóveda y la estructura de la carpeta de datos, los archivos de configuración y de exportación, los atajos y comandos
documentados. Mira [docs/versionamento.md](docs/versionamento.md).

Ejemplos, en el estilo del historial de este repositorio:

```
feat(client): editor SQL com resultado paginado
fix(client): "executar de novo" repete o comando do resultado que está na tela
build: empacotamento do app com o electron-builder
```

El **título del pull request** sigue el mismo formato. Si el pull request se fusiona con squash, es el título lo que entra en el
historial. Las notas de cada beta y el `CHANGELOG.md` salen del historial, por eso la convención importa: un mensaje fuera del
formato no aparece en ellos.

El tipo `release` no está en la tabla de arriba: está reservado al pull request de lanzamiento (`release: vX.Y.Z`), abierto por
los [mantenedores](#mantenedores), y no aparece en el changelog. **Fusionar en `main` el pull request de lanzamiento es lanzar la
versión**: la pipeline publica los paquetes y la release, y la publicación crea la etiqueta `vX.Y.Z`. Nadie crea una etiqueta de
versión a mano, y un pull request común no cambia el campo `version` de `src/client/package.json` (quien lo cambia es el pull
request que sube la versión después de una estable).

## Mantenedores

En este proyecto, los **mantenedores** son las personas con el rol **Maintain** o **Admin** en el repositorio de GitHub. Son
ellas quienes crean ramas, revisan y fusionan pull requests, lanzan versiones, atienden los reportes de seguridad y aplican el
[código de conducta](CODE_OF_CONDUCT.es.md). Los reportes de vulnerabilidades siguen el [SECURITY.es.md](SECURITY.es.md); el
paso a paso de un lanzamiento está en [docs/versionamento.md](docs/versionamento.md).

## Licencia de las contribuciones

Prism se distribuye bajo la [GNU GPL versión 3](LICENSE) (`GPL-3.0-only`), con el permiso adicional de la sección 7 para el
driver de IBM descrito en el [NOTICE](NOTICE). Al enviar una contribución, la ofreces bajo esa misma licencia y con ese mismo
permiso.

## Qué no entra al repositorio

- **Secretos:** contraseña, token, clave de API, clave privada, cadena de conexión con contraseña, archivo de bóveda real. Para
  probar, genera valores de prueba.
- **Datos de clientes:** volcado de base de datos, resultado de consulta, captura de pantalla o log con datos reales. Usa datos
  inventados.
- **Datos de tu máquina o de tu red:** ruta de perfil de usuario, nombre de usuario del sistema, nombre de runner, host o IP de
  una red interna, dirección o identificador de un servidor interno de código o de paquetes, nombre de un proyecto interno de
  una empresa. Vale también para los mensajes de commit. Es la regla RN-ABERTO-003 de la
  [especificación](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md), y el `leak-guard` la verifica.
- **Archivos generados:** `bin/`, `obj/`, `node_modules/`, `out/`, `release/`, la API publicada en `src/client/resources/api/` y
  las salidas de los scripts de la pipeline (`api-bundles/`, `release-notes.md`).
- **Dependencias con una licencia incompatible** con la GPLv3, o con términos de redistribución que el proyecto no verificó. El
  driver de IBM, por ejemplo, es propietario y solo puede ser referenciado, nunca copiado al repositorio.
