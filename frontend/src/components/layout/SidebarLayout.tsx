import React, { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  Ellipsis,
  Landmark,
  ListFilter,
  LogOut,
  ReceiptText,
  Repeat,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { transactionAPI } from "../../services/api";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface SidebarLayoutProps {
  children: React.ReactNode;
  title?: string;
  /** Pages that draw their own heading (the monthly spread) pass false. */
  showTitle?: boolean;
}

type NavItem = { to: string; label: string; short: string; icon: LucideIcon; phone: boolean };

// Daily-loop sections first; the phone tab bar keeps the first four and puts the rest under More.
const NAV: NavItem[] = [
  { to: "/overview", label: "This month", short: "Month", icon: BookOpen, phone: true },
  { to: "/transactions", label: "Transactions", short: "Transactions", icon: ReceiptText, phone: true },
  { to: "/budgets", label: "Budgets", short: "Budgets", icon: Wallet, phone: true },
  { to: "/recurring", label: "Recurring", short: "Recurring", icon: Repeat, phone: true },
  { to: "/rules", label: "Rules", short: "Rules", icon: ListFilter, phone: false },
  { to: "/net-worth", label: "Net worth", short: "Net worth", icon: TrendingUp, phone: false },
  { to: "/insights", label: "Reports", short: "Reports", icon: BarChart3, phone: false },
  { to: "/connections", label: "Connections", short: "Connections", icon: Landmark, phone: false },
];

function useReviewCount() {
  const [count, setCount] = useState(0);
  const { pathname } = useLocation();

  // Refetch on navigation so the badge drops after a review session.
  useEffect(() => {
    let active = true;
    // Promise.resolve first: a missing or throwing API (tests, offline) must not break the page.
    Promise.resolve()
      .then(() => transactionAPI.getReviewCount())
      .then((r: { count?: number }) => active && setCount(r?.count ?? 0))
      .catch(() => active && setCount(0));
    return () => {
      active = false;
    };
  }, [pathname]);

  return count;
}

const ReviewBadge: React.FC<{ count: number; className?: string }> = ({ count, className }) =>
  count > 0 ? (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-terra px-1.5 text-[11px] font-semibold leading-5 text-white",
        className
      )}
      aria-label={`${count} transactions need review`}
    >
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

const UserMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const initial = user?.fullName?.trim().charAt(0).toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-full border border-rule bg-card text-sm font-semibold text-ink hover:bg-muted"
        aria-label="Account menu"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-semibold text-ink">{user?.fullName}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <NavLink to="/settings">
            <Settings /> Settings
          </NavLink>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const Wordmark: React.FC = () => (
  <NavLink to="/overview" className="text-[15px] font-semibold tracking-tight text-ink">
    Mazzy Money
  </NavLink>
);

const SidebarLayout: React.FC<SidebarLayoutProps> = ({ children, title, showTitle = true }) => {
  const reviewCount = useReviewCount();
  const { logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const moreActive = NAV.some((n) => !n.phone && pathname.startsWith(n.to));

  useEffect(() => {
    if (title) document.title = `${title} · Mazzy Money`;
  }, [title]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm supports-[backdrop-filter]:bg-paper/85">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-5 md:px-8">
          <Wordmark />
          <nav aria-label="Sections" className="hidden h-full flex-1 items-stretch gap-6 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-ink",
                    "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent",
                    isActive && "font-semibold text-ink after:bg-sage"
                  )
                }
              >
                {item.label}
                {item.to === "/transactions" && <ReviewBadge count={reviewCount} />}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto md:ml-0">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-5 pb-28 pt-8 md:px-8 md:pb-16 md:pt-10">
        {showTitle && title && (
          <h1 className="mb-8 text-title font-semibold text-ink">{title}</h1>
        )}
        {children}
      </main>

      {/* Phone: bottom tabs for the daily loop, everything else under More. */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid grid-cols-5">
          {NAV.filter((n) => n.phone).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground",
                  isActive && "font-semibold text-ink"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("size-5", isActive ? "text-sage" : "text-muted-foreground")} strokeWidth={1.75} />
                  {item.short}
                  {item.to === "/transactions" && (
                    <ReviewBadge count={reviewCount} className="absolute left-1/2 top-1 ml-2" />
                  )}
                </>
              )}
            </NavLink>
          ))}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground",
                moreActive && "font-semibold text-ink"
              )}
            >
              <Ellipsis className={cn("size-5", moreActive ? "text-sage" : "text-muted-foreground")} strokeWidth={1.75} />
              More
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-xl border-rule bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <SheetHeader>
                <SheetTitle className="text-left text-base">More</SheetTitle>
              </SheetHeader>
              <div className="px-4">
                {NAV.filter((n) => !n.phone).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className="ledger-line flex items-center gap-3 py-3.5 text-[15px] text-ink"
                  >
                    <item.icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
                    {item.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center gap-3 py-3.5 text-[15px] text-ink"
                >
                  <LogOut className="size-5 text-muted-foreground" strokeWidth={1.75} />
                  Sign out
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
};

export default SidebarLayout;
