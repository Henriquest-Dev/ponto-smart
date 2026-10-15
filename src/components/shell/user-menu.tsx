"use client";

import { ArrowLeftRight, Building2, LogOut, MoreVertical, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/misc";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { logoutAction, switchCompanyAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

export type MenuLink = { href: string; label: string; icon: "app" | "company" | "platform" | "security" | "profile" };

const ICONS = { app: Smartphone, company: Building2, platform: ArrowLeftRight, security: ShieldCheck, profile: UserRound };

export type UserMenuProps = {
  name: string;
  email: string;
  links: MenuLink[];
  companies: { id: string; name: string; active: boolean }[];
};

export function UserMenu({ name, email, links, companies, compact }: UserMenuProps & { compact?: boolean }) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        {compact ? (
          <button className="rounded-full" aria-label="Menu da conta">
            <Avatar name={name} size={34} />
          </button>
        ) : (
          <button className="flex w-full items-center gap-3 rounded-lg border border-border bg-background p-2.5 text-left shadow-[0_1px_2px_rgb(17_19_31/0.04)] hover:border-border-strong">
            <Avatar name={name} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{name}</span>
              <span className="block truncate text-xs text-muted">{email}</span>
            </span>
            <MoreVertical className="size-4 text-subtle" />
          </button>
        )}
      </DropdownTrigger>
      <DropdownContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-60">
        <DropdownLabel>
          <span className="block truncate font-medium text-foreground">{name}</span>
          <span className="block truncate">{email}</span>
        </DropdownLabel>
        <DropdownSeparator />
        {links.map((l) => {
          const Icon = ICONS[l.icon];
          return (
            <DropdownItem key={l.href} asChild>
              <Link href={l.href}>
                <Icon /> {l.label}
              </Link>
            </DropdownItem>
          );
        })}
        {companies.length > 1 ? (
          <>
            <DropdownSeparator />
            <DropdownLabel>Empresa activa</DropdownLabel>
            {companies.map((c) => (
              <DropdownItem
                key={c.id}
                onSelect={() => {
                  void switchCompanyAction(c.id);
                }}
                className={cn(c.active && "font-medium text-primary")}
              >
                <Building2 /> <span className="truncate">{c.name}</span>
              </DropdownItem>
            ))}
          </>
        ) : null}
        <DropdownSeparator />
        <DropdownItem
          onSelect={() => {
            void logoutAction();
          }}
          className="text-danger [&_svg]:text-danger"
        >
          <LogOut /> Terminar sessão
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
