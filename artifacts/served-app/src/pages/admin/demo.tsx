/**
 * Admin → Demo. Carla previews the attorney explainer (90-sec animated
 * video) inline and emails a tokenised watch link to a prospect from
 * `info@servedapp.co`. Each send is logged in the admin audit table.
 *
 * The send endpoint (`POST /api/admin/demo/invites`) is intentionally
 * NOT in the OpenAPI spec — admin endpoints stay off the public schema
 * to keep them off external tooling. We hand-roll the fetch here.
 */
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Play, Send, CheckCircle2, Copy } from "lucide-react";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

interface SendResult {
  id: number;
  token: string;
  recipientEmail: string;
  recipientName: string | null;
  expiresAt: string;
  watchUrl: string;
  delivered: boolean;
}

async function postSend(body: {
  recipientEmail: string;
  recipientName?: string;
}): Promise<SendResult> {
  const res = await fetch(`${apiBase}/admin/demo/invites`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) msg = parsed.error;
    } catch {
      /* keep raw */
    }
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as SendResult;
}

export default function AdminDemoPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<SendResult | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      const result = await postSend({
        recipientEmail: email.trim(),
        recipientName: name.trim() || undefined,
      });
      setLastSend(result);
      setName("");
      setEmail("");
      toast({
        title: result.delivered ? "Demo sent" : "Saved (email queued)",
        description: result.delivered
          ? `Watch link emailed to ${result.recipientEmail}.`
          : `Invite saved but the email transport returned an error — share the link manually.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't send demo",
        description: err?.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  // The attorney-demo artifact is mounted at /attorney-demo/ via the shared
  // proxy. The animated video auto-plays on load.
  const previewSrc = "/attorney-demo/";

  return (
    <div className="min-h-full bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Play className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Attorney demo</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Send a tokenised watch link to a prospect. Each link is gated by
              the recipient's email and expires in 30 days.
            </p>
          </div>
        </div>
      </div>

      <div className="px-8 py-8 grid grid-cols-1 xl:grid-cols-[1fr,420px] gap-8 max-w-[1600px]">
        {/* Preview */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Preview
            </h2>
            <a
              href={previewSrc}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-500 hover:text-gray-900 underline"
            >
              Open in new tab
            </a>
          </div>
          <div className="aspect-video rounded-2xl overflow-hidden border border-gray-200 bg-black shadow-lg">
            <iframe
              key={previewSrc}
              src={previewSrc}
              title="SERVED. Attorney demo preview"
              className="w-full h-full"
              allow="autoplay"
            />
          </div>
          <p className="text-xs text-gray-500">
            This is the same video the recipient sees after confirming their
            email.
          </p>
        </div>

        {/* Send form + last send */}
        <div className="space-y-6">
          <form
            onSubmit={handleSend}
            className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 shadow-sm"
          >
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Send to a prospect
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                We'll email <span className="font-mono">info@servedapp.co</span>{" "}
                with a personalised link. They confirm their email to watch.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">
                Recipient name <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah Chen"
                disabled={sending}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">
                Recipient email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sarah@firm.com"
                disabled={sending}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-50"
              />
            </div>

            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand-navy text-white font-semibold text-sm hover:bg-brand-navy-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending…" : "Send demo"}
            </button>
          </form>

          {lastSend && <LastSendCard send={lastSend} />}
        </div>
      </div>
    </div>
  );
}

function LastSendCard({ send }: { send: SendResult }) {
  const { toast } = useToast();
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            Sent to {send.recipientName || send.recipientEmail}
          </div>
          <div className="text-xs text-emerald-700 mt-0.5 truncate">
            {send.recipientEmail}
          </div>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-emerald-200 px-3 py-2 flex items-center gap-2">
        <code className="text-[11px] text-gray-700 truncate flex-1 font-mono">
          {send.watchUrl}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(send.watchUrl);
            toast({ title: "Link copied" });
          }}
          className="text-emerald-700 hover:text-emerald-900 p-1 rounded transition-colors"
          aria-label="Copy watch link"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-emerald-700">
        Valid until {new Date(send.expiresAt).toLocaleDateString()}.{" "}
        {send.delivered
          ? "Email delivery confirmed by SendGrid."
          : "Email transport returned an error — copy the link and share manually."}
      </p>
    </div>
  );
}
