import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useAdminCreateServer,
  useAdminDeleteServerAccount,
  useAdminFailServer,
  useAdminRecoverStuckAccount,
  useAdminResendInvite,
  useAdminRevokeInvite,
  useAdminServers,
  useAdminSetServerStatus,
  useAdminUpdateServer,
  useAdminVerifyServer,
  type AdminServerProfilePatch,
  type AdminInvitationInfo,
  type AdminServerRow,
  type AdminServerStatus,
} from "@/lib/admin";
import {
  ShieldCheck,
  ShieldAlert,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Play,
  Archive,
  Mail,
  Send,
  Trash2,
  Wrench,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CRED_BADGE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

const STATUS_BADGE: Record<AdminServerStatus, string> = {
  pending: "bg-blue-100 text-blue-700",
  active: "bg-emerald-100 text-emerald-700",
  suspended: "bg-amber-100 text-amber-800",
  inactive: "bg-gray-200 text-gray-700",
};

const US_STATE_RX = /^[A-Za-z]{2}$/;

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function AddServerForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [isLicensedNvServer, setIsLicensedNvServer] = useState(false);
  const [licenseCounty, setLicenseCounty] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [markVerified, setMarkVerified] = useState(true);
  const create = useAdminCreateServer();
  const { toast } = useToast();

  const today = new Date().toISOString().slice(0, 10);

  const stateValid = US_STATE_RX.test(licenseState.trim());
  const expiryValid =
    licenseExpiry.length === 10 && new Date(licenseExpiry) > new Date(today);
  const canSubmit =
    email.trim().length > 0 &&
    licenseNumber.trim().length > 0 &&
    stateValid &&
    expiryValid &&
    !create.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const result = await create.mutateAsync({
        userEmail: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        serviceArea: serviceArea.trim() || undefined,
        licenseNumber: licenseNumber.trim(),
        licenseState: licenseState.trim().toUpperCase(),
        licenseExpiry,
        isLicensedNvServer,
        licenseCounty: licenseCounty.trim() || undefined,
        businessAddress: businessAddress.trim() || undefined,
        markVerified,
      });
      const title = result.invited
        ? "Invitation sent"
        : markVerified
          ? "Server added & verified"
          : "Server added (pending verification)";
      const description = result.invited
        ? markVerified
          ? `${email} will get a Clerk sign-up email and be activated automatically when they finish onboarding.`
          : `${email} will get a Clerk sign-up email and stay pending until you verify them.`
        : markVerified
          ? `${email} is active and can take work now.`
          : `${email} was added in pending status. Verify them from the row actions when ready.`;
      toast({ title, description });
      setEmail("");
      setFirstName("");
      setLastName("");
      setPhone("");
      setServiceArea("");
      setLicenseNumber("");
      setLicenseState("");
      setLicenseExpiry("");
      setIsLicensedNvServer(false);
      setLicenseCounty("");
      setBusinessAddress("");
      setMarkVerified(true);
      onDone();
    } catch (err: any) {
      toast({
        title: "Couldn't add server",
        description: err?.message ?? "Try again",
        variant: "destructive",
      });
    }
  };

  return (
    <form
      onSubmit={submit}
      className="bg-white rounded-xl border border-gray-200 p-5 space-y-3"
    >
      <h2 className="font-semibold text-gray-900">Add server manually</h2>
      <p className="text-xs text-gray-500 -mt-1">
        If the email already has an account, we set their role to
        <span className="font-mono mx-1">server</span>. Otherwise we email them
        a Clerk sign-up invitation. The "Mark as verified" toggle below
        controls whether they can take work right away or wait for a manual
        check.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            User email *
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="server@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="input-add-server-email"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            First name
          </label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Last name
          </label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Phone
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Service area
          </label>
          <input
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
            placeholder="Las Vegas, NV"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            Driver's license (required)
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            License number *
          </label>
          <input
            required
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder="D1234567"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            data-testid="input-add-server-license-number"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            State *
          </label>
          <input
            required
            maxLength={2}
            value={licenseState}
            onChange={(e) =>
              setLicenseState(e.target.value.toUpperCase().slice(0, 2))
            }
            placeholder="NV"
            className={`w-full rounded-lg border px-3 py-2 text-sm uppercase ${
              licenseState && !stateValid
                ? "border-red-400"
                : "border-gray-300"
            }`}
            data-testid="input-add-server-license-state"
          />
          {licenseState && !stateValid && (
            <p className="text-[11px] text-red-600 mt-1">
              Use the 2-letter state code (e.g. NV).
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Expiration *
          </label>
          <input
            required
            type="date"
            min={today}
            value={licenseExpiry}
            onChange={(e) => setLicenseExpiry(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-sm ${
              licenseExpiry && !expiryValid
                ? "border-red-400"
                : "border-gray-300"
            }`}
            data-testid="input-add-server-license-expiry"
          />
          {licenseExpiry && !expiryValid && (
            <p className="text-[11px] text-red-600 mt-1">
              Expiry must be a future date.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Nevada licensed-server (optional)
        </div>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isLicensedNvServer}
            onChange={(e) => setIsLicensedNvServer(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-amber-500"
            data-testid="checkbox-add-server-nv-licensed"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-900">
              Holds a Nevada PILB process-server work card
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Affidavits this server signs will print the licensed-server
              attestation using the work-card number above.
            </span>
          </span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              License county
            </label>
            <input
              value={licenseCounty}
              onChange={(e) => setLicenseCounty(e.target.value)}
              placeholder="Clark"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="input-add-server-license-county"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Business address (optional)
            </label>
            <input
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              placeholder="Overrides SERVED. address on this server's affidavits"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="input-add-server-business-address"
            />
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={markVerified}
            onChange={(e) => setMarkVerified(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-amber-500"
            data-testid="checkbox-add-server-verified"
          />
          <span>
            <span className="block text-sm font-semibold text-gray-900">
              Mark as verified now
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              {markVerified
                ? "Skip background check. Server becomes active and can take work immediately."
                : "Server is added in pending status. They'll need to be verified before they can take jobs."}
            </span>
          </span>
        </label>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-lg disabled:opacity-50"
          data-testid="button-add-server-submit"
        >
          {create.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Add server
        </button>
      </div>
    </form>
  );
}

function StatusPill({ status }: { status: AdminServerStatus }) {
  return (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[status]}`}
      data-testid={`badge-status-${status}`}
    >
      {status}
    </span>
  );
}

function daysFromNow(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

const INVITATION_BADGE: Record<string, string> = {
  pending: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  expired: "bg-red-100 text-red-700",
  revoked: "bg-gray-200 text-gray-600",
  unknown: "bg-gray-100 text-gray-500",
};

/**
 * Pill describing the current Clerk invitation for an unlinked roster row.
 * `null` means we have no invite record (e.g. the row was inserted without
 * an email or Clerk lookup failed) — fall back to the legacy "awaiting
 * sign-up" hint so the UI never goes blank.
 */
function InvitationBadge({
  invitation,
  serverId,
}: {
  invitation: AdminInvitationInfo | null;
  serverId: number;
}) {
  if (!invitation) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${INVITATION_BADGE.unknown}`}
        data-testid={`badge-invitation-${serverId}`}
        title="We don't have a Clerk invitation on record for this row."
      >
        <Mail className="w-3 h-3" /> No invite on file
      </span>
    );
  }

  const status = invitation.status;
  const cls = INVITATION_BADGE[status] ?? INVITATION_BADGE.unknown;

  let label: string;
  let title: string;
  if (status === "pending") {
    if (invitation.expiresAt) {
      const days = daysFromNow(invitation.expiresAt);
      if (days < 0) {
        label = "Invite expired";
        title = `Expired ${relativeDays(days)} (${invitation.expiresAt})`;
      } else {
        label = `Pending · expires ${relativeDays(days)}`;
        title = `Sent ${relativeDays(daysFromNow(invitation.createdAt))}, expires ${invitation.expiresAt}`;
      }
    } else {
      const days = daysFromNow(invitation.createdAt);
      label = `Pending · sent ${relativeDays(days)}`;
      title = `Created ${invitation.createdAt}`;
    }
  } else if (status === "accepted") {
    label = "Invite accepted";
    title = `Recipient accepted on ${invitation.updatedAt} but the row hasn't linked yet — they need to sign in once.`;
  } else if (status === "expired") {
    label = "Invite expired";
    title = `Expired ${invitation.expiresAt ? `on ${invitation.expiresAt}` : ""}. Resend to send a fresh link.`;
  } else if (status === "revoked") {
    label = "Invite revoked";
    title = `Revoked on ${invitation.updatedAt}. Resend to send a fresh link.`;
  } else {
    label = status;
    title = "";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}
      data-testid={`badge-invitation-${serverId}`}
      data-invitation-status={status}
      title={title}
    >
      <Mail className="w-3 h-3" />
      {label}
    </span>
  );
}

function LicenseCell({ s }: { s: AdminServerRow }) {
  const days = daysUntil(s.licenseExpiry);
  if (!s.licenseNumber) return <span className="text-gray-400">—</span>;
  return (
    <div className="text-xs">
      <div className="font-mono text-gray-800">
        {s.licenseNumber}
        {s.licenseState ? (
          <span className="text-gray-500 ml-1">({s.licenseState})</span>
        ) : null}
      </div>
      {s.licenseExpiry && (
        <div className="mt-0.5 flex items-center gap-1">
          <span className="text-gray-500">exp {s.licenseExpiry}</span>
          {days !== null && days <= 30 && days >= 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-amber-700 font-semibold"
              data-testid={`warn-expiry-${s.id}`}
            >
              <AlertTriangle className="w-3 h-3" />
              {days}d
            </span>
          )}
          {days !== null && days < 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-red-700 font-semibold"
              data-testid={`warn-expired-${s.id}`}
            >
              <AlertTriangle className="w-3 h-3" /> expired
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminServersPage() {
  const { data, isLoading } = useAdminServers();
  const [, setLocation] = useLocation();
  const [stateFilter, setStateFilter] = useState<string>("all");
  const verify = useAdminVerifyServer();
  const failMut = useAdminFailServer();
  const setStatus = useAdminSetServerStatus();
  const resendInvite = useAdminResendInvite();
  const revokeInvite = useAdminRevokeInvite();
  const recoverStuck = useAdminRecoverStuckAccount();
  const deleteAccount = useAdminDeleteServerAccount();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);

  // Deep-link from /app/admin/users: rows pass `#server-<id>` so admins can
  // click through from a support search and land on the matching roster row.
  // We scroll it into view + flash a highlight ring for ~2s. Re-runs whenever
  // the hash or the loaded row set changes (the row may not exist on first
  // render while the query is loading).
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AdminServerRow | null>(null);
  useEffect(() => {
    if (!data) return;
    const m = /^#server-(\d+)$/.exec(window.location.hash);
    if (!m) return;
    const id = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(id)) return;
    if (!data.items.some((s) => s.id === id)) return;
    setHighlightId(id);
    const el = document.querySelector(`[data-testid="row-server-${id}"]`);
    if (el && "scrollIntoView" in el) {
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(t);
  }, [data]);

  // Distinct license states present in the roster, for the filter dropdown.
  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.items ?? []) {
      if (s.licenseState) set.add(s.licenseState.toUpperCase());
    }
    return Array.from(set).sort();
  }, [data]);

  const visibleItems = useMemo(() => {
    const items = data?.items ?? [];
    if (stateFilter === "all") return items;
    if (stateFilter === "none")
      return items.filter((s) => !s.licenseState);
    return items.filter(
      (s) => (s.licenseState ?? "").toUpperCase() === stateFilter,
    );
  }, [data, stateFilter]);

  const handleVerify = async (id: number) => {
    try {
      await verify.mutateAsync(id);
      toast({ title: "Server verified" });
    } catch (err: any) {
      toast({
        title: "Verify failed",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleFail = async (id: number) => {
    const reason = prompt("Reason for failing this server's check?");
    if (!reason) return;
    try {
      await failMut.mutateAsync({ serverId: id, reason });
      toast({ title: "Server marked as failed" });
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleStatus = async (
    s: AdminServerRow,
    next: AdminServerStatus,
    confirmText: string,
  ) => {
    if (!window.confirm(confirmText)) return;
    try {
      await setStatus.mutateAsync({ serverId: s.id, status: next });
      toast({ title: `Marked ${s.name} as ${next}` });
    } catch (err: any) {
      toast({
        title: "Status update failed",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleResend = async (s: AdminServerRow) => {
    const inv = s.invitation;
    let prompt: string;
    if (inv?.status === "pending") {
      prompt = `${s.email} already has a live invitation. Sending a new one will silently revoke the old link so the recipient only ever has one working URL. Continue?`;
    } else if (inv?.status === "expired") {
      prompt = `The previous invite for ${s.email} has expired. Send a fresh sign-up link?`;
    } else if (inv?.status === "revoked") {
      prompt = `The previous invite for ${s.email} was revoked. Send a fresh sign-up link?`;
    } else if (inv?.status === "accepted") {
      prompt = `${s.email} already accepted their invite — they may just need to sign in to finish linking. Send a new invite anyway?`;
    } else {
      prompt = `Send a Clerk invitation to ${s.email}? Any previous invite link for this email will stop working.`;
    }
    if (!window.confirm(prompt)) return;
    try {
      await resendInvite.mutateAsync(s.id);
      toast({
        title: "Invitation resent",
        description: `${s.email} will get a fresh sign-up email shortly.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't resend invite",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteAccount = async (s: AdminServerRow) => {
    const typed = window.prompt(
      `Delete account for ${s.name} (${s.email})? This wipes their login (Clerk + credentials) and removes them from the active roster. Their server profile, service attempts, payouts, and job history are PRESERVED on this row for the audit/legal trail and will show as "Deleted" in the list. The email can re-onboard from scratch as a new account. This CANNOT be undone.\n\nType DELETE to confirm:`,
    );
    if (typed !== "DELETE") return;
    try {
      const result = await deleteAccount.mutateAsync(s.id);
      if (result.clerkError) {
        toast({
          title: "DB wiped, but Clerk delete failed",
          description: `${result.clerkError}. Delete the Clerk user manually so the email can sign up again.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Account deleted",
          description: `${s.email} can now be re-onboarded as a fresh server.`,
        });
      }
    } catch (err: any) {
      toast({
        title: "Couldn't delete account",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleRecoverStuck = async (s: AdminServerRow) => {
    if (
      !window.confirm(
        `Force ${s.email} into the Server role?\n\nUse this when the invitee already signed up under a different role (usually Individual) and is stuck in the wrong portal. This sets their role to "server", links them to this roster row, and updates Clerk so their next sign-in lands them in the Server portal.\n\nIf they haven't signed up yet, use Resend Invite instead.`,
      )
    ) {
      return;
    }
    try {
      const result = await recoverStuck.mutateAsync(s.id);
      toast({
        title: "Account recovered",
        description: `${result.email} is now a server${
          result.previousRole && result.previousRole !== "server"
            ? ` (was: ${result.previousRole})`
            : ""
        }. They may need a hard refresh on their next sign-in.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't recover account",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  const handleRevoke = async (s: AdminServerRow) => {
    if (
      !window.confirm(
        `Revoke the pending invite for ${s.email}? This deletes the unlinked roster row and cancels their Clerk invitation. Use this if the email was wrong or the server is no longer needed.`,
      )
    ) {
      return;
    }
    try {
      await revokeInvite.mutateAsync(s.id);
      toast({
        title: "Invite revoked",
        description: `${s.email} can no longer use the previous link.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't revoke invite",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Servers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Roster + credential status. Manually onboard the first servers
            without payment or background-check fees.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            data-testid="select-state-filter"
          >
            <option value="all">All states</option>
            {stateOptions.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
            <option value="none">No state</option>
          </select>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 text-black font-bold text-sm rounded-lg"
            data-testid="button-toggle-add-server"
          >
            <Plus className="w-4 h-4" />
            {showForm ? "Hide form" : "Add server"}
          </button>
        </div>
      </div>

      {showForm && <AddServerForm onDone={() => setShowForm(false)} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-12 text-center">
            <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-700">
              No servers yet
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Add your first server above to start accepting jobs.
            </div>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="p-12 text-center">
            <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-gray-700">
              No servers match this state
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Try a different state or choose “All states”.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">Server</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">License</th>
                  <th className="text-left px-4 py-3">Service area</th>
                  <th className="text-left px-4 py-3">Credentials</th>
                  <th className="text-left px-4 py-3">Payouts</th>
                  <th className="text-left px-4 py-3">Jobs</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleItems.map((s) => {
                  const credLabel = s.credentialStatus ?? "none";
                  const isDeleted = !!s.deletedAt;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setLocation(`/app/admin/servers/${s.id}`)}
                      className={`hover:bg-gray-50 transition-colors cursor-pointer ${
                        isDeleted ? "bg-gray-50/60 text-gray-500" : ""
                      } ${
                        highlightId === s.id
                          ? "bg-amber-50 ring-2 ring-amber-300 ring-inset"
                          : ""
                      }`}
                      data-testid={`row-server-${s.id}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          <span className={`hover:text-amber-600 ${isDeleted ? "line-through text-gray-500" : ""}`}>
                            {s.name}
                          </span>
                          {isDeleted && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200"
                              title={`Account deleted${
                                s.deletedAt
                                  ? ` on ${new Date(s.deletedAt).toLocaleDateString()}`
                                  : ""
                              }${
                                s.deletedReason === "self_deleted"
                                  ? " (by the server)"
                                  : s.deletedReason === "admin_deleted"
                                    ? " (by an admin)"
                                    : ""
                              }. Login wiped, but service attempts, payouts, and job history are preserved on this row for the audit trail.`}
                              data-testid={`badge-deleted-${s.id}`}
                            >
                              Deleted
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{s.email}</div>
                        {!s.userId && !isDeleted && (
                          <div className="mt-1">
                            <InvitationBadge
                              invitation={s.invitation}
                              serverId={s.id}
                            />
                          </div>
                        )}
                        {isDeleted && s.deletedAt && (
                          <div className="text-[11px] text-gray-400 mt-1">
                            Deleted {new Date(s.deletedAt).toLocaleDateString()}
                            {s.deletedReason === "self_deleted"
                              ? " by server"
                              : s.deletedReason === "admin_deleted"
                                ? " by admin"
                                : ""}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={s.status} />
                      </td>
                      <td className="px-4 py-3">
                        <LicenseCell s={s} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {s.serviceArea ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CRED_BADGE[credLabel] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {credLabel}
                        </span>
                        {s.credentialFailureReason && (
                          <div className="text-[11px] text-red-600 mt-1">
                            {s.credentialFailureReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {s.payoutsEnabled ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Enabled
                          </span>
                        ) : s.stripeAccountId ? (
                          <span className="text-amber-700">Onboarding</span>
                        ) : (
                          <span className="text-gray-400">Not connected</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {s.jobsCompleted}
                      </td>
                      <td
                        className="px-4 py-3 text-right space-x-1 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isDeleted ? (
                          <span className="text-[11px] text-gray-400 italic">
                            History preserved
                          </span>
                        ) : null}
                        {!isDeleted && !s.userId && (
                          <>
                            <button
                              onClick={() => handleResend(s)}
                              disabled={resendInvite.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-1 disabled:opacity-50"
                              data-testid={`button-resend-invite-${s.id}`}
                            >
                              <Send className="w-3 h-3" /> Resend invite
                            </button>
                            {s.invitation?.status !== "pending" && (
                              <button
                                onClick={() => handleRecoverStuck(s)}
                                disabled={recoverStuck.isPending}
                                title="Force this email into the Server role. Use when the invitee already signed up under a different role and is stuck in the wrong portal."
                                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-1 disabled:opacity-50"
                                data-testid={`button-recover-stuck-${s.id}`}
                              >
                                <Wrench className="w-3 h-3" /> Force server role
                              </button>
                            )}
                            <button
                              onClick={() => handleRevoke(s)}
                              disabled={revokeInvite.isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 disabled:opacity-50"
                              data-testid={`button-revoke-invite-${s.id}`}
                            >
                              <Trash2 className="w-3 h-3" /> Revoke
                            </button>
                          </>
                        )}
                        {!isDeleted && s.userId && (
                          <button
                            onClick={() => setEditing(s)}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-edit-server-${s.id}`}
                            title="Edit name, phone, license, server type, business address, service area"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                        )}
                        {!isDeleted && credLabel !== "verified" && s.userId && (
                          <button
                            onClick={() => handleVerify(s.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-verify-${s.id}`}
                          >
                            <ShieldCheck className="w-3 h-3" /> Verify
                          </button>
                        )}
                        {!isDeleted && credLabel !== "failed" && s.userId && (
                          <button
                            onClick={() => handleFail(s.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-fail-${s.id}`}
                          >
                            <XCircle className="w-3 h-3" /> Fail
                          </button>
                        )}
                        {!isDeleted && s.status === "active" && (
                          <button
                            onClick={() =>
                              handleStatus(
                                s,
                                "suspended",
                                `Suspend ${s.name}? They will be blocked from accepting new jobs but can be reactivated later.`,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-1"
                            data-testid={`button-suspend-${s.id}`}
                          >
                            <Pause className="w-3 h-3" /> Suspend
                          </button>
                        )}
                        {!isDeleted && s.status === "suspended" && (
                          <button
                            onClick={() =>
                              handleStatus(
                                s,
                                "active",
                                `Reactivate ${s.name}? They will be able to accept jobs again.`,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-reactivate-${s.id}`}
                          >
                            <Play className="w-3 h-3" /> Reactivate
                          </button>
                        )}
                        {!isDeleted && s.status !== "inactive" && (
                          <button
                            onClick={() =>
                              handleStatus(
                                s,
                                "inactive",
                                `Mark ${s.name} inactive? This is for servers who left the platform. They will be permanently blocked unless you reactivate.`,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-inactive-${s.id}`}
                          >
                            <Archive className="w-3 h-3" /> Inactive
                          </button>
                        )}
                        {!isDeleted && s.status === "inactive" && (
                          <button
                            onClick={() =>
                              handleStatus(
                                s,
                                "active",
                                `Reactivate ${s.name}? They'll move back to active and be able to accept jobs.`,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-1"
                            data-testid={`button-reactivate-${s.id}`}
                          >
                            <Play className="w-3 h-3" /> Reactivate
                          </button>
                        )}
                        {!isDeleted && s.userId && (
                          <button
                            onClick={() => handleDeleteAccount(s)}
                            disabled={deleteAccount.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-100 hover:bg-red-200 text-red-800 text-xs font-bold px-2 py-1 disabled:opacity-50"
                            data-testid={`button-delete-account-${s.id}`}
                            title="Delete this server's login. Their roster row, service attempts, payouts, and job history are preserved on this row for the audit/legal trail."
                          >
                            <Trash2 className="w-3 h-3" /> Delete account
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 text-center">
        <ShieldAlert className="inline w-3 h-3 mr-1 -mt-0.5" />
        Suspending blocks job acceptance immediately. Servers see a banner on
        their dashboard explaining they're paused.
      </p>

      {editing && (
        <EditServerModal
          server={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const SERVER_TYPE_OPTIONS: Array<{
  value: "licensed_nv" | "registered" | "private" | "sheriff";
  label: string;
}> = [
  { value: "licensed_nv", label: "Licensed (NV PILB)" },
  { value: "registered", label: "Registered (out-of-state)" },
  { value: "private", label: "Private process server" },
  { value: "sheriff", label: "Sheriff / constable" },
];

function EditServerModal({
  server,
  onClose,
}: {
  server: AdminServerRow;
  onClose: () => void;
}) {
  const update = useAdminUpdateServer();
  const { toast } = useToast();
  const [name, setName] = useState(server.name);
  const [phone, setPhone] = useState(server.phone ?? "");
  const [licenseNumber, setLicenseNumber] = useState(server.licenseNumber ?? "");
  const [licenseState, setLicenseState] = useState(server.licenseState ?? "");
  const [licenseCounty, setLicenseCounty] = useState(server.licenseCounty ?? "");
  const [licenseExpiry, setLicenseExpiry] = useState(server.licenseExpiry ?? "");
  const [isLicensedNvServer, setIsLicensedNvServer] = useState(
    server.isLicensedNvServer,
  );
  const [serverType, setServerType] = useState<string>(server.serverType ?? "");
  const [businessAddress, setBusinessAddress] = useState(
    server.businessAddress ?? "",
  );
  const [serviceArea, setServiceArea] = useState(server.serviceArea ?? "");

  const today = new Date().toISOString().slice(0, 10);
  const stateValid =
    licenseState.trim() === "" || US_STATE_RX.test(licenseState.trim());
  const expiryValid =
    licenseExpiry === "" ||
    (licenseExpiry.length === 10 && new Date(licenseExpiry) > new Date(today));
  const canSave =
    name.trim().length > 0 && stateValid && expiryValid && !update.isPending;

  function diff(): AdminServerProfilePatch {
    const norm = (s: string) => (s.trim() === "" ? null : s.trim());
    const out: AdminServerProfilePatch = {};
    if (name.trim() !== server.name) out.name = name.trim();
    if (norm(phone) !== (server.phone ?? null)) out.phone = norm(phone);
    if (norm(licenseNumber) !== (server.licenseNumber ?? null))
      out.licenseNumber = norm(licenseNumber);
    if ((norm(licenseState)?.toUpperCase() ?? null) !== (server.licenseState ?? null))
      out.licenseState = norm(licenseState)?.toUpperCase() ?? null;
    if (norm(licenseCounty) !== (server.licenseCounty ?? null))
      out.licenseCounty = norm(licenseCounty);
    if ((licenseExpiry || null) !== (server.licenseExpiry ?? null))
      out.licenseExpiry = licenseExpiry || null;
    if (isLicensedNvServer !== server.isLicensedNvServer)
      out.isLicensedNvServer = isLicensedNvServer;
    if ((serverType || null) !== (server.serverType ?? null))
      out.serverType = (serverType || null) as AdminServerProfilePatch["serverType"];
    if (norm(businessAddress) !== (server.businessAddress ?? null))
      out.businessAddress = norm(businessAddress);
    if (norm(serviceArea) !== (server.serviceArea ?? null))
      out.serviceArea = norm(serviceArea);
    return out;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const patch = diff();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      const result = await update.mutateAsync({
        serverId: server.id,
        patch,
      });
      toast({
        title: "Server updated",
        description:
          result.changed.length > 0
            ? `Changed: ${result.changed.join(", ")}`
            : "No changes",
      });
      onClose();
    } catch (err: any) {
      toast({
        title: "Couldn't save",
        description:
          err?.responseJson?.error ?? err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="modal-edit-server"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-8"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Edit server</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {server.email} · ID #{server.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 p-1"
            data-testid="button-close-edit-server"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
            Email and Stripe payout state aren't editable here — those have
            their own admin actions.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name *">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                data-testid="input-edit-name"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-edit-phone"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="License #">
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                data-testid="input-edit-license-number"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="State (2-letter)">
              <input
                type="text"
                maxLength={2}
                value={licenseState}
                onChange={(e) => setLicenseState(e.target.value.toUpperCase())}
                data-testid="input-edit-license-state"
                className={`w-full border rounded-md px-3 py-1.5 text-sm ${
                  stateValid ? "border-gray-300" : "border-red-400"
                }`}
              />
              {!stateValid && (
                <p className="text-[11px] text-red-600 mt-1">
                  Must be a 2-letter postal code
                </p>
              )}
            </Field>
            <Field label="Expiry (future)">
              <input
                type="date"
                min={today}
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
                data-testid="input-edit-license-expiry"
                className={`w-full border rounded-md px-3 py-1.5 text-sm ${
                  expiryValid ? "border-gray-300" : "border-red-400"
                }`}
              />
              {!expiryValid && (
                <p className="text-[11px] text-red-600 mt-1">
                  Must be a future date
                </p>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="License county">
              <input
                type="text"
                value={licenseCounty}
                onChange={(e) => setLicenseCounty(e.target.value)}
                data-testid="input-edit-license-county"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
              />
            </Field>
            <Field label="Server type">
              <select
                value={serverType}
                onChange={(e) => setServerType(e.target.value)}
                data-testid="select-edit-server-type"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
              >
                <option value="">— Not set —</option>
                {SERVER_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Business address">
            <input
              type="text"
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              data-testid="input-edit-business-address"
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
          </Field>

          <Field label="Service area">
            <input
              type="text"
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="e.g. Clark County, NV"
              data-testid="input-edit-service-area"
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={isLicensedNvServer}
              onChange={(e) => setIsLicensedNvServer(e.target.checked)}
              data-testid="checkbox-edit-licensed-nv"
              className="rounded border-gray-300"
            />
            <span>
              <span className="font-semibold">NV PILB licensed</span> — can
              accept subpoena and civil-litigation jobs
            </span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-md"
            data-testid="button-cancel-edit-server"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            data-testid="button-save-edit-server"
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-sm rounded-md"
          >
            {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
