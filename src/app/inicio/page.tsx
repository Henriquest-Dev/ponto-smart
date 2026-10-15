import { redirect } from "next/navigation";
import { getContext, homeFor } from "@/lib/auth/context";

/** Encaminha o utilizador autenticado para o painel do seu perfil. */
export default async function Inicio() {
  const ctx = await getContext();
  redirect(ctx ? homeFor(ctx) : "/login");
}
