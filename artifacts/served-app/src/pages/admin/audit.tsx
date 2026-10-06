import { useMemo, useState } from "react";
import {
  useAdminAudit,
  useAdminAuditFilters,
  type AdminAuditAction,
  type AdminAuditRow,
} from "@/lib/admin";
import { ScrollText, Filter, X, Download } from "lucide-react";

const ACTION_LABEL: Record<AdminAuditAction, string> = {
  "server.create": "Created server",
  "server.invite": "Invited server",
  "server.resend_invite": "Resent invite",
  "server.revoke_invite": "Revoked invite",
  "server.status_change": "Changed status",
  "server.verify": "Verified",
  "server.fail": "Marked failed",
  "server.delete_account": "Deleted account",
  "server.recover_stuck_account": "Forced server role",
  "server.edit_profile": "Edited server profile",
  "job.assign": "Assigned job",
  "job.cancel": "Cancelled job",
  "user.email": "Emailed user",
  "payout.retry": "Retried payout",
  "payout.dismiss": "Dismissed failed payout",
  "maintenance.purge_test_data": "Purged test data",
};

const ACTION_BADGE: Record<AdminAuditAction, string> = {
  "server.create": "bg-emerald-100 text-emerald-700",
  "server.invite": "bg-blue-100 text-blue-700",
  "server.resend_invite": "bg-blue-50 text-blue-600",
  "server.revoke_invite": "bg-red-100 text-red-700",
  "server.status_change": "bg-amber-100 text-amber-800",
  "server.verify": "bg-emerald-100 text-emerald-700",
  "server.fail": "bg-red-100 text-red-700",
  "server.delete_account": "bg-red-100 text-red-700",
  "server.recover_stuck_account": "bg-amber-100 text-amber-800",
  "server.edit_profile": "bg-sky-100 text-sky-700",
  "job.assign": "bg-indigo-100 text-indigo-700",
  "job.cancel": "bg-gray-200 text-gray-700",
  "user.email": "bg-sky-100 text-sky-700",
  "payout.retry": "bg-amber-100 text-amber-800",
  "payout.dismiss": "bg-gray-200 text-gray-700",
  "maintenance.purge_test_data": "bg-red-100 text-red-700",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function describeDetails(row: AdminAuditRow): string | null {
  const d = row.details;
  if (!d) return null;
  const out: string[] = [];
  switch (row.action) {
    case "server.status_change": {
      const from = d.from ? String(d.from) : "?";
      const to = d.to ? String(d.to) : "?";
      out.push(`${from} → ${to}`);
      break;
    }
    case "server.fail": {
      if (typeof d.reason === "string" && d.reason) {
        out.push(d.reason);
      }
      break;
    }
    case "server.invite":
    case "server.resend_invite": {
      if (typeof d.email === "string") out.push(d.email);
      if (typeof d.invitationId === "string" && d.invitationId) {
        out.push(`invite ${d.invitationId.slice(0, 12)}…`);
      }
      break;
    }
    case "server.revoke_invite": {
      if (typeof d.email === "string") out.push(d.email);
      if (typeof d.revokedCount === "number") {
        out.push(`${d.revokedCount} clerk invite(s) revoked`);
      }
      break;
    }
    case "server.create": {
      if (typeof d.email === "string") out.push(d.email);
      if (d.autoVerified) out.push("auto-verified");
      break;
    }
    case "job.assign":
    case "job.cancel": {
      if (typeof d.jobId === "number") out.push(`job #${d.jobId}`);
      break;
    }
    case "payout.retry": {
      if (typeof d.payoutId === "number") out.push(`payout #${d.payoutId}`);
      if (typeof d.jobId === "number") out.push(`job #${d.jobId}`);
      if (typeof d.amountCents === "number") {
        out.push(`$${(d.amountCents / 100).toFixed(2)}`);
      }
      if (typeof d.newStatus === "string") out.push(`→ ${d.newStatus}`);
      if (typeof d.failureReason === "string" && d.failureReason) {
        out.push(d.failureReason);
      }
      break;
    }
    case "payout.dismiss": {
      if (typeof d.payoutId === "number") out.push(`payout #${d.payoutId}`);
      if (typeof d.jobId === "number") out.push(`job #${d.jobId}`);
      if (typeof d.amountCents === "number") {
        out.push(`$${(d.amountCents / 100).toFixed(2)}`);
      }
      if (d.jobCancelled === true) out.push("job cancelled");
      break;
    }
  }
  return out.length > 0 ? out.join(" · ") : null;
}

// Date input strings are validated client-side before they hit the URL or
// the React Query key — passing a half-typed "2025-" would otherwise refetch
// on every keystroke and the server would silently drop it. We accept the
// canonical YYYY-MM-DD that `<input type="date">` emits and ignore anything
// else; the server applies the same shape check defensively.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeDateInput(v: string): string | undefined {
  return DATE_ONLY_RE.test(v) ? v : undefined;
}

