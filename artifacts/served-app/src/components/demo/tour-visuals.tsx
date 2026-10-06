import { motion } from "framer-motion";
import {
  MapPin,
  CheckCircle2,
  Camera,
  FileSignature,
  Wallet,
  Search,
  Upload,
  Zap,
  ShieldCheck,
  Star,
  ChevronRight,
  FileText,
  DollarSign,
  Clock,
  Building2,
  User,
  FolderOpen,
  Image as ImageIcon,
} from "lucide-react";
import type { TourRole, TourTheme, TourSlide } from "@/data/tours";

type Props = {
  visual: TourSlide["visual"];
  role: TourRole;
  theme: TourTheme;
};

export function TourVisual({ visual, role, theme }: Props) {
  return (
    <motion.div
      key={visual}
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -8 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="w-full h-full flex items-center justify-center"
    >
      {render(visual, role, theme)}
    </motion.div>
  );
}

function render(visual: TourSlide["visual"], role: TourRole, theme: TourTheme) {
  switch (visual) {
    case "intro":
      return <IntroVisual theme={theme} role={role} />;
    case "outro":
      return <OutroVisual theme={theme} />;
    case "post-job":
      return <PostJobVisual theme={theme} />;
    case "pricing-public":
      return <PublicPricingVisual theme={theme} />;
    case "server-claim":
      return <ServerClaimVisual theme={theme} />;
    case "tracking":
      return <TrackingVisual theme={theme} />;
    case "proof":
      return <ProofVisual theme={theme} />;
    case "tier-table":
      return <TierTableVisual theme={theme} />;
    case "bulk-upload":
      return <BulkUploadVisual theme={theme} />;
    case "dashboard":
      return <DashboardVisual theme={theme} />;
    case "vault":
      return <VaultVisual theme={theme} />;
    case "personal-vault":
      return <PersonalVaultVisual theme={theme} />;
    case "savings":
      return <SavingsVisual theme={theme} />;
    case "job-feed":
      return <JobFeedVisual theme={theme} />;
    case "claim-tap":
      return <ClaimTapVisual theme={theme} />;
    case "mobile-capture":
      return <MobileCaptureVisual theme={theme} />;
    case "affidavit":
      return <AffidavitVisual theme={theme} />;
    case "wallet":
      return <WalletVisual theme={theme} />;
  }
}

/* ----------------------------------- shared shells ----------------------------------- */

function PhoneFrame({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: TourTheme;
}) {
  return (
    <div
      className="relative rounded-[42px] p-3 shadow-2xl"
      style={{
        background:
          "linear-gradient(180deg, #1a2540 0%, #0a1530 100%)",
        boxShadow: `0 30px 80px ${theme.accentSoft}, 0 0 0 1px rgba(255,255,255,0.06)`,
        width: 320,
        height: 600,
      }}
    >
      <div className="absolute top-4 left-1/2 -translate-x-1/2 w-24 h-5 rounded-full bg-black/60 z-10" />
      <div className="w-full h-full rounded-[34px] overflow-hidden bg-[#0f1e3c] flex flex-col">
        {children}
      </div>
    </div>
  );
}

function LaptopFrame({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: TourTheme;
}) {
  return (
    <div className="flex flex-col items-center" style={{ width: 720 }}>
      <div
        className="rounded-t-2xl p-3 w-full"
        style={{
          background: "linear-gradient(180deg, #1a2540 0%, #0a1530 100%)",
          boxShadow: `0 30px 80px ${theme.accentSoft}`,
        }}
      >
        <div className="rounded-lg overflow-hidden bg-[#0f1e3c]" style={{ height: 440 }}>
          {children}
        </div>
      </div>
      <div
        className="h-3 w-[110%] rounded-b-2xl"
        style={{
          background: "linear-gradient(180deg, #1a2540 0%, #0a1530 100%)",
        }}
      />
    </div>
  );
}

function BrandHeader({ theme, title }: { theme: TourTheme; title?: string }) {
  return (
    <div className="flex items-center justify-between px-5 pt-6 pb-3">
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm"
          style={{ background: theme.accent, color: "#0f1e3c" }}
        >
          S.
        </div>
        <div className="text-white font-bold text-sm">{title ?? "SERVED."}</div>
      </div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">
        {theme.badge}
      </div>
    </div>
  );
}

