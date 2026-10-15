export type NavIcon =
  | "dashboard" | "users" | "calendar" | "file" | "wallet" | "clock" | "map" | "chart" | "messages"
  | "scroll" | "settings" | "building" | "layers" | "receipt" | "activity" | "home" | "history" | "scan" | "user";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
  children?: { href: string; label: string }[];
};

export type NavSection = { title?: string; items: NavItem[] };
