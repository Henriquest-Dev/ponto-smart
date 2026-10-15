"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** No telemóvel, a primeira visita ao login passa pela apresentação (uma única vez). */
export function FirstVisit() {
  const router = useRouter();
  useEffect(() => {
    try {
      if (!localStorage.getItem("horbit-apresentacao") && window.matchMedia("(max-width: 767px)").matches) router.replace("/comecar/");
    } catch {}
  }, [router]);
  return null;
}
