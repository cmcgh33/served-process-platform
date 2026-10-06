import { Router } from "express";
import { db, jobsTable, serversTable } from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { requireRole } from "../middlewares/auth";

const anyRole = requireRole("requester", "attorney", "server");

const router = Router();

// Build the WHERE clause that scopes /dashboard reads to the caller. Returns
// undefined when the caller has no resolvable scope (e.g. a server with no
// profile yet) — in which case all aggregates collapse to zero.
//
// Drafts (attorney pre-payment shells) are always excluded — the dashboard
// reflects work in flight, not pending intent.
async function scopeForUser(userId: string, role: string): Promise<SQL | undefined> {
  const notDraft = sql`${jobsTable.status} <> 'draft'`;
  if (role === "requester" || role === "attorney") {
    return and(eq(jobsTable.requesterUserId, userId), notDraft);
  }
  if (role === "server") {
    const [row] = await db
      .select({ id: serversTable.id })
      .from(serversTable)
      .where(eq(serversTable.userId, userId));
    if (!row) return sql`false`;
    return and(eq(jobsTable.serverId, row.id), notDraft);
  }
  return sql`false`;
}

router.get("/dashboard/summary", anyRole, async (req, res) => {
  const scope = await scopeForUser(req.userId!, req.userRole!);

  const [totals] = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      servedCount: sql<number>`count(*) filter (where ${jobsTable.status} = 'served')::int`,
      pendingJobs: sql<number>`count(*) filter (where ${jobsTable.status} = 'pending')::int`,
      failedCount: sql<number>`count(*) filter (where ${jobsTable.status} = 'failed')::int`,
    })
    .from(jobsTable)
    .where(scope);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // First day of the current calendar month, in the server's timezone. We
  // compare against jobs.servedAt so the count reflects when service was
  // actually completed (not when the job was created).
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [todayStats] = await db
    .select({ servedToday: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(
      and(
        scope,
        sql`${jobsTable.status} = 'served' AND ${jobsTable.servedAt} >= ${today.toISOString()}`,
      ),
    );

  const [monthStats] = await db
    .select({ servedThisMonth: sql<number>`count(*)::int` })
    .from(jobsTable)
    .where(
      and(
        scope,
        sql`${jobsTable.status} = 'served' AND ${jobsTable.servedAt} >= ${monthStart.toISOString()}`,
      ),
    );

  const [serverStats] = await db
    .select({ activeServers: sql<number>`count(*)::int` })
    .from(serversTable)
    .where(eq(serversTable.active, true));

  const totalCompleted = (totals?.servedCount ?? 0) + (totals?.failedCount ?? 0);
  const successRate =
    totalCompleted > 0 ? Math.round(((totals?.servedCount ?? 0) / totalCompleted) * 100) : 0;

  res.json({
    totalJobs: totals?.totalJobs ?? 0,
    servedCount: totals?.servedCount ?? 0,
    servedToday: todayStats?.servedToday ?? 0,
    servedThisMonth: monthStats?.servedThisMonth ?? 0,
    pendingJobs: totals?.pendingJobs ?? 0,
    activeServers: serverStats?.activeServers ?? 0,
    successRate,
    avgCompletionHours: 4.5,
  });
});

router.get("/dashboard/recent-jobs", anyRole, async (req, res) => {
  const scope = await scopeForUser(req.userId!, req.userRole!);
  const limit = parseInt((req.query.limit as string) ?? "10", 10);
  const recentJobs = await db
    .select()
    .from(jobsTable)
    .where(scope)
    .orderBy(sql`${jobsTable.createdAt} DESC`)
    .limit(limit);
  res.json(recentJobs);
});

router.get("/dashboard/status-breakdown", anyRole, async (req, res) => {
  const scope = await scopeForUser(req.userId!, req.userRole!);
  const breakdown = await db
    .select({
      status: jobsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(jobsTable)
    .where(scope)
    .groupBy(jobsTable.status);
  res.json(breakdown);
});

export default router;
