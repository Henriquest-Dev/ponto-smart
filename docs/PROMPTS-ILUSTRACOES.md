# Ilustrações do Horbit: prompts para gerar as imagens

Estilo pedido: **cartoon plano com textura de grão**, como as três referências (rei deitado sobre moedas, homem de bigode em formas geométricas, cabeça com cabelo ruivo e grão). Fundo liso **violeta Horbit**.

As imagens actuais em `public/onboarding/` são capturas reais da aplicação dentro de um telemóvel. Gere as ilustrações com os prompts abaixo e substitua os ficheiros com o **mesmo nome e tamanho**. Também pode enviar as imagens geradas para eu as recortar e juntar aos ecrãs reais, para dar mais profundidade.

## Paleta (usar em todas)

| Uso | Cor |
|---|---|
| Fundo | violeta Horbit `#673FEC` (liso, sem gradiente) |
| Sombras do fundo e objectos escuros | violeta profundo `#4B23C9` |
| Roupa clara, papéis, ecrãs | lilás `#EFEBFB` e branco `#FFFFFF` |
| Cabelo, calças, contornos internos | tinta `#16131F` |
| Destaques (moedas, capacete, botões) | amarelo quente `#FFC83D` e laranja `#FF8A3D` |
| Confirmação (visto, "validado") | verde `#1F9D63` |
| Pele | tons castanhos quentes `#8A4B2A`, `#A8613A`, `#C98A5E` (pessoas moçambicanas) |

## Bloco de estilo (colar no fim de cada prompt)

```
Style: flat cartoon illustration, chunky simplified geometric characters with exaggerated proportions, big rounded shapes, no outlines, subtle risograph grain and speckle texture inside the shapes, soft grain shading on one side, playful and confident mood, editorial illustration like Dribbble flat character art. Solid flat background color #673FEC (Horbit violet), no gradient, no vignette. Limited palette: #673FEC, #4B23C9, #EFEBFB, #FFFFFF, #16131F, #FFC83D, #FF8A3D, #1F9D63, warm brown skin tones #8A4B2A #A8613A #C98A5E. Characters are Black Mozambican adults, modern work clothes. Centered composition with generous empty space around, square 1:1, 2048x2048. No text, no letters, no logos, no watermark.
```

Prompt negativo (se a ferramenta aceitar): `text, letters, numbers, logo, watermark, gradient background, 3D render, photorealistic, outlines, thin lines, clutter, extra fingers, blurry`.

---

## 1. Apresentação, passo 1: marcar o ponto

Ficheiro: `public/onboarding/1.webp` (1080×1080). Também aparece ao lado do login no computador.

```
A cheerful Black Mozambican shop worker in a lilac polo shirt and dark trousers, seen slightly from below, holding up a big smartphone toward a tall reception kiosk screen that shows a simple white square QR code pattern (abstract blocks, not a real code). A large green check mark floats above the phone. Behind them, a thin circular orbit line in lighter violet wraps around the scene like a planet ring. Morning feeling, confident pose.
```
+ bloco de estilo.

## 2. Apresentação, passo 2: justificar uma falta

Ficheiro: `public/onboarding/2.webp` (1080×1080).

```
A Black Mozambican woman sitting relaxed on a big rounded armchair, one leg crossed, taking a photo of a medical certificate (a white sheet of paper with a small red cross and abstract grey lines) with her smartphone. A big paper airplane made of the same document flies away toward the top right, leaving a dotted trail. A small plant in a yellow pot next to the chair.
```
+ bloco de estilo.

## 3. Apresentação, passo 3: salários e recibos

Ficheiro: `public/onboarding/3.webp` (1080×1080). Inspirado no rei sobre as moedas.

```
Low-angle view of a happy Black Mozambican worker in a white shirt and dark vest, lying back with hands behind the head on a big pile of golden coins and white payslip envelopes, wearing sunglasses and a small yellow crown made of paper. Coins have a simple orbit ring engraved instead of a symbol. Some payslip sheets float in the air with abstract grey lines (no text). Big, bold, joyful.
```
+ bloco de estilo.

## 4. Ecrã de entrada (opcional)

Ficheiro sugerido: `public/onboarding/marca.webp` (1080×1080), para o ecrã violeta com o logótipo, se quiser uma imagem por trás.

```
A minimal composition: a large thin circular orbit ring in lighter violet crossing the frame diagonally, with three small simple planets: a yellow clock face without numbers, a white paper sheet folded like a planet, and a green check mark disc. Lots of empty violet space in the centre for a logo.
```
+ bloco de estilo.

---

### Depois de gerar

1. Exporte em PNG ou WebP, quadrado. Se a ferramenta só der 1024×1024, também serve.
2. Envie-me as imagens. Eu converto para WebP de 1080×1080, ajusto o violeta do fundo para `#673FEC` exacto e coloco nos ficheiros acima.
3. Se preferir fazer sozinho: substitua os ficheiros em `public/onboarding/` com o mesmo nome e faça *commit*. O site publica de novo automaticamente.
