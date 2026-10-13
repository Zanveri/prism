<!--
Título no formato dos commits: tipo(escopo): descrição, em português. Exemplo: fix(client): mensagem do que mudou.
O pull request vai para a develop (o ramo padrão). Da develop para a main, só o pull request de lançamento (release: vX.Y.Z).
Nenhum pull request roda a pipeline: quem revisa roda as verificações na própria máquina (CONTRIBUTING.md), e a pipeline confirma
depois do merge. Veja o CONTRIBUTING.md.
-->

## O que muda

## Por que

A issue que este pull request resolve (issue primeiro: CONTRIBUTING.md): #

## Como foi testado

- Testes que acompanham a mudança:
- O que você conferiu à mão, e em qual banco e sistema:

## Lista de conferência

- [ ] O título segue o formato dos commits (e leva `!` se a mudança quebra o contrato da versão).
- [ ] Há testes para o comportamento que muda.
- [ ] `dotnet build src/api/Prism.slnx` termina sem avisos e `dotnet test src/api/Prism.slnx` passa (se tocou a API).
- [ ] `lint`, `typecheck` e `test` de `src/client` passam (se tocou a interface).
- [ ] `bash scripts/ci/test-scripts.sh`, `bash scripts/ci/check-workflows.sh` e `bash scripts/ci/actionlint.sh` passam (se tocou `scripts/ci/` ou `.github/`).
- [ ] `bash scripts/ci/leak-guard.sh` não acha nada nos arquivos que este pull request muda.
- [ ] Mudou um `PackageReference`: rodei `dotnet restore src/api/Prism.slnx --force-evaluate` e os `packages.lock.json` estão no commit.
- [ ] A documentação acompanha, quando a mudança altera um comando, uma pasta ou uma regra.
- [ ] Não há segredo, dado de cliente, caminho de máquina, nome de usuário do sistema nem dado de infraestrutura nos arquivos, nas capturas nem nas mensagens de commit.
- [ ] Entendo que a contribuição entra sob a GPL-3.0-only, com a permissão adicional do NOTICE.
