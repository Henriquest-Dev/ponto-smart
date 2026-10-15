/** Ilustrações 3D (renderizadas, em public/media). */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const mediaSrc = (name: string) => `${base}/media/${name}`;

const SIZES = {
  hero: [1048, 855],
  login: [965, 650],
  company: [616, 599],
  team: [808, 623],
  scan: [844, 661],
  payroll: [918, 471],
  empty: [370, 515],
} as const;

export type Illustration = keyof typeof SIZES;

export function Illustration({ name, className, priority = false }: { name: Illustration; className?: string; priority?: boolean }) {
  const [w, h] = SIZES[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mediaSrc(`${name}.webp`)}
      alt=""
      width={w}
      height={h}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

/** Vídeo curto do produto (loop, sem som); em movimento reduzido fica só o poster. */
export function HeroVideo({ className }: { className?: string }) {
  return (
    <video
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster={mediaSrc("horbit-hero-poster.webp")}
      width={1200}
      height={980}
      aria-label="Colaborador marca o ponto no telemóvel junto à estação da recepção, dentro do perímetro da empresa"
    >
      <source src={mediaSrc("horbit-hero.webm")} type="video/webm" />
      <source src={mediaSrc("horbit-hero.mp4")} type="video/mp4" />
    </video>
  );
}
