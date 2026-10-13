# Changelog

Todas as mudanças relevantes do Prism são registradas aqui. O formato segue o
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), e as versões seguem o
[Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/).

## Não lançado

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
