import { Router, type IRouter, type RequestHandler } from "express";
import { clerkClient } from "@clerk/express";
import {
  db,
  serverCredentialsTable,
  serversTable,
  usersTable,
  userRoles,
  type UserRole,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { isAdminUser } from "../lib/marketplace";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function getOrUpsertUser(userId: string) {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (existing[0]) {
    // Self-heal: an admin-invited server who signed in via Google/OAuth
    // before the invite-linking fix landed may have ended up with
    // role=NULL (and been routed into the Individual portal). On every
    // /me hit, re-check whether their email matches a pending server row
    // and, if so, claim the role now. We intentionally only upgrade from
    // NULL — never overwrite a deliberate role choice (requester /
    // attorney) the user has already made.
    if (existing[0].role === null && existing[0].email) {
      const [pendingServer] = await db
        .select({ id: serversTable.id })
        .from(serversTable)
        .where(
          and(
            eq(serversTable.email, existing[0].email),
            isNull(serversTable.userId),
            isNull(serversTable.deletedAt),
          ),
        )
        .limit(1);
      if (pendingServer) {
        const [healed] = await db
          .update(usersTable)
          .set({ role: "server", updatedAt: new Date() })
          .where(eq(usersTable.id, userId))
          .returning();
        try {
          const cu = await clerkClient.users.getUser(userId);
          await clerkClient.users.updateUser(userId, {
            publicMetadata: { ...(cu.publicMetadata ?? {}), role: "server" },
          });
          await linkPendingServerByEmail(
            userId,
            existing[0].email,
            [healed?.firstName, healed?.lastName].filter(Boolean).join(" ").trim() || "",
          );
        } catch (err) {
          logger.warn(
            { err, userId, email: existing[0].email },
            "Could not finish self-heal of invited server (non-fatal)",
          );
        }
        return healed ?? existing[0];
      }
    }
    return existing[0];
  }

  // First time we've seen this Clerk user — pull profile from Clerk and persist.
  // Normalize email casing because admin.ts always lowercases on insert; if we
  // queried serversTable.email with the raw Clerk casing here, an invited
  // server with a mixed-case address could fail to link on first sign-in.
  const cu = await clerkClient.users.getUser(userId);
  const rawEmail =
    cu.primaryEmailAddress?.emailAddress ??
    cu.emailAddresses?.[0]?.emailAddress ??
    null;
  const email = rawEmail ? rawEmail.toLowerCase() : null;
  const metadataRole = (cu.publicMetadata as Record<string, unknown> | undefined)
    ?.role;
  let role: UserRole | null =
    metadataRole === "requester" ||
    metadataRole === "attorney" ||
    metadataRole === "server"
      ? metadataRole
      : null;

  // Admin-invited-server fallback: if Clerk has no role metadata yet (the
  // common case for Google/OAuth signups, which bypass the URL `intent`
  // round-trip and never hit the role-chooser before /me runs), check
  // whether this email matches a pending `servers` row created by the
  // admin invite flow. If so, claim the role as "server" up front so the
  // user is routed straight into the Server portal — no manual role pick,
  // no accidental drop into the Individual portal.
  if (!role && email) {
    const [pendingServer] = await db
      .select({ id: serversTable.id })
      .from(serversTable)
      .where(
        and(
          eq(serversTable.email, email),
          isNull(serversTable.userId),
          isNull(serversTable.deletedAt),
        ),
      )
      .limit(1);
    if (pendingServer) {
      role = "server";
      // Best-effort: also stamp Clerk so subsequent sessions / other
      // services see the correct role without re-querying Postgres.
      try {
        await clerkClient.users.updateUser(userId, {
          publicMetadata: { ...(cu.publicMetadata ?? {}), role: "server" },
        });
      } catch (err) {
        logger.warn(
          { err, userId, email },
          "Could not stamp Clerk publicMetadata.role for invited server (non-fatal)",
        );
      }
    }
  }

  const [row] = await db
    .insert(usersTable)
    .values({
      id: userId,
      email,
      firstName: cu.firstName ?? null,
      lastName: cu.lastName ?? null,
      role,
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email,
        firstName: cu.firstName ?? null,
        lastName: cu.lastName ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  // If this user matches an admin-invited server (a server row with the same
  // email and userId IS NULL), link the row now so they don't have to be
  // manually re-added by an admin.
  if (role === "server" && email) {
    await linkPendingServerByEmail(
      userId,
      email,
      [cu.firstName, cu.lastName].filter(Boolean).join(" ").trim() || "",
    );
  }
  return row;
}

/**
 * Link a pending (admin-invited) server row to a Clerk user by email.
 * The server row is created at invite time with `userId = NULL`. When the
 * invitee signs up — either via the legacy Clerk invitation ticket flow OR
 * the simpler email-link sign-up flow — we attach the row to their userId
 * here. If the admin pre-verified the server at invite time, we also flip
 * them to active and create the verified credential record so they can
 * take work immediately. Safe to call multiple times — it's idempotent and
 * a no-op when no pending row matches.
 */
export async function linkPendingServerByEmail(
  userId: string,
  email: string,
  displayName: string,
): Promise<void> {
  try {
    const normalizedEmail = email.toLowerCase();
    const [pendingServer] = await db
      .select({
        id: serversTable.id,
        verifiedAt: serversTable.verifiedAt,
      })
      .from(serversTable)
      .where(
        and(
          eq(serversTable.email, normalizedEmail),
          isNull(serversTable.userId),
          // Skip soft-deleted rows so a re-onboarding email gets a fresh
          // server row instead of accidentally re-linking to a deleted
          // (history-only) account.
          isNull(serversTable.deletedAt),
        ),
      )
      .limit(1);

    if (!pendingServer) return;

    const wasPreVerified = !!pendingServer.verifiedAt;
    const now = new Date();
    await db
      .update(serversTable)
      .set({
        userId,
        name: displayName,
        ...(wasPreVerified
          ? { status: "active" as const, active: true }
          : {}),
      })
      .where(eq(serversTable.id, pendingServer.id));

    if (wasPreVerified) {
      await db
        .insert(serverCredentialsTable)
        .values({
          userId,
          status: "verified",
          verifiedAt: pendingServer.verifiedAt ?? now,
        })
        .onConflictDoUpdate({
          target: serverCredentialsTable.userId,
          set: {
            status: "verified",
            verifiedAt: pendingServer.verifiedAt ?? now,
            failureReason: null,
            updatedAt: now,
          },
        });
    }

    logger.info(
      {
        userId,
        email: normalizedEmail,
        serverId: pendingServer.id,
        preVerified: wasPreVerified,
      },
      "Linked invited server row to Clerk user",
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, userId, email },
      "Failed to link invited server row (non-fatal)",
    );
  }
}

router.get("/me", requireAuth, async (req, res) => {
  const user = await getOrUpsertUser(req.userId!);

  // Tell the client whether this user actually has a process-server profile
  // attached to their account, so the role chooser can hide the "switch to
  // server" option for plain individual signups. Only counts rows already
  // linked to this userId — pending invitations don't count.
  const serverRow = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, user.id))
    .limit(1);

  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isAdmin: isAdminUser(user.id),
    hasServerProfile: serverRow.length > 0,
  });
});