/* ----------------------------------- intro / outro ----------------------------------- */

function IntroVisual({ theme, role }: { theme: TourTheme; role: TourRole }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 720, height: 480 }}>
      <motion.div
        className="absolute inset-0 rounded-3xl opacity-30"
        style={{
          background: `radial-gradient(circle at 30% 50%, ${theme.accent}, transparent 60%)`,
        }}
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <PhoneFrame theme={theme}>
        <BrandHeader theme={theme} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}
          >
            {role === "requester" && <User size={36} style={{ color: theme.accent }} />}
            {role === "attorney" && <Building2 size={36} style={{ color: theme.accent }} />}
            {role === "server" && <Zap size={36} style={{ color: theme.accent }} />}
          </motion.div>
          <div className="text-white text-2xl font-black tracking-tight">
            {role === "requester" && "Get someone served."}
            {role === "attorney" && "Run your firm."}
            {role === "server" && "Get to work."}
          </div>
          <div className="text-slate-400 text-sm mt-2">
            Tap below to begin.
          </div>
          <motion.div
            className="mt-8 w-full py-3 rounded-xl text-center font-bold text-sm"
            style={{ background: theme.accent, color: "#0f1e3c" }}
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            Open SERVED.
          </motion.div>
        </div>
      </PhoneFrame>
    </div>
  );
}

function OutroVisual({ theme }: { theme: TourTheme }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ width: 720, height: 480 }}>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="text-7xl font-black tracking-tight"
        style={{ color: theme.accent }}
      >
        SERVED.
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-slate-300 mt-4 text-xl"
      >
        <span style={{ color: theme.accent }} className="font-semibold">Trust</span> the Process.
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="mt-10 px-5 py-2 rounded-full border text-xs uppercase tracking-widest text-slate-400"
        style={{ borderColor: theme.accentSoft }}
      >
        servedapp.co · info@servedapp.co
      </motion.div>
    </div>
  );
}

/* ----------------------------------- requester visuals ----------------------------------- */

function PostJobVisual({ theme }: { theme: TourTheme }) {
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="New Job" />
      <div className="flex-1 px-5 space-y-3 overflow-hidden">
        <FormField label="Recipient" value="John Smith" theme={theme} delay={0.1} />
        <FormField label="Address" value="2400 W. Sahara Ave, Las Vegas, NV" theme={theme} delay={0.25} />
        <FormField label="Document Type" value="Summons & Complaint" theme={theme} delay={0.4} />
        <FormField label="Service Window" value="Standard · 5 business days" theme={theme} delay={0.55} />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85 }}
          className="mt-6 w-full py-3 rounded-xl text-center font-bold text-sm"
          style={{ background: theme.accent, color: "#0f1e3c" }}
        >
          Continue · $75
        </motion.div>
      </div>
    </PhoneFrame>
  );
}

function FormField({
  label,
  value,
  theme,
  delay,
}: {
  label: string;
  value: string;
  theme: TourTheme;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
    >
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
        {label}
      </div>
      <div
        className="rounded-lg px-3 py-2.5 text-sm text-white"
        style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.accentSoft}` }}
      >
        {value}
      </div>
    </motion.div>
  );
}

function PublicPricingVisual({ theme }: { theme: TourTheme }) {
  const rows = [
    { label: "Standard service", price: "$75", desc: "5 business days" },
    { label: "Rush service", price: "$95", desc: "48 hours" },
    { label: "Same-day", price: "$120+", desc: "Licensed servers" },
  ];
  return (
    <div className="flex flex-col items-center" style={{ width: 560 }}>
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-3">
        Public rates · No subscription
      </div>
      <div className="w-full space-y-3">
        {rows.map((r, i) => (
          <motion.div
            key={r.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.12 }}
            className="flex items-center justify-between rounded-xl px-5 py-4"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${i === 0 ? theme.accent : "rgba(255,255,255,0.08)"}`,
            }}
          >
            <div>
              <div className="text-white font-bold">{r.label}</div>
              <div className="text-slate-500 text-xs mt-0.5">{r.desc}</div>
            </div>
            <div className="text-2xl font-black" style={{ color: theme.accent }}>
              {r.price}
            </div>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-slate-400 text-xs mt-4 text-center max-w-sm"
      >
        Includes mileage, attempt fees, and notarized proof of service.
      </motion.div>
    </div>
  );
}

