import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: UserRole | null;
    }
  }
}

async function loadRoleFromDb(userId: string): Promise<UserRole | null> {
  const rows = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return (rows[0]?.role ?? null) as UserRole | null;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;

  // Authoritative role lookup: always read from DB so authorization decisions
  // never rely on stale Clerk session claims. Cheap, indexed by primary key.
  // Skipped for the brand-new sign-up case (row may not exist yet) — handlers
  // that don't need a role (e.g. /me, which upserts the row) still work.
  try {
    req.userRole = await loadRoleFromDb(userId);
  } catch (err) {
    req.log.error({ err, userId }, "Failed to load user role from DB");
    res.status(500).json({ error: "Internal" });
    return;
  }

  next();
};

export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.userRole) {
      res.status(403).json({ error: "Role not set" });
      return;
    }
    if (!allowed.includes(req.userRole)) {
      res
        .status(403)
        .json({ error: "Forbidden", required: allowed, actual: req.userRole });
      return;
    }
    next();
  };
}