router.post("/me/role", requireAuth, async (req, res) => {
  const role = req.body?.role;
  if (!userRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  // Make sure the row exists (handles brand-new sign-ups).
  const existing = await getOrUpsertUser(req.userId!);

  // Switching the active portal is allowed: requester / attorney / server
  // are different *user types*, not privilege tiers, and a real human may
  // legitimately need a serve (requester) AND deliver serves (server) AND
  // run a law practice (attorney). Their underlying server profile, Stripe
  // Connect account, attorney subscription, etc. all stay attached to the
  // user — only the default portal changes. We log every switch so it
  // shows up in the audit trail.
  if (existing.role && existing.role !== role) {
    req.log.info(
      { userId: req.userId, from: existing.role, to: role },
      "User switched active portal",
    );
  }

  // Sync role to both Clerk metadata and our DB.
  await clerkClient.users.updateUser(req.userId!, {
    publicMetadata: { role },
  });
  const [row] = await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, req.userId!))
    .returning();
  if (!existing.role) {
    req.log.info({ userId: req.userId, role }, "Role assigned");
  }

  // If they just became a server (role chooser pick after signing up via an
  // admin invite link), link any pending server row keyed off their email.
  // This is what makes the email-link invite flow work without Clerk's
  // invitation ticket mechanism — the admin pre-creates a `servers` row
  // with `userId = NULL` at invite time, the invitee signs up normally,
  // picks "server" here, and we attach them to that row by email.
  if (role === "server" && row.email) {
    await linkPendingServerByEmail(
      row.id,
      row.email,
      [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "",
    );
  }

  const serverRow = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, row.id))
    .limit(1);
  res.json({
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    role: row.role,
    isAdmin: isAdminUser(row.id),
    hasServerProfile: serverRow.length > 0,
  });
});

