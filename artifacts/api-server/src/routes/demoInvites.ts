/**
 * Attorney-demo email gating.
 *
 * Two surfaces:
 *
 *   - POST /admin/demo/invites — admin-only. Mints a token, persists a row
 *     to `demo_invites`, sends a SendGrid email from `info@servedapp.co`
 *     with a tokenised "watch" link, and writes an admin_audit_log entry.
 *
 *   - GET  /demo/invites/:token       — public, no auth.
 *   - POST /demo/invites/:token/confirm — public, no auth. Soft email-gate;
 *     accepts a recipient-typed email and stamps `viewed_at` on first
 *     successful match.
 *
 * The admin endpoint lives under `/api/admin/demo/...` (mounted via the
 * admin router prefix). The public endpoints live under `/api/demo/...`
 * and are mounted on the public sub-router that runs BEFORE requireAuth.
 */
import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  demoInvitesTable,
  adminAuditLogTable,
  type DemoInvite,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { isAdminUser } from "../lib/marketplace";
import { sendEmail, buildAppUrl } from "../lib/mailer";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FROM_ADDRESS = "SERVED. <info@servedapp.co>";
const TOKEN_BYTES = 24; // 48 hex chars; comfortably collision-free.
const INVITE_TTL_DAYS = 30;

function mintToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function emailsMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function inviteValidNow(invite: DemoInvite, now = new Date()): boolean {
  if (invite.revokedAt) return false;
  return invite.expiresAt.getTime() > now.getTime();
}

const sendBodySchema = z.object({
  recipientEmail: z.string().email(),
  recipientName: z.string().trim().min(1).max(120).optional(),
});

const confirmBodySchema = z.object({
  email: z.string().email(),
});

// ---------------------------------------------------------------------------
// Admin router (mounted under /api/admin)
// ---------------------------------------------------------------------------
export const demoInvitesAdminRouter: IRouter = Router();

function requireAdmin(): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    if (!isAdminUser(req.userId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
}

demoInvitesAdminRouter.post(
  "/admin/demo/invites",
  requireAuth,
  requireAdmin(),
  async (req, res) => {
    const parsed = sendBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { recipientEmail, recipientName } = parsed.data;

    const token = mintToken();
    const expiresAt = new Date(
      Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const [row] = await db
      .insert(demoInvitesTable)
      .values({
        token,
        recipientEmail,
        recipientName: recipientName ?? null,
        sentByUserId: (req as any).userId,
        expiresAt,
      })
      .returning();

    const watchUrl = buildAppUrl(`/demo/watch/${token}`);
    const greetName = recipientName?.trim() || "there";

    const subject = "Your SERVED. attorney demo";
    const text = [
      `Hi ${greetName},`,
      "",
      "Here's a short walkthrough of SERVED. — the modern way Nevada attorneys handle process serving:",
      "",
      watchUrl,
      "",
      "It's about 90 seconds. When you open the link, just confirm your email so we know it reached the right inbox.",
      "",
      "Want a live walkthrough? Book a 30-minute demo: https://calendly.com/servedapp-info/30min",
      "",
      "— The SERVED. team",
      "info@servedapp.co",
    ].join("\n");

    const escapedName = escapeHtml(greetName);
    const escapedUrl = escapeHtml(watchUrl);
    const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;">
  <p style="font-size:18px;font-weight:800;letter-spacing:0.06em;color:#0f1e3c;margin:0 0 18px;">SERVED.</p>
  <p>Hi ${escapedName},</p>
  <p>Here's a short walkthrough of <strong>SERVED.</strong> — the modern way Nevada attorneys handle process serving.</p>
  <p style="margin:28px 0;text-align:center;">
    <a href="${escapedUrl}"
       style="display:inline-block;background:#f59e0b;color:#0f1e3c;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:10px;">
      Watch the 90-second demo
    </a>
  </p>
  <p style="color:#555;font-size:13px;text-align:center;">
    Or paste this link into your browser:<br>
    <a href="${escapedUrl}" style="color:#0f1e3c;word-break:break-all;">${escapedUrl}</a>
  </p>
  <p style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px 14px;color:#7c2d12;font-size:14px;">
    When you open the link, just confirm your email so we know it reached the right inbox.
  </p>
  <p>Want a live walkthrough?
    <a href="https://calendly.com/servedapp-info/30min" style="color:#0f1e3c;font-weight:600;">Book a 30-minute demo</a>.
  </p>
  <p style="color:#555;font-size:13px;margin-top:28px;">— The SERVED. team<br>info@servedapp.co</p>
</body></html>`;

    const delivered = await sendEmail({
      to: recipientEmail,
      from: FROM_ADDRESS,
      subject,
      text,
      html,
    });

    // Audit row is required, not best-effort — every send must be
    // attributable. If this insert fails the whole request 500s so the
    // caller knows the send was not recorded (the invite row + email
    // are already persisted/dispatched, but ops will see the 500 and
    // can reconcile from SendGrid + the orphan invite row).
    await db.insert(adminAuditLogTable).values({
      actorUserId: (req as any).userId,
      action: "demo.invite_send",
      targetUserId: null,
      targetServerId: null,
      details: {
        inviteId: row!.id,
        recipientEmail,
        recipientName: recipientName ?? null,
        delivered,
      },
    });

    res.status(201).json({
      id: row!.id,
      token: row!.token,
      recipientEmail: row!.recipientEmail,
      recipientName: row!.recipientName,
      expiresAt: row!.expiresAt.toISOString(),
      watchUrl,
      delivered,
    });
  },
);

// ---------------------------------------------------------------------------
// Public router (mounted on the public sub-router, BEFORE requireAuth)
// ---------------------------------------------------------------------------
export const demoInvitesPublicRouter: IRouter = Router();

demoInvitesPublicRouter.get(
  "/demo/invites/:token",
  async (req, res) => {
    const token = String(req.params.token ?? "");
    if (!token || token.length < 8) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    const [row] = await db
      .select()
      .from(demoInvitesTable)
      .where(eq(demoInvitesTable.token, token))
      .limit(1);

    if (!row || !inviteValidNow(row)) {
      res.status(404).json({ error: "Invite not found or expired" });
      return;
    }

    res.json({
      recipientName: row.recipientName,
      validUntil: row.expiresAt.toISOString(),
      alreadyConfirmed: !!row.viewedAt,
    });
  },
);

demoInvitesPublicRouter.post(
  "/demo/invites/:token/confirm",
  async (req, res) => {
    const token = String(req.params.token ?? "");
    const parsed = confirmBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Email required" });
      return;
    }

    const [row] = await db
      .select()
      .from(demoInvitesTable)
      .where(eq(demoInvitesTable.token, token))
      .limit(1);

    if (!row || !inviteValidNow(row)) {
      res.status(404).json({ error: "Invite not found or expired" });
      return;
    }

    if (!emailsMatch(row.recipientEmail, parsed.data.email)) {
      res.status(403).json({ error: "Email does not match this invitation" });
      return;
    }

    if (!row.viewedAt) {
      await db
        .update(demoInvitesTable)
        .set({ viewedAt: new Date() })
        .where(eq(demoInvitesTable.id, row.id));
    }

    res.json({ ok: true });
  },
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
