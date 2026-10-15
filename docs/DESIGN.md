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

## Imagens
- Ilustrações 3D renderizadas em `public/media/*.webp` e o vídeo `horbit-hero.(webm|mp4)`. Usar `Illustration`/`HeroVideo` de `@/components/brand/media` (tratam do `basePath`). Fundo das ilustrações: `#efebfb`.
- Estados vazios: `EmptyState` (já mostra `empty.webp`).

## Proibido (aspecto genérico de "site feito por IA")
- Ícones (`lucide-react` foi removido), emojis, "icon chips", setas "→" em botões, estrelas, brilhos.
- Gradientes decorativos, sombras suaves em todos os cartões, animações de entrada em cada secção.
- Rótulos em MAIÚSCULAS, eyebrows por cima de títulos, separadores " · " em metadados.

## Linguagem
- Cores por tokens (`text-muted`, `bg-surface-2`, `text-success`…). Hex soltos só em gráficos e nas superfícies da marca acima.
- Carregamento: `<span className="spinner" />`.
- Texto: português de Portugal, maiúscula só no início, verbos claros ("Guardar", "Criar acesso", "Aprovar").
