import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Lock,
  FileText,
  Trash2,
} from "lucide-react";
import {
  useGetMyCredentialing,
  useCreateCredentialingCheckout,
  useGetMyServerProfile,
  useUpdateMyServerProfile,
  getGetMyServerProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatCentsUsd, SERVER_CREDENTIALING_CENTS } from "@workspace/pricing";
import { redirectTopLevel } from "@/lib/external-redirect";
import { uploadProfilePhoto } from "@/lib/uploadProfilePhoto";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";

export default function ServerCredentialing() {
  const [location] = useLocation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const paid = params.get("paid");

  const { data: cred, isLoading, refetch } = useGetMyCredentialing();
  const checkout = useCreateCredentialingCheckout();
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After returning from Stripe with ?paid=1, poll a couple times so the
  // webhook-driven status flip becomes visible.
  useEffect(() => {
    if (paid !== "1") return;
    let count = 0;
    const t = setInterval(() => {
      count += 1;
      refetch();
      if (count >= 5) clearInterval(t);
    }, 1500);
    return () => clearInterval(t);
  }, [paid, refetch]);

  const status = cred?.status ?? null;
  const isVerified = status === "verified";
  const isPending = status === "pending";
  const isFailed = status === "failed";
  const isPaidWaiting = paid === "1" && !isVerified && !isFailed;

  async function handlePay() {
    setError(null);
    if (!consent) {
      setError("Please confirm the FCRA consent box to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await checkout.mutateAsync();
      if (res?.url) {
        redirectTopLevel(res.url);
      } else {
        setError("Could not start checkout. Please try again.");
        setSubmitting(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold mb-2"
          style={{
            backgroundColor: "rgba(34,197,94,0.1)",
            color: "#15803d",
            border: "1px solid rgba(34,197,94,0.3)",
          }}
        >
          <ShieldCheck className="w-3 h-3" />
          SERVER CREDENTIALING
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Get verified to start serving</h1>
        <p className="text-sm text-gray-500 mt-1">
          A one-time $24.99 background check unlocks the job feed. Required by Nevada law and SERVED.&apos;s
          insurance carrier.
        </p>
      </div>

      {/* Status banner */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-3 text-gray-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading credentialing status…
        </div>
      ) : isVerified ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-emerald-900 text-sm">You&apos;re verified</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Your background check passed{cred?.verifiedAt ? ` on ${new Date(cred.verifiedAt).toLocaleDateString()}` : ""}. You can accept jobs from the feed.
            </p>
          </div>
          <Link
            href="/app/server/job-feed"
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors"
          >
            Go to Job Feed <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : isPending || isPaidWaiting ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-amber-900 text-sm">Background check in progress</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Payment received. Most reports complete within 24 hours. We&apos;ll email you the moment
              you&apos;re cleared.
            </p>
          </div>
        </div>
      ) : isFailed ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900 text-sm">Background check did not pass</p>
            <p className="text-xs text-red-700 mt-0.5">
              {cred?.failureReason ??
                "Please contact support@servedlegal.com to discuss next steps. Your $24.99 fee is non-refundable per Nevada PILB requirements."}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 flex items-start gap-3">
          <Lock className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-gray-900 text-sm">Not yet credentialed</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Complete the one-time $24.99 background check below to unlock the job feed and start
              earning.
            </p>
          </div>
        </div>
      )}

      {/* What's included */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h2 className="text-sm font-bold text-gray-900 mb-4">What&apos;s included in your $24.99 check</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { label: "Nationwide criminal records search (Certn)", desc: "County, state, and federal databases." },
            { label: "Sex-offender registry check", desc: "DRUVS multi-state registry." },
            { label: "Identity verification", desc: "SSN trace + address history." },
            { label: "Annual re-verification", desc: "Auto re-check every 12 months — fee included Year 1." },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-gray-900">{item.label}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FCRA + consent */}
      {!isVerified && !isPending && !isPaidWaiting && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-start gap-2">
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-gray-900">FCRA Disclosure &amp; Authorization</h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                SERVED. (&ldquo;the Company&rdquo;) may obtain a consumer report and/or
                investigative consumer report about you from Certn Inc., a consumer reporting agency, for
                purposes of evaluating your eligibility to provide process-serving services on the SERVED.
                platform. This report may include information about your character, criminal history,
                identity, and address history.
              </p>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                You have the right to request a copy of any report obtained, to dispute the accuracy of any
                information, and to additional information about Certn&apos;s privacy practices. A summary of
                your rights under the Fair Credit Reporting Act is available at{" "}
                <a
                  href="https://www.consumerfinance.gov/learnmore"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-600 hover:text-amber-700 underline"
                >
                  consumerfinance.gov/learnmore
                </a>
                .
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-amber-500 rounded border-gray-300 focus:ring-amber-400"
              data-testid="checkbox-fcra-consent"
            />
            <span className="text-xs text-gray-700 leading-relaxed">
              I have read the disclosure above and authorize SERVED. to obtain a consumer report about me from
              Certn for the purposes described. I understand the $24.99 fee is non-refundable once my report
              has been ordered.
            </span>
          </label>

          {error ? (
            <div className="text-xs font-semibold text-red-600 px-3 py-2 bg-red-50 rounded-lg">{error}</div>
          ) : null}

          <button
            onClick={handlePay}
            disabled={submitting || !consent}
            data-testid="button-pay-credentialing"
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-amber-400 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-black font-bold text-sm rounded-xl transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Redirecting to Stripe…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" /> Pay {formatCentsUsd(SERVER_CREDENTIALING_CENTS)} &amp; Run My
                Background Check
              </>
            )}
          </button>
          <p className="text-[11px] text-gray-400 text-center">
            Secured by Stripe. SERVED. never sees or stores your card details.
          </p>
        </div>
      )}

      {/* Server profile (Nevada affidavit fields) */}
      <ServerProfilePanel />

      {/* Danger zone — self-serve account deletion. */}
      <DeleteAccountPanel />

      {/* Trust footer */}
      <p className="text-[11px] text-gray-400 text-center">
        SERVED. · Las Vegas, NV · Background checks performed by Certn Inc.
      </p>
    </div>
  );
}

