import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Home, Scale, Gavel, FileWarning, FileText, MoreHorizontal,
  Upload, X, FileIcon, Clock, Zap, Rocket, ChevronRight,
  User, MapPin, FilePlus, Check, ShieldCheck, CreditCard, Loader2,
  ArrowLeft, Printer, Package, Phone,
} from "lucide-react";
import { useCreateJob } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { redirectTopLevel } from "@/lib/external-redirect";

// urgency tier (UI) → ServiceType in our pricing engine.
const URGENCY_TO_SERVICE_TYPE: Record<
  "standard" | "rush" | "same_day",
  "standard" | "rush" | "licensed"
> = {
  standard: "standard",
  rush: "rush",
  same_day: "rush",
};

// ── Types ─────────────────────────────────────────────────────────────────────

const DOC_CATEGORIES = [
  { id: "family_court", label: "Family Court", desc: "Divorce, custody, child support", icon: Home, licensed: false },
  { id: "small_claims", label: "Small Claims", desc: "Property disputes up to $10K", icon: Scale, licensed: false },
  { id: "civil_litigation", label: "Civil Litigation", desc: "Lawsuits, complaints, summons", icon: Gavel, licensed: true },
  { id: "eviction", label: "Eviction Notice", desc: "Unlawful detainer, pay or quit", icon: FileWarning, licensed: false },
  { id: "subpoena", label: "Subpoena", desc: "Court-ordered appearance or records", icon: FileText, licensed: true },
  { id: "other", label: "Other Documents", desc: "Anything else requiring service", icon: MoreHorizontal, licensed: false },
] as const;

const URGENCY_TIERS = [
  { id: "standard", label: "Standard", desc: "3–5 business days", price: 75, icon: Clock, priceLabel: "$75" },
  { id: "rush", label: "Rush", desc: "24–48 hours", price: 95, icon: Zap, priceLabel: "$95" },
  { id: "same_day", label: "Same Day", desc: "Within hours", price: 150, icon: Rocket, priceLabel: "$150" },
] as const;

interface UploadedFile { id: string; name: string; size: number; file: File }

interface ServedDocItem {
  /** Stable id used for React `key` only — never sent to the server. */
  uid: string;
  title: string;
  documentType: string;
}

interface JobForm {
  jobTitle: string;
  // Requester contact snapshot — captured at job creation, required at
  // publish time for affidavit attribution.
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  caseNumber: string;
  matterName: string;
  // Nevada affidavit caption + documents-served catalogue. Optional —
  // requesters who don't know yet can leave blank and the affidavit will
  // fall back to documentType.
  courtName: string;
  petitioner: string;
  respondent: string;
  documentsServed: ServedDocItem[];
  docCategory: string;
  urgency: "standard" | "rush" | "same_day";
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  notes: string;
  files: UploadedFile[];
  documentHandling: "prints" | "pickup";
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupContactName: string;
  pickupContactPhone: string;
}

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

function newDocItem(): ServedDocItem {
  return {
    uid: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: "",
    documentType: "Summons",
  };
}

/**
 * A documents-served row is publish-valid when:
 *  - a document type is selected, AND
 *  - if the type is "Other", a custom free-text title was entered.
 * Non-Other types may leave the title blank (the affidavit will use the
 * type as the line text).
 */
function isDocItemValid(d: ServedDocItem): boolean {
  const type = d.documentType.trim();
  if (!type) return false;
  if (type === "Other") return d.title.trim().length > 0;
  return true;
}

