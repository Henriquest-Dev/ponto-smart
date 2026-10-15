"use client";

import { LinkTabs } from "@/components/ui/tabs";

/** Navegação entre as vistas de assiduidade. */
export function AttendanceNav({ active, reviewCount }: { active: "registos" | "revisao" | "correccoes"; reviewCount?: number }) {
  return (
    <LinkTabs
      active={active}
      items={[
        { key: "registos", label: "Registos diários", href: "/empresa/assiduidade/" },
        { key: "revisao", label: "Em revisão", href: "/empresa/assiduidade/revisao/", count: reviewCount },
        { key: "correccoes", label: "Correcções", href: "/empresa/assiduidade/correccoes/" },
      ]}
    />
  );
}
