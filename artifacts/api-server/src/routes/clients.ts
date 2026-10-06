import { Router } from "express";
import { db, clientsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateClientBody } from "@workspace/api-zod";
import { requireRole } from "../middlewares/auth";

const router = Router();

const requesterOrAttorney = requireRole("requester", "attorney");

router.get("/clients", requesterOrAttorney, async (req, res) => {
  const clients = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.ownerUserId, req.userId!))
    .orderBy(clientsTable.createdAt);
  res.json(clients);
});

router.post("/clients", requesterOrAttorney, async (req, res) => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const [client] = await db
    .insert(clientsTable)
    .values({ ...parsed.data, ownerUserId: req.userId! })
    .returning();
  res.status(201).json(client);
});

router.get("/clients/:id", requesterOrAttorney, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.id, id), eq(clientsTable.ownerUserId, req.userId!)));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(client);
});

export default router;