/**
 * Self-edit panel for Nevada-compliant affidavit fields. Sits on the
 * credentialing page because that's where servers go to "set up to take
 * jobs" — the business address + work-card number are both prerequisites
 * for a legally sufficient proof of service.
 *
 * Renders nothing if the caller has no server row yet (e.g. brand-new
 * sign-up that hasn't been provisioned), so the page degrades gracefully.
 */
/**
 * Self-serve "delete my account" card. Hits `DELETE /me/account` which
 * wipes our DB rows and the Clerk user, then we sign the user out so the
 * stale session doesn't linger. Requires the user to type DELETE to
 * prevent accidental clicks.
 */
function DeleteAccountPanel() {
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    const typed = window.prompt(
      "Delete your SERVED. account? This wipes your login so you can no longer sign in. Your server profile and the full record of every job you completed (service attempts, GPS, payouts, affidavits) are PRESERVED for legal recordkeeping — attorneys and the courts may need to reference them years later. This CANNOT be undone.\n\nType DELETE to confirm:",
    );
    if (typed !== "DELETE") return;
    setBusy(true);
    try {
      const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
      const res = await fetch(`${apiBase}/me/account`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      toast.success("Account deleted. Signing you out…");
      // Sign out of Clerk and bounce home. We do this even if the Clerk
      // user delete failed server-side — the session is now backed by a
      // user that no longer has a DB row, so signing out is the right move.
      await clerk.signOut({ redirectUrl: "/" });
    } catch (err) {
      toast.error("Couldn't delete account", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-red-200 p-6 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-red-700 flex items-center gap-1.5">
          <Trash2 className="w-4 h-4" /> Delete account
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Permanently removes your SERVED. account, server profile, and login.
          Past completed jobs stay on file (anonymized) for legal records.
          This cannot be undone.
        </p>
      </div>
      <button
        onClick={handleDelete}
        disabled={busy}
        data-testid="button-delete-my-account"
        className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-bold text-sm rounded-lg transition-colors"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        Delete my account
      </button>
    </div>
  );
}

function ServerProfilePanel() {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useGetMyServerProfile({
    query: {
      queryKey: getGetMyServerProfileQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const update = useUpdateMyServerProfile();

  const [businessAddress, setBusinessAddress] = useState("");
  const [isLicensedNvServer, setIsLicensedNvServer] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseCounty, setLicenseCounty] = useState("");
  const [serverType, setServerType] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // One-shot hydration on first profile load. We deliberately don't sync
  // on every refetch so the user's in-progress edits never get clobbered
  // by a background revalidation.
  useEffect(() => {
    if (!profile || hydrated) return;
    setBusinessAddress(profile.businessAddress ?? "");
    setIsLicensedNvServer(Boolean(profile.isLicensedNvServer));
    setLicenseNumber(profile.licenseNumber ?? "");
    setLicenseCounty(profile.licenseCounty ?? "");
    setServerType(profile.serverType ?? "");
    setPhotoUrl(profile.photoUrl ?? null);
    setHydrated(true);
  }, [profile, hydrated]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 flex items-center gap-3 text-gray-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading server profile…
      </div>
    );
  }
  // 404 = no server row provisioned yet. Stay quiet; the rest of the page
  // is still useful (background-check checkout doesn't depend on this).
  if (!profile) return null;

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        data: {
          businessAddress: businessAddress.trim() || undefined,
          isLicensedNvServer,
          licenseNumber: licenseNumber.trim() || undefined,
          licenseCounty: licenseCounty.trim() || undefined,
          serverType: (serverType.trim() ||
            undefined) as "licensed_nv" | "registered" | "private" | undefined,
        },
      });
      qc.invalidateQueries({ queryKey: getGetMyServerProfileQueryKey() });
      toast.success("Server profile saved");
    } catch (err) {
      toast.error("Couldn't save profile", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  // Photo uploads persist immediately (separate from the Save Profile button)
  // so the headshot is stored the moment it's picked.
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    setUploadingPhoto(true);
    try {
      const objectPath = await uploadProfilePhoto(file);
      await update.mutateAsync({ data: { photoUrl: objectPath } });
      setPhotoUrl(objectPath);
      qc.invalidateQueries({ queryKey: getGetMyServerProfileQueryKey() });
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error("Couldn't upload photo", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    setUploadingPhoto(true);
    try {
      await update.mutateAsync({ data: { photoUrl: null } });
      setPhotoUrl(null);
      qc.invalidateQueries({ queryKey: getGetMyServerProfileQueryKey() });
      toast.success("Profile photo removed");
    } catch (err) {
      toast.error("Couldn't remove photo", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-gray-900">Server Profile</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          These fields are printed on every Nevada affidavit you sign. Keep them current.
        </p>
      </div>

      <div className="flex items-center gap-4 pb-2">
        <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0">
          {photoUrl ? (
            <img
              src={resolveStorageObjectUrl(photoUrl)}
              alt="Server profile"
              className="w-full h-full object-cover"
              data-testid="img-profile-photo"
            />
          ) : (
            <span className="text-2xl font-bold text-gray-300">
              {(profile.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-gray-600">
            Profile Photo
          </label>
          <div className="flex items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                uploadingPhoto
                  ? "bg-gray-100 text-gray-400"
                  : "bg-gray-900 hover:bg-gray-800 text-white"
              }`}
            >
              {uploadingPhoto ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
                </>
              ) : photoUrl ? (
                "Change photo"
              ) : (
                "Upload photo"
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingPhoto}
                onChange={handlePhotoChange}
                data-testid="input-profile-photo"
              />
            </label>
            {photoUrl && !uploadingPhoto && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
                data-testid="button-remove-profile-photo"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            A headshot shown to the SERVED. team in your server profile.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Business Address</label>
          <input
            value={businessAddress}
            onChange={(e) => setBusinessAddress(e.target.value)}
            placeholder="e.g., 123 Main St, Suite 4, Las Vegas, NV 89101"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            data-testid="input-business-address"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Server Classification
          </label>
          <select
            value={serverType}
            onChange={(e) => setServerType(e.target.value)}
            data-testid="select-server-type"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          >
            <option value="">— Select —</option>
            <option value="licensed_nv">Nevada PILB Licensed Process Server</option>
            <option value="registered">Registered Process Server (other state)</option>
            <option value="private">Private Process Server</option>
          </select>
          <p className="text-[10px] text-gray-400 mt-1">
            Printed on the affidavit attestation block under your name.
          </p>
        </div>

        <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors">
          <input
            type="checkbox"
            checked={isLicensedNvServer}
            onChange={(e) => setIsLicensedNvServer(e.target.checked)}
            className="mt-0.5 w-4 h-4 text-amber-500 rounded border-gray-300 focus:ring-amber-400"
            data-testid="checkbox-nv-licensed"
          />
          <span className="text-xs text-gray-700 leading-relaxed">
            I hold a Nevada PILB process-server work card (NRS 648). Affidavits I sign will declare
            licensed-server status using the work-card number below.
          </span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              NV Work Card / License Number
            </label>
            <input
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="e.g., 1234-PSW"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              data-testid="input-license-number"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">License County</label>
            <input
              value={licenseCounty}
              onChange={(e) => setLicenseCounty(e.target.value)}
              placeholder="e.g., Clark"
              className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              data-testid="input-license-county"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={update.isPending}
        data-testid="button-save-server-profile"
        className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm rounded-xl transition-colors"
      >
        {update.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save Profile"
        )}
      </button>
    </div>
  );
}
