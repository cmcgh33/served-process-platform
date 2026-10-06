import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  X,
  CreditCard,
  User as UserIcon,
  Calendar,
  Loader2,
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import {
  useAdminUserDetail,
  useAdminEmailUser,
  useAdminAudit,
} from "@/lib/admin";
import {
  USER_EMAIL_TEMPLATES,
  fillTemplate,
} from "./userEmailTemplates";

const SUB_STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  trialing: "bg-sky-100 text-sky-700",
  past_due: "bg-amber-100 text-amber-800",
  canceled: "bg-gray-200 text-gray-700",
  incomplete: "bg-gray-100 text-gray-600",
  incomplete_expired: "bg-gray-100 text-gray-600",
  unpaid: "bg-red-100 text-red-700",
};

function fmt(d: string | null | undefined, withTime = false): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return format(dt, withTime ? "MMM d, yyyy 'at' h:mm a" : "MMM d, yyyy");
}

/**
 * Compose + send a one-off email to this user. Templates prefill the
 * subject/body (editable before sending); the recipient is always the
 * selected user's address on file, resolved server-side.
 */
function EmailComposer({
  userId,
  email,
  firstName,
}: {
  userId: string;
  email: string | null;
  firstName: string | null;
}) {
  const [templateId, setTemplateId] = useState<string>(
    USER_EMAIL_TEMPLATES[0]?.id ?? "blank",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const send = useAdminEmailUser();
  const history = useAdminAudit(
    { targetUserId: userId, action: "user.email", limit: 50 },
    { enabled: !!email },
  );

  // Apply the initially-selected template once the composer mounts so the
  // fields aren't blank on first open.
  useEffect(() => {
    const t = USER_EMAIL_TEMPLATES.find((x) => x.id === templateId);
    if (t) {
      setSubject(fillTemplate(t.subject, firstName));
      setBody(fillTemplate(t.body, firstName));
    }
    // Only run on mount; later changes go through the select handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = USER_EMAIL_TEMPLATES.find((x) => x.id === id);
    if (t) {
      setSubject(fillTemplate(t.subject, firstName));
      setBody(fillTemplate(t.body, firstName));
    }
    send.reset();
  };

  const canSend =
    !!email && subject.trim().length > 0 && body.trim().length > 0;

  const result = send.data;

  return (
    <section className="border-t border-gray-100 pt-5 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Mail className="w-4 h-4 text-amber-500" />
        Send an email
      </h3>

      {!email ? (
        <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-3">
          This user has no email address on file, so a message can't be sent.
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Sends to <span className="font-medium text-gray-700">{email}</span>.
            Pick a template, edit anything you like, then send.
          </p>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Template
            </label>
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              data-testid="select-email-template"
            >
              {USER_EMAIL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Subject
            </label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="input-email-subject"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Message
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Write your message…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-sans leading-relaxed resize-y"
              data-testid="textarea-email-body"
            />
          </div>

          {result && result.delivered && (
            <div
              className="flex items-start gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2"
              data-testid="status-email-sent"
            >
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Sent to {result.to}.</span>
            </div>
          )}
          {result && !result.delivered && (
            <div
              className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"
              data-testid="status-email-failed"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {result.hadCredential
                  ? `The email service rejected the message${result.detail ? `: ${result.detail}` : "."}`
                  : "Email isn't fully configured yet, so nothing was sent. Contact support to finish email setup."}
              </span>
            </div>
          )}
          {send.isError && (
            <div
              className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2"
              data-testid="status-email-error"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{(send.error as Error).message}</span>
            </div>
          )}

          <button
            type="button"
            disabled={!canSend || send.isPending}
            onClick={() =>
              send.mutate({ userId, subject: subject.trim(), body })
            }
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-sm rounded-lg"
            data-testid="button-send-email"
          >
            {send.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> Send email
              </>
            )}
          </button>

          <div className="border-t border-gray-100 pt-4 mt-1">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-2">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              Emails sent to this user
            </h4>
            {history.isLoading ? (
              <div className="text-xs text-gray-400">Loading history…</div>
            ) : !history.data || history.data.items.length === 0 ? (
              <div className="text-xs text-gray-400" data-testid="email-history-empty">
                No emails sent yet.
              </div>
            ) : (
              <ul className="space-y-2" data-testid="email-history-list">
                {history.data.items.map((row) => {
                  const subj =
                    typeof row.details?.subject === "string"
                      ? row.details.subject
                      : "(no subject)";
                  return (
                    <li
                      key={row.id}
                      className="text-xs border border-gray-100 rounded-lg px-3 py-2 bg-gray-50"
                    >
                      <div className="font-medium text-gray-800 truncate">
                        {subj}
                      </div>
                      <div className="text-gray-500 mt-0.5">
                        {fmt(row.createdAt, true)}
                        {row.actorName ? ` · by ${row.actorName}` : ""}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Right-side drawer that opens when an admin clicks a user row. Surfaces
 * the user's profile + their subscription posture (tier, status, current
 * period end, Stripe IDs for ops cross-reference) and a job-activity
 * counter. Read-only; mutation surfaces (cancel sub, change plan) live
 * in Stripe today.
 */
export function UserDetailDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useAdminUserDetail(userId);

  if (!userId) return null;

  const u = data?.user;
  const sub = data?.subscription ?? null;
  const fullName =
    u && [u.firstName, u.lastName].filter(Boolean).join(" ").trim();

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      data-testid="drawer-user-detail-backdrop"
    >
      <aside
        className="w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="drawer-user-detail"
      >
        <header className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-amber-500" />
              User detail
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate font-mono">
              {userId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 -mr-1"
            aria-label="Close"
            data-testid="button-close-user-detail"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {isLoading && (
          <div className="p-8 flex items-center justify-center text-sm text-gray-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {error && !isLoading && (
          <div className="p-6 text-sm text-red-700 bg-red-50 m-4 rounded-lg">
            Couldn't load this user. {(error as Error).message}
          </div>
        )}

        {!isLoading && data && u && (
          <div className="p-5 space-y-6">
            <section className="space-y-2">
              <div className="text-lg font-semibold text-gray-900">
                {fullName || u.email || "—"}
              </div>
              {u.email && (
                <div className="text-sm text-gray-600">{u.email}</div>
              )}
              <div className="flex items-center gap-2 pt-1">
                {u.role && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 capitalize">
                    {u.role}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  Joined {fmt(u.createdAt)}
                </span>
              </div>
            </section>

            <section className="border-t border-gray-100 pt-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-500" />
                Subscription
              </h3>

              {sub ? (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Tier</dt>
                    <dd
                      className="font-medium text-gray-900 capitalize"
                      data-testid="text-sub-tier"
                    >
                      {sub.tier.replace(/_/g, " ")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Status</dt>
                    <dd>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${SUB_STATUS_BADGE[sub.status] ?? "bg-gray-100 text-gray-600"}`}
                        data-testid="badge-sub-status"
                      >
                        {sub.status.replace(/_/g, " ")}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Started
                    </dt>
                    <dd className="text-gray-800">{fmt(sub.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Renews / ends
                    </dt>
                    <dd
                      className="text-gray-800"
                      data-testid="text-sub-period-end"
                    >
                      {fmt(sub.currentPeriodEnd)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-500">Last updated</dt>
                    <dd className="text-gray-800">{fmt(sub.updatedAt, true)}</dd>
                  </div>
                  {sub.stripeCustomerId && (
                    <div className="col-span-2">
                      <dt className="text-xs text-gray-500">Stripe customer</dt>
                      <dd className="font-mono text-xs text-gray-700 break-all select-all">
                        {sub.stripeCustomerId}
                      </dd>
                    </div>
                  )}
                  {sub.stripeSubscriptionId && (
                    <div className="col-span-2">
                      <dt className="text-xs text-gray-500">Stripe subscription</dt>
                      <dd className="font-mono text-xs text-gray-700 break-all select-all">
                        {sub.stripeSubscriptionId}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-3">
                  No subscription on file. Plan column shows{" "}
                  <span className="font-semibold capitalize">{u.plan}</span>{" "}
                  (pay-as-you-go).
                </div>
              )}
            </section>

            <section className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Activity
              </h3>
              <div className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900" data-testid="text-jobs-count">
                  {data.jobsCount}
                </span>{" "}
                {data.jobsCount === 1 ? "job" : "jobs"} placed
              </div>
            </section>

            <EmailComposer
              userId={u.id}
              email={u.email}
              firstName={u.firstName}
            />
          </div>
        )}
      </aside>
    </div>
  );
}
