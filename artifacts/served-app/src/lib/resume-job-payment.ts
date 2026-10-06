/**
 * Shared "resume Stripe Checkout for a job stuck in pending_payment"
 * logic used by both the requester (individual) detail page and the
 * shared admin/attorney detail page. Extracted so the two surfaces
 * cannot drift apart on price-matching, redirect behaviour, or error
 * handling.
 *
 * Why amount-based price matching:
 * The job row stores `serviceType` ∈ {standard, rush, licensed} but the
 * post-job UI also offers `same_day` urgency, which collapses to `rush`
 * in the DB — so the original product can't be losslessly recovered
 * from the stored serviceType. The grossCents snapshot, however, IS
 * authoritative. We look up Stripe Prices and find the one whose
 * `unit_amount` matches grossCents.
 *
 * SAFETY ASSUMPTION: SERVED.'s Stripe catalog has unique amounts for
 * the three serve tiers (Standard $75 / Rush $95 / Same Day $150). If
 * a future product is added at the same price as an existing one, this
 * resume flow may pick the wrong tier — at which point the right fix
 * is to stamp the originating Stripe Price ID on the job row at create
 * time and look up by that instead.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { redirectTopLevel } from "./external-redirect";

export interface ResumePaymentJob {
  id: string;
  grossCents?: number | null;
  documentType?: string | null;
  recipientName: string;
}

interface StripePrice {
  id: string;
  unit_amount: number | null;
}
interface StripeProduct {
  name?: string;
  prices?: StripePrice[];
}

export function useResumeJobPayment() {
  const [resumingPayment, setResumingPayment] = useState(false);

  const resumePayment = useCallback(async (job: ResumePaymentJob) => {
    if (typeof job.grossCents !== "number" || job.grossCents <= 0) {
      toast.error(
        "This job has no recorded price. Please cancel it and post a new one.",
      );
      return;
    }
    setResumingPayment(true);
    try {
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
      const productsRes = await fetch(`${basePath}/api/stripe/products`);
      if (!productsRes.ok) {
        throw new Error("Could not load checkout pricing.");
      }
      const productsBody = (await productsRes.json()) as {
        data?: StripeProduct[];
      };
      const products = productsBody.data ?? [];
      const matchingPrice = products
        .flatMap((p) => p.prices ?? [])
        .find((pr) => pr.unit_amount === job.grossCents);
      if (!matchingPrice?.id) {
        throw new Error(
          "We couldn't find a matching Stripe price for this job. " +
            "Please cancel and re-post, or contact support.",
        );
      }
      const checkoutRes = await fetch(`${basePath}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: matchingPrice.id,
          jobTitle: job.documentType ?? undefined,
          recipientName: job.recipientName,
          jobId: job.id,
        }),
      });
      const { url, error } = (await checkoutRes.json()) as {
        url?: string;
        error?: string;
      };
      if (!url) {
        throw new Error(error ?? "Stripe did not return a checkout URL.");
      }
      // Top-level navigation — `window.open(_blank)` would be popup-
      // blocked because of the await above (broken user-gesture chain).
      redirectTopLevel(url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not resume payment.",
      );
      setResumingPayment(false);
    }
  }, []);

  return { resumePayment, resumingPayment };
}