function ServerClaimVisual({ theme }: { theme: TourTheme }) {
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Server assigned" />
      <div className="flex-1 px-5">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="rounded-2xl p-5 mb-3"
          style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}
        >
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-black" style={{ background: theme.accent, color: "#0f1e3c" }}>
              MR
            </div>
            <div className="flex-1">
              <div className="text-white font-bold">Marcus Reed</div>
              <div className="flex items-center gap-1 mt-0.5">
                <Star size={12} fill={theme.accent} stroke={theme.accent} />
                <span className="text-xs text-slate-300">4.96 · 312 serves</span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Badge icon={<ShieldCheck size={12} />} label="Licensed" theme={theme} />
            <Badge icon={<CheckCircle2 size={12} />} label="Verified" theme={theme} />
            <Badge icon={<MapPin size={12} />} label="Local" theme={theme} />
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <div className="text-slate-400 text-xs mb-1">ETA</div>
          <div className="text-white font-bold">Today · 2:15 PM</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="rounded-xl px-4 py-3 text-sm mt-2"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <div className="text-slate-400 text-xs mb-1">Status</div>
          <div className="text-white font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: theme.accent }} />
            En route
          </div>
        </motion.div>
      </div>
    </PhoneFrame>
  );
}

function Badge({ icon, label, theme }: { icon: React.ReactNode; label: string; theme: TourTheme }) {
  return (
    <div
      className="flex items-center justify-center gap-1 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: "rgba(255,255,255,0.06)", color: theme.accent }}
    >
      {icon}
      {label}
    </div>
  );
}

function TrackingVisual({ theme }: { theme: TourTheme }) {
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Live tracking" />
      <div className="flex-1 relative">
        {/* Map stub */}
        <div
          className="absolute inset-x-3 top-0 bottom-32 rounded-xl overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, #142547 0%, #0a1530 100%)",
          }}
        >
          {/* Grid lines */}
          <svg className="absolute inset-0 w-full h-full opacity-20">
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={`h${i}`} x1="0" y1={i * 35} x2="100%" y2={i * 35} stroke={theme.accent} strokeWidth="0.5" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={`v${i}`} x1={i * 55} y1="0" x2={i * 55} y2="100%" stroke={theme.accent} strokeWidth="0.5" />
            ))}
          </svg>
          {/* Path */}
          <motion.svg className="absolute inset-0 w-full h-full" viewBox="0 0 280 280" preserveAspectRatio="none">
            <motion.path
              d="M 40 240 Q 100 180 140 140 T 240 60"
              stroke={theme.accent}
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="6 6"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.5, ease: "easeInOut" }}
            />
          </motion.svg>
          {/* Markers */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="absolute"
            style={{ left: "12%", bottom: "12%" }}
          >
            <div className="w-3 h-3 rounded-full bg-slate-400 ring-4 ring-slate-400/20" />
          </motion.div>
          <motion.div
            initial={{ left: "12%", bottom: "12%" }}
            animate={{ left: "82%", bottom: "78%" }}
            transition={{ duration: 2.5, ease: "easeInOut" }}
            className="absolute"
          >
            <div
              className="w-4 h-4 rounded-full ring-4"
              style={{ background: theme.accent, boxShadow: `0 0 12px ${theme.accent}` }}
            />
          </motion.div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, type: "spring" }}
            className="absolute"
            style={{ right: "10%", top: "12%" }}
          >
            <MapPin size={20} fill={theme.accent} stroke="#0f1e3c" strokeWidth={2} />
          </motion.div>
        </div>
        {/* Status */}
        <div className="absolute inset-x-3 bottom-3 rounded-xl px-4 py-3" style={{ background: "rgba(15,30,60,0.95)", border: `1px solid ${theme.accentSoft}` }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400">Marcus is</div>
              <div className="text-white font-bold text-sm">2 min away</div>
            </div>
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
              className="w-3 h-3 rounded-full"
              style={{ background: theme.accent }}
            />
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function ProofVisual({ theme }: { theme: TourTheme }) {
  return (
    <div className="flex items-center justify-center">
      <PhoneFrame theme={theme}>
        <BrandHeader theme={theme} title="Service complete" />
        <div className="flex-1 px-5 flex flex-col items-center justify-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 180, damping: 14 }}
            className="w-24 h-24 rounded-full flex items-center justify-center mb-4"
            style={{ background: theme.accentBg, border: `2px solid ${theme.accent}` }}
          >
            <CheckCircle2 size={56} style={{ color: theme.accent }} />
          </motion.div>
          <div className="text-white text-xl font-black text-center">SERVED</div>
          <div className="text-slate-400 text-xs mt-1">Today · 2:24 PM</div>
          <div className="mt-5 w-full space-y-2">
            <ReceiptRow icon={<Camera size={14} />} label="Photo evidence" theme={theme} />
            <ReceiptRow icon={<MapPin size={14} />} label="GPS coordinates" theme={theme} />
            <ReceiptRow icon={<FileSignature size={14} />} label="E-notarized affidavit" theme={theme} />
          </div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-4 w-full rounded-lg px-3 py-2.5 flex items-center justify-between"
            style={{ background: theme.accentBg, border: `1px solid ${theme.accent}` }}
          >
            <div className="flex items-center gap-2">
              <FileText size={14} style={{ color: theme.accent }} />
              <span className="text-white text-xs font-semibold">Affidavit emailed</span>
            </div>
            <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: theme.accent }}>
              Court-ready
            </span>
          </motion.div>
        </div>
      </PhoneFrame>
    </div>
  );
}

