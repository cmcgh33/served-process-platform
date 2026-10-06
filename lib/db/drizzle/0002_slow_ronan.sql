-- Task #13 follow-up: persist Stripe Payout id once the connected account's
-- automatic payout that includes our transfer is scheduled, so the wallet
-- can show the authoritative `arrival_date` on each unpaid payout row.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "stripe_payout_id" text;
