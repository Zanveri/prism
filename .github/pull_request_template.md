<!--
Title in the commit format: type(scope): description, in Portuguese. Example: fix(client): mensagem do que mudou.
The pull request goes to develop (the default branch). From develop to main, only the release pull request (release: vX.Y.Z).
No pull request runs the pipeline: reviewers run the checks on their own machine (CONTRIBUTING.md), and the pipeline confirms
after the merge. See CONTRIBUTING.md.
-->

## What changes

## Why

The issue this pull request resolves (issue first: CONTRIBUTING.md): #

## How it was tested

- Tests that come with the change:
- What you checked by hand, and on which database and system:

## Checklist

- [ ] The title follows the commit format (and carries `!` if the change breaks the version contract).
- [ ] There are tests for the behavior that changes.
- [ ] `dotnet build src/api/Prism.slnx` ends with no warnings and `dotnet test src/api/Prism.slnx` passes (if you touched the API).
- [ ] `lint`, `typecheck` and `test` in `src/client` pass (if you touched the interface).
- [ ] `bash scripts/ci/test-scripts.sh`, `bash scripts/ci/check-workflows.sh` and `bash scripts/ci/actionlint.sh` pass (if you touched `scripts/ci/` or `.github/`).
- [ ] `bash scripts/ci/leak-guard.sh` finds nothing in the files this pull request changes.
- [ ] A `PackageReference` changed: I ran `dotnet restore src/api/Prism.slnx --force-evaluate` and the `packages.lock.json` files are in the commit.
- [ ] The documentation follows, when the change alters a command, a folder or a rule (the public texts exist in English, Portuguese and Spanish).
- [ ] There is no secret, customer data, machine path, operating system user name or infrastructure data in the files, the screenshots or the commit messages.
- [ ] I understand that the contribution is licensed under GPL-3.0-only, with the additional permission in NOTICE.
