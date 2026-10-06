import { brand } from "@/lib/brand";

export type TourRole = "requester" | "attorney" | "server";

export type TourTheme = {
  accent: string;
  accentBg: string;
  accentSoft: string;
  badge: string;
  label: string;
  title: string;
  tagline: string;
};

export const TOUR_THEMES: Record<TourRole, TourTheme> = {
  requester: {
    accent: brand.amber,
    accentBg: "rgba(245,158,11,0.12)",
    accentSoft: "rgba(245,158,11,0.25)",
    badge: "Individual",
    label: "FOR INDIVIDUALS",
    title: "Need someone served?",
    tagline: "Skip the courthouse runaround.",
  },
  attorney: {
    accent: brand.sky,
    accentBg: "rgba(56,189,248,0.12)",
    accentSoft: "rgba(56,189,248,0.25)",
    badge: "ProServe",
    label: "FOR LAW FIRMS",
    title: "Process serving, done right.",
    tagline: "Built for the way attorneys work.",
  },
  server: {
    accent: brand.emerald,
    accentBg: "rgba(52,211,153,0.12)",
    accentSoft: "rgba(52,211,153,0.25)",
    badge: "Server",
    label: "FOR PROCESS SERVERS",
    title: "Get paid more.",
    tagline: "Skip the middleman.",
  },
};

export type TourSlide = {
  id: string;
  eyebrow: string;
  headline: string;
  body: string;
  visual:
    | "intro"
    | "post-job"
    | "pricing-public"
    | "server-claim"
    | "tracking"
    | "proof"
    | "outro"
    | "tier-table"
    | "bulk-upload"
    | "dashboard"
    | "vault"
    | "personal-vault"
    | "savings"
    | "job-feed"
    | "claim-tap"
    | "mobile-capture"
    | "affidavit"
    | "wallet";
  durationMs?: number;
};

