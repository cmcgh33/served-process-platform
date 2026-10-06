import type { AttorneyPlan } from "@workspace/db";

const GB = 1024 * 1024 * 1024;

export const PLAN_QUOTA_BYTES: Record<AttorneyPlan, number> = {
  solo: 5 * GB,
  firm: 25 * GB,
  firm_pro: 100 * GB,
  enterprise: -1,
};

export function quotaForPlan(plan: AttorneyPlan): number {
  return PLAN_QUOTA_BYTES[plan];
}

export function wouldExceedQuota(
  usedBytes: number,
  incomingBytes: number,
  plan: AttorneyPlan,
): boolean {
  const q = quotaForPlan(plan);
  if (q < 0) return false;
  return usedBytes + incomingBytes > q;
}
