"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingScreen } from "@/components/shell/area";
import { homeFor, useSession } from "@/lib/sb/session";

/** Encaminha para a área certa conforme o papel. */
export default function Inicio() {
  const { state, company } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "anon" || state.status === "error") router.replace("/login/");
    if (state.status === "ready") router.replace(homeFor(state.me, company));
  }, [state, company, router]);
  return <LoadingScreen />;
}