export const TOUR_SLIDES: Record<TourRole, TourSlide[]> = {
  requester: [
    {
      id: "intro",
      eyebrow: "FOR INDIVIDUALS",
      headline: "Need someone served?",
      body: "Skip the courthouse runaround. Open SERVED. on any device — and a verified process server picks up your job in minutes.",
      visual: "intro",
      durationMs: 6000,
    },
    {
      id: "post",
      eyebrow: "STEP ONE",
      headline: "Tell us who, where, and what.",
      body: "Family court, eviction, small claims, subpoenas — anything you can serve, you can post in under two minutes.",
      visual: "post-job",
      durationMs: 7500,
    },
    {
      id: "pricing",
      eyebrow: "STEP TWO",
      headline: "$75 standard. Pay once.",
      body: "No subscription. No membership. The price you see is the price you pay — including tax, mileage, and proof of service.",
      visual: "pricing-public",
      durationMs: 7000,
    },
    {
      id: "claim",
      eyebrow: "STEP THREE",
      headline: "A verified server claims your job.",
      body: "Every server on SERVED. is licensed, background-checked, and rated. You see who's coming before they leave the office.",
      visual: "server-claim",
      durationMs: 7500,
    },
    {
      id: "tracking",
      eyebrow: "STEP FOUR",
      headline: "Watch the attempt happen, live.",
      body: "GPS-tracked. Time-stamped. Photographed. You stay in the loop without making a single phone call.",
      visual: "tracking",
      durationMs: 7500,
    },
    {
      id: "proof",
      eyebrow: "STEP FIVE",
      headline: "Notarized proof in your inbox.",
      body: "The moment service is complete, the affidavit is generated, e-notarized, and emailed to you — court-ready.",
      visual: "proof",
      durationMs: 7500,
    },
    {
      id: "vault",
      eyebrow: "STEP SIX",
      headline: "Your personal case vault.",
      body: "Every affidavit, photo, and document for your case — kept in one secure place. Court filings, exhibits, receipts, GPS logs. Searchable. Downloadable. Yours forever.",
      visual: "personal-vault",
      durationMs: 7500,
    },
    {
      id: "outro",
      eyebrow: "THAT'S IT.",
      headline: "Welcome to SERVED.",
      body: "Trust the Process.",
      visual: "outro",
      durationMs: 6000,
    },
  ],
  attorney: [
    {
      id: "intro",
      eyebrow: "FOR LAW FIRMS",
      headline: "Stop chasing process servers.",
      body: "Submit, track, and receive court-ready proof of service — without follow-ups or guesswork. Built for Nevada law firms handling family law, evictions, and civil filings.",
      visual: "intro",
      durationMs: 6500,
    },
    {
      id: "tiers",
      eyebrow: "PRICING",
      headline: "You're already paying for process serving. You're just overpaying.",
      body: "ProServe lowers your cost per serve immediately — across every case, every server, every county. Solo $99/mo · Firm $199/mo · Firm Pro $299/mo. Lower per-serve rates the moment you subscribe.",
      visual: "tier-table",
      durationMs: 8000,
    },
    {
      id: "bulk",
      eyebrow: "STEP ONE",
      headline: "Submit a serve in under 60 seconds.",
      body: "No emails. No calls. Just enter the details, upload your documents, and dispatch instantly. Built to scale with your firm.",
      visual: "bulk-upload",
      durationMs: 7500,
    },
    {
      id: "dashboard",
      eyebrow: "STEP TWO",
      headline: "Know exactly what's happening — without asking.",
      body: "See every active job, every status, every server — all in one place. No follow-ups. No \u201Cdid they go yet?\u201D",
      visual: "dashboard",
      durationMs: 7500,
    },
    {
      id: "vault",
      eyebrow: "STEP THREE",
      headline: "Never lose an affidavit again.",
      body: "Every serve, every attempt, every document — saved, searchable, and ready when you need it. Download court-ready proof the moment service is complete.",
      visual: "vault",
      durationMs: 7500,
    },
    {
      id: "savings",
      eyebrow: "THE BOTTOM LINE",
      headline: "Here's what you're paying now vs. what you should be paying.",
      body: "At 50 serves per month, your firm pays significantly less with SERVED — with faster turnaround and full visibility. Save $2,451 per month.",
      visual: "savings",
      durationMs: 8000,
    },
    {
      id: "outro",
      eyebrow: "SERVED. TRUST THE PROCESS.",
      headline: "Stop managing process servers.",
      body: "Submit your request. Track it live. Get your affidavit. Done.",
      visual: "outro",
      durationMs: 6000,
    },
  ],
  server: [
    {
      id: "intro",
      eyebrow: "FOR PROCESS SERVERS",
      headline: "Get paid more. Skip the middleman.",
      body: "SERVED. takes 20%. You keep 80% of every serve — direct deposit, no waiting on a check from corporate.",
      visual: "intro",
      durationMs: 6500,
    },
    {
      id: "feed",
      eyebrow: "STEP ONE",
      headline: "Open jobs near you, ranked by payout.",
      body: "Every job on the board shows the address, the payout, the deadline, and the rush bonus before you tap.",
      visual: "job-feed",
      durationMs: 7500,
    },
    {
      id: "claim",
      eyebrow: "STEP TWO",
      headline: "Claim in one tap. It's yours.",
      body: "First server to claim wins the job. No bidding. No begging dispatchers. Just take the work and go.",
      visual: "claim-tap",
      durationMs: 7000,
    },
    {
      id: "mobile",
      eyebrow: "STEP THREE",
      headline: "Built for the field.",
      body: "Live GPS, photo capture, signature pad, and notes — all in one screen, all offline-capable.",
      visual: "mobile-capture",
      durationMs: 7500,
    },
    {
      id: "affidavit",
      eyebrow: "STEP FOUR",
      headline: "Affidavit generates itself.",
      body: "Hit submit. SERVED. builds the proof of service, e-notarizes it, and ships it to the requester — automatically.",
      visual: "affidavit",
      durationMs: 7500,
    },
    {
      id: "wallet",
      eyebrow: "STEP FIVE",
      headline: "Cash hits in days, not weeks.",
      body: "Standard payout in 2 business days via Stripe. Instant Cash-Out available for a small fee. You decide.",
      visual: "wallet",
      durationMs: 7500,
    },
    {
      id: "outro",
      eyebrow: "WELCOME TO SERVED.",
      headline: "Earn $2,500–$3,400/mo at 50 serves.",
      body: "Trust the Process.",
      visual: "outro",
      durationMs: 6500,
    },
  ],
};
