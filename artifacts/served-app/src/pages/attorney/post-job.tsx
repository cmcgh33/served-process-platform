import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useCreateJob,
  useGetServePricePreview,
  useCreateDraftJobsCheckout,
  useGetJob,
  useUpdateJob,
  useGetMyFirmProfile,
  getGetMyFirmProfileQueryKey,
  getListJobsQueryKey,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, Link, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  X,
  FileText,
  Scale,
  Zap,
  Clock,
  CreditCard,
  Save,
  Pencil,
  Loader2,
  Printer,
  Package,
  MapPin,
  Phone,
  User,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

const DOCUMENT_TYPES = [
  "Summons & Complaint",
  "Subpoena",
  "Civil Litigation — Complaint",
  "Divorce Petition",
  "Restraining Order",
  "Eviction Notice",
  "Small Claims",
  "Deposition Notice",
  "Other",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

// Standardized document-type catalogue (Nevada-curated, used in all
// jurisdictions). Curated from the most
// commonly-served NV process types (JCRCP / EDCR / NRS 40 eviction
// chapter / NRS 33 protection orders). "Other" lives at the bottom and
// requires the user to enter a custom free-text title for the affidavit.
const DOC_TYPE_OPTIONS = [
  "Summons",
  "Complaint",
  "Summons & Complaint",
  "Petition",
  "Motion",
  "Civil Subpoena",
  "Subpoena Duces Tecum",
  "Court Order",
  "Temporary Protection Order (TPO)",
  "Extended Protection Order (EPO)",
  "Notice to Quit / Pay-or-Quit",
  "Summary Eviction Complaint",
  "Unlawful Detainer Complaint",
  "Writ of Restitution",
  "Writ of Execution",
  "Writ of Garnishment",
  "Notice of Hearing",
  "Small Claims Affidavit & Order",
  "Divorce / Custody Decree",
  "Other",
] as const;

const formSchema = z.object({
  documentType: z.string().min(1, "Document type is required"),
  serviceType: z.enum(["standard", "rush"]),
  // Requester contact snapshot — required at publish (drafts can be saved
  // partially filled and the publish-time gate catches missing values).
  requesterName: z.string().optional(),
  requesterEmail: z
    .string()
    .optional()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
      "Enter a valid email",
    ),
  requesterPhone: z.string().optional(),
  recipientName: z.string().min(1, "Recipient name is required"),
  recipientAddress: z.string().min(1, "Address is required"),
  recipientCity: z.string().min(1, "City is required"),
  recipientState: z.string().min(2).max(2),
  recipientZip: z.string().min(5),
  caseNumber: z.string().optional(),
  deptNumber: z.string().optional(),
  matterName: z.string().optional(),
  // Nevada affidavit caption + documents-served catalogue.
  courtName: z.string().optional(),
  petitioner: z.string().optional(),
  respondent: z.string().optional(),
  documentsServed: z
    .array(
      z.object({
        title: z.string(),
        documentType: z.string(),
      }),
    )
    .default([]),
  notes: z.string().optional(),
  // Document handover — `prints` (server downloads + prints), `pickup`
  // (server picks up originals from the firm), or `either` (server picks
  // at job time). Pickup fields are required server-side when handling
  // is pickup or either.
  documentHandling: z.enum(["prints", "pickup", "either"]).default("prints"),
  pickupAddress: z.string().optional(),
  pickupCity: z.string().optional(),
  pickupState: z.string().optional(),
  pickupZip: z.string().optional(),
  pickupContactName: z.string().optional(),
  pickupContactPhone: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

/**
 * Publish-time validation. Mirrors the server gate in routes/jobs.ts.
 * Only invoked when the user is publishing a job (Pay & Post or
 * subscriber-post) — drafts are intentionally exempt so attorneys can
 * save partial work and finish later.
 *
 * Returns true when the form is OK to publish. When it returns false,
 * field-level errors have been set on the provided form so the offending
 * inputs render with inline messages instead of a generic 400 toast.
 *
 * Universal (all jurisdictions):
 *   - requesterName, requesterEmail
 *   - at least one documents-served row valid: a type is selected, AND
 *     when type === "Other" a custom title is entered.
 *
 * Nevada-only adds: courtName, petitioner, respondent.
 */
function enforcePublishRules(
  values: FormValues,
  setError: (field: keyof FormValues, msg: string) => void,
): boolean {
  let ok = true;
  if (!values.requesterName?.trim()) {
    setError("requesterName", "Required to publish.");
    ok = false;
  }
  if (!values.requesterEmail?.trim()) {
    setError("requesterEmail", "Required to publish.");
    ok = false;
  }
  const docs = (values.documentsServed ?? []).filter((d) => {
    const type = d.documentType?.trim();
    if (!type) return false;
    if (type === "Other") return Boolean(d.title?.trim());
    return true;
  });
  if (docs.length === 0) {
    setError(
      "documentsServed",
      "Add at least one document to be served (pick a type — and add a title when Other).",
    );
    ok = false;
  }
  const isNevada = values.recipientState?.trim().toUpperCase() === "NV";
  if (isNevada) {
    if (!values.courtName?.trim()) {
      setError("courtName", "Required for Nevada jobs.");
      ok = false;
    }
    if (!values.petitioner?.trim()) {
      setError("petitioner", "Required for Nevada jobs.");
      ok = false;
    }
    if (!values.respondent?.trim()) {
      setError("respondent", "Required for Nevada jobs.");
      ok = false;
    }
  }
  return ok;
}

interface UploadedFile {
  id: string;
  name: string;
  size: number;
}

function FileUploadZone({
  files,
  onAdd,
  onRemove,
}: {
  files: UploadedFile[];
  onAdd: (f: UploadedFile[]) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const processFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    onAdd(
      Array.from(fileList).map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}`,
        name: f.name,
        size: f.size,
      }))
    );
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      processFiles(e.dataTransfer.files);
    },
    [onAdd]
  );

  const fmt = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
          dragging
            ? "border-sky-400 bg-sky-50"
            : "border-gray-200 hover:border-sky-300 hover:bg-sky-50/40 bg-gray-50"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center">
            <Upload className="w-5 h-5 text-sky-500" />
          </div>
          <p className="text-sm font-semibold text-gray-700">
            Drop documents here or <span className="text-sky-600">browse</span>
          </p>
          <p className="text-xs text-gray-400">PDF, JPG, PNG — up to 25 MB each</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => processFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-lg"
            >
              <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-sky-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{f.name}</p>
                <p className="text-xs text-gray-400">{fmt(f.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                className="p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceTypePicker({
  value,
  onChange,
}: {
  value: "standard" | "rush";
  onChange: (v: "standard" | "rush") => void;
}) {
  const options: Array<{
    key: "standard" | "rush";
    label: string;
    blurb: string;
    icon: typeof Clock;
  }> = [
    { key: "standard", label: "Standard", blurb: "Within 5 business days", icon: Clock },
    { key: "rush", label: "Rush", blurb: "Within 48 hours", icon: Zap },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "text-left p-3 rounded-xl border transition-all",
              active
                ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                : "border-gray-200 bg-white hover:border-sky-200",
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center",
                  active ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500",
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                <p className="text-[11px] text-gray-500">{opt.blurb}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function AttorneyPostJob() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const search = useSearch();

  // ?edit=<jobId> — when present we load the existing draft and switch the
  // form into edit-mode (PATCH /jobs/:id on save) instead of create-mode.
  const editJobId = useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get("edit");
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [search]);
  const isEditMode = editJobId != null;

  const createJob = useCreateJob();
  const updateJob = useUpdateJob();
  const draftJobsCheckout = useCreateDraftJobsCheckout();

  const editJobQuery = useGetJob(editJobId ?? 0, {
    query: {
      queryKey: getGetJobQueryKey(editJobId ?? 0),
      enabled: editJobId != null,
      refetchOnWindowFocus: false,
    },
  });
  const editJob = editJobQuery.data;

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      documentType: "",
      serviceType: "standard",
      requesterName: "",
      requesterEmail: "",
      requesterPhone: "",
      recipientName: "",
      recipientAddress: "",
      recipientCity: "",
      recipientState: "",
      recipientZip: "",
      caseNumber: "",
      deptNumber: "",
      matterName: "",
      courtName: "",
      petitioner: "",
      respondent: "",
      documentsServed: [],
      notes: "",
      documentHandling: "prints",
      pickupAddress: "",
      pickupCity: "",
      pickupState: "",
      pickupZip: "",
      pickupContactName: "",
      pickupContactPhone: "",
    },
  });
  const docsArray = useFieldArray({
    control: form.control,
    name: "documentsServed",
  });

  // Hydrate the form once the draft loads. We do this with form.reset so
  // react-hook-form treats the loaded values as the new baseline (dirty
  // tracking, defaultValues, etc.).
  const hydratedForJobId = useRef<number | null>(null);
  useEffect(() => {
    if (!editJob) return;
    if (hydratedForJobId.current === editJob.id) return;
    if (editJob.status !== "draft") {
      // Backend will refuse to save anyway; tell the user up front and
      // bounce them back to the drafts list.
      toast.error("This matter is no longer a draft and can't be edited.");
      setLocation("/app/attorney/jobs?tab=drafts");
      return;
    }
    // The post-job form only knows about standard/rush. If the draft was
    // somehow created with `licensed` (not reachable from this form, but
    // possible via API), refuse to edit here rather than silently
    // coercing the service tier to standard on save — which would change
    // both the price and the service guarantee.
    if (
      editJob.serviceType !== "standard" &&
      editJob.serviceType !== "rush"
    ) {
      toast.error(
        `This draft uses "${editJob.serviceType}" service, which can't be edited from here.`,
      );
      setLocation("/app/attorney/jobs?tab=drafts");
      return;
    }
    const svc = editJob.serviceType;
    form.reset({
      documentType: editJob.documentType ?? "",
      serviceType: svc,
      requesterName: editJob.requesterName ?? "",
      requesterEmail: editJob.requesterEmail ?? "",
      requesterPhone: editJob.requesterPhone ?? "",
      recipientName: editJob.recipientName ?? "",
      recipientAddress: editJob.recipientAddress ?? "",
      recipientCity: editJob.recipientCity ?? "",
      recipientState: editJob.recipientState ?? "",
      recipientZip: editJob.recipientZip ?? "",
      caseNumber: editJob.caseNumber ?? "",
      deptNumber: editJob.deptNumber ?? "",
      matterName: editJob.matterName ?? "",
      courtName: editJob.courtName ?? "",
      petitioner: editJob.petitioner ?? "",
      respondent: editJob.respondent ?? "",
      documentsServed:
        editJob.documentsServed?.map((d) => ({
          title: d.title,
          documentType: d.documentType,
        })) ?? [],
      notes: editJob.notes ?? "",
      documentHandling:
        (editJob.documentHandling as "prints" | "pickup" | "either" | undefined) ??
        "prints",
      pickupAddress: editJob.pickupAddress ?? "",
      pickupCity: editJob.pickupCity ?? "",
      pickupState: editJob.pickupState ?? "",
      pickupZip: editJob.pickupZip ?? "",
      pickupContactName: editJob.pickupContactName ?? "",
      pickupContactPhone: editJob.pickupContactPhone ?? "",
    });
    hydratedForJobId.current = editJob.id;
  }, [editJob, form, setLocation]);

  const serviceType = form.watch("serviceType");
  const documentHandling = form.watch("documentHandling");

  const pricePreview = useGetServePricePreview({ serviceType });

  // Firm-profile autofill — option (a): when the attorney chooses
  // pickup/either, prefill blank pickup fields from their saved Firm
  // Profile. Each field is filled INDEPENDENTLY and only when blank, so
  // an attorney who manually overrides one field (e.g. a different
  // suite for this job) doesn't get clobbered. Skipped in edit mode so
  // we don't overwrite the deliberately-saved draft values.
  const firmProfileQuery = useGetMyFirmProfile({
    query: {
      queryKey: getGetMyFirmProfileQueryKey(),
      enabled: !isEditMode,
      refetchOnWindowFocus: false,
    },
  });
  const autofilledFromProfile = useRef(false);
  useEffect(() => {
    if (isEditMode) return;
    if (autofilledFromProfile.current) return;
    if (documentHandling !== "pickup" && documentHandling !== "either") return;
    const profile = firmProfileQuery.data;
    if (!profile) return;
    const fillIfBlank = (
      name:
        | "pickupAddress"
        | "pickupCity"
        | "pickupState"
        | "pickupZip"
        | "pickupContactName"
        | "pickupContactPhone",
      value: string | null | undefined,
    ) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      const current = form.getValues(name);
      if (current && current.trim().length > 0) return;
      // shouldDirty so the form treats it as a real edit and the save
      // button enables, but no validation fire (user hasn't touched).
      form.setValue(name, trimmed, { shouldDirty: true, shouldValidate: false });
    };
    // Combine address line 1 + suite/floor into the single pickupAddress
    // input the form has today (no separate suite field on the post-job
    // form — the suite gets appended so the server still sees it).
    const composedAddress = [profile.firmAddress, profile.firmAddress2]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join(", ");
    fillIfBlank("pickupAddress", composedAddress);
    fillIfBlank("pickupCity", profile.firmCity);
    fillIfBlank("pickupState", profile.firmState);
    fillIfBlank("pickupZip", profile.firmZip);
    fillIfBlank("pickupContactName", profile.firmContactName);
    fillIfBlank("pickupContactPhone", profile.firmPhone);
    autofilledFromProfile.current = true;
  }, [documentHandling, firmProfileQuery.data, form, isEditMode]);

  const isSubscriber = pricePreview.data?.isSubscriber ?? false;
  const grossCents = pricePreview.data?.grossCents ?? 0;
  const tierLabel = pricePreview.data?.tierLabel ?? "Public";
  const formattedAmount = pricePreview.data?.formattedAmount ?? "—";
  const publicCents = pricePreview.data?.publicGrossCents ?? grossCents;
  const youSaveCents = isSubscriber ? Math.max(0, publicCents - grossCents) : 0;

  const addFiles = (files: UploadedFile[]) =>
    setUploadedFiles((prev) => {
      const ids = new Set(prev.map((f) => f.id));
      return [...prev, ...files.filter((f) => !ids.has(f.id))];
    });

  type SubmitMode = "pay" | "draft" | "subscriberPost";

  const saveEdits = () =>
    form.handleSubmit((values) => {
      if (editJobId == null) return;
      updateJob.mutate(
        {
          id: editJobId,
          data: {
            documentType: values.documentType,
            serviceType: values.serviceType,
            requesterName: values.requesterName?.trim() || undefined,
            requesterEmail: values.requesterEmail?.trim() || undefined,
            requesterPhone: values.requesterPhone?.trim() || undefined,
            recipientName: values.recipientName,
            recipientAddress: values.recipientAddress,
            recipientCity: values.recipientCity,
            recipientState: values.recipientState,
            recipientZip: values.recipientZip,
            caseNumber: values.caseNumber || undefined,
            deptNumber: values.deptNumber || undefined,
            matterName: values.matterName || undefined,
            courtName: values.courtName || undefined,
            petitioner: values.petitioner || undefined,
            respondent: values.respondent || undefined,
            documentsServed: (values.documentsServed ?? [])
              .filter((d) => {
                const type = d.documentType?.trim();
                if (!type) return false;
                if (type === "Other") return Boolean(d.title?.trim());
                return true;
              })
              .map((d) => ({
                title: d.title?.trim() || d.documentType.trim(),
                documentType: d.documentType.trim() || "Other",
              })),
            notes: values.notes || undefined,
            documentHandling: values.documentHandling,
            pickupAddress: values.pickupAddress?.trim() || undefined,
            pickupCity: values.pickupCity?.trim() || undefined,
            pickupState: values.pickupState?.trim() || undefined,
            pickupZip: values.pickupZip?.trim() || undefined,
            pickupContactName: values.pickupContactName?.trim() || undefined,
            pickupContactPhone: values.pickupContactPhone?.trim() || undefined,
          },
        },
        {
          onSuccess: () => {
            toast.success("Draft updated");
            queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
            queryClient.invalidateQueries({
              queryKey: getGetJobQueryKey(editJobId),
            });
            setLocation("/app/attorney/jobs?tab=drafts");
          },
          onError: (err) => {
            toast.error("Couldn't save changes", {
              description:
                err instanceof Error ? err.message : "Unknown error",
            });
          },
        },
      );
    });

  const submit = (mode: SubmitMode) =>
    form.handleSubmit((values) => {
      // Subscribers post directly: status=pending. Non-subscribers create as
      // draft and then either go straight to single-job Stripe checkout
      // (Pay & Post) or land on My Jobs to batch later (Save as Draft).
      const initialStatus =
        mode === "subscriberPost" ? "pending" : "draft";

      // Publish-time gate — drafts are exempt so attorneys can save
      // partial work and complete later (matches the server-side guard
      // in routes/jobs.ts).
      if (mode !== "draft") {
        const ok = enforcePublishRules(values, (field, msg) =>
          form.setError(field, { type: "manual", message: msg }),
        );
        if (!ok) {
          toast.error("A few details are needed before posting", {
            description:
              "Add your contact info and at least one document. Nevada jobs also need court name and parties.",
          });
          return;
        }
      }

      const documentsServed = (values.documentsServed ?? [])
        .filter((d) => {
          const type = d.documentType?.trim();
          if (!type) return false;
          if (type === "Other") return Boolean(d.title?.trim());
          return true;
        })
        .map((d) => ({
          title: d.title?.trim() || d.documentType.trim(),
          documentType: d.documentType.trim() || "Other",
        }));

      createJob.mutate(
        {
          data: {
            ...values,
            documentsServed,
            requesterName: values.requesterName?.trim() || undefined,
            requesterEmail: values.requesterEmail?.trim() || undefined,
            requesterPhone: values.requesterPhone?.trim() || undefined,
            courtName: values.courtName?.trim() || undefined,
            petitioner: values.petitioner?.trim() || undefined,
            respondent: values.respondent?.trim() || undefined,
            documentHandling: values.documentHandling,
            pickupAddress: values.pickupAddress?.trim() || undefined,
            pickupCity: values.pickupCity?.trim() || undefined,
            pickupState: values.pickupState?.trim() || undefined,
            pickupZip: values.pickupZip?.trim() || undefined,
            pickupContactName: values.pickupContactName?.trim() || undefined,
            pickupContactPhone: values.pickupContactPhone?.trim() || undefined,
            initialStatus,
          },
        },
        {
          onSuccess: (data) => {
            if (mode === "subscriberPost") {
              toast.success("Matter filed successfully!", {
                description: `Reference: ${data.platformRef}`,
              });
              setLocation("/app/attorney/jobs");
              return;
            }
            if (mode === "draft") {
              toast.success("Draft saved", {
                description: `Pay anytime to publish #${data.platformRef}.`,
              });
              setLocation("/app/attorney/jobs?tab=drafts");
              return;
            }
            // mode === "pay" — kick off single-job Checkout
            draftJobsCheckout.mutate(
              { data: { jobIds: [data.id] } },
              {
                onSuccess: (resp) => {
                  window.location.assign(resp.url);
                },
                onError: (err) => {
                  toast.error("Couldn't start checkout", {
                    description:
                      err instanceof Error ? err.message : "Unknown error",
                  });
                  setLocation("/app/attorney/jobs?tab=drafts");
                },
              },
            );
          },
          onError: (err) => {
            toast.error("Failed to post job", {
              description: err instanceof Error ? err.message : "Unknown error",
            });
          },
        },
      );
    });

  const isWorking =
    createJob.isPending ||
    draftJobsCheckout.isPending ||
    updateJob.isPending;
  const isLoadingDraft = isEditMode && editJobQuery.isLoading;
  // Until the live price loads we don't know whether the caller is a
  // subscriber, so don't render the wrong action set. The Pay/Save vs.
  // single Post Job buttons are gated on `isSubscriber`, which defaults
  // to false during loading and could briefly mis-route a subscriber
  // through paid checkout.
  const isPriceReady = pricePreview.isSuccess;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link
          href={
            isEditMode
              ? "/app/attorney/jobs?tab=drafts"
              : "/app/attorney/dashboard"
          }
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {isEditMode ? "Edit Draft" : "Post a Matter"}
          </h1>
          <p className="text-sm text-gray-500">
            {isEditMode
              ? editJob?.platformRef
                ? `Update details for draft ${editJob.platformRef} before checkout.`
                : "Update draft details before checkout."
              : "File a new service request for your firm."}
          </p>
        </div>
      </div>

      {isLoadingDraft && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading draft…
        </div>
      )}
      {isEditMode && !isLoadingDraft && editJobQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          Couldn't load this draft.{" "}
          <Link
            href="/app/attorney/jobs?tab=drafts"
            className="underline font-semibold"
          >
            Back to drafts
          </Link>
        </div>
      )}

      {/* In edit mode, suppress the entire form while loading or on
          load error — there's no useful baseline to edit against and
          showing an empty form would let attorneys "edit" nothing
          and submit a blank PATCH. */}
      {!(isLoadingDraft || (isEditMode && editJobQuery.isError)) && (
      <Form {...form}>
        <form className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-5">
            {/* Document Upload — hidden in edit mode because document
                attachments aren't saved through PATCH /jobs/:id; only
                matter-info fields (recipient, service speed, case info)
                can be revised here before checkout. */}
            {!isEditMode && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <Scale className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-gray-900">Upload Documents</h2>
                    <p className="text-xs text-gray-500">
                      Attach pleadings, subpoenas, or any documents to be served
                    </p>
                  </div>
                </div>
                <FileUploadZone
                  files={uploadedFiles}
                  onAdd={addFiles}
                  onRemove={(id) => setUploadedFiles((p) => p.filter((f) => f.id !== id))}
                />
              </div>
            )}

            {/* Service type */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-sm font-bold text-gray-900">Service Speed</h2>
              <FormField
                control={form.control}
                name="serviceType"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <ServiceTypePicker
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Requester contact — captured as snapshot on the affidavit's
                REQUESTING PARTY block. Required to publish (drafts exempt). */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Requesting Party</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Printed on the affidavit so the court knows who hired the platform to effect service.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="requesterName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">
                        Full Name <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-requester-name"
                          placeholder="Jane Smith, Esq."
                          className="bg-gray-50 border-gray-200"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="requesterEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">
                        Email <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-requester-email"
                          type="email"
                          placeholder="you@firm.com"
                          className="bg-gray-50 border-gray-200"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="requesterPhone"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-xs text-gray-600">
                        Phone <span className="text-gray-400">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-requester-phone"
                          type="tel"
                          placeholder="(702) 555-0123"
                          className="bg-gray-50 border-gray-200"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Case / matter info */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-sm font-bold text-gray-900">Matter Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="documentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">Document Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-gray-50 border-gray-200">
                            <SelectValue placeholder="Select type..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOCUMENT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="caseNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">Case / Docket Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. CV-2026-1234" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="deptNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">Dept. No.</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 14" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="matterName"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-xs text-gray-600">Matter Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Harrison v. Smith" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="courtName"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-xs text-gray-600">
                        Court Name <span className="text-gray-400">(for affidavit caption)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Eighth Judicial District Court, Clark County, Nevada"
                          className="bg-gray-50 border-gray-200"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="petitioner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">Petitioner / Plaintiff</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Jane Smith" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="respondent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">Respondent / Defendant</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. John Jones" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Documents-served catalogue (rendered onto the affidavit list) */}
              <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">Documents Served</h3>
                    <p className="text-[11px] text-gray-500">
                      One row per document. Pick a type for each — and add a custom title when "Other". The exact list prints on the affidavit.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => docsArray.append({ title: "", documentType: "Summons" })}
                    className="text-xs font-semibold text-sky-600 hover:text-sky-700"
                  >
                    + Add document
                  </button>
                </div>
                {docsArray.fields.length === 0 ? (
                  <p className="text-xs text-gray-500 px-3 py-2 bg-gray-50 border border-dashed border-gray-200 rounded-lg">
                    No documents added.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {docsArray.fields.map((field, idx) => (
                      <div key={field.id} className="grid grid-cols-[1fr,160px,32px] gap-2 items-start">
                        <FormField
                          control={form.control}
                          name={`documentsServed.${idx}.title` as const}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormControl>
                                <Input
                                  placeholder="Document title (e.g. Summons in a Civil Case)"
                                  className="bg-gray-50 border-gray-200"
                                  {...f}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`documentsServed.${idx}.documentType` as const}
                          render={({ field: f }) => (
                            <FormItem>
                              <Select onValueChange={f.onChange} value={f.value}>
                                <FormControl>
                                  <SelectTrigger className="bg-gray-50 border-gray-200">
                                    <SelectValue placeholder="Type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {DOC_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <button
                          type="button"
                          aria-label="Remove document"
                          onClick={() => docsArray.remove(idx)}
                          className="text-gray-400 hover:text-red-500 text-lg leading-none mt-2"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recipient */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-sm font-bold text-gray-900">Party to be Served</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="recipientName"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-xs text-gray-600">Recipient Full Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John Doe" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recipientAddress"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel className="text-xs text-gray-600">Street Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recipientCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-gray-600">City</FormLabel>
                      <FormControl>
                        <Input placeholder="Henderson" className="bg-gray-50 border-gray-200" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="recipientState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">State</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-gray-50 border-gray-200">
                              <SelectValue placeholder="State" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {US_STATES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="recipientZip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">Zip</FormLabel>
                        <FormControl>
                          <Input placeholder="89002" maxLength={5} className="bg-gray-50 border-gray-200" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Document Handover — how the server gets the docs to serve.
                Three options: server downloads + prints (default), server
                picks up originals from the firm, or "either" (server's
                choice — useful when the firm wants to offer pickup as a
                courtesy but the server has a printer). When pickup is
                offered (pickup or either), the firm address fields below
                become required server-side. */}
            <FormField
              control={form.control}
              name="documentHandling"
              render={({ field }) => {
                const handling = field.value;
                const hasFiles = uploadedFiles.length > 0;
                const printsAvailable = hasFiles || isEditMode;
                const showPickupFields = handling === "pickup" || handling === "either";
                return (
                  <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Document Handover</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        How should the assigned server get the documents to serve?
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <button
                        type="button"
                        data-testid="radio-handling-prints"
                        disabled={!printsAvailable}
                        onClick={() => field.onChange("prints")}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all",
                          handling === "prints" && printsAvailable
                            ? "border-amber-400 bg-amber-50"
                            : "border-gray-200 bg-white hover:border-amber-200",
                          !printsAvailable && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <Printer
                          className={cn(
                            "w-4 h-4 mb-2",
                            handling === "prints" ? "text-amber-500" : "text-gray-400",
                          )}
                        />
                        <p className="text-sm font-bold text-gray-900">Server prints</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {printsAvailable
                            ? "Server downloads the uploaded PDF and prints on their end."
                            : "Upload a PDF above to enable this option."}
                        </p>
                      </button>
                      <button
                        type="button"
                        data-testid="radio-handling-pickup"
                        onClick={() => field.onChange("pickup")}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all",
                          handling === "pickup"
                            ? "border-amber-400 bg-amber-50"
                            : "border-gray-200 bg-white hover:border-amber-200",
                        )}
                      >
                        <Package
                          className={cn(
                            "w-4 h-4 mb-2",
                            handling === "pickup" ? "text-amber-500" : "text-gray-400",
                          )}
                        />
                        <p className="text-sm font-bold text-gray-900">Server picks up</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Server collects originals from your office before serving.
                        </p>
                      </button>
                      <button
                        type="button"
                        data-testid="radio-handling-either"
                        onClick={() => field.onChange("either")}
                        className={cn(
                          "text-left p-4 rounded-xl border transition-all",
                          handling === "either"
                            ? "border-amber-400 bg-amber-50"
                            : "border-gray-200 bg-white hover:border-amber-200",
                        )}
                      >
                        <FileText
                          className={cn(
                            "w-4 h-4 mb-2",
                            handling === "either" ? "text-amber-500" : "text-gray-400",
                          )}
                        />
                        <p className="text-sm font-bold text-gray-900">Server's choice</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Offer both — server can download and print, or stop by your office for originals.
                        </p>
                      </button>
                    </div>

                    {showPickupFields && (
                      <div className="space-y-3 p-4 rounded-xl border border-amber-200 bg-amber-50/40">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-amber-500" />
                          <p className="text-sm font-bold text-gray-900">Firm pickup address</p>
                        </div>
                        <FormField
                          control={form.control}
                          name="pickupAddress"
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs text-gray-600">Street Address</FormLabel>
                              <FormControl>
                                <Input
                                  data-testid="input-pickup-address"
                                  placeholder="500 Lawyer Lane, Suite 200"
                                  className="bg-white border-gray-200"
                                  {...f}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="pickupCity"
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-gray-600">City</FormLabel>
                                <FormControl>
                                  <Input
                                    data-testid="input-pickup-city"
                                    placeholder="Las Vegas"
                                    className="bg-white border-gray-200"
                                    {...f}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <FormField
                              control={form.control}
                              name="pickupState"
                              render={({ field: f }) => (
                                <FormItem>
                                  <FormLabel className="text-xs text-gray-600">State</FormLabel>
                                  <Select onValueChange={f.onChange} value={f.value ?? ""}>
                                    <FormControl>
                                      <SelectTrigger
                                        data-testid="input-pickup-state"
                                        className="bg-white border-gray-200"
                                      >
                                        <SelectValue placeholder="—" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {US_STATES.map((s) => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="pickupZip"
                              render={({ field: f }) => (
                                <FormItem>
                                  <FormLabel className="text-xs text-gray-600">Zip</FormLabel>
                                  <FormControl>
                                    <Input
                                      data-testid="input-pickup-zip"
                                      placeholder="89101"
                                      maxLength={5}
                                      className="bg-white border-gray-200"
                                      {...f}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <FormField
                            control={form.control}
                            name="pickupContactName"
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-gray-600">Contact name</FormLabel>
                                <div className="relative">
                                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                  <FormControl>
                                    <Input
                                      data-testid="input-pickup-contact-name"
                                      placeholder="Paralegal name"
                                      className="bg-white border-gray-200 pl-9"
                                      {...f}
                                    />
                                  </FormControl>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="pickupContactPhone"
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs text-gray-600">Contact phone</FormLabel>
                                <div className="relative">
                                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                  <FormControl>
                                    <Input
                                      data-testid="input-pickup-contact-phone"
                                      placeholder="(702) 555-0123"
                                      className="bg-white border-gray-200 pl-9"
                                      {...f}
                                    />
                                  </FormControl>
                                </div>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <p className="text-xs text-amber-700 flex items-start gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          The assigned server will be shown this address and can navigate to it before the recipient.
                        </p>
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* Notes */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-sm font-bold text-gray-900">Server Instructions</h2>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-gray-600">Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Service must be personal. Available 9am–5pm weekdays."
                        className="bg-gray-50 border-gray-200 min-h-[90px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Sticky price card */}
          <aside className="lg:sticky lg:top-6 self-start">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 font-semibold">
                  Live Price
                </p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-bold text-gray-900">
                    {formattedAmount}
                  </span>
                  <span className="text-xs text-gray-500">/ serve</span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Tier: <span className="font-semibold text-gray-700">{tierLabel}</span>
                </p>
              </div>

              {isSubscriber && youSaveCents > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-emerald-700">
                    Saving{" "}
                    <span className="font-bold">
                      ${(youSaveCents / 100).toFixed(2)}
                    </span>{" "}
                    vs. public rate (${(publicCents / 100).toFixed(2)})
                  </p>
                </div>
              )}

              {!isSubscriber && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Public per-serve pricing. ProServe subscribers get
                    discounted rates and one-tap posting.
                  </p>
                  <Link
                    href="/app/attorney/subscription"
                    className="text-[11px] font-semibold text-amber-800 underline"
                  >
                    See ProServe plans →
                  </Link>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 space-y-2">
                {isEditMode ? (
                  <>
                    <button
                      type="button"
                      onClick={saveEdits()}
                      disabled={isWorking || isLoadingDraft}
                      className="w-full px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      {updateJob.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Pencil className="w-4 h-4" />
                      )}
                      {updateJob.isPending ? "Saving..." : "Save Changes"}
                    </button>
                    <p className="text-[11px] text-gray-500 text-center">
                      Pay for this draft from My Matters once changes are saved.
                    </p>
                  </>
                ) : !isPriceReady ? (
                  <button
                    type="button"
                    disabled
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-200 text-gray-500 font-semibold text-sm flex items-center justify-center gap-2 cursor-not-allowed"
                  >
                    Loading pricing…
                  </button>
                ) : isSubscriber ? (
                  <button
                    type="button"
                    onClick={submit("subscriberPost")}
                    disabled={isWorking}
                    className="w-full px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Scale className="w-4 h-4" />
                    {isWorking ? "Posting..." : "Post Job"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={submit("pay")}
                      disabled={isWorking}
                      className="w-full px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      <CreditCard className="w-4 h-4" />
                      {isWorking ? "Working..." : `Pay & Post — ${formattedAmount}`}
                    </button>
                    <button
                      type="button"
                      onClick={submit("draft")}
                      disabled={isWorking}
                      className="w-full px-4 py-2.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      Save as Draft
                    </button>
                    <p className="text-[11px] text-gray-500 text-center">
                      Drafts can be paid later, one or many at a time.
                    </p>
                  </>
                )}

                <Link
                  href={
                    isEditMode
                      ? "/app/attorney/jobs?tab=drafts"
                      : "/app/attorney/dashboard"
                  }
                  className="block w-full px-4 py-2 rounded-lg text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </Link>
              </div>
            </div>
          </aside>
        </form>
      </Form>
      )}
    </div>
  );
}