const STEPS = ["Document", "Recipient", "Files", "Review"] as const;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={cn(
            "flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-all",
            i < current ? "bg-emerald-400 text-black" :
            i === current ? "bg-amber-400 text-black" :
            "bg-gray-200 text-gray-400"
          )}>
            {i < current ? <Check className="w-3.5 h-3.5" /> : i + 1}
          </div>
          <span className={cn("text-xs font-semibold hidden sm:block", i === current ? "text-gray-900" : "text-gray-400")}>
            {s}
          </span>
          {i < STEPS.length - 1 && (
            <ChevronRight className={cn("w-3 h-3 mx-0.5", i < current ? "text-emerald-400" : "text-gray-300")} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Document ──────────────────────────────────────────────────────────

function StepDocument({ form, setForm }: { form: JobForm; setForm: (f: Partial<JobForm>) => void }) {
  const tier = URGENCY_TIERS.find((t) => t.id === form.urgency)!;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Document Type</h2>
        <p className="text-sm text-gray-500 mt-0.5">What kind of documents need to be served?</p>
      </div>

      {/* Job title */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Job Title</label>
        <input
          value={form.jobTitle}
          onChange={(e) => setForm({ jobTitle: e.target.value })}
          placeholder="e.g., Serve Divorce Petition — Las Vegas"
          className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      </div>

      {/* Requester contact — captured as snapshot on the affidavit's
          REQUESTING PARTY block. Name + email are required to publish;
          phone is optional. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
        <div>
          <p className="text-sm font-bold text-gray-900">Your Contact Info</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Printed on the affidavit so the court knows who hired the platform to effect service.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              data-testid="input-requester-name"
              value={form.requesterName}
              onChange={(e) => setForm({ requesterName: e.target.value })}
              placeholder="Jane Smith"
              className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              data-testid="input-requester-email"
              type="email"
              value={form.requesterEmail}
              onChange={(e) => setForm({ requesterEmail: e.target.value })}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Phone <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            data-testid="input-requester-phone"
            type="tel"
            value={form.requesterPhone}
            onChange={(e) => setForm({ requesterPhone: e.target.value })}
            placeholder="(702) 555-0123"
            className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>

      {/* Case / matter */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Case Number <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            value={form.caseNumber}
            onChange={(e) => setForm({ caseNumber: e.target.value })}
            placeholder="e.g., CV-2026-04821"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">Matter Name <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            value={form.matterName}
            onChange={(e) => setForm({ matterName: e.target.value })}
            placeholder="e.g., Smith v. Jones"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>

      {/* Court name (Nevada caption) */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Court Name <span className="text-gray-400 font-normal">(for affidavit caption)</span>
        </label>
        <input
          value={form.courtName}
          onChange={(e) => setForm({ courtName: e.target.value })}
          placeholder="e.g., Eighth Judicial District Court, Clark County, Nevada"
          className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
        />
      </div>

      {/* Petitioner / Respondent (caption parties) */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Petitioner / Plaintiff <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            value={form.petitioner}
            onChange={(e) => setForm({ petitioner: e.target.value })}
            placeholder="e.g., Jane Smith"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            Respondent / Defendant <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            value={form.respondent}
            onChange={(e) => setForm({ respondent: e.target.value })}
            placeholder="e.g., John Jones"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>

      {/* Documents-served list lives on the Files step now (visually
          coupled with the upload zone). It used to render here. */}

      {/* Document category */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2">Document Category</label>
        <div className="grid grid-cols-2 gap-3">
          {DOC_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const selected = form.docCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setForm({ docCategory: cat.id })}
                className={cn(
                  "text-left p-4 rounded-xl border transition-all",
                  selected
                    ? "border-amber-400 bg-amber-50"
                    : "border-gray-200 bg-white hover:border-amber-200 hover:bg-amber-50/40"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0", selected ? "bg-amber-100" : "bg-gray-100")}>
                    <Icon className={cn("w-3.5 h-3.5", selected ? "text-amber-600" : "text-gray-400")} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{cat.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{cat.desc}</p>
                    {cat.licensed && (
                      <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                        Licensed Server
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Urgency */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2">Urgency</label>
        <div className="grid grid-cols-3 gap-3">
          {URGENCY_TIERS.map((t) => {
            const Icon = t.icon;
            const selected = form.urgency === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setForm({ urgency: t.id })}
                className={cn(
                  "text-left p-4 rounded-xl border transition-all",
                  selected
                    ? "border-amber-400 bg-amber-50"
                    : "border-gray-200 bg-white hover:border-amber-200"
                )}
              >
                <Icon className={cn("w-4 h-4 mb-2", selected ? "text-amber-500" : "text-gray-400")} />
                <p className="text-sm font-bold text-gray-900">{t.label}</p>
                <p className="text-xs text-gray-500">{t.desc}</p>
                <p className={cn("text-base font-black mt-1", selected ? "text-amber-600" : "text-gray-700")}>
                  {t.priceLabel}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Price summary */}
      <div className="flex items-center justify-between p-4 bg-gray-900 rounded-xl text-white">
        <div>
          <p className="text-xs text-gray-400">Estimated total</p>
          <p className="text-xl font-black">${tier.price}<span className="text-sm font-normal text-gray-400"> one-time</span></p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">{tier.label} · {tier.desc}</p>
          <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1 justify-end">
            <ShieldCheck className="w-3 h-3" /> Affidavit included
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Recipient ─────────────────────────────────────────────────────────

function StepRecipient({ form, setForm }: { form: JobForm; setForm: (f: Partial<JobForm>) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Who to Serve</h2>
        <p className="text-sm text-gray-500 mt-0.5">Enter the recipient's name and service address.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Recipient Full Name</label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={form.recipientName}
            onChange={(e) => setForm({ recipientName: e.target.value })}
            placeholder="John Doe"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Street Address</label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={form.recipientAddress}
            onChange={(e) => setForm({ recipientAddress: e.target.value })}
            placeholder="123 Main St"
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">City</label>
          <input
            value={form.recipientCity}
            onChange={(e) => setForm({ recipientCity: e.target.value })}
            placeholder="Las Vegas"
            className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">State</label>
            <select
              value={form.recipientState}
              onChange={(e) => setForm({ recipientState: e.target.value })}
              className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            >
              <option value="">—</option>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Zip</label>
            <input
              value={form.recipientZip}
              onChange={(e) => setForm({ recipientZip: e.target.value })}
              placeholder="89101"
              maxLength={5}
              className="w-full px-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes for Server <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ notes: e.target.value })}
          placeholder="Gate code: 1234. Best time is 9am–5pm on weekdays."
          rows={3}
          className="w-full px-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400 resize-none"
        />
      </div>
    </div>
  );
}

// ── Step 3: Files ─────────────────────────────────────────────────────────────

function StepFiles({ form, setForm }: { form: JobForm; setForm: (f: Partial<JobForm>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: UploadedFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${Date.now()}`,
      name: f.name,
      size: f.size,
      file: f,
    }));
    setForm({ files: [...form.files, ...newFiles] });
  }, [form.files, setForm]);

  const removeFile = (id: string) => setForm({ files: form.files.filter((f) => f.id !== id) });

  const hasFiles = form.files.length > 0;
  // "Server prints" only makes sense when a PDF/photo is uploaded — otherwise
  // there's nothing for them to print. Force pickup when no file is attached.
  const printsAvailable = hasFiles;
  const handling = form.documentHandling;

  // If the user removes their last file while handling = prints, flip them to
  // pickup so we don't end up in an invalid state.
  useEffect(() => {
    if (!printsAvailable && handling === "prints") {
      setForm({ documentHandling: "pickup" });
    }
  }, [printsAvailable, handling, setForm]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Attach Documents</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Itemize the documents to be served, then upload the file(s).
          The list below is what prints on your affidavit.
        </p>
      </div>

      {/* Documents-served catalogue. Required: at least one row with a
          document type, and if "Other" is selected the custom title
          must be filled. The affidavit prints these verbatim. */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900">
              Documents to Serve <span className="text-red-500">*</span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Add one row per document. The exact list appears on the affidavit.
            </p>
          </div>
          <button
            type="button"
            data-testid="button-add-document"
            onClick={() =>
              setForm({ documentsServed: [...form.documentsServed, newDocItem()] })
            }
            className="text-xs font-semibold text-amber-600 hover:text-amber-700"
          >
            + Add document
          </button>
        </div>
        {form.documentsServed.length === 0 ? (
          <button
            type="button"
            onClick={() =>
              setForm({ documentsServed: [...form.documentsServed, newDocItem()] })
            }
            className="w-full text-xs text-gray-500 px-3 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-lg hover:border-amber-300 hover:bg-amber-50/40 transition-colors"
          >
            No documents added yet — click "Add document" to start.
          </button>
        ) : (
          <div className="space-y-2">
            {form.documentsServed.map((d, idx) => {
              const isOther = d.documentType === "Other";
              const titleMissing = isOther && d.title.trim().length === 0;
              return (
                <div key={d.uid} className="grid grid-cols-[1fr,200px,32px] gap-2 items-start">
                  <div>
                    <input
                      data-testid={`input-document-title-${idx}`}
                      value={d.title}
                      spellCheck
                      onChange={(e) => {
                        const next = [...form.documentsServed];
                        next[idx] = { ...d, title: e.target.value };
                        setForm({ documentsServed: next });
                      }}
                      placeholder={
                        isOther
                          ? "Custom document name (required)"
                          : "Optional descriptive name (e.g., Summons in a Civil Case)"
                      }
                      className={cn(
                        "w-full px-3 py-2 text-sm bg-gray-50 border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400",
                        titleMissing
                          ? "border-red-300 bg-red-50"
                          : "border-gray-200",
                      )}
                    />
                    {titleMissing && (
                      <p className="text-[11px] text-red-600 mt-1">
                        Required when "Other" is selected.
                      </p>
                    )}
                  </div>
                  <select
                    data-testid={`select-document-type-${idx}`}
                    value={d.documentType}
                    onChange={(e) => {
                      const next = [...form.documentsServed];
                      next[idx] = { ...d, documentType: e.target.value };
                      setForm({ documentsServed: next });
                    }}
                    className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                  >
                    {DOC_TYPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Remove document"
                    onClick={() =>
                      setForm({
                        documentsServed: form.documentsServed.filter((_, i) => i !== idx),
                      })
                    }
                    className="text-gray-400 hover:text-red-500 text-lg leading-none mt-2"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={cn(
          "border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors",
          dragging ? "border-amber-400 bg-amber-50" : "border-gray-200 hover:border-amber-300 hover:bg-amber-50/40 bg-white"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-3">
          <Upload className="w-5 h-5 text-amber-500" />
        </div>
        <p className="text-sm font-semibold text-gray-700">
          Drop files here or <span className="text-amber-600">browse</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG — up to 25 MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          data-testid="input-files"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {hasFiles && (
        <div className="space-y-2">
          {form.files.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl">
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <FileIcon className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{f.name}</p>
                <p className="text-xs text-gray-400">{fmt(f.size)}</p>
              </div>
              <button type="button" onClick={() => removeFile(f.id)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-400 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Document handling */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-2">Document Handling</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            data-testid="radio-handling-prints"
            disabled={!printsAvailable}
            onClick={() => setForm({ documentHandling: "prints" })}
            className={cn(
              "text-left p-4 rounded-xl border transition-all",
              handling === "prints" && printsAvailable
                ? "border-amber-400 bg-amber-50"
                : "border-gray-200 bg-white hover:border-amber-200",
              !printsAvailable && "opacity-50 cursor-not-allowed",
            )}
          >
            <Printer className={cn("w-4 h-4 mb-2", handling === "prints" ? "text-amber-500" : "text-gray-400")} />
            <p className="text-sm font-bold text-gray-900">Server prints</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {printsAvailable
                ? "We'll print the uploaded documents and serve them."
                : "Upload a PDF above to enable this option."}
            </p>
          </button>
          <button
            type="button"
            data-testid="radio-handling-pickup"
            onClick={() => setForm({ documentHandling: "pickup" })}
            className={cn(
              "text-left p-4 rounded-xl border transition-all",
              handling === "pickup"
                ? "border-amber-400 bg-amber-50"
                : "border-gray-200 bg-white hover:border-amber-200",
            )}
          >
            <Package className={cn("w-4 h-4 mb-2", handling === "pickup" ? "text-amber-500" : "text-gray-400")} />
            <p className="text-sm font-bold text-gray-900">Server picks up</p>
            <p className="text-xs text-gray-500 mt-0.5">
              We'll collect physical documents from the address you provide.
            </p>
          </button>
        </div>
      </div>

      {handling === "pickup" && (
        <div className="space-y-3 p-4 rounded-xl border border-amber-200 bg-amber-50/40">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-amber-500" />
            <p className="text-sm font-bold text-gray-900">Pickup details</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Pickup Street Address</label>
            <input
              data-testid="input-pickup-address"
              value={form.pickupAddress}
              onChange={(e) => setForm({ pickupAddress: e.target.value })}
              placeholder="500 Lawyer Lane, Suite 200"
              className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">City</label>
              <input
                data-testid="input-pickup-city"
                value={form.pickupCity}
                onChange={(e) => setForm({ pickupCity: e.target.value })}
                placeholder="Las Vegas"
                className="w-full px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">State</label>
                <select
                  data-testid="input-pickup-state"
                  value={form.pickupState}
                  onChange={(e) => setForm({ pickupState: e.target.value })}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                >
                  <option value="">—</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Zip</label>
                <input
                  data-testid="input-pickup-zip"
                  value={form.pickupZip}
                  onChange={(e) => setForm({ pickupZip: e.target.value })}
                  placeholder="89101"
                  maxLength={5}
                  className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Contact Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  data-testid="input-pickup-contact-name"
                  value={form.pickupContactName}
                  onChange={(e) => setForm({ pickupContactName: e.target.value })}
                  placeholder="Paralegal name"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Contact Phone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  data-testid="input-pickup-contact-phone"
                  value={form.pickupContactPhone}
                  onChange={(e) => setForm({ pickupContactPhone: e.target.value })}
                  placeholder="(702) 555-0123"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-amber-700 flex items-start gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            The assigned server will navigate to this pickup address before the recipient.
          </p>
        </div>
      )}

      {!hasFiles && handling === "pickup" && (
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <ShieldCheck className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            No PDF uploaded — the server will collect the physical documents from your pickup address.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Review + Checkout ─────────────────────────────────────────────────

function StepReview({ form, onCheckout, checkingOut }: { form: JobForm; onCheckout: () => void; checkingOut: boolean }) {
  const tier = URGENCY_TIERS.find((t) => t.id === form.urgency)!;
  const cat = DOC_CATEGORIES.find((c) => c.id === form.docCategory);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Review & Pay</h2>
        <p className="text-sm text-gray-500 mt-0.5">Confirm your details before checkout.</p>
      </div>

      {/* Job summary */}
      <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Job Details</p>
          <p className="text-sm font-bold text-gray-900">{form.jobTitle || "Untitled Job"}</p>
          {form.caseNumber && <p className="text-xs text-gray-500 mt-0.5">Case #{form.caseNumber}</p>}
          {form.matterName && <p className="text-xs text-gray-500">{form.matterName}</p>}
          <div className="flex items-center gap-2 mt-2">
            {cat && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {cat.label}
              </span>
            )}
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full",
              tier.id === "same_day" ? "bg-red-100 text-red-700" :
              tier.id === "rush" ? "bg-orange-100 text-orange-700" :
              "bg-gray-100 text-gray-600"
            )}>
              {tier.label}
            </span>
          </div>
        </div>
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Requesting Party</p>
          <p className="text-sm font-bold text-gray-900">{form.requesterName.trim() || "—"}</p>
          {form.requesterEmail.trim() && (
            <p className="text-xs text-gray-500 mt-0.5">{form.requesterEmail.trim()}</p>
          )}
          {form.requesterPhone.trim() && (
            <p className="text-xs text-gray-500">{form.requesterPhone.trim()}</p>
          )}
        </div>
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Documents to Serve</p>
          {form.documentsServed.length > 0 ? (
            <ul className="text-xs text-gray-700 space-y-0.5 list-disc list-inside">
              {form.documentsServed.map((d) => {
                const t = d.title.trim() || d.documentType.trim();
                const showType =
                  d.documentType.trim() &&
                  d.documentType.trim() !== t &&
                  d.documentType.trim().toLowerCase() !== "other";
                return (
                  <li key={d.uid}>
                    {t}{showType ? ` (${d.documentType.trim()})` : ""}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">No documents added.</p>
          )}
        </div>
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Recipient</p>
          <p className="text-sm font-bold text-gray-900">{form.recipientName || "—"}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {[form.recipientAddress, form.recipientCity, form.recipientState, form.recipientZip].filter(Boolean).join(", ") || "No address provided"}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Documents</p>
          <div className="flex items-center gap-2 mb-2">
            {form.documentHandling === "pickup" ? (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                <Package className="w-3 h-3" /> Server picks up
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                <Printer className="w-3 h-3" /> Server prints
              </span>
            )}
          </div>
          {form.files.length > 0
            ? form.files.map((f) => (
                <p key={f.id} className="text-xs text-gray-700 truncate">{f.name}</p>
              ))
            : <p className="text-xs text-gray-400">No files uploaded</p>}
          {form.documentHandling === "pickup" && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pickup at</p>
              <p className="text-xs text-gray-700 mt-0.5">
                {[form.pickupAddress, form.pickupCity, form.pickupState, form.pickupZip].filter(Boolean).join(", ") || "—"}
              </p>
              {(form.pickupContactName || form.pickupContactPhone) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Contact: {form.pickupContactName} · {form.pickupContactPhone}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Price breakdown */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Price Breakdown</p>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{tier.label} Process Serving</span>
          <span className="font-bold">${tier.price}.00</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Digital Affidavit of Service</span>
          <span className="text-emerald-600 font-semibold">Included</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>GPS Tracking & Real-time Updates</span>
          <span className="text-emerald-600 font-semibold">Included</span>
        </div>
        <div className="h-px bg-gray-100" />
        <div className="flex justify-between text-base font-black">
          <span>Total</span>
          <span>${tier.price}.00</span>
        </div>
      </div>

      {/* Checkout CTA */}
      <button
        type="button"
        onClick={onCheckout}
        disabled={checkingOut}
        className="w-full flex items-center justify-center gap-2 py-4 bg-amber-400 hover:bg-amber-500 disabled:opacity-60 text-black font-black text-sm rounded-2xl transition-colors shadow-sm"
      >
        {checkingOut ? (
          <><Loader2 className="w-4 h-4 animate-spin" />Redirecting to payment...</>
        ) : (
          <><CreditCard className="w-4 h-4" />Pay ${tier.price}.00 — Secure Checkout</>
        )}
      </button>
      <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1">
        <ShieldCheck className="w-3 h-3" /> Secured by Stripe · No payment info stored on SERVED.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY_FORM: JobForm = {
  jobTitle: "",
  requesterName: "", requesterEmail: "", requesterPhone: "",
  caseNumber: "", matterName: "",
  courtName: "", petitioner: "", respondent: "", documentsServed: [],
  docCategory: "",
  urgency: "standard", recipientName: "", recipientAddress: "",
  recipientCity: "", recipientState: "", recipientZip: "",
  notes: "", files: [],
  documentHandling: "prints",
  pickupAddress: "", pickupCity: "", pickupState: "", pickupZip: "",
  pickupContactName: "", pickupContactPhone: "",
};

export default function RequesterPostJob() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [form, setFormState] = useState<JobForm>(EMPTY_FORM);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createJob = useCreateJob();

  const setForm = (partial: Partial<JobForm>) => setFormState((prev) => ({ ...prev, ...partial }));

  const canNext = () => {
    if (step === 0) {
      // Document step: job title, requester name + valid email, doc
      // category. Phone is optional.
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.requesterEmail.trim(),
      );
      return (
        form.jobTitle.trim().length > 0 &&
        form.requesterName.trim().length > 0 &&
        emailOk &&
        form.docCategory.length > 0
      );
    }
    if (step === 1) return form.recipientName.trim().length > 0 && form.recipientAddress.trim().length > 0 && form.recipientCity.trim().length > 0;
    if (step === 2) {
      // Step 3 (Files): require at least one valid documents-served row
      // (universal, all jurisdictions). Then either prints (≥1 file) or
      // pickup (all pickup fields).
      const docOk = form.documentsServed.some(isDocItemValid);
      if (!docOk) return false;
      if (form.documentHandling === "pickup") {
        return (
          form.pickupAddress.trim().length > 0 &&
          form.pickupCity.trim().length > 0 &&
          form.pickupState.trim().length > 0 &&
          form.pickupZip.trim().length > 0 &&
          form.pickupContactName.trim().length > 0 &&
          form.pickupContactPhone.trim().length > 0
        );
      }
      return form.files.length > 0;
    }
    return true;
  };

  // The Review-step "Pay & Post" button:
  //  1. Create the job row in the DB with status=pending_payment so it has
  //     a stable id and is owned by the requester.
  //  2. Hand the jobId to Stripe Checkout via metadata.
  //  3. Stripe webhook (`checkout.session.completed`) flips status to
  //     `pending`, at which point it becomes visible to servers.
  // The matter, recipient, files, etc. are all persisted on step 1 so even
  // if the user abandons checkout we have the full draft saved in their
  // "My Jobs" list (visible because requesters see all their own jobs
  // including pending_payment ones).
  const handleCheckout = async () => {
    setCheckingOut(true);
    setError(null);
    try {
      // Publish-time gate (mirrors the API). Universal: requester
      // name + email + at least one valid documents-served row. Nevada
      // adds court name + petitioner + respondent. Surface friendly
      // errors before the Stripe redirect rather than letting the API
      // 400 unwrap mid-checkout.
      const missing: string[] = [];
      if (!form.requesterName.trim()) missing.push("your full name");
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        form.requesterEmail.trim(),
      );
      if (!emailOk) missing.push("a valid email");
      const docOk = form.documentsServed.some(isDocItemValid);
      if (!docOk) missing.push("at least one document (with a type)");
      const isNevada =
        form.recipientState.trim().toUpperCase() === "NV";
      if (isNevada) {
        if (!form.courtName.trim()) missing.push("court name");
        if (!form.petitioner.trim()) missing.push("petitioner");
        if (!form.respondent.trim()) missing.push("respondent");
      }
      if (missing.length > 0) {
        setError(
          `Please go back and add: ${missing.join(", ")}.`,
        );
        setCheckingOut(false);
        return;
      }

      const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

      // 1. Persist the draft job.
      const matterTitle = form.matterName?.trim() || form.jobTitle.trim();
      const created = await createJob.mutateAsync({
        data: {
          documentType: form.docCategory,
          recipientName: form.recipientName.trim(),
          recipientAddress: form.recipientAddress.trim(),
          recipientCity: form.recipientCity.trim(),
          recipientState: form.recipientState.trim() || "CA",
          recipientZip: form.recipientZip.trim() || "00000",
          caseNumber: form.caseNumber.trim() || undefined,
          matterName: matterTitle || undefined,
          requesterName: form.requesterName.trim(),
          requesterEmail: form.requesterEmail.trim(),
          requesterPhone: form.requesterPhone.trim() || undefined,
          courtName: form.courtName.trim() || undefined,
          petitioner: form.petitioner.trim() || undefined,
          respondent: form.respondent.trim() || undefined,
          documentsServed: form.documentsServed
            .filter(isDocItemValid)
            .map((d) => ({
              // Title falls back to the type when the user didn't
              // type a custom name. "Other" rows always have a title
              // (enforced by isDocItemValid).
              title: d.title.trim() || d.documentType.trim(),
              documentType: d.documentType.trim() || "Other",
            })),
          notes: form.notes.trim() || undefined,
          serviceType: URGENCY_TO_SERVICE_TYPE[form.urgency],
          initialStatus: "pending_payment",
          documentHandling: form.documentHandling,
          ...(form.documentHandling === "pickup"
            ? {
                pickupAddress: form.pickupAddress.trim(),
                pickupCity: form.pickupCity.trim(),
                pickupState: form.pickupState.trim(),
                pickupZip: form.pickupZip.trim(),
                pickupContactName: form.pickupContactName.trim(),
                pickupContactPhone: form.pickupContactPhone.trim(),
              }
            : {}),
        },
      });

      // 1b. Upload attached files (if any) and link them to the new job.
      if (form.files.length > 0) {
        for (const uf of form.files) {
          const ct = uf.file.type || "application/octet-stream";
          const reserveRes = await fetch(`${basePath}/api/storage/uploads/request-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: uf.name,
              size: uf.size,
              contentType: ct,
              jobId: created.id,
            }),
          });
          if (!reserveRes.ok) continue;
          const { uploadURL, objectPath } = await reserveRes.json();

          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": ct },
            body: uf.file,
          });

          await fetch(`${basePath}/api/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ objectPath, name: uf.name, size: uf.size, contentType: ct }),
          });
        }
      }

      // 2. Pull current Stripe price for the chosen urgency tier.
      const res = await fetch(`${basePath}/api/stripe/products`);
      const { data: products } = await res.json();

      const tierMap: Record<string, string> = {
        standard: "Standard Process Serving",
        rush: "Rush Process Serving",
        same_day: "Same Day Process Serving",
      };

      const productName = tierMap[form.urgency];
      const product = products?.find((p: any) => p.name === productName);
      const price = product?.prices?.[0];

      if (!price?.id) {
        setError(
          "Your job was saved but we couldn't load checkout pricing. " +
            "Open it from My Jobs and try paying again, or contact support.",
        );
        setCheckingOut(false);
        return;
      }

      // 3. Stripe Checkout, with jobId so the webhook can publish the row.
      const checkoutRes = await fetch(`${basePath}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: price.id,
          jobTitle: form.jobTitle,
          recipientName: form.recipientName,
          jobId: created.id,
        }),
      });

      const { url, error: checkoutError } = await checkoutRes.json();
      if (checkoutError || !url) {
        setError(
          (checkoutError as string) ||
            "Job saved, but checkout couldn't start. Try again from My Jobs.",
        );
        setCheckingOut(false);
        return;
      }

      redirectTopLevel(url);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Network error. Please check your connection and try again.";
      setError(msg);
      setCheckingOut(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => step === 0 ? setLocation("/app/requester/dashboard") : setStep(step - 1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-gray-600" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center">
              <FilePlus className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">Post a Job</h1>
          </div>
          <p className="text-xs text-gray-500">Get your documents served fast</p>
        </div>
      </div>

      {/* Step bar */}
      <div className="bg-white border border-gray-200 rounded-xl px-3 sm:px-5 py-3">
        <StepBar current={step} />
      </div>

      {/* Step content */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6">
        {step === 0 && <StepDocument form={form} setForm={setForm} />}
        {step === 1 && <StepRecipient form={form} setForm={setForm} />}
        {step === 2 && <StepFiles form={form} setForm={setForm} />}
        {step === 3 && <StepReview form={form} onCheckout={handleCheckout} checkingOut={checkingOut} />}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Navigation */}
      {step < 3 && (
        <div className="flex justify-between">
          <button
            onClick={() => step === 0 ? setLocation("/app/requester/dashboard") : setStep(step - 1)}
            className="px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <button
            data-testid={step === 2 ? "button-requester-review-order" : "button-requester-continue"}
            onClick={() => setStep(step + 1)}
            disabled={!canNext()}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-400 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold text-sm rounded-lg transition-colors"
          >
            {step === 2 ? "Review Order" : "Continue"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
