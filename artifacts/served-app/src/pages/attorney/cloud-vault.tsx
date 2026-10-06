import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDocuments,
  useGetDocumentUsage,
  useDeleteDocument,
  getListDocumentsQueryKey,
  getGetDocumentUsageQueryKey,
} from "@workspace/api-client-react";
import {
  Cloud,
  Upload,
  Trash2,
  Loader2,
  AlertCircle,
  FileText,
  Download,
} from "lucide-react";
import { format } from "date-fns";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiBase = `${basePath}/api`;

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function planLabel(p: string): string {
  switch (p) {
    case "solo": return "Solo";
    case "firm": return "Firm";
    case "firm_pro": return "Firm Pro";
    case "enterprise": return "Enterprise";
    default: return p;
  }
}

export function CloudVault() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const usage = useGetDocumentUsage();
  const docs = useListDocuments();
  const del = useDeleteDocument();

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = usage.data?.usedBytes ?? 0;
  const quota = usage.data?.quotaBytes ?? 0;
  const unlimited = quota < 0;
  const pct = unlimited || quota === 0 ? 0 : Math.min(100, (used / quota) * 100);
  const plan = usage.data?.plan ?? "firm";

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const r1 = await fetch(`${apiBase}/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!r1.ok) {
        const body = await r1.json().catch(() => ({}));
        if (r1.status === 413) throw new Error(body.error || "Storage quota exceeded for plan");
        throw new Error(body.error || `Upload URL failed (${r1.status})`);
      }
      const { uploadURL, objectPath } = await r1.json();

      const r2 = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!r2.ok) throw new Error(`Upload to storage failed (${r2.status})`);

      const r3 = await fetch(`${apiBase}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
          objectPath,
        }),
      });
      if (!r3.ok) {
        const body = await r3.json().catch(() => ({}));
        throw new Error(body.error || `Recording document failed (${r3.status})`);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDocumentUsageQueryKey() }),
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(id: number) {
    setError(null);
    try {
      await del.mutateAsync({ id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDocumentUsageQueryKey() }),
      ]);
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
            <Cloud className="w-5 h-5 text-sky-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">Cloud Vault</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Encrypted document storage included with your {planLabel(plan)} plan.
            </p>
          </div>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload document"}
          </button>
        </div>
      </div>

      {/* Usage bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-gray-600 font-medium">
            {fmtBytes(used)} of {unlimited ? "unlimited" : fmtBytes(quota)} used
          </span>
          {!unlimited && (
            <span className="text-gray-400">{pct.toFixed(1)}%</span>
          )}
        </div>
        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: unlimited ? "0%" : `${pct}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Documents list */}
      <div>
        {docs.isLoading ? (
          <div className="text-sm text-gray-500 py-4 text-center">Loading documents…</div>
        ) : (docs.data?.length ?? 0) === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
            No documents uploaded yet.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {docs.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{d.name}</p>
                  <p className="text-xs text-gray-500">
                    {fmtBytes(Number(d.size))} · {format(new Date(d.createdAt), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
                <a
                  href={`${apiBase}/storage${d.objectPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md text-gray-500 hover:text-sky-600 hover:bg-gray-50"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  type="button"
                  onClick={() => onDelete(d.id)}
                  className="p-2 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
