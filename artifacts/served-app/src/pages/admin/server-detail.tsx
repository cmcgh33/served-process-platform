import { Link, useRoute } from "wouter";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  BadgeCheck,
  Briefcase,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import { formatCentsUsd } from "@workspace/pricing";
import { useAdminServerDetail } from "@/lib/admin";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  suspended: "bg-red-100 text-red-700",
  inactive: "bg-gray-200 text-gray-600",
};

const SERVER_TYPE_LABEL: Record<string, string> = {
  licensed_nv: "Licensed (Nevada)",
  registered: "Registered",
  private: "Private",
  sheriff: "Sheriff",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
        {label}
      </div>
      <div className="text-sm text-gray-900 mt-0.5">{children}</div>
    </div>
  );
}

export default function AdminServerDetailPage() {
  const [, params] = useRoute("/app/admin/servers/:id");
  const serverId = params?.id ? Number(params.id) : null;
  const { data, isLoading, isError, error } = useAdminServerDetail(serverId);

  return (
    <div className="space-y-6">
      <Link
        href="/app/admin/servers"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        data-testid="link-back-to-roster"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to servers
      </Link>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
      ) : isError || !data ? (
        <div className="p-12 text-center">
          <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <div className="text-sm font-medium text-gray-700">
            Couldn't load this server
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {error instanceof Error ? error.message : "Please try again."}
          </div>
        </div>
      ) : (
        <ServerDetailBody data={data} />
      )}
    </div>
  );
}

function ServerDetailBody({
  data,
}: {
  data: NonNullable<ReturnType<typeof useAdminServerDetail>["data"]>;
}) {
  const { server, credential, earnings } = data;
  const isDeleted = !!server.deletedAt;

  return (
    <>
      {/* Header card: photo + name + status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-start gap-5">
        <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          {server.photoUrl ? (
            <img
              src={resolveStorageObjectUrl(server.photoUrl)}
              alt={server.name}
              className="w-full h-full object-cover"
              data-testid="img-server-photo"
            />
          ) : (
            <span className="text-3xl font-bold text-gray-300">
              {(server.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1
              className="text-2xl font-bold text-gray-900"
              data-testid="text-server-name"
            >
              {server.name}
            </h1>
            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                STATUS_STYLE[server.status] ?? "bg-gray-100 text-gray-600"
              }`}
              data-testid="badge-server-status"
            >
              {server.status}
            </span>
            {isDeleted && (
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                Deleted
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-gray-400" />
              <span className="truncate">{server.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-400" />
              <span>{server.phone ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span>{server.serviceArea ?? "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span>Joined {formatDate(server.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Earnings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
            Earnings
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-2xl font-bold text-gray-900" data-testid="text-earnings-lifetime">
              {formatCentsUsd(earnings.lifetimeCents)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Lifetime (paid + on the way)
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-600" data-testid="text-earnings-paid">
              {formatCentsUsd(earnings.paidCents)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Paid out</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-600">
              {formatCentsUsd(earnings.inTransitCents + earnings.pendingCents)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">On the way</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {earnings.payoutCount}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Total payouts</div>
          </div>
        </div>
        {earnings.failedCents > 0 && (
          <div className="mt-3 text-xs text-red-600">
            {formatCentsUsd(earnings.failedCents)} in failed payouts needs
            attention.
          </div>
        )}
      </div>

      {/* License + credentials */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              License & classification
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Server type">
              {server.serverType
                ? SERVER_TYPE_LABEL[server.serverType] ?? server.serverType
                : "—"}
            </Field>
            <Field label="License number">
              {server.licenseNumber ?? "—"}
            </Field>
            <Field label="License state">
              {server.licenseState ?? "—"}
            </Field>
            <Field label="License county">
              {server.licenseCounty ?? "—"}
            </Field>
            <Field label="License expiry">
              {formatDate(server.licenseExpiry)}
            </Field>
            <Field label="Business address">
              {server.businessAddress ?? "—"}
            </Field>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Credentials & payouts
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Background check">
              {credential?.status ?? "none"}
            </Field>
            <Field label="Verified on">
              {formatDate(server.verifiedAt)}
            </Field>
            <Field label="Payouts enabled">
              {server.payoutsEnabled ? "Yes" : "No"}
            </Field>
            <Field label="Stripe account">
              {server.stripeAccountId ? "Connected" : "Not connected"}
            </Field>
          </div>
          {credential?.failureReason && (
            <div className="text-xs text-red-600">
              Background check note: {credential.failureReason}
            </div>
          )}
        </div>
      </div>

      {/* Jobs */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
            Jobs
          </h2>
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {server.jobsCompleted}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">Jobs completed</div>
      </div>
    </>
  );
}
