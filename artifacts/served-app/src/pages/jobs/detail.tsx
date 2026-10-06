import {
  useGetJob,
  useUpdateJob,
  useListServers,
  useMarkJobPickedUp,
  useEnsureJobAffidavit,
  getGetJobQueryKey,
} from "@workspace/api-client-react";

import { useParams, Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badges";
import { ArrowLeft, MapPin, FileText, User, Building2, Download, CheckCircle, Navigation, Clock, Camera, Package, PackageCheck, Phone, CreditCard, AlertTriangle, Loader2 } from "lucide-react";
import { JobTimeline } from "@/components/JobTimeline";
import { SubstituteServiceDetails } from "@/components/SubstituteServiceDetails";
import { LogAttemptModal } from "@/components/server/log-attempt-modal";
import { MarkServedModal } from "@/components/server/mark-served-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { resolveStorageObjectUrl } from "@/lib/storageUrl";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/me";
import { useResumeJobPayment } from "@/lib/resume-job-payment";

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: job, isLoading } = useGetJob(jobId, {
    query: {
      queryKey: getGetJobQueryKey(jobId),
      enabled: !!jobId,
      refetchOnWindowFocus: true,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s && ["pending", "assigned", "in_progress", "en_route"].includes(s) ? 15000 : false;
      },
    },
  });
  const { data: servers } = useListServers();
  const { data: me } = useMe();
  const updateJob = useUpdateJob();
  const markPickedUp = useMarkJobPickedUp();
  // On-demand affidavit generator. Mirrors the requester-side flow so a
  // legacy/served job missing its PDF (e.g. one from before signature capture
  // shipped, or after a transient generation failure) can be repaired by the
  // attorney who owns the matter without paging support.
  const ensureAffidavit = useEnsureJobAffidavit({
    mutation: {
      onSuccess: (data) => {
        if (jobId) {
          queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
        }
        if (data?.proofPdfUrl) {
          window.open(
            resolveStorageObjectUrl(data.proofPdfUrl),
            "_blank",
            "noopener,noreferrer",
          );
        }
      },
      onError: (err: unknown) => {
        const message =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Couldn't generate the affidavit. Please try again.";
        toast.error(message);
      },
    },
  });

  const [serverToAssign, setServerToAssign] = useState<string>("");
  const [logAttemptOpen, setLogAttemptOpen] = useState(false);
  const [markServedOpen, setMarkServedOpen] = useState(false);
  const { resumePayment, resumingPayment } = useResumeJobPayment();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-64 col-span-2" />
          <Skeleton className="h-64 col-span-1" />
        </div>
      </div>
    );
  }

  if (!job) return <div>Job not found</div>;

  const handleUpdateStatus = (status: "in_progress" | "cancelled" | "failed") => {
    updateJob.mutate(
      { id: jobId, data: { status } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetJobQueryKey(jobId), data);
          toast.success(`Job marked as ${status.replace("_", " ")}`);
        }
      }
    );
  };

  const handleMarkPickedUp = () => {
    markPickedUp.mutate(
      { id: jobId },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetJobQueryKey(jobId), data);
          toast.success("Documents marked as picked up");
        },
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message?: unknown }).message)
              : "Could not mark pickup";
          toast.error(message);
        },
      },
    );
  };

  const handleAssignServer = () => {
    if (!serverToAssign) return;
    updateJob.mutate(
      { id: jobId, data: { serverId: parseInt(serverToAssign), status: "assigned" } },
      {
        onSuccess: (data) => {
          queryClient.setQueryData(getGetJobQueryKey(jobId), data);
          toast.success("Server assigned successfully");
        }
      }
    );
  };

  // Affidavit is generated server-side as a real PDF (PDFKit) when the server
  // confirms service. The object is stored in Replit Object Storage and the
  // job row carries a `proofPdfUrl` key that we resolve through the api-server
  // streaming endpoint (which enforces ACL on every request).
  const affidavitHref = job.proofPdfUrl
    ? resolveStorageObjectUrl(job.proofPdfUrl)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/app/jobs">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{job.platformRef}</h1>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-muted-foreground mt-1">Created on {format(new Date(job.createdAt), "PPP")}</p>
        </div>
        <div className="flex items-center gap-2">
          {job.status === "served" && affidavitHref && (
            <Button asChild className="bg-primary text-primary-foreground" data-testid="button-download-affidavit">
              <a href={affidavitHref} target="_blank" rel="noreferrer">
                <Download className="mr-2 h-4 w-4" /> Download Affidavit (PDF)
              </a>
            </Button>
          )}
          {job.status === "served" && !affidavitHref && (
            <Button
              onClick={() => {
                if (!jobId) return;
                ensureAffidavit.mutate({ id: jobId });
              }}
              disabled={ensureAffidavit.isPending}
              className="bg-primary text-primary-foreground"
              data-testid="button-generate-affidavit"
            >
              {ensureAffidavit.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing affidavit…
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" /> Download Affidavit (PDF)
                </>
              )}
            </Button>
          )}
          {me?.role === "server" &&
            job.documentHandling === "pickup" &&
            !job.pickedUpAt &&
            (job.status === "assigned" || job.status === "in_progress") && (
              <Button
                onClick={handleMarkPickedUp}
                disabled={markPickedUp.isPending}
                data-testid="button-mark-picked-up"
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                <PackageCheck className="mr-2 h-4 w-4" />
                {markPickedUp.isPending ? "Saving…" : "Mark Picked Up"}
              </Button>
            )}
          {job.status === "assigned" && (
            <Button onClick={() => handleUpdateStatus("in_progress")}>
              Mark In Progress
            </Button>
          )}
          {job.status === "in_progress" && (
            <>
              <Button onClick={() => setMarkServedOpen(true)} data-testid="button-mark-served" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <CheckCircle className="mr-2 h-4 w-4" /> Mark Served
              </Button>
              <Button variant="outline" onClick={() => setLogAttemptOpen(true)} data-testid="button-log-service">
                <Navigation className="mr-2 h-4 w-4" /> Log Attempt
              </Button>
            </>
          )}
          {/* Owner-only "Complete payment" CTA. Restricted to the
              requester/attorney roles because admins/servers can't pay
              on the customer's behalf. The endpoint additionally
              validates ownership server-side. */}
          {job.status === "pending_payment" &&
            (me?.role === "requester" || me?.role === "attorney") && (
              <Button
                onClick={() =>
                  resumePayment({
                    id: String(job.id),
                    grossCents: job.grossCents,
                    documentType: job.documentType,
                    recipientName: job.recipientName,
                  })
                }
                disabled={resumingPayment}
                data-testid="button-complete-payment"
                className="bg-amber-400 hover:bg-amber-500 text-black"
              >
                <CreditCard className="mr-2 h-4 w-4" />
                {resumingPayment ? "Opening checkout…" : "Complete Payment"}
              </Button>
            )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Job Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Document Type</span>
                <span>{job.documentType}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Case Number</span>
                <span className="font-mono">{job.caseNumber || "-"}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-sm font-medium text-muted-foreground block">Matter Name</span>
                <span>{job.matterName || "-"}</span>
              </div>
            </CardContent>
          </Card>

          {job.documentHandling === "pickup" && (() => {
            const isPickedUp = Boolean(job.pickedUpAt);
            return (
              <Card
                data-testid="pickup-card"
                className={cn(
                  isPickedUp
                    ? "border-emerald-300/70 bg-emerald-50/60 dark:bg-emerald-950/10"
                    : "border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/10",
                )}
              >
                <CardHeader>
                  <CardTitle
                    className={cn(
                      "flex items-center gap-2",
                      isPickedUp
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-800 dark:text-amber-400",
                    )}
                  >
                    {isPickedUp ? (
                      <>
                        <PackageCheck className="h-5 w-5" /> Documents Picked Up
                      </>
                    ) : (
                      <>
                        <Package className="h-5 w-5" /> Document Pickup
                      </>
                    )}
                  </CardTitle>
                  <CardDescription
                    className={cn(
                      isPickedUp
                        ? "text-emerald-800/80"
                        : "text-amber-800/80",
                    )}
                  >
                    {isPickedUp
                      ? `Collected on ${format(
                          new Date(job.pickedUpAt!),
                          "PPP 'at' p",
                        )} — server is en route to the recipient.`
                      : "Drive here first to collect physical documents before serving the recipient."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div>
                    <span className="text-sm font-medium text-muted-foreground block">Pickup Address</span>
                    <span>{job.pickupAddress || "—"}</span>
                    <br />
                    <span>
                      {[job.pickupCity, job.pickupState, job.pickupZip].filter(Boolean).join(", ") || ""}
                    </span>
                  </div>
                  {(job.pickupContactName || job.pickupContactPhone) && (
                    <div className="grid gap-1">
                      <span className="text-sm font-medium text-muted-foreground block">Contact</span>
                      {job.pickupContactName && (
                        <span className="flex items-center gap-2">
                          <User
                            className={cn(
                              "h-4 w-4",
                              isPickedUp ? "text-emerald-700" : "text-amber-700",
                            )}
                          />
                          {job.pickupContactName}
                        </span>
                      )}
                      {job.pickupContactPhone && (
                        <a
                          href={`tel:${job.pickupContactPhone}`}
                          className="flex items-center gap-2 text-primary hover:underline"
                        >
                          <Phone className="h-4 w-4" />
                          {job.pickupContactPhone}
                        </a>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" /> Recipient
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Name</span>
                <span className="text-lg font-medium">{job.recipientName}</span>
              </div>
              <div>
                <span className="text-sm font-medium text-muted-foreground block">Address</span>
                <span>{job.recipientAddress}</span>
                <br />
                <span>{job.recipientCity}, {job.recipientState} {job.recipientZip}</span>
              </div>
              {job.notes && (
                <div>
                  <span className="text-sm font-medium text-muted-foreground block">Instructions/Notes</span>
                  <p className="bg-muted p-3 rounded-md mt-1 whitespace-pre-wrap">{job.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {job.servedAt && (
            <Card className="border-green-500/50 bg-green-50/50 dark:bg-green-950/10">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-500">
                  <CheckCircle className="h-5 w-5" /> Service Confirmed
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="text-sm font-medium text-muted-foreground block">Timestamp</span>
                  <span className="font-medium">{format(new Date(job.servedAt), "PPP 'at' p")}</span>
                </div>
                <div>
                  <span className="text-sm font-medium text-muted-foreground block">GPS Coordinates</span>
                  <a 
                    href={`https://maps.google.com/?q=${job.gpsLat},${job.gpsLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-primary hover:underline flex items-center gap-1"
                  >
                    {job.gpsLat?.toFixed(6)}, {job.gpsLng?.toFixed(6)}
                  </a>
                </div>
                {job.proofPhotoUrl && (
                  <div className="sm:col-span-2">
                    <span className="text-sm font-medium text-muted-foreground block mb-2">
                      <Camera className="inline h-4 w-4 mr-1" /> Proof Photo
                    </span>
                    <a
                      href={resolveStorageObjectUrl(job.proofPhotoUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={resolveStorageObjectUrl(job.proofPhotoUrl)}
                        alt="Proof of service"
                        data-testid="img-proof-photo"
                        className="max-h-64 rounded-md border border-green-300"
                      />
                    </a>
                  </div>
                )}
                {job.signatureTypedName && (
                  <div className="sm:col-span-2 border-t pt-3 mt-1">
                    <span className="text-sm font-medium text-muted-foreground block">
                      Server Signature
                    </span>
                    <span className="font-serif italic text-lg" data-testid="text-signature-name">
                      /s/ {job.signatureTypedName}
                    </span>
                    {job.signatureImageUrl && (
                      <div className="mt-2">
                        <img
                          src={resolveStorageObjectUrl(job.signatureImageUrl)}
                          alt="Drawn signature"
                          data-testid="img-signature"
                          className="max-h-20 border rounded bg-white p-1"
                        />
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <SubstituteServiceDetails jobId={jobId} />

          <Card data-testid="card-timeline">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" /> Timeline
              </CardTitle>
              <CardDescription>
                Every milestone for this job in one chronological feed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JobTimeline
                job={job}
                pollInterval={
                  job.status && ["pending", "assigned", "in_progress", "en_route"].includes(job.status)
                    ? 15000
                    : undefined
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Payment Required swap: when a job is in pending_payment,
              there literally cannot be an assignment yet (we only
              search the marketplace once the customer pays). Showing
              the empty Assignment card with an admin "assign server"
              dropdown is misleading and could let staff dispatch a
              server against an unpaid job. Replace it with a clear
              call-to-action card; the "Complete Payment" button only
              renders for the owner roles, the endpoint also enforces
              ownership server-side. */}
          {job.status === "pending_payment" ? (
            <Card
              className="border-rose-300 bg-rose-50/40"
              data-testid="card-payment-required"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-rose-700">
                  <CreditCard className="h-5 w-5" /> Payment required
                </CardTitle>
                <CardDescription className="text-rose-700/80">
                  This job was created but checkout wasn't completed, so
                  it hasn't gone out to the marketplace yet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-rose-900/80">
                  Total due:{" "}
                  <span className="font-semibold">
                    ${(job.grossCents / 100).toFixed(2)}
                  </span>
                </div>
                {(me?.role === "requester" || me?.role === "attorney") ? (
                  <Button
                    className="w-full bg-amber-400 hover:bg-amber-500 text-black"
                    onClick={() =>
                      resumePayment({
                        id: String(job.id),
                        grossCents: job.grossCents,
                        documentType: job.documentType,
                        recipientName: job.recipientName,
                      })
                    }
                    disabled={resumingPayment}
                    data-testid="button-payment-card-complete"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    {resumingPayment ? "Opening checkout…" : "Complete payment"}
                  </Button>
                ) : (
                  <div className="text-xs text-rose-900/70">
                    Only the requester can complete this checkout.
                    Reach out if they need a fresh payment link.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" /> Assignment
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.server ? (
                <div className="space-y-2">
                  <div className="font-medium">{job.server.name}</div>
                  <div className="text-sm text-muted-foreground">{job.server.phone || job.server.email}</div>
                  <Button variant="outline" className="w-full mt-4" asChild>
                    <Link href={`/app/servers/${job.server.id}`}>View Profile</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">Not assigned to a server.</div>
                  <div className="flex gap-2">
                    <Select value={serverToAssign} onValueChange={setServerToAssign}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Server" />
                      </SelectTrigger>
                      <SelectContent>
                        {servers?.filter(s => s.active).map(s => (
                          <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAssignServer} disabled={!serverToAssign || updateJob.isPending}>
                      Assign
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" /> Client Firm
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.client ? (
                <div className="space-y-2">
                  <div className="font-medium">{job.client.firmName}</div>
                  <div className="text-sm">{job.client.contactName}</div>
                  <div className="text-sm text-muted-foreground">{job.client.email}</div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No client associated.</div>
              )}
            </CardContent>
          </Card>
          
          {(job.status === "pending" ||
            job.status === "assigned" ||
            job.status === "pending_payment") && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive text-sm uppercase">Danger Zone</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="destructive" className="w-full" onClick={() => handleUpdateStatus("cancelled")}>
                  {job.status === "pending_payment"
                    ? "Discard this unpaid job"
                    : "Cancel Job"}
                </Button>
                {job.status === "pending_payment" && (
                  <p className="text-xs text-muted-foreground">
                    Nothing has been charged yet — discarding just removes the
                    draft.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {logAttemptOpen && (
        <LogAttemptModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientState: job.recipientState,
          }}
          onClose={() => setLogAttemptOpen(false)}
        />
      )}

      {markServedOpen && (
        <MarkServedModal
          job={{
            id: job.id,
            recipientName: job.recipientName,
            documentType: job.documentType,
            recipientAddress: job.recipientAddress,
            recipientCity: job.recipientCity,
            recipientState: job.recipientState,
            recipientZip: job.recipientZip,
          }}
          onClose={() => setMarkServedOpen(false)}
        />
      )}
    </div>
  );
}
