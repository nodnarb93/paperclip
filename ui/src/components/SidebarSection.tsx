import type { ReactNode } from "react";

interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    // PATCH(nodnarb93): ui-polish (Patch 18) — added a hairline top border +
    // pt-3 so adjacent sections in the sidebar nav have a clear visual break
    // instead of bleeding together over the same flat background. The parent
    // `<nav>` has gap-4 between sections so the border sits inside the gap.
    // `first:` modifier skips the border on the first section so it doesn't
    // create a stray line under the top nav block.
    <div className="pt-3 border-t border-sidebar-border/30 first:border-t-0 first:pt-0">
      <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
        {label}
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
    </div>
  );
}
