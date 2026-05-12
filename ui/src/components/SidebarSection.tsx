import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    // NOTE: section-separator border styling was moved UP to the parent
    // `<nav>` in Sidebar.tsx (Patch 18.1) so it also catches SidebarProjects
    // and SidebarAgents — those don't go through SidebarSection but should
    // get the same visual break. See Sidebar.tsx for the [&>*]: variants.
    <div>
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
        {label}
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
    </div>
  );
}
