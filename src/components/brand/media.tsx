/** Imagens estáticas em public/ (guia e apresentação), com o basePath do GitHub Pages. */
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const asset = (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;

export function Picture({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset(src)}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}
