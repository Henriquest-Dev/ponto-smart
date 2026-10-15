"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/misc";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { cn } from "@/lib/utils";

export type MenuLink = { href: string; label: string; icon?: string };

export type UserMenuProps = {
  name: string;
  email: string;
  links: MenuLink[];
  companies: { id: string; name: string; active: boolean }[];
  onSwitchCompany: (id: string) => void;
  onLogout: () => void;
};

export function UserMenu({ name, email, links, companies, onSwitchCompany, onLogout, compact, dark }: UserMenuProps & { compact?: boolean; dark?: boolean }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        {compact ? (
          <button className="rounded-lg" aria-label="Conta">
            <Avatar name={name} size={32} className="bg-white/10 text-white" />
          </button>
        ) : (
          <button className={cn("flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors", dark ? "hover:bg-white/5" : "bg-background hover:bg-surface-2")}>
            <Avatar name={name} size={34} className={dark ? "bg-white/10 text-white" : undefined} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold">{name}</span>
              <span className={cn("block truncate text-[12px]", dark ? "text-white/50" : "text-muted")}>{email}</span>
            </span>
          </button>
        )}
      </DropdownTrigger>
      <DropdownContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-64">
        <DropdownLabel>
          <span className="block truncate text-[14px] font-bold text-foreground">{name}</span>
          <span className="block truncate">{email}</span>
        </DropdownLabel>
        <DropdownSeparator />
        {links.map((l) => (
          <DropdownItem key={l.href} asChild>
            <Link href={l.href}>{l.label}</Link>
          </DropdownItem>
        ))}
        {companies.length > 1 ? (
          <>
            <DropdownSeparator />
            <DropdownLabel>Empresa activa</DropdownLabel>
            {companies.map((c) => (
              <DropdownItem key={c.id} onSelect={() => onSwitchCompany(c.id)} className={cn(c.active && "font-bold text-primary")}>
                <span className="truncate">{c.name}</span>
              </DropdownItem>
            ))}
          </>
        ) : null}
        <DropdownSeparator />
        <DropdownItem onSelect={() => onLogout()} className="font-bold text-danger">
          Terminar sessão
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
