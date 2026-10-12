# assets

As imagens da marca do Prism e da Zanveri. É daqui que o cliente (`src/client`) tira a marca em todos os lugares e
tamanhos (RN-MARCA-007 e RN-MARCA-008, na especificação da fatia 1): nenhum outro arquivo do repositório tem uma cópia
dos traços.

## O logotipo do Prism

| Arquivo | O que é |
| --- | --- |
| `prism-logo.svg` | O logotipo: o feixe branco entra no prisma de vidro e sai em três faixas de cor, cada uma chegando a um banco de dados (Informix, Db2 e PostgreSQL). É o desenho de traço fino do splash e da tela de login, copiado elemento por elemento, com o mesmo `viewBox`. Para fundo escuro. Fundo transparente. |
| `prism-logo-light.svg` | A variante para fundo claro (RN-MARCA-006): a mesma geometria e as mesmas grossuras. Mudam só as cores que sumiriam no claro: o raio e o brilho dele, o contorno do prisma, as três cores dos bancos e o corpo e o topo dos cilindros. O vidro do prisma, a luz dentro dele e o ponto da entrada ficam como estão. |

E os PNG, de cada SVG, com fundo transparente:

| Arquivo | Tamanho |
| --- | --- |
| `prism-logo-720.png`, `prism-logo-light-720.png` | 720 × 281 px |
| `prism-logo-1440.png`, `prism-logo-light-1440.png` | 1440 × 562 px |
| `prism-logo-2880.png`, `prism-logo-light-2880.png` | 2880 × 1124 px |

Os PNG são gerados dos SVG por um roteiro, e só por ele: nenhum é feito à mão. Mudou um SVG, gere de novo, da pasta
`src/client`:

```sh
pnpm exec electron scripts/make-logo-pngs.mjs
```

Num Linux sem tela, sob o Xvfb: `xvfb-run -a pnpm exec electron scripts/make-logo-pngs.mjs` (como root, acrescente
`--no-sandbox` no fim). O roteiro desenha cada SVG no Chromium do Electron, o mesmo que desenha o app, e confere o
tamanho, o canto transparente e o vidro do prisma opaco.

A regra da marca:

- **Sempre a ilustração inteira**: o raio, o prisma de vidro, as três faixas e os três bancos. Nunca uma parte dela, nem
  uma versão simplificada.
- **Sempre escalada por igual**: a mesma proporção, e as linhas acompanham a escala. Não há variante de traço mais grosso
  para tamanho pequeno, nem traço que não acompanhe a escala.
- **Nunca redesenhada, engrossada nem simplificada.** Sobre fundo escuro, `prism-logo.svg`; sobre fundo claro,
  `prism-logo-light.svg`.

O teste `src/client/src/components/layout/brand-assets.test.ts` confere que `prism-logo.svg` é o desenho do splash
(elemento por elemento) e que a variante clara só difere nas cores.

## A marca da Zanveri (`zanveri/`)

O Prism é um produto da Zanveri. Os arquivos são os que a empresa entregou, copiados byte a byte, só com o nome trocado:
sem redesenho, sem recoloração, sem texto refeito. `ink` é a cor escura, para fundo claro; `paper` é a clara, para fundo
escuro; a faixa vermelha é a mesma nas duas.

| Arquivo | O que é | SHA-256 |
| --- | --- | --- |
| `zanveri/zanveri-monogram-ink.svg` | O monograma "Z", vetorial, escuro | `96f4fb239286fe78ea70606024036db0d94ac512141e69c7e2fe756bca6cea1b` |
| `zanveri/zanveri-monogram-paper.svg` | O monograma "Z", vetorial, claro | `0adb070425ac8c4f3e66ffd0517b776ab5d11ce0659f7fa33a7304d5a069a3be` |
| `zanveri/zanveri-wordmark-ink.svg` | O monograma com "ZANVERI" e "Advanced Microsystems" (estes dois como imagem embutida), escuro | `736f94ea2761c6cb7ad7c142f6eb4209f45569aa8c5ad18e6cce8273a74678a2` |
| `zanveri/zanveri-wordmark-paper.svg` | O mesmo wordmark, claro | `9771e9b1814eed129778c669d89d0525f9c621deb49dd70b9d389466faedf569` |

O SHA-256 é o do arquivo como a Zanveri o entregou; o teste da marca confere que os arquivos daqui continuam sendo esses.
Se a empresa mandar uma versão nova, ela entra no lugar do arquivo, e a soma, nesta tabela.

## Uso das marcas

As marcas Prism e Zanveri identificam o produto e a empresa, e o uso delas fora do Prism não está coberto pela licença do
código.
