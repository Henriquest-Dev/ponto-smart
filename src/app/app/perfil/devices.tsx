"use client";

import { Smartphone } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/ui/action-button";
import { Input } from "@/components/ui/input";
import { getDeviceKey } from "@/lib/client/device";
import { attempt } from "@/lib/result";
import { rpc } from "@/lib/sb/client";

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

export function DeviceControls({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [label, setLabel] = useState(guessLabel);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} aria-label="Nome do dispositivo" />
      <ActionButton
        variant="soft"
        className="shrink-0"
        action={() =>
          attempt(async () => {
            const key = getDeviceKey();
            if (!key) throw new Error("O navegador bloqueou o armazenamento local.");
            await rpc<string>("ps_register_device", {
              p_company: companyId,
              p_device_key: key,
              p_label: label.trim().slice(0, 60) || "Dispositivo",
            });
            onDone();
            return "Dispositivo registado como de confiança.";
          })
        }
      >
        <Smartphone /> Registar este dispositivo
      </ActionButton>
    </div>
  );
}

export function RevokeDevice({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <ActionButton
      size="sm"
      variant="ghost"
      confirm="Revogar este dispositivo?"
      action={() =>
        attempt(async () => {
          await rpc("ps_revoke_device", { p_device: id });
          onDone();
          return "Dispositivo revogado.";
        })
      }
    >
      Revogar
    </ActionButton>
  );
}
