# Changelog

Todas as mudanças relevantes do Prism são registradas aqui. O formato segue o
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), e as versões seguem o
[Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/).

## Não lançado

## [0.5.0] - 2026-10-24

A 0.5.0 reúne tudo o que foi testado nos betas da 0.5.0. Os betas saíram só para Windows e Linux: no macOS, esta é a primeira
versão desde a 0.4.0. O cofre continua no mesmo formato, e a 0.4.0 ainda o abre; mas, se você voltar a ela, ela não guarda o que é
novo, como o lugar do resultado de cada aba e a marca das conexões que vieram do DBeaver.

### Adicionado

- **Importar do DBeaver:** o Prism acha o DBeaver neste computador, ou usa a pasta que você escolher, e traz as pastas, as
  conexões de PostgreSQL, Db2 e Informix e o usuário e a senha de cada uma. Uma prévia mostra antes tudo o que entra e o que ficou
  de fora (como o túnel SSH e o proxy), e desligar "Levar as senhas" traz só o usuário. Nada é mudado no DBeaver.
- **Os tipos de conexão do DBeaver viram ambientes**, com a cor (Development, Test e Production chegam como Desenvolvimento, Teste
  e Produção), e as proteções não ficam mais fracas: a conexão somente leitura chega com "Somente leitura", e a que pergunta antes
  de executar, com "Confirmar antes de executar" em "Todos os comandos".
- **A porta DRDA do Informix:** o DBeaver guarda a porta SQLI, e o Prism conecta pela DRDA. Na prévia, digite a porta DRDA de cada
  servidor, se souber, e ela vale para as conexões dele que entram agora; com o campo vazio, vem a porta do DBeaver, marcada.
- **Importe do DBeaver de novo quando quiser:** a conexão que já veio de lá aparece como "já existe no Prism", e o Prism pergunta
  se sobrescreve todas, quais ou nenhuma. Sobrescrever traz do DBeaver o nome, o servidor, o banco, o usuário, a senha e o
  ambiente (no Informix, a porta só muda se você digitou a DRDA); a pasta, a verificação e as proteções que você ligou no Prism
  continuam.