/**
 * Self-serve account deletion. Hard-deletes everything tied to the calling
 * Clerk user — server roster row, credentials, our `users` row, and finally
 * the Clerk user itself. Mirrors the admin-side hard-delete (see
 * `DELETE /admin/server/:serverId/account`) but limited to "the caller can
 * only delete themselves".
 *
 * Order matters: detach FKs on jobs first, then DB rows, then Clerk last so
 * a Clerk outage can't leave a half-deleted DB. After this returns, the
 * client should immediately sign the user out of Clerk.
 */
router.delete("/me/account", requireAuth, async (req, res) => {
  const userId = req.userId!;

  // Look up any server row the user owns so we can soft-delete it in the
  // same transaction below. We deliberately KEEP service_attempts, payouts,
  // jobs, location_pings, release_events — they stay attached to the
  // server row for the audit/legal trail.
  const [server] = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, userId))
    .limit(1);

  // SOFT DELETE — keep the server roster row and all FK-attached history
  // (service_attempts, payouts, jobs, location pings, release events) so
  // attorneys/admins can still pull a complete chain-of-custody for any
  // past job long after the account is gone. We only wipe the login
  // surface (Clerk user + server_credentials + users row) and mark the
  // server row inactive + deletedAt so it disappears from active rosters
  // and the marketplace.
  try {
    await db.transaction(async (tx) => {
      if (server) {
        await tx
          .update(serversTable)
          .set({
            deletedAt: new Date(),
            deletedReason: "self_deleted",
            status: "inactive",
            active: false,
            // Null userId so the users row can be safely deleted without
            // tripping the unique index, and so a future re-onboard with
            // the same email gets a fresh row.
            userId: null,
          })
          .where(eq(serversTable.id, server.id));
      }
      await tx
        .delete(serverCredentialsTable)
        .where(eq(serverCredentialsTable.userId, userId));
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    });
  } catch (err: any) {
    req.log.error(
      { err: err?.message ?? String(err), userId, serverId: server?.id },
      "Self-delete transaction failed; nothing was changed",
    );
    res.status(500).json({
      error:
        "Couldn't delete account — the database transaction failed and was rolled back. No changes were made.",
      detail: err?.message ?? String(err),
    });
    return;
  }

  let clerkDeleted = false;
  let clerkError: string | null = null;
  try {
    await clerkClient.users.deleteUser(userId);
    clerkDeleted = true;
  } catch (err: any) {
    clerkError = err?.message ?? String(err);
    req.log.error(
      { err: clerkError, userId },
      "Failed to delete Clerk user during self-account purge",
    );
  }

  req.log.info(
    { userId, serverDeleted: !!server, clerkDeleted },
    "User self-deleted account",
  );

  res.json({ ok: true, clerkDeleted, clerkError });
});

// ---------------------------------------------------------------------------
// Firm Profile (attorney) — autofills the pickup-address block on every new
// pickup/either job so attorneys don't retype their office address.
// Stored on the users row; only attorneys can read or write it.
// ---------------------------------------------------------------------------

