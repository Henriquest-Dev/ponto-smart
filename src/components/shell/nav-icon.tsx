import {
  Bell,
  Buildings,
  CalendarCheck,
  ChartBar,
  ChatsCircle,
  ClockCounterClockwise,
  ClockUser,
  FileText,
  GearSix,
  House,
  List,
  ListMagnifyingGlass,
  MapPin,
  QrCode,
  Receipt,
  SquaresFour,
  Tray,
  UserCircle,
  UsersThree,
  Wallet,

} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Ícones da navegação (Phosphor, traço arredondado). Escolhidos pelo destino da ligação. */
const BY_HREF: Record<string, Icon> = {
  "/app/": House,
  "/app/marcar/": QrCode,
  "/app/historico/": ClockCounterClockwise,
  "/app/justificacoes/": FileText,
  "/app/recibos/": Receipt,
  "/app/perfil/": UserCircle,
  "/admin/": SquaresFour,
  "/admin/empresas/": Buildings,
  "/admin/pedidos/": Tray,
  "/admin/assistente/": ChatsCircle,
  "/admin/auditoria/": ListMagnifyingGlass,
  "/empresa/": SquaresFour,
  "/empresa/colaboradores/": UsersThree,
  "/empresa/assiduidade/": CalendarCheck,
  "/empresa/justificacoes/": FileText,
  "/empresa/salarios/": Wallet,
  "/empresa/relatorios/": ChartBar,
  "/empresa/horarios/": ClockUser,
  "/empresa/locais/": MapPin,
  "/empresa/assistente/": ChatsCircle,
  "/empresa/auditoria/": ListMagnifyingGlass,
  "/empresa/definicoes/": GearSix,
  menu: List,
  avisos: Bell,
};

export function NavIcon({ href, active = false, className }: { href: string; active?: boolean; className?: string }) {
  const I = BY_HREF[href.split("?")[0]];
  if (!I) return null;
  return <I aria-hidden weight={active ? "fill" : "regular"} className={cn("size-5 shrink-0", className)} />;
}
