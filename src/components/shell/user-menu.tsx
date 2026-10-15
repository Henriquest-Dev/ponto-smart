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

export function UserMenu({ name, email, links, companies, onSwitchCompany, onLogout, compact }: UserMenuProps & { compact?: boolean }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        {compact ? (
          <button className="rounded-[38%]" aria-label="Conta">
            <Avatar name={name} size={36} />
          </button>
        ) : (
          <button className="flex w-full items-center gap-3 rounded-[18px] bg-background p-2.5 text-left transition-colors hover:bg-[#fbfaff]">
            <Avatar name={name} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-extrabold">{name}</span>
              <span className="block truncate text-[12px] text-muted">{email}</span>
            </span>
            <span className="pr-1 text-[12px] font-bold text-subtle">Conta</span>
          </button>
        )}
      </DropdownTrigger>
      <DropdownContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-64">
        <DropdownLabel>
          <span className="block truncate text-[14px] font-extrabold text-foreground">{name}</span>
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
              <DropdownItem key={c.id} onSelect={() => onSwitchCompany(c.id)} className={cn(c.active && "font-extrabold text-primary")}>
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
