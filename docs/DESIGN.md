# Horbit — regras de interface

Marca: **Horbit** (nunca "PontoSmart"). Tipo de letra: M PLUS Rounded 1c (já global). Pesos: 400 texto, 500 secundário, 700 (`font-bold`) etiquetas e botões, 800 (`font-extrabold`) títulos e números. Não usar `font-semibold`/`font-medium` em títulos.

## Proibido (aspecto genérico de "site feito por IA")
- **Nenhum ícone**: remover todas as importações de `lucide-react` e todos os `<Icon />` (navegação, botões, cabeçalhos de cartão, estados vazios, listas, badges, toasts). Botões só com texto. Botões só-ícone passam a texto curto ("Editar", "Remover", "Copiar", "Abrir", "Fechar", "Descarregar").
- Círculos/quadrados coloridos com ícone dentro ("icon chips"), emojis, setas decorativas "→" em botões/ligações, estrelas, brilhos.
- Sombras suaves em cartões, gradientes decorativos, cartões todos iguais em grelha só para enfeitar.
- Rótulos em MAIÚSCULAS, eyebrows por cima de títulos, separadores " · " em metadados (usar vírgula ou duas linhas).
- `rounded-md`/`rounded-lg` em blocos novos: usar o raio da marca (`rounded-[22px]` cartões, `rounded-[14px]` campos, `rounded-full` botões).

## Linguagem
- **Haste** (traço arredondado do logótipo) é o único elemento gráfico: `<span className="stem" />` (4×14 px, cor = `currentColor`). Usar para estado, item activo, destaque de linha. `Badge`/`StatusDot` já a usam.
- Progresso: barra grossa arredondada (`h-2 rounded-full bg-surface-2` + preenchimento `bg-primary`).
- Títulos de página e cartões: `font-extrabold`, tracking ligeiramente negativo. Números grandes `font-extrabold tabular`.
- Cores: tokens (`text-primary`, `bg-surface-2`, `text-muted`, `text-success`…). Sem hex soltos excepto em gráficos.
- Carregamento: `<span className="spinner" />` (nunca `Loader2`).
- Estados vazios: `EmptyState` sem `icon`.
- Separadores de navegação: `Tabs`/`LinkTabs` (sublinhado com haste).
- Texto: português de Portugal, frase com maiúscula só no início, verbos claros ("Guardar", "Criar acesso", "Aprovar").

Antes de terminar: `grep -rn "lucide-react" <pasta>` tem de devolver vazio.