// Empty string from the form means "clear this field". Normalize to null
// so the column stores NULL instead of "" — keeps the autofill check
// trivial (`if (firmAddress)` works for both unset and cleared).
const trimToNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const firmProfileSchema = z.object({
  firmName: z.string().nullable().optional(),
  firmAddress: z.string().nullable().optional(),
  firmAddress2: z.string().nullable().optional(),
  firmCity: z.string().nullable().optional(),
  firmState: z.string().nullable().optional(),
  firmZip: z.string().nullable().optional(),
  firmPhone: z.string().nullable().optional(),
  firmContactName: z.string().nullable().optional(),
  barNumber: z.string().nullable().optional(),
  barState: z.string().nullable().optional(),
});

function projectFirmProfile(u: {
  firmName: string | null;
  firmAddress: string | null;
  firmAddress2: string | null;
  firmCity: string | null;
  firmState: string | null;
  firmZip: string | null;
  firmPhone: string | null;
  firmContactName: string | null;
  barNumber: string | null;
  barState: string | null;
  attorneyOnboardedAt: Date | null;
}) {
  return {
    firmName: u.firmName,
    firmAddress: u.firmAddress,
    firmAddress2: u.firmAddress2,
    firmCity: u.firmCity,
    firmState: u.firmState,
    firmZip: u.firmZip,
    firmPhone: u.firmPhone,
    firmContactName: u.firmContactName,
    barNumber: u.barNumber,
    barState: u.barState,
    attorneyOnboardedAt: u.attorneyOnboardedAt
      ? u.attorneyOnboardedAt.toISOString()
      : null,
  };
}

// Required fields for the attorney to be considered "onboarded".
// Bar info is intentionally optional — the onboarding form encourages
// it but doesn't block save.
function isFirmProfileComplete(u: {
  firmName: string | null;
  firmAddress: string | null;
  firmCity: string | null;
  firmState: string | null;
  firmZip: string | null;
  firmPhone: string | null;
  firmContactName: string | null;
}): boolean {
  return Boolean(
    u.firmName &&
      u.firmAddress &&
      u.firmCity &&
      u.firmState &&
      u.firmZip &&
      u.firmPhone &&
      u.firmContactName,
  );
}

// First-time attorneys may hit /me/firm-profile before any other endpoint
// has triggered the row upsert; without this bootstrap, requireRole sees
// userRole=null and 403s. Upsert + re-load the role so the role-gate
// downstream sees the freshly-synced role.
const ensureUserBootstrapped: RequestHandler = async (req, res, next) => {
  try {
    if (!req.userRole) {
      const user = await getOrUpsertUser(req.userId!);
      req.userRole = (user.role ?? null) as typeof req.userRole;
    }
    next();
  } catch (err) {
    req.log.error({ err, userId: req.userId }, "Failed to bootstrap user row");
    res.status(500).json({ error: "Internal" });
  }
};

