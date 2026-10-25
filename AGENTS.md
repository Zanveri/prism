# Prism — orientação do projeto

Prism é um cliente de banco de dados para desktop, no lugar do DBeaver, para quem trabalha todo dia com Informix, Db2 e PostgreSQL. O critério de sucesso é ser mais rápido e mais direto que o DBeaver nas mesmas tarefas: abrir, conectar, navegar pelos objetos, rodar SQL e ver o resultado.

É um app Electron que inicia uma API ASP.NET Core em `127.0.0.1` (porta efêmera) e fala com ela por HTTP, com um token de lançamento. Cada usuário tem um cofre cifrado com as pastas e as conexões dele.

## Onde está o quê

| Caminho | O que é |
| --- | --- |
| `docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md` | Especificação da fatia 1: regras `RN-*`, rotas, códigos de erro e critérios de aceite. É a fonte dos requisitos; não se altera uma regra por conta própria. |
| `docs/design/canvas/` | Canvas de design aprovado (`*.dc.html`): a medida de cores, espaçamentos e textos. Onde a especificação e o canvas divergem, vale a especificação (seção 9 dela). |
| `src/api/` | A API em C#; leia [src/api/AGENTS.md](src/api/AGENTS.md). |
| `src/client/` | A interface: Electron, React e Vite. |
| `src/test-fixtures/export/` | As fixtures de ouro da exportação de dados (RN-EXPORT-024): JSON escritos à mão com a entrada e a saída esperada de cada caso, lidos pelos testes da tela e da API. Mudar uma regra é mudar a fixture; nunca se regera a partir do código. |
| `src/test-fixtures/variables/` | A fixture dos marcadores de parâmetro (`markers.json`, RN-VAR-017): o texto de um comando, o banco e quantos marcadores ele já tem (`$n` no PostgreSQL, `?` no Db2 e no Informix, fora de texto, comentário, nome entre aspas e `$tag$`). Escrita à mão, lida pelos testes da tela e da API, que têm de contar igual. Mudar uma regra é mudar a fixture; nunca se regera a partir do código. |

## Projeto de referência

A base do back-end veio de um projeto de referência interno da Zanveri (somente leitura, fora deste repositório). Quando uma convenção não está escrita aqui, ele é o exemplo completo, da camada de HTTP ao teste. Parte do código dele é anterior às regras atuais das skills zanveri: um defeito observado lá não é regra a reproduzir.

## Skills zanveri

O código segue as skills zanveri (`back-end-coding-best-practices`, `back-end-security-best-practices`, `back-end-testing-best-practices`, `front-end-*` e as demais). Leia a skill inteira antes da primeira edição na área. Onde as decisões abaixo se afastam de uma skill, valem as decisões.

## Decisões que saem do padrão zanveri

Estão aqui para que ninguém as "corrija" depois (seção 8 da especificação).

1. **Sem Keycloak, JWT, papéis e políticas.** A senha do usuário precisa gerar a chave do cofre, e um provedor de identidade não entrega isso; quem autentica a chamada é o token de lançamento, e quem libera os dados é o cofre aberto. A família de rotas `api/admin` não existe.
2. **Sem banco do produto nesta fatia.** Os dados do Prism são o cofre, então não há `IDatabaseFactory`, migrations nem transação de handler; os repositories gravam pelo serviço do cofre. Se um banco local entrar depois, é SQLite cifrado.
3. **Sessões com os bancos são de vida longa.** Uma conexão aberta atravessa várias requisições, por isso o registro de sessões é `Singleton`; repositories, queries e services continuam `Transient`.
4. **A mensagem de erro do banco chega à tela como veio.** Num cliente de banco ela é o produto, então a regra "corpo de erro de terceiro não atravessa a integração" não vale para os drivers; as demais regras de integração valem (um único `try` no `Send` do client, `Result` para fora).
5. **Sem Next.js.** Não há Server Components, Server Actions, BFF, `proxy.ts` nem cookie de sessão, porque no Electron a fronteira de confiança é o preload, não um servidor web.
6. **Interface em `src/client`, não em `src/web`.** É a pasta que o usuário criou.
7. **Sem rate limiting, Turnstile, cabeçalhos de proxy e HTTPS.** A API só existe em loopback e só para o próprio app, então nenhuma dessas defesas tem de quem proteger.
8. **O mediador é do próprio Prism (`Prism.Core.Mediator`).** O projeto é de código aberto e tem de compilar só com fontes públicas, então não há pacote de mediador (RN-ABERTO-002).
9. **A chave pública do DBeaver numa constante.** O `credentials-config.json` do DBeaver é cifrado com uma chave fixa que está no código aberto dele; a API a tem numa constante comentada (RN-DBEAVER-008). Não é segredo do Prism e não protege nada: a regra de "nenhum segredo no código" e a verificação de vazamentos da pipeline a aceitam só nessa constante, e ela não vira configuração.

