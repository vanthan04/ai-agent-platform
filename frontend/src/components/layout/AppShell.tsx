"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FolderKanban, ListChecks, PanelLeft, Settings2, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marks the item active for this path and everything below it. */
  match: string;
}

function Brand() {
  return (
    <Link href="/projects" className="flex items-center gap-2 font-semibold">
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-accent-strong text-sm font-bold text-white">
        A
      </span>
      <span>Agent Platform</span>
    </Link>
  );
}

function NavLink({ item, collapsed, pathname }: { item: NavItem; collapsed: boolean; pathname: string }) {
  const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-text")}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{item.label}</span>
    </Link>
  );
}

/** The frame around every page: a side menu that follows the project you are in, and the user menu. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { projectId } = useParams<{ projectId?: string }>();
  const [collapsed, setCollapsed] = useState(false);

  const items: NavItem[] = [{ href: "/projects", label: "Projects", icon: FolderKanban, match: "/projects" }];
  const projectItems: NavItem[] = projectId
    ? [
        { href: `/projects/${projectId}/execution`, label: "Execution", icon: ListChecks, match: `/projects/${projectId}/execution` },
        { href: `/projects/${projectId}/setup`, label: "Setup", icon: Settings2, match: `/projects/${projectId}/setup` },
      ]
    : [];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface p-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2">
        Skip to content
      </a>
      <aside className={cn("shrink-0 border-b border-border bg-surface md:min-h-screen md:border-r md:border-b-0", collapsed ? "md:w-20" : "md:w-64")}>
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className={cn(collapsed && "md:hidden")}>
            <Brand />
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            aria-pressed={collapsed}
            className="hidden rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text md:block"
          >
            <PanelLeft aria-hidden className="size-5" />
          </button>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {items.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
          {projectItems.length > 0 ? <div aria-hidden className="mx-2 hidden border-t border-border md:my-3 md:block" /> : null}
          {projectItems.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-end border-b border-border bg-surface px-6">
          <div className="flex items-center gap-3" title="Signed in as the development user. Real sign-in is not built yet.">
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong">
              DEV
            </span>
            <span className="text-sm text-muted">Development user</span>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
