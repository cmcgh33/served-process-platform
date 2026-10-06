import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import serversRouter from "./servers";
import jobsRouter from "./jobs";
import dashboardRouter from "./dashboard";
import stripeRouter from "./stripe";
import meRouter from "./me";
import storageRouter from "./storage";
import documentsRouter from "./documents";
import marketplaceRouter from "./marketplace";
import draftCheckoutQueueRouter from "./draftCheckoutQueue";
import adminRouter from "./admin";
import pricingRouter from "./pricing";
import locationsRouter from "./locations";
import {
  demoInvitesAdminRouter,
  demoInvitesPublicRouter,
} from "./demoInvites";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Public routes — no auth required.
// - /healthz is hit by uptime probes.
// - /stripe is mounted with its own per-route auth (publishable key endpoint
//   must remain public so the unauthenticated marketing site can render
//   pricing; checkout/products endpoints below add requireAuth themselves).
// - demoInvitesPublicRouter exposes the soft email-gate endpoints used by
//   the public /demo/watch/:token page (lookup + confirm).
// - demoInvitesAdminRouter declares its own requireAuth + requireAdmin so it
//   can sit alongside other admin endpoints — but it lives here in the
//   public block because the global requireAuth below blocks anything that
//   doesn't add it explicitly.
router.use(healthRouter);
router.use(stripeRouter);
router.use(demoInvitesPublicRouter);
router.use(demoInvitesAdminRouter);

// Authenticated routes — every endpoint below requires a valid Clerk session.
// Role-specific authorization (requester / attorney / server) lives inside
// each router as needed.
router.use(requireAuth);
router.use(meRouter);
router.use(clientsRouter);
router.use(serversRouter);
router.use(jobsRouter);
router.use(dashboardRouter);
router.use(storageRouter);
router.use(documentsRouter);
router.use(marketplaceRouter);
router.use(draftCheckoutQueueRouter);
router.use(adminRouter);
router.use(pricingRouter);
router.use(locationsRouter);

export default router;
