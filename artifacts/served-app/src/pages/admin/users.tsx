import { useState } from "react";
import { useLocation } from "wouter";
import {
  useAdminUsers,
  type AdminServerStatus,
  type AdminUserRoleFilter,
  type AdminUserRow,
} from "@/lib/admin";
import { AlertTriangle, Search, Users as UsersIcon } from "lucide-react";
import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";

const ROLE_FILTERS: { value: AdminUserRoleFilter; label: string }[] = [
  { value: "requester", label: "Requesters" },
  { value: "attorney", label: "Attorneys" },
  { value: "server", label: "Servers" },
];

const EXPIRY_WINDOW_DAYS = 30;

const ROLE_BADGE: Record<string, string> = {
  requester: "bg-blue-100 text-blue-700",
  attorney: "bg-violet-100 text-violet-700",
  server: "bg-emerald-100 text-emerald-700",
};

// Mirrors the pill colors used on /app/admin/servers so the two pages read
// the same at a glance.
const STATUS_BADGE: Record<AdminServerStatus, string> = {
  pending: "bg-blue-100 text-blue-700",
  active: "bg-emerald-100 text-emerald-700",
  suspended: "bg-amber-100 text-amber-800",
  inactive: "bg-gray-200 text-gray-700",
};

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function ServerStatusCell({ u }: { u: AdminUserRow }) {
  if (u.role !== "server") {
    return <span className="text-xs text-gray-300">—</span>;
  }
  if (!u.serverStatus) {
    // role=server but no servers row yet (rare — user picked the role but
    // an admin hasn't created the roster entry).
    return (
      <span
        className="text-xs text-gray-400 italic"
        data-testid={`badge-no-roster-${u.id}`}
      >
        no roster
      </span>
    );
  }
  const days = daysUntil(u.serverLicenseExpiry);
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[u.serverStatus]}`}
        data-testid={`badge-server-status-${u.id}`}
      >
        {u.serverStatus}
      </span>
      {days !== null && days <= 30 && days >= 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 font-semibold"
          data-testid={`warn-expiry-${u.id}`}
        >
          <AlertTriangle className="w-3 h-3" />
          license {days}d
        </span>
      )}
      {days !== null && days < 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-[11px] text-red-700 font-semibold"
          data-testid={`warn-expired-${u.id}`}
        >
          <AlertTriangle className="w-3 h-3" /> license expired
        </span>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AdminUserRoleFilter | null>(
    null,
  );
  const [expiringOnly, setExpiringOnly] = useState(false);
  const { data, isLoading } = useAdminUsers({
    search: search || undefined,
    role: roleFilter ?? undefined,
    // Server-side ignores this unless role=server, but only sending it when
    // the chip is on keeps the URL clean and the query key stable.
    expiringWithinDays:
      roleFilter === "server" && expiringOnly ? EXPIRY_WINDOW_DAYS : undefined,
  });
  const [, setLocation] = useLocation();
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const goToServerRow = (serverId: number) => {
    // Hash deep-link → /app/admin/servers consumes `#server-<id>` and scrolls
    // + briefly highlights that row.
    setLocation(`/app/admin/servers#server-${serverId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Search by name or email.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
        }}
        className="flex gap-2"
      >
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Email or name…"
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm"
            data-testid="input-user-search"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-lg"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-gray-500 mr-1">
          Role
        </span>
        <button
          type="button"
          onClick={() => {
            setRoleFilter(null);
            setExpiringOnly(false);
          }}
          className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
            roleFilter === null
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
          data-testid="chip-role-all"
        >
          All
        </button>
        {ROLE_FILTERS.map((opt) => {
          const active = roleFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const nextRole = active ? null : opt.value;
                setRoleFilter(nextRole);
                // Always reset the expiry toggle whenever we leave the
                // Servers chip — including when toggling Servers OFF — so
                // re-selecting Servers later starts from a clean state.
                if (nextRole !== "server") setExpiringOnly(false);
              }}
              className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors ${
                active
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
              data-testid={`chip-role-${opt.value}`}
            >
              {opt.label}
            </button>
          );
        })}
        {roleFilter === "server" && (
          <label
            className="ml-2 inline-flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none"
            data-testid="toggle-expiring-soon"
          >
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => setExpiringOnly(e.target.checked)}
              className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
            />
            License expiring within {EXPIRY_WINDOW_DAYS} days
          </label>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-12 text-center">
            <UsersIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-700">
              No users found
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Server status</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Joined</th>
                  <th className="text-left px-4 py-3">User ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((u) => {
                  const name =
                    [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
                    "—";
                  const isServerLink =
                    u.role === "server" && u.serverId !== null;
                  // Non-server users (requesters/attorneys) open the
                  // subscription/profile drawer in place; server users keep
                  // their existing deep-link to /admin/servers since that
                  // page already has the full lifecycle controls.
                  const handleClick = isServerLink
                    ? () => goToServerRow(u.serverId as number)
                    : () => setOpenUserId(u.id);
                  return (
                    <tr
                      key={u.id}
                      onClick={handleClick}
                      className={
                        isServerLink
                          ? "hover:bg-amber-50 cursor-pointer"
                          : "hover:bg-gray-50 cursor-pointer"
                      }
                      data-testid={`row-user-${u.id}`}
                      title={
                        isServerLink
                          ? "Open this server on the Servers page"
                          : "Open user detail"
                      }
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {name}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {u.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {u.role ? (
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {u.role}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">unset</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ServerStatusCell u={u} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 capitalize">
                        {u.plan}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-400 select-all">
                        {u.id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserDetailDrawer
        userId={openUserId}
        onClose={() => setOpenUserId(null)}
      />
    </div>
  );
}
