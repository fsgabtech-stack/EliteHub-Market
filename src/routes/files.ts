import { createHash } from "node:crypto";

import type { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAnyRole, requireAuthenticatedUser, requireVerifiedEmail } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { createReadUrl, deleteStoredFile, storeFile } from "../modules/files/storage.js";

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  storage: multer.memoryStorage(),
});
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function registerFileRoutes(router: Router): void {
  router.post(
    "/seller/products/:id/images",
    csrfProtection,
    upload.single("file"),
    asyncRoute(async (request, response) => {
      const productId = z.string().uuid().safeParse(request.params.id);
      const file = request.file;
      if (!productId.success || !file || !imageTypes.has(file.mimetype) || file.size === 0) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      requireVerifiedEmail(user);
      const seller = await query<{ approval_status: string }>(
        "SELECT approval_status FROM seller_profiles WHERE user_id = $1",
        [user.id],
      );
      if (seller.rows[0]?.approval_status !== "APPROVED") {
        throw new AppError(403, "FORBIDDEN");
      }
      const owner = await query<{ id: string }>("SELECT id FROM products WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL", [productId.data, user.id]);
      if (!owner.rows[0]) {
        throw new AppError(404, "NOT_FOUND");
      }
      const storageKey = await storeFile({
        body: file.buffer,
        contentType: file.mimetype,
        originalFilename: file.originalname,
        purpose: "PRODUCT_IMAGE",
      });
      try {
        const assetId = await transaction(async (client) => {
          const asset = await client.query<{ id: string }>(
            `INSERT INTO file_assets(owner_user_id, storage_key, original_filename, content_type, byte_size, sha256, purpose)
             VALUES ($1, $2, $3, $4, $5, $6, 'PRODUCT_IMAGE')
             RETURNING id`,
            [user.id, storageKey, file.originalname.slice(0, 255), file.mimetype, file.size, createHash("sha256").update(file.buffer).digest("hex")],
          );
          const createdAsset = asset.rows[0];
          if (!createdAsset) {
            throw new AppError(503, "BACKEND_UNAVAILABLE");
          }
          await client.query(
            `INSERT INTO product_images(product_id, asset_id, sort_order)
             VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM product_images WHERE product_id = $1), 0))`,
            [productId.data, createdAsset.id],
          );
          return createdAsset.id;
        });
        response.status(201).json({ id: assetId });
      } catch (error) {
        await deleteStoredFile(storageKey).catch(() => undefined);
        throw error;
      }
    }),
  );

  router.get(
    "/files/:id",
    asyncRoute(async (request, response) => {
      const assetId = z.string().uuid().safeParse(request.params.id);
      if (!assetId.success) {
        throw invalidRequest();
      }
      const asset = await query<{ owner_user_id: string; purpose: string; storage_key: string }>(
        "SELECT owner_user_id, purpose, storage_key FROM file_assets WHERE id = $1 AND deleted_at IS NULL",
        [assetId.data],
      );
      const value = asset.rows[0];
      if (!value) {
        throw new AppError(404, "NOT_FOUND");
      }
      if (value.purpose !== "PRODUCT_IMAGE") {
        const user = await requireAuthenticatedUser(request);
        if (user.id !== value.owner_user_id && !user.roles.includes("ADMIN")) {
          throw new AppError(403, "FORBIDDEN");
        }
      }
      response.redirect(302, await createReadUrl(value.storage_key));
    }),
  );
}
