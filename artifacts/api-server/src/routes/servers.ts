import { Router } from "express";
import { db, serversTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { CreateServerBody, UpdateServerBody } from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

const anyRole = requireRole("requester", "attorney", "server");

// Roster is visible to all signed-in users — needed for assignment UI and for
// servers to view their peers. Excludes soft-deleted accounts so closed
// servers don't leak into general app flows; their history is still visible
// in the admin namespace via /admin/servers.
router.get("/servers", anyRole, async (req, res) => {
  const servers = await db
    .select()
    .from(serversTable)
    .where(isNull(serversTable.deletedAt))
    .orderBy(serversTable.createdAt);
  res.json(servers);
});

router.post("/servers", requireRole("server"), async (req, res) => {
  const parsed = CreateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  // One server profile per Clerk user.
  const [existing] = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.userId, req.userId!));
  if (existing) {
    res.status(409).json({ error: "Server profile already exists" });
    return;
  }
  const [server] = await db
    .insert(serversTable)
    .values({ ...parsed.data, userId: req.userId! })
    .returning();
  res.status(201).json(server);
});

router.get("/servers/:id", anyRole, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const [server] = await db
    .select()
    .from(serversTable)
    .where(and(eq(serversTable.id, id), isNull(serversTable.deletedAt)));
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(server);
});

router.patch("/servers/:id", requireRole("server"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const parsed = UpdateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  // Only allow updates to the caller's own server profile.
  const [server] = await db
    .update(serversTable)
    .set(parsed.data)
    .where(and(eq(serversTable.id, id), eq(serversTable.userId, req.userId!)))
    .returning();
  if (!server) {
    res.status(403).json({ error: "Not your server profile" });
    return;
  }
  res.json(server);
});

export default router;
