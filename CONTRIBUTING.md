# How to contribute to Prism

**English** · [Português (BR)](CONTRIBUTING.pt-BR.md) · [Español](CONTRIBUTING.es.md)

Thank you for wanting to help. This guide explains how work enters the project, how to set up the environment, where the
conventions are, what a pull request must bring, what reviewers run on their own machine and how to write commit messages.

Participation follows the [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). **A vulnerability does not go in an issue, a comment or a pull
request**: see [SECURITY.md](SECURITY.md).

## Flow

The flow is the one in RN-GITHUB-003, decided by the project owner:

1. **Issue first.** All work starts in an issue: a defect or a suggestion, each with its own form. The maintainers assess whether
   it becomes work and say when. You can write it in English, Portuguese or Spanish. That way nobody spends time in a direction
   the project will not follow.
2. **Branches only by the maintainers**, with a prefix for the type of change: `feat/`, `fix/`, `chore/`, `docs/`, `ci/`,
   `refactor/` and `test/` (for example, `fix/command-separator`). A branch starts from `develop`:
   `git switch -c fix/subject origin/develop`.
3. **Pull request to `develop`**, which is the repository's default branch. The pull request template carries the checklist, and
   it cites the issue it resolves.
4. **Outside contributors work through a fork**: fork the repository, create the branch in your fork, with the same prefix, and
   open the pull request from your fork to `develop` here.
5. **From `develop` to `main`, only the release pull request** (`release: vX.Y.Z`), opened by the maintainers
   ([docs/versionamento.md](docs/versionamento.md), in Portuguese).
6. Answer the review with new commits on the same branch.

