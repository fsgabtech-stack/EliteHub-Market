import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { requireAuthenticatedUser } from "../http/authorization.js";
import { asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";

const notificationIdSchema = z.string().uuid();
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export function registerNotificationRoutes(router: Router): void {
  router.get(
    "/notifications",
    asyncRoute(async (request, response) => {
      const parsed = listSchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      const notifications = await query<{
        body: string;
        created_at: Date;
        id: string;
        kind: string;
        link_path: string | null;
        read_at: Date | null;
        title: string;
      }>(
        `SELECT id, kind, title, body, link_path, read_at, created_at
           FROM user_notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [user.id, parsed.data.limit],
      );
      response.json({ items: notifications.rows.map((notification) => ({
        body: notification.body,
        createdAt: notification.created_at.toISOString(),
        id: notification.id,
        kind: notification.kind,
        linkPath: notification.link_path,
        readAt: notification.read_at?.toISOString() ?? null,
        title: notification.title,
      })) });
    }),
  );

  router.patch(
    "/notifications/:id/read",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const notificationId = notificationIdSchema.safeParse(request.params.id);
      if (!notificationId.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      await query(
        "UPDATE user_notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2",
        [notificationId.data, user.id],
      );
      response.status(204).send();
    }),
  );
}
