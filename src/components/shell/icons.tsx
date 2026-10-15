import {
  Activity, BarChart3, Building2, CalendarCheck2, Clock3, FileCheck2, History, House, Layers, LayoutGrid,
  MapPin, MessagesSquare, Receipt, ScanLine, ScrollText, Settings, UserRound, Users, Wallet,
} from "lucide-react";
import type { NavIcon } from "./nav-types";

export const NAV_ICONS: Record<NavIcon, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  dashboard: LayoutGrid,
  users: Users,
  calendar: CalendarCheck2,
  file: FileCheck2,
  wallet: Wallet,
  clock: Clock3,
  map: MapPin,
  chart: BarChart3,
  messages: MessagesSquare,
  scroll: ScrollText,
  settings: Settings,
  building: Building2,
  layers: Layers,
  receipt: Receipt,
  activity: Activity,
  home: House,
  history: History,
  scan: ScanLine,
  user: UserRound,
};
