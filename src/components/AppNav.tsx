import Link from "next/link";
import { Logo } from "@/components/Logo";

/** Bottom bar on phones, top bar from `sm` up. Three destinations, no menu. */
export function AppNav({ current }: { current: "today" | "journal" | "settings" }) {
  const items = [
    { key: "today", href: "/today", label: "Today" },
    { key: "journal", href: "/journal", label: "Journal" },
    { key: "settings", href: "/settings", label: "Settings" },
  ] as const;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-canvas/90 backdrop-blur-md sm:static sm:border-b sm:border-t-0 sm:bg-transparent sm:backdrop-blur-none">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3.5">
        <Link href="/today" className="hidden text-gold sm:block" aria-label="Lumsa">
          <Logo size={24} />
        </Link>

        <div className="flex flex-1 items-center justify-around sm:flex-none sm:justify-end sm:gap-1">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={current === item.key ? "page" : undefined}
              className={
                current === item.key
                  ? "rounded-full px-4 py-1.5 text-sm font-medium text-gold"
                  : "rounded-full px-4 py-1.5 text-sm text-muted transition-colors hover:text-text"
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
