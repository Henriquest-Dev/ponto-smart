import type { Metadata } from "next";

export const metadata: Metadata = { title: "Definições" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