**No pull request runs the pipeline** (RN-ABERTO-005): it only runs after the merge, on `develop` and `main`. Reviewers run the
checks on their own machine, with the commands in [What reviewers run](#what-reviewers-run), and the pipeline confirms after the
merge. Every merge into `develop` publishes a beta: a merge is a delivery, which is why the pull request must arrive verified.

## Set up the environment

The prerequisites and the development commands are in the [README](README.md#development): .NET SDK 10, Node.js 22, pnpm 10
(the exact version is in the `packageManager` field of `src/client/package.json`) and, for the API integration tests, Docker. In
short:

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

The development app's vaults live in `Zanveri/Prism-dev`, in the system's application data folder, and never mix with those of
the packaged app (see [Where the data lives](#where-the-data-lives)).

## Test and package on your machine

### Tests

```bash
dotnet build src/api/Prism.slnx          # zero warnings
dotnet test src/api/Prism.slnx           # unit and integration (Docker running)
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test
```

### Package

A platform's package carries the API published for the same platform, and there is only one API in `src/client/resources/api`:
publish the API and then build the package.

```bash
pnpm --dir src/client build:api -- win-x64      # or linux-x64, osx-arm64, osx-x64; with no argument, the machine's own
pnpm --dir src/client dist -- win               # win, linux or mac (mac accepts arm64 or x64 after it: dist -- mac arm64)
pnpm --dir src/client dist:dir                  # just the app folder, no installer: src/client/release/win-unpacked/Prism.exe
```

Packages come out in `src/client/release/`, as `Prism-<version>-<system>-<architecture>.<extension>`. Each one carries the API
in `resources/api` and needs neither .NET nor Node on the machine; there is no code signing. `dist` fails if the platform's API
was not published first. On macOS, one architecture at a time: `build:api -- osx-arm64` and `dist -- mac arm64`, then
`osx-x64` and `mac x64`. The deb and the rpm require the project URL (`PRISM_HOMEPAGE`, which in the pipeline is the workflow's
repository page); the rest is in [docs/ci.md](docs/ci.md) (in Portuguese).

`build:api` touches the API's `packages.lock.json` files: it adds the empty target `net10.0/<identifier>` (for example,
`net10.0/win-x64`). Provisional: after publishing, look at `git diff -- "src/api/*/packages.lock.json"` and undo it
(`git checkout -- "src/api/*/packages.lock.json"`) only if the sole difference is that target.

### Where the data lives

The vaults and the API log live in the app's data folder:

- Windows, packaged app: `%APPDATA%\Zanveri\Prism`
- Linux and macOS, packaged app: the `Zanveri/Prism` subfolder of the system's application data folder
- in development (`pnpm dev`): `Zanveri/Prism-dev` in the same place, so the development app never opens the real vaults

Inside it: `vaults/`, with one encrypted file per user (`<user>.vault.json`), `logs/` and the Chromium profile files that
Electron writes there.

`--user-data-dir=<folder>` on the command line changes the folder in both cases (use a test folder to try the packaged app
without touching anyone's data). The main process log carries the line `[prism] pasta de dados: ...` (data folder).

### Repository structure

| Path | What it is |
| --- | --- |
| `src/client/` | The interface: Electron, React and Vite. Guidance in [src/client/AGENTS.md](src/client/AGENTS.md). |
| `src/api/` | The C# API (.NET 10) and the tests. Guidance in [src/api/AGENTS.md](src/api/AGENTS.md). |
| `docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md` | Specification of the first delivery: `RN-*` rules, routes, error codes and acceptance criteria. |
| `docs/design/canvas/` | The approved design canvas: the measure of colors, spacing and texts. |
| `site/` | The documentation site (static HTML and CSS, in English, Portuguese and Spanish), published on GitHub Pages by the pipeline at <https://zanveri.github.io/prism/>. |
| `docs/versionamento.md` | How Prism is versioned and how a version is released (the release pull request from `develop` to `main`). |
| `docs/ci.md` | The pipeline: what each workflow and job does, what each merge publishes, how to run it locally, the runners, the repository's GitHub checklist and the rehearsal with the private repository. |
| `.github/workflows/`, `.github/actions/`, `scripts/ci/` | The pipeline (GitHub Actions: the entry workflow, the reusable ones and the composite actions) and the scripts it calls, one per step, with their tests. |
| `cliff.toml` | The `git-cliff` configuration, which generates the changelog and the release notes. |
| `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | The issue forms (defect and suggestion) and the pull request template. |
| [AGENTS.md](AGENTS.md) | Guidance for whoever writes code, at the root. |

## Where the conventions are

- [AGENTS.md](AGENTS.md), at the root: what applies to the whole project.
- [src/api/AGENTS.md](src/api/AGENTS.md): the C# API.
- [src/client/AGENTS.md](src/client/AGENTS.md): the interface.
- [Specification](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md): the source of requirements. The rules have codes
  (`RN-COFRE-003`, for example) and, when the code implements one, the comment cites the rule. Do not change the behavior of a
  rule on your own: open an issue.
- [Design canvas](docs/design/canvas/): the measure of the interface's colors, spacing and texts.
- [docs/ci.md](docs/ci.md): the pipeline, for whoever touches `.github/` or `scripts/ci/`.

Language: names in the code (types, functions, files) are in English; screen texts, error messages and comments are in
Portuguese.

## What a pull request must bring

- **Tests** for the behavior that changes: unit tests and, when HTTP or a database is on the path, integration tests.
- **API build with no warnings**, the API and interface suites passing, and the pipeline scripts, if you touched them (the
  commands are right below).
- **Locked packages:** if you changed a `PackageReference`, run `dotnet restore src/api/Prism.slnx --force-evaluate` and include
  the `packages.lock.json` files in the same commit. In the interface, `pnpm-lock.yaml` goes in together with the change to
  `package.json`.
- **Documentation** updated when the change alters a command, a folder or a rule. The public texts (README, CONTRIBUTING,
  SECURITY, CODE_OF_CONDUCT and the site) exist in English, Portuguese and Spanish: change all three.
- **Pull request title** in the commit format (see below).

## What reviewers run

The pipeline does not run on the pull request; reviewers run this on their own machine, on the pull request's branch
(`gh pr checkout <number>`, or `git fetch origin pull/<number>/head:pr-<number>` and `git switch pr-<number>`). **Read the code
before running it**: it is someone else's code running on your machine.

```bash
# The interface
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test

# The API (integration tests need Docker running)
dotnet build src/api/Prism.slnx            # zero warnings
dotnet test src/api/Prism.slnx

# The scripts and the workflows, when the pull request touches scripts/ci/ or .github/
bash scripts/ci/test-scripts.sh
bash scripts/ci/check-workflows.sh
bash scripts/ci/actionlint.sh              # downloads the pinned actionlint (Linux x64)

# What must not enter the repository (RN-ABERTO-003); with the company's terms, in a file outside the repository
bash scripts/ci/leak-guard.sh
LEAK_GUARD_EXTRA=/path/to/terms bash scripts/ci/leak-guard.sh --messages origin/develop..HEAD

# The dependencies (high or critical fails)
bash scripts/ci/audit-deps.sh client
bash scripts/ci/audit-deps.sh api

# What the merge will release: develop (the beta) or, in the release pull request, main (the stable)
bash scripts/ci/check-version.sh develop
```

What the pipeline does after the merge, and what each command above checks, is in [docs/ci.md](docs/ci.md).

## Commit messages

Prism follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The message is in Portuguese:

```
type(scope): short description
```

The scope is optional and, today, is usually `api` or `client`. The accepted types:

| Type | When to use |
| --- | --- |
| `feat` | new feature |
| `fix` | defect fix |
| `perf` | performance gain |
| `refactor` | code change that does not alter behavior |
| `docs` | documentation only |
| `build` | packaging, dependencies and build scripts |
| `ci` | the pipeline |
| `test` | tests only |
| `chore` | what does not fit the others |

A `!` after the type (or the scope) marks a change that breaks the contract the version number protects: the vault format and
the data folder structure, the configuration and export files, the documented shortcuts and commands. See
[docs/versionamento.md](docs/versionamento.md).

Examples, in the style of this repository's history:

```
feat(client): editor SQL com resultado paginado
fix(client): "executar de novo" repete o comando do resultado que está na tela
build: empacotamento do app com o electron-builder
```

The **pull request title** follows the same format. If the pull request is merged with squash, the title is what enters the
history. The notes of each beta and the `CHANGELOG.md` come from the history, which is why the convention matters: a message
outside the format does not show up in them.

The `release` type is not in the table above: it is reserved for the release pull request (`release: vX.Y.Z`), opened by the
[maintainers](#maintainers), and does not appear in the changelog. **Merging the release pull request into `main` is releasing the
version**: the pipeline publishes the packages and the release, and the publication creates the `vX.Y.Z` tag. Nobody creates a
version tag by hand, and an ordinary pull request does not change the `version` field of `src/client/package.json` (the one that
changes it is the pull request that bumps the version after a stable one).

## Maintainers

In this project, **maintainers** are the people with the **Maintain** or **Admin** role on the GitHub repository. They are the
ones who create branches, review and merge pull requests, release versions, handle security reports and enforce the
[code of conduct](CODE_OF_CONDUCT.md). Vulnerability reports follow [SECURITY.md](SECURITY.md); the step by step of a release is
in [docs/versionamento.md](docs/versionamento.md).

## License of contributions

Prism is distributed under the [GNU GPL version 3](LICENSE) (`GPL-3.0-only`), with the section 7 additional permission for the
IBM driver described in [NOTICE](NOTICE). By submitting a contribution, you offer it under that same license and with that same
permission.

## What does not enter the repository

- **Secrets:** password, token, API key, private key, connection string with a password, real vault file. To test, generate test
  values.
- **Customer data:** database dump, query result, screenshot or log with real data. Use made-up data.
- **Data from your machine or your network:** user profile path, operating system user name, runner name, host or IP of an
  internal network, address or identifier of an internal code or package server, name of a company's internal project. This also
  applies to commit messages. It is rule RN-ABERTO-003 of the
  [specification](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md), and `leak-guard` checks it.
- **Generated files:** `bin/`, `obj/`, `node_modules/`, `out/`, `release/`, the API published in `src/client/resources/api/` and
  the outputs of the pipeline scripts (`api-bundles/`, `release-notes.md`).
- **Dependencies with a license incompatible** with the GPLv3, or with redistribution terms the project has not checked. The IBM
  driver, for example, is proprietary and can only be referenced, never copied into the repository.
