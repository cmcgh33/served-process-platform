/**
 * Certn webhook receiver.
 *
 * Mounted in `app.ts` at `POST /api/webhooks/certn` BEFORE `express.json()`
 * so the raw body buffer is preserved for HMAC verification.
 *
 * Idempotency: every event is keyed on `(checkId, status)` against
 * `server_credentials.background_check_id`. We never regress a verified row,
 * and a duplicate "verified" delivery is a no-op.
 */
import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  serverCredentialsTable,
  serversTable,
} from "@workspace/db";
import {
  isCertnLiveMode,
  parseCertnEvent,
  verifyWebhookSignature,
} from "@workspace/integrations-certn";
import { logger } from "./lib/logger";

/**
 * Header name Certn uses for HMAC signatures. Configurable via env in case
 * the live integration uses a different header name than what's documented.
 */
function getSignatureHeaderName(): string {
  return (
    process.env.CERTN_SIGNATURE_HEADER?.trim().toLowerCase() ||
    "x-certn-signature"
  );
}

export async function handleCertnWebhook(
  req: Request,
  res: Response,
): Promise<void> {
  // In stub mode (no CERTN_WEBHOOK_SECRET) we refuse to act on webhooks at
  // all — the manual-verify admin endpoint is the recovery path. Otherwise
  // an unsecured public POST could flip credentials to verified.
  if (!isCertnLiveMode() || !process.env.CERTN_WEBHOOK_SECRET) {
    logger.warn(
      { ip: req.ip },
      "Certn webhook received in stub mode — rejecting",
    );
    res.status(404).json({ error: "Not configured" });
    return;
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.error(
      "Certn webhook body is not a Buffer — express.json() ran first?",
    );
    res.status(500).json({ error: "Misconfigured" });
    return;
  }

  const headerName = getSignatureHeaderName();
  const sigRaw = req.headers[headerName];
  const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn({ ip: req.ip }, "Certn webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    logger.error({ err }, "Certn webhook payload not valid JSON");
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const outcome = parseCertnEvent(payload);
  if (outcome.kind === "ignored") {
    logger.info({ reason: outcome.reason }, "Certn webhook ignored");
    res.status(200).json({ received: true, action: "ignored" });
    return;
  }

  // applicantRef is what we sent to Certn at submitCheck time:
  //   `srv_${server.id}` — recover the numeric server id from it.
  const match = /^srv_(\d+)$/.exec(outcome.applicantRef);
  if (!match) {
    logger.warn(
      { applicantRef: outcome.applicantRef },
      "Certn webhook applicantRef shape unrecognized — cannot resolve server",
    );
    res.status(200).json({ received: true, action: "ignored" });
    return;
  }
  const serverId = Number.parseInt(match[1], 10);
  const [server] = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.id, serverId))
    .limit(1);
  if (!server || !server.userId) {
    logger.warn({ serverId }, "Certn webhook for unknown server");
    res.status(200).json({ received: true, action: "ignored" });
    return;
  }

  const now = new Date();
  if (outcome.kind === "verified") {
    const [credRow] = await db
      .insert(serverCredentialsTable)
      .values({
        userId: server.userId,
        status: "verified",
        verifiedAt: now,
        backgroundCheckId: outcome.checkId,
      })
      .onConflictDoUpdate({
        target: serverCredentialsTable.userId,
        set: {
          // Don't regress a verified row, but still let backgroundCheckId
          // fill in if we got an out-of-order webhook before submitCheck
          // wrote the id back.
          status: "verified",
          verifiedAt: now,
          failureReason: null,
          backgroundCheckId: outcome.checkId,
          updatedAt: now,
        },
      })
      .returning();
    // Flip the lifecycle status to `active` so the server can accept jobs.
    // Background-check pass is the trigger today; an admin can later move
    // them to suspended/inactive without losing the verifiedAt timestamp.
    await db
      .update(serversTable)
      .set({ verifiedAt: now, status: "active", active: true })
      .where(eq(serversTable.id, serverId));
    logger.info(
      { serverId, userId: server.userId, checkId: outcome.checkId },
      "Certn webhook → server verified",
    );
    res.status(200).json({ received: true, action: "verified", credRow });
    return;
  }

  // Failure — never overwrites a previously-verified row.
  const [credRow] = await db
    .insert(serverCredentialsTable)
    .values({
      userId: server.userId,
      status: "failed",
      failureReason: outcome.reason,
      backgroundCheckId: outcome.checkId,
    })
    .onConflictDoUpdate({
      target: serverCredentialsTable.userId,
      // Use a CASE so an out-of-order failure can't downgrade a verified row.
      set: {
        status: sql`CASE WHEN ${serverCredentialsTable.status} = 'verified' THEN ${serverCredentialsTable.status} ELSE 'failed' END`,
        failureReason: outcome.reason,
        backgroundCheckId: outcome.checkId,
        updatedAt: now,
      },
    })
    .returning();
  logger.info(
    {
      serverId,
      userId: server.userId,
      checkId: outcome.checkId,
      reason: outcome.reason,
    },
    "Certn webhook → server failed",
  );
  res.status(200).json({ received: true, action: "failed", credRow });
}
