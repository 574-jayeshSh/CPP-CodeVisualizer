import { Router } from "express";
import { z } from "zod";

import { asyncHandler, sendError } from "../http.js";
import { runService } from "../services/run.service.js";

const router = Router();

const runSchema = z.object({
  source: z.string().min(1).max(200_000),
  stdin: z.string().max(100_000).optional(),
  timeLimitMs: z.number().int().min(50).max(30_000).optional(),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = runSchema.safeParse(req.body);

    if (!parsed.success) {
      sendError(res, 400, "Invalid run payload.", parsed.error.flatten());
      return;
    }

    const result = await runService.run(parsed.data);
    res.json(result);
  }),
);

export { router as runRouter };