router.get(
  "/me/firm-profile",
  ensureUserBootstrapped,
  requireRole("attorney"),
  async (req, res) => {
  const [row] = await db
    .select({
      firmName: usersTable.firmName,
      firmAddress: usersTable.firmAddress,
      firmAddress2: usersTable.firmAddress2,
      firmCity: usersTable.firmCity,
      firmState: usersTable.firmState,
      firmZip: usersTable.firmZip,
      firmPhone: usersTable.firmPhone,
      firmContactName: usersTable.firmContactName,
      barNumber: usersTable.barNumber,
      barState: usersTable.barState,
      attorneyOnboardedAt: usersTable.attorneyOnboardedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  // No row = brand-new attorney that hasn't hit /me yet. Return a blank
  // profile rather than 404 so the form binding never trips on undefined.
  res.json(
    row
      ? projectFirmProfile(row)
      : projectFirmProfile({
          firmName: null,
          firmAddress: null,
          firmAddress2: null,
          firmCity: null,
          firmState: null,
          firmZip: null,
          firmPhone: null,
          firmContactName: null,
          barNumber: null,
          barState: null,
          attorneyOnboardedAt: null,
        }),
  );
  },
);

router.patch(
  "/me/firm-profile",
  ensureUserBootstrapped,
  requireRole("attorney"),
  async (req, res) => {
    const parsed = firmProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid firm profile", detail: parsed.error.flatten() });
      return;
    }
    const v = parsed.data;
    // Truly partial PATCH: only touch keys the client actually sent.
    // Sending `null` or an empty string clears the field; omitting the
    // key leaves the existing value alone. (Architect-flagged data-loss
    // fix — previously every omitted key was silently nulled out.)
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (v.firmName !== undefined) set.firmName = trimToNull(v.firmName);
    if (v.firmAddress !== undefined) set.firmAddress = trimToNull(v.firmAddress);
    if (v.firmAddress2 !== undefined) set.firmAddress2 = trimToNull(v.firmAddress2);
    if (v.firmCity !== undefined) set.firmCity = trimToNull(v.firmCity);
    if (v.firmState !== undefined) set.firmState = trimToNull(v.firmState);
    if (v.firmZip !== undefined) set.firmZip = trimToNull(v.firmZip);
    if (v.firmPhone !== undefined) set.firmPhone = trimToNull(v.firmPhone);
    if (v.firmContactName !== undefined) set.firmContactName = trimToNull(v.firmContactName);
    if (v.barNumber !== undefined) set.barNumber = trimToNull(v.barNumber);
    if (v.barState !== undefined) set.barState = trimToNull(v.barState);
    // Stamp `attorneyOnboardedAt` the first time the merged profile
    // satisfies the required-fields gate. Idempotent — once stamped,
    // we never re-stamp or unstamp here.
    const [existing] = await db
      .select({
        firmName: usersTable.firmName,
        firmAddress: usersTable.firmAddress,
        firmCity: usersTable.firmCity,
        firmState: usersTable.firmState,
        firmZip: usersTable.firmZip,
        firmPhone: usersTable.firmPhone,
        firmContactName: usersTable.firmContactName,
        attorneyOnboardedAt: usersTable.attorneyOnboardedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);
    const merged = {
      firmName: (set.firmName as string | null | undefined) ?? existing?.firmName ?? null,
      firmAddress: (set.firmAddress as string | null | undefined) ?? existing?.firmAddress ?? null,
      firmCity: (set.firmCity as string | null | undefined) ?? existing?.firmCity ?? null,
      firmState: (set.firmState as string | null | undefined) ?? existing?.firmState ?? null,
      firmZip: (set.firmZip as string | null | undefined) ?? existing?.firmZip ?? null,
      firmPhone: (set.firmPhone as string | null | undefined) ?? existing?.firmPhone ?? null,
      firmContactName:
        (set.firmContactName as string | null | undefined) ?? existing?.firmContactName ?? null,
    };
    if (!existing?.attorneyOnboardedAt && isFirmProfileComplete(merged)) {
      set.attorneyOnboardedAt = new Date();
    }
    const [row] = await db
      .update(usersTable)
      .set(set)
      .where(eq(usersTable.id, req.userId!))
      .returning();
    res.json(projectFirmProfile(row));
  },
);

// ---------------------------------------------------------------------------
// Account preferences (any role) — phone + SMS opt-out. Display name and
// email are owned by Clerk and edited there.
// ---------------------------------------------------------------------------

const accountPreferencesSchema = z.object({
  phone: z.string().nullable().optional(),
  smsOptOut: z.boolean().optional(),
});

router.get("/me/account", requireAuth, async (req, res) => {
  const [row] = await db
    .select({ phone: usersTable.phone, smsOptOut: usersTable.smsOptOut })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  res.json({
    phone: row?.phone ?? null,
    smsOptOut: row?.smsOptOut ?? false,
  });
});

router.patch("/me/account", requireAuth, async (req, res) => {
  const parsed = accountPreferencesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid account preferences", detail: parsed.error.flatten() });
    return;
  }
  const v = parsed.data;
  await getOrUpsertUser(req.userId!);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (v.phone !== undefined) set.phone = trimToNull(v.phone);
  if (v.smsOptOut !== undefined) set.smsOptOut = v.smsOptOut;
  const [row] = await db
    .update(usersTable)
    .set(set)
    .where(eq(usersTable.id, req.userId!))
    .returning({ phone: usersTable.phone, smsOptOut: usersTable.smsOptOut });
  res.json({ phone: row.phone, smsOptOut: row.smsOptOut });
});

export default router;
