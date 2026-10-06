/**
 * Hand-rolled admin API hooks. The admin namespace is intentionally
 * NOT in the OpenAPI spec — it's gated by ADMIN_USER_IDS env allowlist
 * and returns 404 to non-admins, so we don't want to advertise it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Try to surface the API's `error` field cleanly so toasts read like
    // sentences instead of `404 : {"error":"..."}`. Falls back to the raw
    // body for non-JSON responses (HTML 502s from a proxy, etc).
    let message = text;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (typeof parsed?.error === "string" && parsed.error.length > 0) {
          message = parsed.error;
        }
      } catch {
        /* not JSON — keep raw text */
      }
    }
    throw new Error(message || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------- Types ----------

export interface AdminOverview {
  usersByRole: { role: string; count: number }[];
  jobsByStatus: { status: string; count: number }[];
  revenue: { grossCents: number; platformFeeCents: number };
  payouts: { status: string; totalCents: number }[];
  activeSubscriptions: number;
}

export interface AdminJobRow {
  id: number;
  status: string;
  documentType: string;
  recipientName: string;
  recipientCity: string;
  recipientState: string;
  caseNumber: string | null;
  requesterUserId: string | null;
  serverId: number | null;
  grossCents: number;
  serviceType: string;
  createdAt: string;
  servedAt: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  /** Billing tier of the requester at the time the row is read (e.g.
   *  "public", "solo", "firm", "firm_pro"). Always populated for rows
   *  that have a requesterUserId. Reflects the *current* plan, not the
   *  plan at job creation — the per-job cents already snapshot the
   *  rate they were charged. */
  requesterPlan: string | null;
  serverName: string | null;
  proofPdfUrl: string | null;
}

export interface AdminUserDetailSubscription {
  id: number;
  tier: string;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  stripePriceId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail {
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    role: string | null;
    plan: string;
    createdAt: string;
  };
  subscription: AdminUserDetailSubscription | null;
  jobsCount: number;
}

export type AdminServerStatus = "pending" | "active" | "suspended" | "inactive";

export type AdminInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

export interface AdminInvitationInfo {
  id: string;
  status: AdminInvitationStatus;
  /** ISO timestamp of when the invitation was created. */
  createdAt: string;
  /** ISO timestamp of last update (e.g. when revoked/accepted). */
  updatedAt: string;
  /**
   * ISO timestamp of when the invite link expires. May be null if the
   * Clerk plan doesn't surface an expiry on the API response.
   */
  expiresAt: string | null;
}

export interface AdminServerRow {
  id: number;
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  serverTier: string;
  serviceArea: string | null;
  active: boolean;
  status: AdminServerStatus;
  licenseNumber: string | null;
  licenseState: string | null;
  licenseExpiry: string | null;
  isLicensedNvServer: boolean;
  licenseCounty: string | null;
  serverType: "licensed_nv" | "registered" | "private" | "sheriff" | null;
  businessAddress: string | null;
  jobsCompleted: number;
  payoutsEnabled: boolean;
  stripeAccountId: string | null;
  verifiedAt: string | null;
  createdAt: string;
  /**
   * Soft-delete marker. When set, the server's login has been wiped
   * (Clerk + credentials + users row) but the roster row + all FK-attached
   * history (service attempts, payouts, jobs, location pings, release
   * events) is preserved for audit/legal traceback.
   */
  deletedAt: string | null;
  deletedReason: string | null;
  credentialStatus: string | null;
  credentialFailureReason: string | null;
  /**
   * Live Clerk invitation state for unlinked rows (`userId === null`).
   * `null` means we have no invitation on file (or Clerk lookup failed).
   */
  invitation: AdminInvitationInfo | null;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  plan: string;
  createdAt: string;
  // Populated only for users with role='server' via a left-join on the
  // `servers` roster. Lets the user-search page surface lifecycle + license
  // expiry inline so admins don't have to context-switch to /admin/servers.
  serverId: number | null;
  serverStatus: AdminServerStatus | null;
  serverLicenseExpiry: string | null;
}

export type AdminAuditAction =
  | "server.create"
  | "server.invite"
  | "server.resend_invite"
  | "server.revoke_invite"
  | "server.status_change"
  | "server.verify"
  | "server.fail"
  | "server.delete_account"
  | "server.recover_stuck_account"
  | "server.edit_profile"
  | "job.assign"
  | "job.cancel"
  | "user.email"
  | "payout.retry"
  | "payout.dismiss"
  | "maintenance.purge_test_data";

export interface AdminAuditRow {
  id: number;
  actorUserId: string;
  action: AdminAuditAction;
  targetServerId: number | null;
  targetUserId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  targetUserName: string | null;
  targetServerName: string | null;
}

export interface AdminAuditFilters {
  actors: { id: string; name: string; email: string | null }[];
  servers: { id: number; name: string; email: string }[];
  actions: readonly AdminAuditAction[];
}

// ---------- Queries ----------

export function useAdminOverview(opts: { enabled?: boolean } = {}) {
  return useQuery<AdminOverview>({
    queryKey: ["admin", "overview"],
    queryFn: () => fetchJson<AdminOverview>("/admin/overview"),
    enabled: opts.enabled ?? true,
    staleTime: 30 * 1000,
  });
}

export function useAdminJobs(
  params: { status?: string; limit?: number; offset?: number } = {},
  opts: { enabled?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery<{ items: AdminJobRow[]; limit: number; offset: number }>({
    queryKey: ["admin", "jobs", params],
    queryFn: () =>
      fetchJson<{ items: AdminJobRow[]; limit: number; offset: number }>(
        `/admin/jobs${suffix}`,
      ),
    enabled: opts.enabled ?? true,
  });
}

export function useAdminUserDetail(
  userId: string | null,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<AdminUserDetail>({
    queryKey: ["admin", "user-detail", userId],
    queryFn: () =>
      fetchJson<AdminUserDetail>(
        `/admin/users/${encodeURIComponent(userId ?? "")}`,
      ),
    enabled: (opts.enabled ?? true) && !!userId,
    staleTime: 30 * 1000,
  });
}

export function useAdminServers(
  opts: { enabled?: boolean; state?: string | null } = {},
) {
  const state = opts.state?.trim().toUpperCase() || null;
  return useQuery<{ items: AdminServerRow[] }>({
    queryKey: ["admin", "servers", state ?? "all"],
    queryFn: () =>
      fetchJson<{ items: AdminServerRow[] }>(
        state ? `/admin/servers?state=${encodeURIComponent(state)}` : "/admin/servers",
      ),
    enabled: opts.enabled ?? true,
  });
}

export interface AdminServerEarnings {
  paidCents: number;
  inTransitCents: number;
  pendingCents: number;
  failedCents: number;
  lifetimeCents: number;
  payoutCount: number;
}

export interface AdminServerCredential {
  id: number;
  userId: string;
  status: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  [key: string]: unknown;
}

export interface AdminServerDetail {
  server: AdminServerRow & { photoUrl: string | null };
  credential: AdminServerCredential | null;
  earnings: AdminServerEarnings;
  invitation: AdminInvitationInfo | null;
}

export function useAdminServerDetail(
  serverId: number | null,
  opts: { enabled?: boolean } = {},
) {
  return useQuery<AdminServerDetail>({
    queryKey: ["admin", "server", serverId],
    queryFn: () => fetchJson<AdminServerDetail>(`/admin/server/${serverId}`),
    enabled: (opts.enabled ?? true) && serverId != null,
  });
}

export type AdminUserRoleFilter = "requester" | "attorney" | "server";

export function useAdminAudit(
  params: {
    actor?: string;
    serverId?: number;
    action?: AdminAuditAction;
    targetUserId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {},
  opts: { enabled?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (params.actor) qs.set("actor", params.actor);
  if (params.serverId) qs.set("serverId", String(params.serverId));
  if (params.action) qs.set("action", params.action);
  if (params.targetUserId) qs.set("targetUserId", params.targetUserId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery<{
    items: AdminAuditRow[];
    limit: number;
    offset: number;
    actions: AdminAuditAction[];
  }>({
    queryKey: ["admin", "audit", params],
    queryFn: () =>
      fetchJson<{
        items: AdminAuditRow[];
        limit: number;
        offset: number;
        actions: AdminAuditAction[];
      }>(`/admin/audit${suffix}`),
    enabled: opts.enabled ?? true,
  });
}

export function useAdminAuditFilters(opts: { enabled?: boolean } = {}) {
  return useQuery<AdminAuditFilters>({
    queryKey: ["admin", "audit", "filters"],
    queryFn: () => fetchJson<AdminAuditFilters>("/admin/audit/filters"),
    enabled: opts.enabled ?? true,
    staleTime: 60 * 1000,
  });
}

export function useAdminUsers(
  params: {
    search?: string;
    role?: AdminUserRoleFilter;
    expiringWithinDays?: number;
    limit?: number;
    offset?: number;
  } = {},
  opts: { enabled?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.role) qs.set("role", params.role);
  if (typeof params.expiringWithinDays === "number")
    qs.set("expiringWithinDays", String(params.expiringWithinDays));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery<{ items: AdminUserRow[]; limit: number; offset: number }>({
    queryKey: ["admin", "users", params],
    queryFn: () =>
      fetchJson<{ items: AdminUserRow[]; limit: number; offset: number }>(
        `/admin/users${suffix}`,
      ),
    enabled: opts.enabled ?? true,
  });
}

// ---------- Mutations ----------

export function useAdminAssignJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { jobId: number; serverId: number }) =>
      fetchJson<{ job: unknown }>(`/admin/jobs/${vars.jobId}/assign`, {
        method: "POST",
        body: JSON.stringify({ serverId: vars.serverId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export interface AdminEmailUserResult {
  to: string;
  from: string;
  delivered: boolean;
  hadCredential: boolean;
  status: number | null;
  detail: string | null;
  sentAt: string;
}

/**
 * Send a one-off email to a user from the admin Users drawer. The server
 * resolves the recipient from the user's row — we only pass subject + body.
 */
export function useAdminEmailUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; subject: string; body: string }) =>
      fetchJson<AdminEmailUserResult>(
        `/admin/users/${vars.userId}/email`,
        {
          method: "POST",
          body: JSON.stringify({ subject: vars.subject, body: vars.body }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export interface AdminFailedPayoutRow {
  id: number;
  jobId: number;
  serverId: number | null;
  userId: string;
  amountCents: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  serverName: string | null;
  serverEmail: string | null;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
}

export function useAdminFailedPayouts(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["admin", "payouts", "failed"],
    queryFn: () =>
      fetchJson<{ payouts: AdminFailedPayoutRow[] }>("/admin/payouts/failed"),
    enabled: opts.enabled ?? true,
  });
}

export function useAdminRetryPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payoutId: number) =>
      fetchJson<{
        ok: boolean;
        payout: {
          id: number;
          status: string;
          stripeTransferId: string | null;
          failureReason: string | null;
          amountCents: number;
        } | null;
      }>(`/admin/payouts/${payoutId}/retry`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payouts"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminDismissFailedPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payoutId: number) =>
      fetchJson<{
        ok: boolean;
        payoutId: number;
        jobId: number;
        jobCancelled: boolean;
      }>(`/admin/payouts/${payoutId}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "payouts"] });
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) =>
      fetchJson<{ job: unknown }>(`/admin/jobs/${jobId}/cancel`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

/**
 * Force-regenerate the affidavit PDF for a served job. Useful when the
 * original generation failed (transient storage error) or when legal
 * template strings change. Server-side requires the job to be `served`
 * and have a captured signature typed name.
 */
export function useAdminRegenerateAffidavit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: number) =>
      fetchJson<{ jobId: number; proofPdfUrl: string }>(
        `/admin/jobs/${jobId}/regenerate-affidavit`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
  });
}

export function useAdminCreateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      userEmail: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      serviceArea?: string;
      licenseNumber: string;
      licenseState: string;
      licenseExpiry: string;
      /** Optional NV PILB licensed-server attestation (work-card holder). */
      isLicensedNvServer?: boolean;
      /** Optional NV-license issuing county (e.g. "Clark"). */
      licenseCounty?: string;
      /** Optional per-server business address printed on affidavits. */
      businessAddress?: string;
      /**
       * If true (default), the server is created as `active` with verified
       * credentials so they can take work immediately. Set false to leave
       * them in `pending` until Certn / manual review clears them.
       */
      markVerified?: boolean;
    }) =>
      fetchJson<{
        server: unknown;
        credential: unknown;
        invited?: boolean;
        preVerified?: boolean;
      }>("/admin/servers", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export interface AdminServerProfilePatch {
  name?: string;
  phone?: string | null;
  licenseNumber?: string | null;
  licenseState?: string | null;
  licenseExpiry?: string | null;
  licenseCounty?: string | null;
  isLicensedNvServer?: boolean;
  serverType?: "licensed_nv" | "registered" | "private" | "sheriff" | null;
  businessAddress?: string | null;
  serviceArea?: string | null;
}

export function useAdminUpdateServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: number; patch: AdminServerProfilePatch }) =>
      fetchJson<{ server: AdminServerRow; changed: string[] }>(
        `/admin/server/${vars.serverId}/profile`,
        {
          method: "PATCH",
          body: JSON.stringify(vars.patch),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminSetServerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: number; status: AdminServerStatus }) =>
      fetchJson<{ server: unknown }>(
        `/admin/server/${vars.serverId}/status`,
        {
          method: "POST",
          body: JSON.stringify({ status: vars.status }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminVerifyServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: number) =>
      fetchJson(`/admin/server/${serverId}/verify`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: number) =>
      fetchJson<{ ok: true; invitationId: string | null }>(
        `/admin/server/${serverId}/resend-invite`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: number) =>
      fetchJson<{ ok: true; revokedCount: number }>(
        `/admin/server/${serverId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export interface AdminMailerTestResult {
  to: string;
  subject: string;
  from: string;
  delivered: boolean;
  hadCredential: boolean;
  status: number | null;
  detail: string | null;
  sentAt: string;
}

/**
 * Trigger the admin "send test email" smoke test. Calls the same
 * `sendEmail` code path the rest of the app uses, so a successful
 * response means SendGrid is wired correctly end-to-end.
 *
 * `to` is optional; the server defaults to the calling admin's email
 * on file so the safest default is "send it to me".
 */
export function useAdminSendTestEmail() {
  return useMutation<
    AdminMailerTestResult,
    Error,
    { to?: string; subject?: string; body?: string }
  >({
    mutationFn: (vars) =>
      fetchJson<AdminMailerTestResult>("/admin/mailer/test", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
  });
}

/**
 * Hard-delete a server's entire account (Clerk user + DB rows). Distinct
 * from `useAdminSetServerStatus({ status: "inactive" })`, which is a soft
 * delete that's reactivatable. Use this when the email needs to be
 * re-onboarded from scratch (e.g. wiping a test account).
 */
export function useAdminDeleteServerAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: number) =>
      fetchJson<{
        ok: true;
        clerkDeleted: boolean;
        revokedInvites: number;
        clerkError: string | null;
      }>(`/admin/server/${serverId}/account`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/**
 * One-click recovery for an invitee who already has a Clerk account
 * with the wrong role saved (e.g. they previously signed up as an
 * Individual). Looks up the Clerk user by the pending server row's
 * email, flips `users.role` to "server", stamps Clerk publicMetadata,
 * and links the pending row to their userId. Returns 404 if no Clerk
 * user has signed up under that email yet (in which case Resend invite
 * is the right move).
 */
export function useAdminRecoverStuckAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: number) =>
      fetchJson<{
        ok: true;
        userId: string;
        email: string;
        previousRole: string | null;
      }>(`/admin/server/${serverId}/recover-stuck-account`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminFailServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { serverId: number; reason?: string }) =>
      fetchJson(`/admin/server/${vars.serverId}/fail`, {
        method: "POST",
        body: JSON.stringify({ reason: vars.reason ?? "" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "servers"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export interface AdminPurgeResult {
  ok: true;
  counts: {
    documents: number;
    uploadReservations: number;
    payments: number;
    payouts: number;
    licenseExpiryNotifications: number;
    jobs: number;
    servers: number;
    clients: number;
  };
}

/**
 * Wipe demo / pre-launch data from the operational tables (jobs, servers,
 * clients and FK children). Intended as a one-shot factory reset right
 * after launch. Server requires `{ confirmation: "PURGE" }` in the body.
 */
export function useAdminPurgeTestData() {
  const qc = useQueryClient();
  return useMutation<AdminPurgeResult, Error, void>({
    mutationFn: () =>
      fetchJson<AdminPurgeResult>("/admin/maintenance/purge-test-data", {
        method: "POST",
        body: JSON.stringify({ confirmation: "PURGE" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}