function ReceiptRow({ icon, label, theme }: { icon: React.ReactNode; label: string; theme: TourTheme }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-300 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
      <span style={{ color: theme.accent }}>{icon}</span>
      {label}
      <CheckCircle2 size={12} className="ml-auto" style={{ color: theme.accent }} />
    </div>
  );
}

/* ----------------------------------- attorney visuals ----------------------------------- */

function TierTableVisual({ theme }: { theme: TourTheme }) {
  const tiers = [
    { name: "Solo", price: "$99", standard: "$65", rush: "$85", storage: "5 GB", featured: false },
    { name: "Firm", price: "$199", standard: "$60", rush: "$79", storage: "25 GB", featured: false },
    { name: "Firm Pro", price: "$299", standard: "$55", rush: "$72", storage: "100 GB", featured: true },
  ];
  return (
    <div className="grid grid-cols-3 gap-4" style={{ width: 720 }}>
      {tiers.map((t, i) => (
        <motion.div
          key={t.name}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.12 }}
          className="rounded-2xl p-5 relative"
          style={{
            background: t.featured ? theme.accentBg : "rgba(255,255,255,0.03)",
            border: `1px solid ${t.featured ? theme.accent : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {t.featured && (
            <div className="absolute -top-2 left-5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider"
              style={{ background: theme.accent, color: "#0f1e3c" }}>
              MOST POPULAR
            </div>
          )}
          <div className="text-white font-bold text-lg">{t.name}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-black" style={{ color: t.featured ? theme.accent : "#fff" }}>
              {t.price}
            </span>
            <span className="text-xs text-slate-500">/mo</span>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            <Row label="Standard" value={t.standard} />
            <Row label="Rush" value={t.rush} />
            <Row label="Cloud vault" value={t.storage} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-300">
      <span className="text-slate-500">{label}</span>
      <span className="font-bold text-white">{value}</span>
    </div>
  );
}

function BulkUploadVisual({ theme }: { theme: TourTheme }) {
  return (
    <LaptopFrame theme={theme}>
      <div className="h-full flex flex-col">
        <BrandHeader theme={theme} title="Bulk Dispatch" />
        <div className="flex-1 px-6 pb-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center py-8 mb-4"
            style={{ borderColor: theme.accentSoft, background: theme.accentBg }}
          >
            <Upload size={32} style={{ color: theme.accent }} />
            <div className="text-white font-bold mt-2 text-sm">Drop case files here</div>
            <div className="text-slate-400 text-xs mt-1">PDF · DOCX · CSV manifest</div>
          </motion.div>
          <div className="space-y-2">
            {[
              { case: "CV-2026-1142", name: "Garcia v. Sandstone LLC", count: 4 },
              { case: "FC-2026-0847", name: "In re: Marriage of Patel", count: 2 },
              { case: "EV-2026-3301", name: "Westgate Holdings v. Doe", count: 7 },
            ].map((c, i) => (
              <motion.div
                key={c.case}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="flex items-center justify-between rounded-lg px-4 py-2.5"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="flex items-center gap-3">
                  <FileText size={16} style={{ color: theme.accent }} />
                  <div>
                    <div className="text-white text-xs font-bold">{c.name}</div>
                    <div className="text-slate-500 text-[10px]">{c.case}</div>
                  </div>
                </div>
                <div className="text-xs text-slate-300">
                  <span className="font-bold" style={{ color: theme.accent }}>{c.count}</span> defendants
                </div>
              </motion.div>
            ))}
          </div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-4 py-2.5 rounded-lg text-center font-bold text-sm"
            style={{ background: theme.accent, color: "#0f1e3c" }}
          >
            Dispatch 13 serves
          </motion.div>
        </div>
      </div>
    </LaptopFrame>
  );
}

function DashboardVisual({ theme }: { theme: TourTheme }) {
  const jobs = [
    { name: "Patel v. Westgate", status: "En route", color: theme.accent, server: "M. Reed" },
    { name: "Garcia v. Sandstone", status: "Served", color: "#34d399", server: "K. Chen" },
    { name: "In re: Doe", status: "Attempting", color: "#fbbf24", server: "J. Vega" },
    { name: "Hernandez v. CT", status: "Claimed", color: theme.accent, server: "L. Park" },
    { name: "FTC v. Apex", status: "Served", color: "#34d399", server: "T. Diaz" },
  ];
  return (
    <LaptopFrame theme={theme}>
      <div className="h-full flex flex-col">
        <BrandHeader theme={theme} title="Firm Dashboard" />
        <div className="px-6 grid grid-cols-3 gap-3 mb-3">
          {[
            { label: "Active", value: "23", icon: <Clock size={14} /> },
            { label: "Served (mo)", value: "47", icon: <CheckCircle2 size={14} /> },
            { label: "Spend (mo)", value: "$3,128", icon: <DollarSign size={14} /> },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="rounded-lg px-4 py-3"
              style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400">
                <span style={{ color: theme.accent }}>{s.icon}</span>
                {s.label}
              </div>
              <div className="text-white font-black text-xl mt-1">{s.value}</div>
            </motion.div>
          ))}
        </div>
        <div className="px-6 flex-1 overflow-hidden">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Live jobs</div>
          <div className="space-y-1.5">
            {jobs.map((j, i) => (
              <motion.div
                key={j.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.07 }}
                className="flex items-center justify-between rounded-lg px-4 py-2 text-xs"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: j.color }} />
                  <span className="text-white font-bold">{j.name}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-400">
                  <span>{j.server}</span>
                  <span className="font-bold" style={{ color: j.color }}>{j.status}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </LaptopFrame>
  );
}

function VaultVisual({ theme }: { theme: TourTheme }) {
  const folders = [
    { name: "Garcia v. Sandstone", count: 12, date: "Apr 28" },
    { name: "Patel — Marriage", count: 8, date: "Apr 26" },
    { name: "Westgate Holdings", count: 24, date: "Apr 24" },
    { name: "FTC v. Apex Corp", count: 16, date: "Apr 21" },
  ];
  return (
    <LaptopFrame theme={theme}>
      <div className="h-full flex flex-col">
        <BrandHeader theme={theme} title="Cloud Vault · 100 GB" />
        <div className="px-6 mb-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg px-4 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.accentSoft}` }}
          >
            <Search size={14} style={{ color: theme.accent }} />
            <span className="text-slate-400 text-sm">Search by case, client, server, or date…</span>
          </motion.div>
        </div>
        <div className="px-6 grid grid-cols-2 gap-3 flex-1">
          {folders.map((f, i) => (
            <motion.div
              key={f.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              className="rounded-xl p-4"
              style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}
            >
              <FolderOpen size={20} style={{ color: theme.accent }} />
              <div className="text-white font-bold text-sm mt-2">{f.name}</div>
              <div className="text-slate-400 text-xs mt-0.5">
                {f.count} files · updated {f.date}
              </div>
            </motion.div>
          ))}
        </div>
        <div className="px-6 py-3 flex justify-between items-center text-xs text-slate-400">
          <span>23.7 GB used of 100 GB</span>
          <div className="w-32 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: "23.7%" }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="h-full rounded-full"
              style={{ background: theme.accent }}
            />
          </div>
        </div>
      </div>
    </LaptopFrame>
  );
}

function PersonalVaultVisual({ theme }: { theme: TourTheme }) {
  const docs = [
    { name: "Affidavit of Service.pdf", size: "284 KB", date: "Today", icon: "doc" as const, badge: "Notarized" },
    { name: "Photo — Subject identified.jpg", size: "2.1 MB", date: "Today", icon: "img" as const },
    { name: "GPS attempt log.pdf", size: "98 KB", date: "Today", icon: "doc" as const },
    { name: "Original Complaint.pdf", size: "1.4 MB", date: "Apr 24", icon: "doc" as const },
    { name: "Receipt — court filing fee.pdf", size: "62 KB", date: "Apr 22", icon: "doc" as const },
    { name: "Subpoena exhibit A.pdf", size: "412 KB", date: "Apr 21", icon: "doc" as const },
  ];
  return (
    <LaptopFrame theme={theme}>
      <div className="h-full flex flex-col">
        <BrandHeader theme={theme} title="My Vault · Garcia v. Sandstone" />
        <div className="px-6 mb-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg px-4 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.accentSoft}` }}
          >
            <Search size={14} style={{ color: theme.accent }} />
            <span className="text-slate-400 text-sm">Search documents, photos, and logs…</span>
          </motion.div>
        </div>
        <div className="px-6 flex-1 space-y-2 overflow-hidden">
          {docs.map((d, i) => (
            <motion.div
              key={d.name}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              className="rounded-lg px-3 py-2.5 flex items-center gap-3"
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.accentSoft}` }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}
              >
                {d.icon === "doc" ? (
                  <FileText size={16} style={{ color: theme.accent }} />
                ) : (
                  <ImageIcon size={16} style={{ color: theme.accent }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-semibold truncate">{d.name}</div>
                <div className="text-slate-500 text-[11px]">{d.size} · {d.date}</div>
              </div>
              {d.badge && (
                <div
                  className="text-[9px] uppercase tracking-widest font-bold px-2 py-1 rounded shrink-0"
                  style={{ background: theme.accentBg, color: theme.accent, border: `1px solid ${theme.accentSoft}` }}
                >
                  {d.badge}
                </div>
              )}
            </motion.div>
          ))}
        </div>
        <div className="px-6 py-3 flex justify-between items-center text-xs text-slate-400">
          <span>Encrypted · retained for life of matter</span>
          <span style={{ color: theme.accent }} className="font-semibold">Download all</span>
        </div>
      </div>
    </LaptopFrame>
  );
}

function SavingsVisual({ theme }: { theme: TourTheme }) {
  return (
    <div className="flex flex-col items-center" style={{ width: 720 }}>
      <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
        50 serves / month · 25 standard + 25 rush
      </div>
      <div className="grid grid-cols-2 gap-6 w-full">
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-2xl p-6"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="text-slate-400 text-xs uppercase tracking-widest">ABC Legal</div>
          <div className="text-3xl font-black text-slate-300 mt-2">$5,925</div>
          <div className="text-slate-500 text-xs mt-1">/month</div>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <div>25 × $86 = $2,150</div>
            <div>25 × $151 = $3,775</div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-2xl p-6 relative"
          style={{ background: theme.accentBg, border: `1px solid ${theme.accent}` }}
        >
          <div className="text-xs uppercase tracking-widest" style={{ color: theme.accent }}>SERVED. Firm Pro</div>
          <div className="text-3xl font-black text-white mt-2">$3,474</div>
          <div className="text-slate-300 text-xs mt-1">/month — incl. $299 sub</div>
          <div className="mt-4 space-y-1 text-xs text-slate-300">
            <div>25 × $55 = $1,375</div>
            <div>25 × $72 = $1,800</div>
          </div>
        </motion.div>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5, type: "spring" }}
        className="mt-6 px-6 py-3 rounded-full font-black text-2xl"
        style={{ background: theme.accent, color: "#0f1e3c" }}
      >
        Save $2,451 / month
      </motion.div>
    </div>
  );
}

/* ----------------------------------- server visuals ----------------------------------- */

function JobFeedVisual({ theme }: { theme: TourTheme }) {
  const jobs = [
    { name: "Sahara Ave · Summons", payout: "$60", rush: false, distance: "2.1 mi" },
    { name: "Henderson · Eviction", payout: "$76", rush: true, distance: "8.4 mi" },
    { name: "Spring Valley · Subpoena", payout: "$60", rush: false, distance: "3.7 mi" },
    { name: "Downtown · Family Court", payout: "$96", rush: true, distance: "5.2 mi" },
  ];
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Open jobs · 12" />
      <div className="px-4 flex-1 space-y-2">
        {jobs.map((j, i) => (
          <motion.div
            key={j.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12 }}
            className="rounded-xl p-3"
            style={{
              background: i === 0 ? theme.accentBg : "rgba(255,255,255,0.04)",
              border: `1px solid ${i === 0 ? theme.accent : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <div className="flex items-center justify-between">
              <div className="text-white text-sm font-bold">{j.name}</div>
              <div className="text-lg font-black" style={{ color: theme.accent }}>{j.payout}</div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <MapPin size={10} /> {j.distance}
              </div>
              {j.rush && (
                <div className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: theme.accent, color: "#0f1e3c" }}>
                  Rush
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </PhoneFrame>
  );
}

function ClaimTapVisual({ theme }: { theme: TourTheme }) {
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Henderson · Eviction" />
      <div className="flex-1 px-5 flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-4 mb-3"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Recipient</div>
          <div className="text-white font-bold mt-0.5">Robert Doe</div>
          <div className="text-slate-400 text-xs mt-2">1432 Lake Mead Pkwy, Henderson NV</div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-2 gap-2 mb-3"
        >
          <Stat label="Payout" value="$76" theme={theme} accent />
          <Stat label="Deadline" value="48 hr" theme={theme} />
          <Stat label="Distance" value="8.4 mi" theme={theme} />
          <Stat label="Doc type" value="Notice" theme={theme} />
        </motion.div>
        <motion.div
          className="mt-auto"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <motion.div
            animate={{ boxShadow: [`0 0 0 0 ${theme.accentSoft}`, `0 0 0 18px transparent`] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="w-full py-4 rounded-xl text-center font-black text-base"
            style={{ background: theme.accent, color: "#0f1e3c" }}
          >
            Claim Job
          </motion.div>
          <div className="text-center text-[10px] text-slate-500 mt-2">
            80% to you · 20% platform
          </div>
        </motion.div>
      </div>
    </PhoneFrame>
  );
}

function Stat({ label, value, theme, accent }: { label: string; value: string; theme: TourTheme; accent?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: accent ? theme.accentBg : "rgba(255,255,255,0.04)" }}>
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className="font-black text-base mt-0.5" style={{ color: accent ? theme.accent : "#fff" }}>{value}</div>
    </div>
  );
}

function MobileCaptureVisual({ theme }: { theme: TourTheme }) {
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Field capture" />
      <div className="flex-1 px-4 space-y-2">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl overflow-hidden relative"
          style={{ height: 200, background: "linear-gradient(135deg, #1a2540, #0a1530)" }}
        >
          {/* fake photo */}
          <div className="absolute inset-0 opacity-50" style={{
            background:
              "repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 4px, transparent 4px, transparent 12px)",
          }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Camera size={42} style={{ color: theme.accent }} />
          </div>
          <div className="absolute bottom-2 left-2 right-2 flex justify-between text-[10px] text-white/80 font-mono">
            <span>36.0982° N</span>
            <span>115.2204° W</span>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-3 gap-2"
        >
          <ActionTile icon={<Camera size={16} />} label="Photo" theme={theme} />
          <ActionTile icon={<FileSignature size={16} />} label="Signature" theme={theme} />
          <ActionTile icon={<MapPin size={16} />} label="GPS" theme={theme} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl p-3"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Notes</div>
          <div className="text-white text-xs">Personal service. Recipient acknowledged receipt at front door.</div>
        </motion.div>
      </div>
    </PhoneFrame>
  );
}

function ActionTile({ icon, label, theme }: { icon: React.ReactNode; label: string; theme: TourTheme }) {
  return (
    <div className="rounded-lg py-3 flex flex-col items-center gap-1"
      style={{ background: theme.accentBg, border: `1px solid ${theme.accentSoft}` }}>
      <span style={{ color: theme.accent }}>{icon}</span>
      <span className="text-[10px] text-slate-300 font-bold">{label}</span>
    </div>
  );
}

function AffidavitVisual({ theme }: { theme: TourTheme }) {
  return (
    <div className="flex items-center gap-6" style={{ width: 720 }}>
      <PhoneFrame theme={theme}>
        <BrandHeader theme={theme} title="Submitting…" />
        <div className="flex-1 px-5 flex flex-col items-center justify-center space-y-3">
          {[
            { label: "Photo uploaded", delay: 0.1 },
            { label: "GPS verified", delay: 0.4 },
            { label: "Affidavit drafted", delay: 0.8 },
            { label: "E-notarized", delay: 1.2 },
            { label: "Sent to requester", delay: 1.6 },
          ].map((s) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: s.delay }}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <CheckCircle2 size={16} style={{ color: theme.accent }} />
              <span className="text-white text-xs font-bold">{s.label}</span>
            </motion.div>
          ))}
        </div>
      </PhoneFrame>
      <motion.div
        initial={{ opacity: 0, x: 16, rotate: 2 }}
        animate={{ opacity: 1, x: 0, rotate: 1 }}
        transition={{ delay: 0.5 }}
        className="rounded-xl p-5 text-xs"
        style={{ background: "#fff", color: "#0f1e3c", width: 280, minHeight: 380, boxShadow: `0 30px 60px ${theme.accentSoft}` }}
      >
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Affidavit of Service</div>
        <div className="font-black text-base">DOE v. WESTGATE</div>
        <div className="text-[10px] mt-1 text-slate-500">Case No. EV-2026-3301</div>
        <div className="my-3 h-px bg-slate-200" />
        <div className="text-[10px] leading-relaxed text-slate-700">
          I, Marcus Reed, NV PSL #4471, hereby affirm under penalty of perjury that on the 30th day of April, 2026, at 2:24 PM Pacific Time, I personally served the above-named recipient at 1432 Lake Mead Pkwy, Henderson, NV, with the documents listed herein…
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="font-mono text-[10px] text-slate-500">/s/ M. Reed</div>
          <div className="text-[10px] font-bold" style={{ color: theme.accent }}>NOTARIZED ✓</div>
        </div>
        <div className="mt-3 pt-2 border-t border-slate-200 text-[8px] text-slate-500 leading-snug">
          SERVED.
        </div>
      </motion.div>
    </div>
  );
}

