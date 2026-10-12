# Política de segurança

## Versões cobertas

O Prism está em desenvolvimento. Enquanto a versão for `0.x`, a intenção é que as correções de segurança saiam na versão seguinte;
não há versões antigas mantidas em paralelo, e os betas (as versões `X.Y.Z-beta.N`) são substituídos pela estável seguinte. Antes da
primeira versão publicada (a 0.1.0), vale o ramo `develop`.

## Como relatar uma vulnerabilidade

**Não abra issue, nem comentário, nem pull request com a descrição da falha**: tudo isso é público.

Relate em privado, pelo **relato privado de vulnerabilidade** do GitHub: na página do repositório, abra a aba **Security** e clique
em **Report a vulnerability**. O formulário pede um resumo, os detalhes, uma prova do conceito e o impacto. O relato só é visto por
você e pelos [mantenedores](CONTRIBUTING.md#mantenedores), e o GitHub avisa os mantenedores quando ele chega
([documentação](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)). O próprio GitHub
põe quem relatou como colaborador do aviso de segurança que nasce do relato, e é nele que a conversa continua.

O botão só existe com o repositório **público** e com o relato privado ligado nas configurações. Se ele não aparecer, não relate
por outro meio público: abra uma issue **sem nenhum detalhe da falha**, só pedindo um contato para um relato de segurança, e um
mantenedor responde.

## O que incluir

- A versão do Prism (ela aparece na tela de entrada, ao lado do nome; ou o commit, se você compilou do código), o sistema
  operacional e o banco envolvido.
- O que é a falha e o que ela permite fazer: por exemplo, ler o conteúdo de um cofre sem a senha, usar a API local sem o token,
  executar código a partir de um dado vindo do banco, ou fazer o atualizador instalar um pacote que não é o da release.
- Os passos para reproduzir, o mais curtos que você conseguir.
- O que você esperava e o que aconteceu.

Use dados de teste. Nunca anexe um cofre de verdade, uma senha, um token, uma string de conexão nem dados de cliente. Se o relato
precisar de um arquivo de cofre, crie um com um usuário de teste.

## O que esperar

- A intenção é responder no próprio relato: confirmar o recebimento, dizer se o problema foi reproduzido e, havendo correção, em que
  versão ela sai. Não há prazo definido.
- Pedimos que o relato não seja divulgado antes de a correção ser publicada.
- O nome de quem relatou só entra nas notas da versão que traz a correção se a pessoa quiser.

## O que está no escopo

O que o Prism se propõe a proteger: o cofre cifrado de cada usuário, a senha das conexões, a API local (que só escuta em
`127.0.0.1` e exige um token de lançamento), a janela do app, o que vai para o log e a atualização (o pacote baixado é conferido
contra duas somas SHA-256 antes de qualquer uso; veja o [README](README.md#atualizações)).

Fora do escopo: quem já tem acesso à sessão do usuário no sistema operacional, com o app aberto e destravado, e falhas dos bancos de
dados a que o Prism se conecta. Um defeito comum, sem efeito sobre a segurança, vai numa issue pública normal.
