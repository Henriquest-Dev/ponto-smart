export type NavItem = {
  href: string;
  label: string;
  /** Mantido por compatibilidade; a navegação Horbit é só texto. */
  icon?: string;
  badge?: number;
  children?: { href: string; label: string }[];
};

export type NavSection = { title?: string; items: NavItem[] };
