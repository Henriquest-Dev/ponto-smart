import { Area } from "@/components/shell/area";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Area kind="admin">{children}</Area>;
}