function WalletVisual({ theme }: { theme: TourTheme }) {
  const txs = [
    { name: "Henderson · Eviction", amount: "+$60.80", date: "Today" },
    { name: "Sahara · Summons", amount: "+$48.00", date: "Today" },
    { name: "Downtown · Family", amount: "+$76.80", date: "Yesterday" },
    { name: "Spring Valley", amount: "+$48.00", date: "Yesterday" },
  ];
  return (
    <PhoneFrame theme={theme}>
      <BrandHeader theme={theme} title="Wallet" />
      <div className="flex-1 px-5">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl p-5 text-center"
          style={{ background: theme.accentBg, border: `1px solid ${theme.accent}` }}
        >
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Available balance</div>
          <div className="text-4xl font-black text-white mt-1">$847.20</div>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="py-2 rounded-lg text-xs font-bold"
              style={{ background: theme.accent, color: "#0f1e3c" }}>
              Cash Out
            </div>
            <div className="py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: "rgba(255,255,255,0.06)" }}>
              Instant ($0.50)
            </div>
          </div>
        </motion.div>
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Recent</div>
          <div className="space-y-1.5">
            {txs.map((t, i) => (
              <motion.div
                key={t.name + i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div>
                  <div className="text-white font-bold">{t.name}</div>
                  <div className="text-slate-500 text-[10px]">{t.date}</div>
                </div>
                <div className="font-bold" style={{ color: theme.accent }}>{t.amount}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
