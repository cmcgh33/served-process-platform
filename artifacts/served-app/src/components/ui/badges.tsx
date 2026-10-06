import { Badge } from "@/components/ui/badge";
import { JobStatus, ServerServerTier } from "@workspace/api-client-react";

export function StatusBadge({ status }: { status: string }) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let colorClass = "";

  switch (status) {
    case "pending":
      variant = "secondary";
      colorClass = "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
      break;
    case "pending_payment":
      // Distinct rose tint so unpaid jobs are visually unmistakable
      // — falling through to the default (no colorClass) made these
      // jobs trivial to confuse with paid+pending in the ops/attorney
      // surfaces (`pages/jobs/*`, `pages/dashboard.tsx`).
      variant = "secondary";
      colorClass =
        "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300";
      break;
    case "assigned":
      variant = "default";
      colorClass = "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      break;
    case "in_progress":
      variant = "default";
      colorClass = "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
      break;
    case "en_route":
      variant = "default";
      colorClass =
        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
      break;
    case "served":
      variant = "default";
      colorClass = "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      break;
    case "failed":
      variant = "destructive";
      break;
    case "cancelled":
      variant = "secondary";
      colorClass = "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
      break;
  }

  // `replace` only swaps the first underscore — use `replaceAll` so
  // multi-token statuses like `pending_payment` don't render as
  // `PENDING_PAYMENT`. (Today only one is multi-underscore but the
  // contract is "render any status nicely".)
  const label = status.replaceAll("_", " ").toUpperCase();

  return (
    <Badge variant={variant} className={colorClass}>
      {label}
    </Badge>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  let variant: "default" | "secondary" | "outline" = "default";
  let colorClass = "";

  switch (tier) {
    case "basic":
      variant = "secondary";
      break;
    case "pro":
      variant = "default";
      colorClass = "bg-blue-600 text-white hover:bg-blue-700";
      break;
    case "licensed":
      variant = "default";
      colorClass = "bg-amber-600 text-white hover:bg-amber-700";
      break;
  }

  return (
    <Badge variant={variant} className={colorClass}>
      {tier.toUpperCase()}
    </Badge>
  );
}
