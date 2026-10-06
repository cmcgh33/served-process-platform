import { Link, useLocation } from "wouter";
import { SignOutLink } from "@/components/auth/sign-out-link";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  ShieldCheck,
  Repeat,
  Crown,
  ScrollText,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/me";

const navigation = [
  { name: "Overview", href: "/app/admin", icon: LayoutDashboard, exact: true },
  { name: "Jobs", href: "/app/admin/jobs", icon: Briefcase },
  { name: "Servers", href: "/app/admin/servers", icon: ShieldCheck },
  { name: "Users", href: "/app/admin/users", icon: Users },
  { name: "Demo", href: "/app/admin/demo", icon: Play },
  { name: "Audit", href: "/app/admin/audit", icon: ScrollText },
];

export function AdminSidebar() {
  const [location] = useLocation();
  const me = useMe();
  const displayName =
    [me.data?.firstName, me.data?.lastName].filter(Boolean).join(" ").trim() ||
    me.data?.email ||
    "Owner";

  return (
    <div className="flex h-full w-64 flex-col text-white bg-brand-navy">
      <div
        className="flex h-16 flex-col justify-center px-5"
        style={{
          borderBottomColor: "rgba(255,255,255,0.08)",
          borderBottomWidth: 1,
        }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center flex-shrink-0">
            <Crown className="w-4 h-4 text-brand-navy" />
          </div>
          <div>
            <div className="font-black text-sm tracking-wider leading-none">
              SERVED.
            </div>
            <div className="text-[9px] font-bold tracking-widest uppercase leading-none mt-0.5 text-amber-400">
              Admin Portal
            </div>
          </div>
        </Link>
      </div>

      <div
        className="px-5 py-4 space-y-3"
        style={{
          borderBottomColor: "rgba(255,255,255,0.08)",
          borderBottomWidth: 1,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "rgba(245,158,11,0.15)" }}
          >
            <Crown className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <span
            className="text-sm font-medium flex-1 truncate"
            style={{ color: "rgba(255,255,255,0.9)" }}
          >
            {displayName}
          </span>
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded leading-none"
            style={{
              border: "1px solid rgba(245,158,11,0.4)",
              color: "var(--color-brand-amber)",
              backgroundColor: "rgba(245,158,11,0.1)",
            }}
          >
            Admin
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {navigation.map((item) => {
          const isActive = item.exact
            ? location === item.href
            : location === item.href || location.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                isActive ? "bg-amber-400 text-black" : "hover:bg-white/10",
              )}
              style={isActive ? {} : { color: "rgba(255,255,255,0.6)" }}
              data-testid={`link-admin-${item.name.toLowerCase()}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div
        className="px-5 py-4 space-y-1"
        style={{
          borderTopColor: "rgba(255,255,255,0.08)",
          borderTopWidth: 1,
        }}
      >
        <p
          className="text-[10px] mb-3"
          style={{ color: "rgba(255,255,255,0.25)" }}
        >
          © 2026 SERVED.
        </p>
        <Link
          href="/app/role-chooser?switch=1"
          className="flex items-center gap-2.5 w-full rounded-md px-1 py-1.5 text-sm transition-colors hover:text-white"
          style={{ color: "rgba(255,255,255,0.45)" }}
          data-testid="link-admin-switch-role"
        >
          <Repeat className="w-4 h-4" />
          <span>Switch Portal</span>
        </Link>
        <SignOutLink label="Log Out" testId="button-admin-sign-out" />
      </div>
    </div>
  );
}
