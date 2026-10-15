/**
 * Ilustração do hero: o momento da marcação.
 * À esquerda, o ecrã da estação com o QR que muda; à direita, o telemóvel do
 * colaborador a confirmar que está dentro do perímetro do local.
 * Uma única animação ao carregar (o ponto GPS assenta dentro do perímetro e a
 * confirmação aparece); desligada com prefers-reduced-motion.
 */
export function ClockScene() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-hidden>
      {/* Estação (ecrã da recepção) */}
      <div className="absolute top-6 left-0 w-[46%] rounded-[18px] border border-[#e4def4] bg-white p-4 shadow-[0_24px_48px_-28px_rgb(48_28_110/0.45)] sm:p-5">
        <p className="text-[11px] font-medium text-[#6b6e7f]">Estação da recepção</p>
        <div className="mt-3 aspect-square w-full rounded-lg bg-[#15131f] p-[10%]">
          <QrGlyph />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#efe9fe]">
          <div className="scene-countdown h-full rounded-full bg-[#7041ec]" />
        </div>
        <p className="mt-2 text-[11px] text-[#6b6e7f]">Novo código a cada 30 s</p>
      </div>

      {/* Telemóvel do colaborador */}
      <div className="relative ml-auto w-[62%] rounded-[34px] border-[6px] border-[#15131f] bg-[#15131f] shadow-[0_40px_80px_-40px_rgb(48_28_110/0.6)]">
        <div className="overflow-hidden rounded-[28px] bg-[#f6f4fb]">
          <div className="flex items-center justify-between px-5 pt-4 text-[10px] font-semibold text-[#15131f]">
            <span>07:58</span>
            <span className="h-1.5 w-10 rounded-full bg-[#15131f]/80" />
          </div>
          <div className="px-4 pt-4 pb-5">
            <p className="text-[11px] text-[#6b6e7f]">Loja da Baixa</p>
            <p className="font-display text-[17px] leading-tight font-semibold text-[#15131f]">A confirmar localização</p>

            {/* Perímetro (geofence) */}
            <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-2xl bg-white">
              <svg viewBox="0 0 200 200" className="absolute inset-0 size-full">
                <defs>
                  <pattern id="ps-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#efeaf8" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="200" height="200" fill="url(#ps-grid)" />
                <path d="M0 132 C 50 120, 90 150, 200 118" stroke="#e7e1f5" strokeWidth="9" fill="none" />
                <path d="M118 0 C 112 60, 128 120, 104 200" stroke="#e7e1f5" strokeWidth="7" fill="none" />
                <circle cx="100" cy="100" r="62" fill="#7041ec" fillOpacity="0.08" stroke="#7041ec" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="100" cy="100" r="3" fill="#7041ec" />
                <g className="scene-gps">
                  <circle cx="0" cy="0" r="22" fill="#0f9d58" fillOpacity="0.12" className="scene-halo" />
                  <circle cx="0" cy="0" r="6.5" fill="#0f9d58" stroke="white" strokeWidth="2.5" />
                </g>
              </svg>
              <span className="absolute top-2 left-2 rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-[#6b6e7f]">raio 50 m</span>
            </div>

            <div className="scene-result mt-3 flex items-center gap-2.5 rounded-xl bg-white px-3 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e3f6ea]">
                <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="#0b7d46" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-[#15131f]">Entrada registada</span>
                <span className="block text-[10px] text-[#6b6e7f]">Dentro do perímetro, a 12 m do centro</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Padrão de QR decorativo (não é um código válido). */
function QrGlyph() {
  const cells: [number, number][] = [];
  const seed = [0x5a3c, 0x2bd1, 0x7e05, 0x13a9, 0x6c72, 0x3f18, 0x48e6, 0x71b3, 0x0d5e, 0x66a1, 0x2c97, 0x59f0, 0x1e4b, 0x7a28, 0x35c6, 0x43dd];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((seed[y] >> x) & 1) cells.push([x, y]);
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="5" height="5" fill="white" />
      <rect x={x + 1} y={y + 1} width="3" height="3" fill="#15131f" />
      <rect x={x + 2} y={y + 2} width="1" height="1" fill="white" />
    </g>
  );
  return (
    <svg viewBox="0 0 21 21" className="size-full" shapeRendering="crispEdges">
      {cells
        .filter(([x, y]) => !((x < 6 && y < 6) || (x > 9 && y < 6) || (x < 6 && y > 9)))
        .map(([x, y]) => (
          <rect key={`${x}.${y}`} x={x + 2.5} y={y + 2.5} width="1" height="1" fill="white" />
        ))}
      {finder(0, 0)}
      {finder(16, 0)}
      {finder(0, 16)}
    </svg>
  );
}
