import { Link, useLocation } from "wouter";
import {
  Briefcase,
  Users,
  Building2,
  LayoutDashboard,
  MapPin,
  Settings,
  ShieldAlert,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutLink } from "@/components/auth/sign-out-link";

export function Sidebar() {
  const [location] = useLocation();

  const navigation = [
    { name: "Command Center", href: "/app/dashboard", icon: LayoutDashboard },
    { name: "Active Jobs", href: "/app/jobs", icon: Briefcase },
    { name: "My Assignments", href: "/app/my-jobs", icon: MapPin },
    { name: "Process Servers", href: "/app/servers", icon: Users },
    { name: "Client Firms", href: "/app/clients", icon: Building2 },
  ];

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight text-sidebar-primary hover:opacity-80 transition-opacity">
          <ShieldAlert className="h-5 w-5" />
          <span>SERVED.</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-3">
        <nav className="space-y-1">
          {navigation.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-sidebar-border p-4 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground cursor-not-allowed">
          <Settings className="h-4 w-4" />
          Settings
        </div>
        <Link
          href="/app/role-chooser?switch=1"
          className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground w-full rounded-md transition-colors"
          data-testid="link-admin-switch-role"
        >
          <Repeat className="h-4 w-4" />
          Switch Portal
        </Link>
        <SignOutLink
          label="Sign Out"
          className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground w-full rounded-md transition-colors"
          style={{}}
          testId="button-admin-sign-out"
        />
      </div>
    </div>
  );
}
