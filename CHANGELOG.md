# Changelog

Todas as mudanças relevantes do Prism são registradas aqui. O formato segue o
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), e as versões seguem o
[Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/).

## Não lançado

## [0.3.0] - 2026-10-15

A 0.3.0 reúne tudo o que foi testado nos betas da 0.2.0 e da 0.3.0 (a 0.2.0 não saiu como versão estável).

**Antes de atualizar:** na primeira entrada, o Prism converte o seu cofre para um formato novo, e uma versão anterior do Prism
não o abre mais (ela avisa que é preciso atualizar). Se quiser poder voltar para a versão que você usa hoje, copie antes a pasta
de dados do Prism (no Windows, `%APPDATA%\Zanveri\Prism`).

### Adicionado

- **Edite os dados direto na grade**, nos Registros de uma tabela e no resultado de uma consulta: F2, Enter, duplo clique ou
  comece a digitar. As alterações ficam destacadas até você salvar, e o Prism pergunta antes de você perdê-las. Vale também no
  resultado de uma junção, coluna por coluna.
- **Filtrar (F11)**, como no DBeaver: pelo menu da célula, filtre pelo valor dela, por uma condição ou pelo que você escrever;
  Ctrl+F11 abre a lista dos valores da coluna para escolher. O campo de filtro sugere as colunas enquanto você digita e agora
  também fica acima do resultado da consulta.
- **F5 atualiza** os Registros, o resultado da consulta, a Estrutura, o Diagrama e o item escolhido no navegador.
- **Scripts salvos:** Ctrl+S guarda a consulta como um script, cifrado no seu cofre, e os scripts ficam numa seção própria do
  navegador.
- **As abas voltam** na próxima entrada, na mesma ordem e com o SQL que você ainda não salvou.
- **Abas em mais de uma janela:** arraste uma aba para mudar a ordem ou para levá-la a outra janela.
- **Todos os bancos do servidor** aparecem sob a conexão, no navegador, e a aba de consulta mostra em qual banco ela roda e deixa
  trocar.
- **Ctrl+clique no nome de uma tabela**, no editor SQL, abre os registros dela.
- **Duplicar conexão**, no menu da conexão.
- **Editar pasta (F2):** a pasta ganha um ambiente, com nome e cor, que as conexões dela usam quando não têm um próprio. Os
  ambientes que você já usa aparecem prontos para escolher, e o navegador filtra as conexões por ambiente.
- **Escolha a fonte** da interface e a do editor SQL, em Configurações › Aparência.

### Alterado

- **Instalador do Windows:** ele pede permissão de administrador para instalar para todos os usuários do computador; sem a
  permissão, instala só para você. A atualização de dentro do app segue o mesmo modo.
- A aba de uma tabela mostra só o nome dela; o esquema aparece quando há tabelas de mais de um esquema abertas.

### Corrigido

- Copiar (Ctrl+C e "Copiar valor") e exportar para CSV levam o valor inteiro de uma célula grande, e não só o pedaço que a
  grade mostra.
- Um resultado parado por cinco minutos, sem carregar mais linhas, passa a liberar o banco, em vez de às vezes ficar aberto até
  a conexão fechar.
- Na árvore, a seta para a esquerda volta ao item de cima, como em qualquer árvore.

## [0.1.1] - 2026-10-13

### Alterado

- O Prism passa a ser distribuído sob a licença GNU GPL versão 3 (GPL-3.0-only).

## [0.1.0] - 2026-10-13

PostgreSQL, Db2 e Informix funcionam; os drivers da IBM (Db2 e Informix) são instalados sob demanda, em Configurações ›
Drivers. Nenhum pacote é assinado.

### Adicionado

- Aplicativo de desktop (Electron) que inicia uma API local (ASP.NET Core, .NET 10) em `127.0.0.1` e conversa com ela por HTTP
  com um token gerado a cada abertura. A API vai dentro do pacote, e não é preciso instalar .NET nem Node.
- Cofre cifrado por usuário (Argon2id e AES-256-GCM) com as pastas e as conexões. A senha do usuário gera a chave do cofre e
  não é gravada: quem a esquece perde o cofre, que não tem recuperação.
- Entrada e criação de usuário. Usuário inexistente e senha errada mostram a mesma mensagem.
- Pastas (criar, criar subpasta, renomear, mover e excluir) e conexões (criar, editar, excluir e testar).
- Revelar a senha de uma conexão, que pede a senha do usuário de novo; o quinto erro seguido fecha o cofre.
- Árvore de objetos do PostgreSQL: esquemas, tabelas, visões, rotinas, colunas (com a chave primária marcada), índices e chaves
  estrangeiras.
- Editor SQL para o PostgreSQL: um comando por execução, enviado como está e sempre em auto-commit. O resultado mostra as 200
  primeiras linhas e o tempo; "Carregar mais 200" traz as seguintes, "Contar total" só conta quando você pede e "Cancelar"
  interrompe um comando demorado. O erro do banco aparece como ele veio. Os comandos de controle de transação (`BEGIN`, `COMMIT`,
  `ROLLBACK` e afins) são recusados nesta versão.
- Janela de abertura (splash) e a versão do aplicativo na tela de entrada.
- Pacotes para as plataformas de desktop, gerados pela pipeline (GitHub Actions): Windows x64 (instalador e zip), Linux x64
  (AppImage, deb, rpm e tar.gz) e macOS (dmg e zip, para Apple Silicon e Intel). Cada pacote leva a API publicada para a mesma
  plataforma, e a release do GitHub traz um `SHA256SUMS`. Cada merge na `develop` publica um beta.
- Verificação de atualizações: ao abrir, no máximo uma vez por dia, o Prism consulta as releases do projeto de onde o pacote
  saiu e, havendo versão estável mais nova, mostra as notas dela e pergunta. Só baixa quando você manda; confere o pacote
  baixado com duas somas SHA-256 (a das notas da release e a do `SHA256SUMS`) antes de instalar; e permite pular uma versão ou
  desligar a verificação. No Windows roda o instalador conferido; no Linux e no macOS deixa o pacote conferido na pasta de
  downloads.
- Pasta de dados por usuário do sistema (`%APPDATA%\Zanveri\Prism` no Windows e a subpasta `Zanveri/Prism` da pasta de dados de
  aplicativo nos outros sistemas), separada da do app de desenvolvimento.

### Segurança

- A API só escuta em `127.0.0.1`, numa porta escolhida pelo sistema a cada abertura, e recusa com 401 a requisição sem o token; aceita
  uma única origem de página. A janela roda com isolamento de contexto e sandbox, sem acesso direto ao Node.
- O log não registra senha, string de conexão nem texto de SQL.
