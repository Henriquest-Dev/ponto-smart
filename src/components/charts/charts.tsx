"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

const PRIMARY = "#673fec";
const INDIGO = "#1a1530";
const INDIGO_SOFT = "#d4c8fb";
const GRID = "#eeecf5";
const AXIS = "#8c88a0";

function ChartTooltip({ active, payload, label, formatLabel }: TooltipContentProps<number, string> & { formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-[#1a1530] px-3.5 py-2.5 text-xs text-white">
      <p className="mb-1 font-bold">{formatLabel ? formatLabel(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-white/70">
          <span className="h-3 w-[4px] rounded-full" style={{ background: p.color === INDIGO_SOFT ? "#b7a6f7" : p.color === INDIGO ? "#ffffff" : p.color }} />
          {p.name}: <span className="font-bold text-white tabular">{Number(p.value).toLocaleString("pt-PT")}</span>
        </p>
      ))}
    </div>
  );
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortMonth = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", timeZone: "UTC" });

/** Barras finas verticais (presenças por dia), ao estilo do gráfico de referência. */
export function DailyBars({ data, dataKey, name }: { data: Record<string, string | number>[]; dataKey: string; name: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={`Gráfico: ${name} por dia`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical stroke={GRID} strokeDasharray="3 3" horizontal={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
          <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgb(103 63 236 / 0.06)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} formatLabel={shortDate} />} />
          <Bar dataKey={dataKey} name={name} fill={PRIMARY} radius={[3, 3, 0, 0]} maxBarSize={7} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Barras agrupadas (índigo forte / suave). */
export function GroupedBars({
  data,
  category,
  series,
}: {
  data: Record<string, string | number>[];
  category: string;
  series: { key: string; name: string; tone: "strong" | "soft" }[];
}) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Gráfico de barras agrupadas">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barGap={4}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={category} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgb(103 63 236 / 0.06)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.tone === "strong" ? INDIGO : INDIGO_SOFT} radius={[6, 6, 6, 6]} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Linhas suaves com área em gradiente (como o "Email Data Chart"). */
export function SmoothArea({
  data,
  category,
  series,
  percent,
  categoryFormat,
}: {
  data: Record<string, string | number>[];
  category: string;
  series: { key: string; name: string; color?: string }[];
  percent?: boolean;
  /** Formato do eixo: "month" (YYYY-MM) ou "date" (YYYY-MM-DD). */
  categoryFormat?: "month" | "date";
}) {
  const formatCategory = categoryFormat === "month" ? shortMonth : categoryFormat === "date" ? shortDate : undefined;
  return (
    <div className="h-60 w-full" role="img" aria-label="Gráfico de evolução">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="ps-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.18} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical stroke={GRID} horizontal={false} />
          <XAxis dataKey={category} tickFormatter={formatCategory} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v) => (percent ? `${v}%` : Number(v).toLocaleString("pt-PT", { notation: "compact" }))} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} domain={percent ? [(min: number) => Math.max(0, Math.floor((min - 10) / 10) * 10), 100] : ["auto", "auto"]} />
          <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} formatLabel={formatCategory} />} />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color ?? (i === 0 ? PRIMARY : INDIGO)}
              strokeWidth={1.8}
              fill={i === 0 ? "url(#ps-area)" : "transparent"}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-[13px] font-bold text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-2">
          <span className="h-3 w-[4px] rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

