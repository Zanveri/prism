# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Desenvolvedores** que escrevem e testam SQL contra bancos de desenvolvimento, teste e produção enquanto mexem em sistemas que rodam em
  Informix, Db2 e PostgreSQL. Usam o Prism o dia inteiro, com várias abas e janelas abertas, muito pelo teclado.
- **Suporte e análise**: consultam dados de produção para atender um chamado ou investigar um problema, muitas vezes sem poder alterar nada.

DBAs não foram confirmados como público principal: o que só eles precisam não puxa decisões de produto.

## Product Purpose

O Prism é um cliente de banco de dados para desktop, no lugar do DBeaver, para quem trabalha todo dia com Informix, Db2 e PostgreSQL. Nasceu
da frustração com as versões recentes do DBeaver: a vontade de ter de novo uma ferramenta leve e direta para o trabalho de todo dia.

O critério de sucesso é ser mais rápido e mais direto que o DBeaver nas mesmas tarefas: abrir, conectar, navegar pelos objetos, rodar SQL e
ver o resultado.

## Positioning

Quatro apostas, confirmadas pelo dono, que juntas um vizinho (DBeaver, DataGrip) não diz com verdade:

1. **Informix e Db2 de primeira classe.** Os bancos que os outros clientes tratam como de segunda são cidadãos de primeira: o driver da IBM
   instalado pelo próprio app, o catálogo, a porta DRDA do Informix, a mensagem de erro do banco como veio.
2. **Mais rápido e direto.** Menos passos e menos peso que o DBeaver em cada tarefa do dia.
3. **Seguro para produção.** Ambientes com cor, somente leitura, confirmação antes de comando irreversível e um cofre cifrado por usuário.
4. **Sair do DBeaver sem dor.** Importa pastas, conexões, senhas e ambientes do DBeaver, sem mudar nada nele, e reimporta quando a pessoa
   quiser.

## Operating Context

- App desktop (Electron, com uma API local em C# em `127.0.0.1`) para Windows, macOS e Linux. Instalador e cópia portátil no Windows;
  AppImage, deb, rpm e tar.gz no Linux; dmg e zip no macOS (Apple Silicon e Intel), só nas versões estáveis. Os betas saem para Windows e
  Linux. Os pacotes não são assinados (o macOS leva assinatura ad hoc), e o sistema avisa na primeira abertura.
- O dia de trabalho: produção ao lado de desenvolvimento e teste na mesma sessão, distinguidos pela cor do ambiente; abas de consulta e de
  tabela que voltam na próxima entrada; o resultado no painel, numa aba ou numa janela própria; zoom do programa de 50% a 200%.
- O driver do PostgreSQL vem com o app. O do Db2 e do Informix é da IBM e o Prism o baixa em Configurações › Drivers; a IBM não o publica
  para Mac com processador Intel.
- Quem chega costuma vir do DBeaver, com as conexões já montadas lá.
- A interface está em português do Brasil. O README e o site de documentação (`site/`, publicado em zanveri.github.io/prism) já existem
  em inglês, português e espanhol.

## Capabilities and Constraints

- **A fonte dos requisitos é a especificação** (`docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md`), com as regras `RN-*`; não se
  altera uma regra por conta própria. O canvas aprovado (`docs/design/canvas/*.dc.html`) é a medida de cores, espaçamentos e textos; onde
  ele e a especificação divergem, vale a especificação.
- **O cofre**: cada usuário tem o seu, cifrado com uma chave derivada da senha dele (Argon2id). A senha não é guardada e não há como
  recuperá-la; ver a senha de uma conexão pede a senha do usuário antes. Depois de um tempo sem uso, que a pessoa escolhe, o cofre bloqueia.
- **O resultado** traz só as 200 primeiras linhas; o total só é contado quando a pessoa pede, e mais linhas só sob demanda.
- **A mensagem de erro do banco chega à tela como veio**: num cliente de banco, ela é o produto.
- Código aberto (GPL-3.0), que compila só com fontes públicas.
- Termos do produto: cofre, pasta, conexão, ambiente, navegador, área de trabalho, aba de consulta, aba de tabela (Registros e Estrutura),
  resultado, script, driver.
- **Em aberto:** a tradução da interface. O alcance é público e mundial, e a interface deve ganhar outros idiomas; quais e quando ainda
  não foi decidido.

## Brand Commitments

- **O nome é Prism.** A marca é a ilustração inteira do login: o feixe branco, o prisma de vidro com as facetas, as três faixas de cor com
  brilho e os três bancos. O dono recusou, duas vezes, versões simplificadas ou chapadas (RN-MARCA-001). Há um desenho só, de traço fino,
  tirado de `assets/` em todos os tamanhos (RN-MARCA-007); a variante para fundo claro muda só as cores que sumiriam (RN-MARCA-006). Na barra
  superior a marca tem 40 px de altura.
- **As três cores dos bancos carregam dado**: Informix, Db2 e PostgreSQL têm cada um a sua, e ela não é enfeite.
- **"powered by Zanveri"** aparece no splash e na barra superior, com os arquivos de `assets/zanveri/` como a empresa os entregou, sem
  redesenho nem recoloração (RN-MARCA-008).
- **A voz** é a dos textos da especificação: português do Brasil, direto, dizendo o que aconteceu e o que fazer, sem jargão de marketing.

## Evidence on Hand

- Capturas reais do app em `site/img/` (o editor com resultado, as conexões, as configurações, os temas, a tabela com registros e
  diagrama, a busca no navegador, o erro do banco, o tema claro, a criação de usuário).
- O README em três línguas, o site de documentação em `site/` e o `CHANGELOG.md` com cada versão (o app está na 0.6.0).
- As marcas em `assets/` (Prism, escura e clara, em SVG e PNG) e `assets/zanveri/` (monograma e wordmark).
- **Não existem, e não se inventam:** medições de velocidade contra o DBeaver ou o DataGrip, números de usuários ou de downloads,
  depoimentos, clientes nomeados.

## Product Principles

1. **A velocidade é a funcionalidade.** Cada tarefa do dia tem menos passos que no DBeaver; o que acrescenta um passo precisa se pagar.
2. **Informix e Db2 nunca são o caso especial tratado por último.** O que vale para o PostgreSQL vale para eles, e o que só eles têm
   (DRDA, o driver da IBM) é resolvido pelo app.
3. **Produção é perigosa, e a proteção não enfraquece por conveniência.** Somente leitura, confirmação e a cor do ambiente acompanham a
   conexão, inclusive quando ela vem do DBeaver.
4. **O banco fala com a pessoa.** A mensagem dele chega como veio, e o Prism não a esconde atrás de uma frase genérica.
5. **Nada se perde.** As abas, o texto de SQL e o lugar de cada coisa voltam; nenhum atalho recarrega ou fecha a janela por engano.

## Accessibility & Inclusion

- Todo par de texto e fundo de cada tema passa no contraste: 4,5:1 para texto, 3:1 para texto grande e ícone, conferido por teste
  (RN-CONFIG-003).
- O que muda na tela e importa é anunciado ao leitor de tela (avisos, erros, a grade com a seleção); todo caminho de mouse tem um caminho
  de teclado (arrastar uma aba para outra janela também existe como "Mover para nova janela").
- O zoom do programa vai de 50% a 200% e vale em todas as janelas.
