import { Router } from "express";
import {
  formatCentsUsd,
  getServePrice,
  type ProServeTier,
  type ServiceType,
} from "@workspace/pricing";
import { requireRole } from "../middlewares/auth";
import {
  getActiveSubscriptionTier,
  getPricingTierForCreator,
} from "../lib/marketplace";

const anyRole = requireRole("requester", "attorney", "server");

const router = Router();

const VALID_SERVICE_TYPES: readonly ServiceType[] = [
  "standard",
  "rush",
  "licensed",
];

const TIER_LABELS: Record<string, string> = {
  public: "Public",
  solo: "ProServe Solo",
  firm: "ProServe Firm",
  firm_pro: "ProServe Firm Pro",
};

router.get("/pricing/serve-preview", anyRole, async (req, res) => {
  const serviceTypeRaw = String(req.query.serviceType ?? "");
  if (!VALID_SERVICE_TYPES.includes(serviceTypeRaw as ServiceType)) {
    res.status(400).json({
      error:
        "serviceType must be one of: " + VALID_SERVICE_TYPES.join(", "),
    });
    return;
  }
  const serviceType = serviceTypeRaw as ServiceType;

  const userId = req.userId!;
  const role = req.userRole ?? null;

  const pricingTier = await getPricingTierForCreator(userId, role);
  const activeSub: ProServeTier | null = await getActiveSubscriptionTier(
    userId,
    role,
  );

  const grossCents = getServePrice(pricingTier, serviceType);
  const publicGrossCents = getServePrice("public", serviceType);

  res.json({
    serviceType,
    pricingTier,
    tierLabel: TIER_LABELS[pricingTier] ?? pricingTier,
    grossCents,
    formattedAmount: formatCentsUsd(grossCents),
    isSubscriber: activeSub !== null,
    publicGrossCents,
  });
});

export default router;