export default function AdminAuditPage() {
  const [actorFilter, setActorFilter] = useState<string>("");
  const [serverFilter, setServerFilter] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [fromFilter, setFromFilter] = useState<string>("");
  const [toFilter, setToFilter] = useState<string>("");

  const filters = useAdminAuditFilters();
  const params = useMemo(
    () => ({
      actor: actorFilter || undefined,
      serverId: serverFilter ? Number.parseInt(serverFilter, 10) : undefined,
      action: (actionFilter || undefined) as AdminAuditAction | undefined,
      from: normalizeDateInput(fromFilter),
      to: normalizeDateInput(toFilter),
      limit: 200,
    }),
    [actorFilter, serverFilter, actionFilter, fromFilter, toFilter],
  );
  const audit = useAdminAudit(params);

  const hasFilters = Boolean(
    actorFilter || serverFilter || actionFilter || fromFilter || toFilter,
  );
  const clearFilters = () => {
    setActorFilter("");
    setServerFilter("");
    setActionFilter("");
    setFromFilter("");
    setToFilter("");
  };

  const items = audit.data?.items ?? [];

  // Build a download URL for the streaming CSV endpoint that mirrors the
  // currently-active filters. We hand this to a plain `<a download>` so the
  // browser handles streaming + Save-As natively (the Clerk session cookie
  // is sent automatically because we're same-origin).
  const csvHref = useMemo(() => {
    const qs = new URLSearchParams();
    if (actorFilter) qs.set("actor", actorFilter);
    if (serverFilter) qs.set("serverId", serverFilter);
    if (actionFilter) qs.set("action", actionFilter);
    const fromNorm = normalizeDateInput(fromFilter);
    const toNorm = normalizeDateInput(toFilter);
    if (fromNorm) qs.set("from", fromNorm);
    if (toNorm) qs.set("to", toNorm);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    return `${base}/api/admin/audit.csv${suffix}`;
  }, [actorFilter, serverFilter, actionFilter, fromFilter, toFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Every destructive admin action on the servers roster, with the
            owner who performed it. Filter by admin or by the server they
            touched. Most recent first.
          </p>
        </div>
        <a
          href={csvHref}
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold px-3 py-2 shrink-0"
          data-testid="button-audit-export-csv"
        >
          <Download className="w-4 h-4" /> Download CSV
        </a>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-gray-700 mr-2">
          <Filter className="w-4 h-4" />
          <span className="font-semibold text-sm">Filters</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Actor (admin)
          </label>
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[220px]"
            data-testid="select-audit-actor"
          >
            <option value="">All admins</option>
            {filters.data?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.email && a.email !== a.name ? ` (${a.email})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Target server
          </label>
          <select
            value={serverFilter}
            onChange={(e) => setServerFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[220px]"
            data-testid="select-audit-server"
          >
            <option value="">All servers</option>
            {filters.data?.servers.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name} — {s.email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Action
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[180px]"
            data-testid="select-audit-action"
          >
            <option value="">All actions</option>
            {(filters.data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a as AdminAuditAction] ?? a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            From
          </label>
          <input
            type="date"
            value={fromFilter}
            max={toFilter || undefined}
            onChange={(e) => setFromFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="input-audit-from"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            To
          </label>
          <input
            type="date"
            value={toFilter}
            min={fromFilter || undefined}
            onChange={(e) => setToFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="input-audit-to"
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-3 py-2"
            data-testid="button-audit-clear-filters"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {audit.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center" data-testid="audit-empty-state">
            <ScrollText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-700">
              No audit entries
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {hasFilters
                ? "Try clearing the filters above."
                : "Admin actions will appear here as they happen."}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Admin</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Target</th>
                  <th className="text-left px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((row) => {
                  const action = row.action as AdminAuditAction;
                  const detail = describeDetails(row);
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-gray-50"
                      data-testid={`row-audit-${row.id}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {row.actorName ?? row.actorUserId}
                        </div>
                        {row.actorEmail &&
                          row.actorEmail !== row.actorName && (
                            <div className="text-xs text-gray-500">
                              {row.actorEmail}
                            </div>
                          )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            ACTION_BADGE[action] ?? "bg-gray-100 text-gray-600"
                          }`}
                          data-testid={`badge-action-${action}`}
                        >
                          {ACTION_LABEL[action] ?? action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.targetServerName ? (
                          <div className="font-medium text-gray-900">
                            {row.targetServerName}
                          </div>
                        ) : row.targetServerId ? (
                          <div className="text-xs text-gray-500">
                            server #{row.targetServerId} (deleted)
                          </div>
                        ) : row.targetUserName ? (
                          <div className="font-medium text-gray-900">
                            {row.targetUserName}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {detail ?? <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
