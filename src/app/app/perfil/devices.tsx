"use client";

import { Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDeviceKey } from "@/lib/client/device";
import { registerDeviceAction, revokeDeviceAction } from "../actions";

function guessLabel() {
  if (typeof navigator === "undefined") return "Este dispositivo";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Telemóvel Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Computador Windows";
  return "Este dispositivo";
}

export function DeviceControls() {
  const [label, setLabel] = useState(guessLabel);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} aria-label="Nome do dispositivo" />
      <Button
        variant="soft"
        disabled={pending}
        className="shrink-0"
        onClick={() =>
          start(async () => {
            const key = getDeviceKey();
            if (!key) return void toast.error("O navegador bloqueou o armazenamento local.");
            const r = await registerDeviceAction(key, label);
            if (r.ok) toast.success(r.message ?? "Registado.");
            else toast.error(r.error);
          })
        }
      >
        <Smartphone /> Registar este dispositivo
      </Button>
    </div>
  );
}

export function RevokeDevice({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeDeviceAction(id);
          if (r.ok) toast.success(r.message ?? "Revogado.");
          else toast.error(r.error);
        })
      }
    >
      Revogar
    </Button>
  );
}
