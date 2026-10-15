# Horbit — regras de interface

Marca: **Horbit** (nunca "PontoSmart"). Tipo de letra: M PLUS Rounded 1c (já global). Pesos: 400 texto, 500 secundário, 700 (`font-bold`) títulos, etiquetas e botões. Sem `font-extrabold`.

## Direcção: sóbria, de software de trabalho
- Fundo da aplicação `bg-canvas` (cinza muito claro), conteúdo em branco com contorno de 1 px (`border-border`). Barra lateral escura (`#16131f`).
- Violeta (`primary`) só na acção principal de cada ecrã e no item activo. Não pintar palavras de títulos, números ou nomes.
- Raios pequenos: `rounded-md` (botões pequenos), `rounded-lg` (botões, campos), `rounded-xl` (cartões). Nada de botões em pílula (`rounded-full` só em barras de progresso finas).
- Campos: etiqueta por cima, caixa branca com contorno (`Input`/`FloatField`). Sem etiquetas flutuantes.
- Estados: `Badge` (etiqueta pequena com fundo suave) ou `StatusDot` (quadrado de 8 px + texto). A classe `stem` é esse quadrado.
- Progresso: barra fina (`h-1`).
- Listas de texto: separadas por linhas (`border-b border-border`), sem marcadores decorativos.

## Navegação e telemóvel
- Mobile-first: desenhar primeiro a 390 px. Tabelas largas têm uma lista empilhada no telemóvel (`md:hidden`) e a tabela só a partir de `md`.
- Ícones só na navegação (barra lateral, barra inferior, avisos), com Phosphor em traço arredondado, via `NavIcon` (`src/components/shell/nav-icon.tsx`). O item activo usa o peso `fill`.

## Imagens
- Página inicial = guia prático com capturas reais em `public/guia/` (principal 1600×1000, detalhe 640×800 sobreposto). Usar `Picture` de `@/components/brand/media` (trata do `basePath`).
- Apresentação (`/comecar/`): `public/onboarding/1–3.webp` (1080×1080, fundo violeta `#673FEC`). Podem ser substituídas pelas ilustrações cartoon de `docs/PROMPTS-ILUSTRACOES.md`.
- Sem animações decorativas (a biblioteca `motion` foi removida). Só transições curtas de cor/largura em resposta a acções.

## Proibido (aspecto genérico de "site feito por IA")
- Ícones fora da navegação, emojis, "icon chips", setas "→" em botões, estrelas, brilhos, robôs ou varinhas mágicas (nada que lembre "IA").
- Gradientes decorativos, sombras suaves em todos os cartões, animações de entrada em cada secção.
- Rótulos em MAIÚSCULAS, eyebrows por cima de títulos, separadores " · " em metadados.

## Linguagem
- Cores por tokens (`text-muted`, `bg-surface-2`, `text-success`…). Hex soltos só em gráficos e nas superfícies da marca acima.
- Carregamento: `<span className="spinner" />`.
- Texto: português de Portugal, maiúscula só no início, verbos claros ("Guardar", "Criar acesso", "Aprovar").
