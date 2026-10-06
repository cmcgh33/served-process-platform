/**
 * Helpers for GET /admin/users (role + license-expiry filtering).
 *
 * Extracted from `routes/admin.ts` so the predicate behavior can be
 * exercised by integration tests against a real database — see
 * `adminUserFilters.test.ts`.
 */
import {
  and,
  eq,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  serversTable,
  usersTable,
  userRoles,
  type UserRole,
} from "@workspace/db";

export interface AdminUsersQuery {
  search: string;
  role: UserRole | null;
  /**
   * "Next N days" license-expiry window for servers. Bounded 0..365.
   * Only honored when role === 'server' (other roles have no
   * license_expiry, so applying it would always return an empty list).
   */
  expiringWithinDays: number | null;
  limit: number;
  offset: number;
}

export function parseAdminUsersQuery(
  raw: Record<string, unknown>,
): AdminUsersQuery {
  const search =
    typeof raw.search === "string" ? raw.search.trim() : "";
  const limit = Math.min(
    Math.max(Number.parseInt(String(raw.limit ?? "50"), 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    Number.parseInt(String(raw.offset ?? "0"), 10) || 0,
    0,
  );

  const rawRole = typeof raw.role === "string" ? raw.role.trim() : "";
  const role: UserRole | null = (userRoles as readonly string[]).includes(
    rawRole,
  )
    ? (rawRole as UserRole)
    : null;

  const parsedExpiring = Number.parseInt(String(raw.expiringWithinDays ?? ""), 10);
  const expiringWithinDays =
    role === "server" && Number.isFinite(parsedExpiring) && parsedExpiring >= 0
      ? Math.min(parsedExpiring, 365)
      : null;

  return { search, role, expiringWithinDays, limit, offset };
}

/**
 * Build the WHERE clause for the /admin/users listing query.
 *
 * Notes on the expiry predicate:
 *   - "Expiring within N days" means the future window
 *     `[CURRENT_DATE, CURRENT_DATE + N]`. We deliberately EXCLUDE
 *     already-expired licenses so the chip means what it says — lapsed
 *     servers belong to a separate triage flow and would otherwise
 *     drown the upcoming-expiry list.
 *   - `date + integer` adds days in Postgres.
 */
export function buildAdminUsersWhere(
  q: AdminUsersQuery,
): SQL<unknown> | undefined {
  const conditions: SQL<unknown>[] = [];
  if (q.search) {
    const searchOr = or(
      ilike(usersTable.email, `%${q.search}%`),
      ilike(usersTable.firstName, `%${q.search}%`),
      ilike(usersTable.lastName, `%${q.search}%`),
    );
    if (searchOr) conditions.push(searchOr);
  }
  if (q.role) {
    conditions.push(eq(usersTable.role, q.role));
  }
  if (q.expiringWithinDays !== null) {
    // The `::int` cast on the parameter is required: Postgres can't
    // resolve `date + $1` when `$1` is sent as the default text type
    // (operator is not unique: date + unknown). Casting forces the
    // `date + integer` overload, which adds days.
    conditions.push(
      sql`${serversTable.licenseExpiry} IS NOT NULL AND ${serversTable.licenseExpiry} >= CURRENT_DATE AND ${serversTable.licenseExpiry} <= CURRENT_DATE + ${q.expiringWithinDays}::int`,
    );
  }
  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