- **Onde importar:** "Importar do DBeaver…" fica no menu do espaço vazio do navegador, no menu da pasta ("Importar do DBeaver
  aqui…") e em Configurações › Importar, que mostra também a última importação. No primeiro uso, "Comece por aqui" oferece
  importar do DBeaver ou de um arquivo do Prism, ou criar uma conexão; quem já tem conexões recebe o convite uma vez ("Agora não"
  o fecha).
- **Variáveis nos scripts:** declare com `let` e `const`, como no JavaScript, e use no SQL como `@nome` (`let id = 10` e
  `WHERE id = @id`; `const status = ['aberto', 'faturado']` e `IN (@status)`). Diferente do `${nome}` do DBeaver, que é colado no
  texto, o valor vai ao banco como parâmetro, e você não escreve aspas; só uma variável do tipo `sql` entra no comando como está,
  e o Prism destaca o trecho que veio dela.
- **As declarações seguem o JavaScript**, com os tipos do TypeScript (`let n: number | null = null`): números, textos, datas,
  listas, objetos e `null`, as funções de `Math` e de `date` (`date.today()`, `date.addDays`…) e o `random`, para dados de teste.
  Não há laços nem funções, e o que o JavaScript faria em silêncio, como `'5' * 2`, o `==` ou uma data que não existe, dá erro.
- **Alt+X e Ctrl+Enter com variáveis:** o Alt+X avalia as declarações na ordem, a cada execução, e executa cada comando com os
  valores daquele ponto. O Ctrl+Enter numa declaração só a avalia; num comando, usa os valores que a aba já tem. Com um erro numa
  variável, nada vai ao banco: a área de resultado mostra "Erros nas variáveis", e o clique num erro leva o cursor até ele.
- **Veja os valores:** a aba "Variáveis", na área de resultado, mostra cada variável com o tipo, o valor e a origem, para copiar
  ou ir à declaração; o ponteiro sobre ela, no editor, mostra o mesmo, e a declaração avaliada mostra o valor, apagado, no fim da
  linha (desligue em Configurações › Editor SQL). O botão "SQL enviado" mostra o comando com os valores no lugar, para copiar.
- **O editor conhece as variáveis:** elas ganham cor própria em todos os temas, os erros ficam sublinhados enquanto você digita, e
  o autocompletar sugere as variáveis depois do `@`. Um sublinhado pontilhado avisa, sem impedir nada, onde o banco faria
  diferente do esperado, como a variável depois de ORDER BY, que vai como valor, e não como nome de coluna.
- **Um resultado com variáveis se comporta como qualquer outro:** o F5, o filtro, a atualização automática, a edição da grade, o
  "Exportar dados" e a cópia para outro banco repetem o comando com os mesmos valores. "Confirmar antes de executar" mostra cada
  comando com os valores no lugar, e o que usa uma variável `sql` sempre pergunta, também em "Só comandos irreversíveis".
- **Os valores são da aba:** ficam na memória enquanto ela está aberta, vão junto quando você a leva para outra janela e somem ao
  fechá-la, ao trocar o banco ou a conexão e no bloqueio. O script salvo guarda só o texto das declarações.
- **O resultado numa aba ou numa janela:** no botão "Onde mostrar o resultado", "Numa aba" faz do resultado uma aba própria, logo
  depois da consulta, e "Numa janela" o abre numa janela que dá para pôr em outro monitor. Trocar de lugar não executa nada de
  novo, e "Voltar para o painel" ou Ctrl+W o trazem de volta. Cada aba lembra a escolha, e a das abas novas fica em Configurações
  › Resultados ("No painel" continua o padrão).
- **F6 alterna entre o editor e o resultado**, onde quer que o resultado esteja.
- **Solte a aba em qualquer lugar longe da barra das abas e ela abre numa janela nova**, como no Chrome, também com a janela
  maximizada. Solta sobre outra janela do Prism, ela vai para o fim das abas de lá.
- **O valor de uma chave estrangeira no resultado da consulta leva ao registro referenciado**, como já acontecia nos Registros: o
  clique no valor, ou "Ir para o registro referenciado" no menu da célula, abre a tabela referenciada já filtrada por ele.
- **O autocompletar completa o JOIN pela chave estrangeira**, como no DBeaver: depois de JOIN, as tabelas ligadas às do comando
  aparecem no topo com a condição pronta (`clientes c ON c.id = p.cliente_id`). Com a conexão aberta, ele também busca no banco as
  colunas depois de `tabela.` ou `apelido.`, mesmo as de uma tabela que você ainda não abriu no navegador.
- **Voltar e avançar entre as abas**, como no DBeaver: os botões voltar e avançar do mouse e Alt+← e Alt+→ (no macOS, Cmd+[ e
  Cmd+], fora do editor SQL) passam pelas abas na ordem em que você as usou.
- **Ir ao item pelas primeiras letras**, como no DBeaver: no navegador e na seção Scripts, digitar o começo de um nome leva ao
  próximo item à vista que começa por ele, sem diferenciar maiúsculas nem acentos.
- **Atualizar a cada 1 segundo:** "A cada 1 s" entra em "Atualizar automaticamente", e o "Personalizado…" passa a aceitar de 1 a
  3.600 segundos.
- **Tema Kanagawa**, escuro, em Configurações › Aparência.

### Alterado

- Na grade, a tecla Delete marca para exclusão as linhas das células escolhidas, como o Alt+Delete, também com uma célula só. A
  linha marcada fica vermelha, além de riscada, e nada sai do banco antes do Salvar.
- Ao editar uma célula (F2, Enter, duplo clique ou Editar célula), o valor já vem todo selecionado, e o que você digita escreve
  por cima.
- No editor SQL, no Windows e no Linux, Alt+← e Alt+→ passam a voltar e avançar entre as abas, e deixam de pular o cursor pelos
  trechos do comando (Shift+Alt+← e Shift+Alt+→ continuam selecionando).
- As abas ficam mais baixas e mais enxutas, e a barra do resultado e as abas do Executar script acompanham, para sobrar mais
  espaço para o editor e a grade.
- Com uma aba só na janela, "Mover para nova janela" fica desabilitado, e arrastá-la para fora não abre outra janela.
- Mesmo sem variáveis, o editor marca com um sublinhado pontilhado o `@nome` que não é variável do script (ele vai ao banco como
  está) e o `//` fora de um texto (no SQL, o comentário é `--`). Nada disso muda o que vai ao banco.
- Só aparece a atualização que tem o pacote do seu sistema: quando uma versão sai sem ele, o Prism oferece a mais nova que o tem.
- No macOS, as atualizações chegam pelas versões estáveis: os betas passam a sair só para Windows e Linux.

### Corrigido

- No macOS, o Prism não precisa mais de comando no Terminal para abrir: em vez de dizer que o app está danificado, o sistema diz,
  na primeira abertura, que não pode verificá-lo, e você o libera uma vez em Ajustes do Sistema › Privacidade e Segurança › Abrir
  Mesmo Assim (macOS 15 ou mais novo) ou, até o macOS 14, clicando nele com o botão direito e escolhendo Abrir.
- No Linux com X11, soltar a aba fora da janela passa a abrir a janela nova, onde antes não fazia nada; e, com o zoom do programa
  fora de 100%, a janela nova deixa de abrir longe de onde a aba foi solta.
- O botão voltar do mouse não leva mais às Configurações; nelas, ele as fecha e volta à área de trabalho.
- No PostgreSQL, o Ctrl+Enter e o Executar script deixam de partir o comando no meio de um texto `E'…'` com a aspa escapada pela
  barra (`E'it\'s'`).

### Segurança

- A busca e o download das atualizações deixam de aceitar certificados das autoridades intermediárias da eMudhra, que foram
  comprometidas (o Prism passa ao Electron 44.9.3).

## [0.4.0] - 2026-10-20

A 0.4.0 reúne tudo o que foi testado nos betas da 0.4.0.

**Antes de atualizar:** na primeira entrada, o Prism converte o seu cofre para um formato novo, e uma versão anterior do Prism
não o abre mais (ela avisa que é preciso atualizar). Se quiser poder voltar para a versão que você usa hoje, copie antes a pasta
de dados do Prism (no Windows, `%APPDATA%\Zanveri\Prism`).

### Adicionado

- **Executar script (Alt+X)**, como no DBeaver: os comandos do editor rodam um depois do outro, cada resultado numa aba, com as
  Estatísticas no fim e uma pergunta quando um comando falha. Sem seleção, o Ctrl+Enter executa só o comando do cursor, e o
  editor destaca por um instante o que foi enviado.
- **A conexão da aba** aparece na barra do editor e se troca pela lista ou por Ctrl+9. Os scripts genéricos (salvos sem conexão,
  pela caixa "Script genérico (sem conexão)") abrem na conexão que estiver conectada ou perguntam em qual rodar.
- **Pastas de scripts:** a seção Scripts do navegador vira uma árvore, com pastas que se criam, renomeiam, movem e excluem (a
  pasta só sai quando está vazia), e lembra se ficou recolhida. Cada script ganha um ícone e uma cor, e as pastas de conexões
  também ganham cor.
- **Proteções da conexão e da pasta:** "Confirmar antes de executar" (só os comandos irreversíveis, ou todos) mostra o ambiente,
  a conexão e o comando antes de ele sair. "Somente leitura" deixa passar só consultas: o resto (INSERT, UPDATE, DELETE, comandos
  de estrutura, CALL, SET…) é recusado pelo Prism antes de chegar ao banco, e marcar ou desmarcar pede a sua senha. É uma proteção
  contra engano no Prism, e não substitui uma conta do banco só com SELECT.
- **A conexão conectada é verificada a cada 30 segundos**, e um indicador ao lado do nome diz se ela respondeu, com um aviso
  quando ela deixa de responder e quando volta. A verificação vem ligada, também nas conexões que você já tem; o intervalo, a
  consulta e o desligar ficam em "Sessão da conexão", no formulário da conexão. O navegador ganha "Só as conectadas".
- **O resultado se atualiza sozinho** a cada intervalo, se você quiser, e o total de linhas pode ser contado de novo.
- **Edite mais rápido na grade:** a barra de edição, como a do DBeaver, com Editar célula, Adicionar linha, Duplicar linha e
  Excluir linha, nos Registros, no resultado da consulta e nas abas do Executar script.
- **Escolha várias células, linhas ou colunas inteiras**, como no DBeaver: pelo clique, Shift, Ctrl, arrastando ou pelo número da
  linha; o clique no nome da coluna escolhe a coluna inteira. Copiar age em tudo o que está escolhido; Excluir linha e Duplicar
  linha agem nas linhas escolhidas.
- **Edite várias células de uma vez:** o valor digitado numa célula vai para todas as escolhidas da mesma coluna. Com a coluna
  inteira escolhida pelo cabeçalho, ele vale para todas as linhas do resultado (não vale em resultados de junção nem nas colunas
  da chave), e o Prism conta as linhas e pergunta antes de salvar.
- **Copiar avançado** (Ctrl+Shift+C): copie o que está escolhido em CSV, Código fonte, DbUnit, HTML, JSON, Markdown, SQL, TXT ou
  XML, com as opções de cada formato guardadas em "Configurar comandos 'Copiar como'…", e também o nome das colunas ou o número
  das linhas.
- **Gerar SQL** no menu da grade, a partir das linhas escolhidas: SELECT .. WHERE .. =, SELECT .. WHERE .. IN, INSERT, UPDATE e
  DELETE pela chave única, mais o CREATE da tabela, para copiar ou abrir numa aba de consulta.
- **Exportar dados** em dez formatos (CSV, Código fonte, DbUnit, HTML, JSON, Markdown, SQL, TXT, XML e XLSX), por um assistente
  como o do DBeaver, de uma tabela, dos Registros ou de um resultado. A exportação roda em segundo plano, com o progresso na barra
  de status, e o Prism pergunta antes de cancelá-la se você sair ou fechar a janela.
- **Importar dados** de um arquivo CSV, TSV, JSON ou XLSX para uma tabela, com o mapeamento das colunas e a prévia, e **copiar
  linhas para uma tabela que já existe**, nesta ou em outra conexão, pelo destino "Banco de dados" do "Exportar dados".
- **Exportar e importar conexões** com as pastas, num arquivo cifrado com uma senha de exportação, escolhendo de cada conexão se
  vai só o usuário, o usuário e a senha, ou nenhum dos dois. Bom para configurar os bancos de quem chega na equipe.
- **Zoom do programa inteiro** (Ctrl +, Ctrl − e Ctrl 0) e a "Densidade do navegador", que mostra mais itens na árvore.

### Alterado

- Sem seleção, o Ctrl+Enter também termina o comando na linha em branco, como no DBeaver (na dúvida, o Prism não separa). Para
  valer só o ponto e vírgula, desligue "A linha em branco separa os comandos" em Configurações › Editor SQL.
- O clique no nome da coluna passa a escolher a coluna; para ordenar, use o botão ao lado do nome ou o "Ordenar" do menu.
- Na pasta de conexões, o F2 passa a só renomear; o ambiente e a cor ficam em "Editar pasta…", no menu da pasta.
- No menu da célula, "Linha nova" passa a se chamar "Adicionar linha", e Alt+Delete exclui a linha da célula.
- A árvore, a busca do navegador e as abas ficam com o texto um pouco menor, como o resto da área de trabalho.

### Corrigido

- O Salvar do Informix grava, em colunas LVARCHAR, textos de mais de 16.350 caracteres (antes voltava com o erro "No cast from
  text to lvarchar").
- A aba de um script salvo num banco que não é o padrão deixa de voltar marcada como não salva ao reabrir o Prism.
- Depois de trocar o banco da aba, o filtro do resultado anterior não volta a ser aplicado.
- Trocar o banco da aba com alterações não salvas na grade deixa o foco na pergunta, e o Esc a fecha.
- Um resultado com mais linhas para carregar volta a liberar o banco depois de cinco minutos parado, mesmo depois de um comando
  que o Prism recusou antes de enviar ao banco.

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
