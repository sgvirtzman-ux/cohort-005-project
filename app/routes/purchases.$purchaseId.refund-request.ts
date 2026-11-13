import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/purchases.$purchaseId.refund-request";
import { requireUserId } from "~/lib/access.server";
import { createRefundRequest } from "~/lib/refunds.server";
import { parseFormData, parseParams } from "~/lib/validation";

const paramsSchema = z.object({
  purchaseId: z.coerce.number().int().positive(),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
});

export async function action({ params, request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { purchaseId } = parseParams(params, paramsSchema);

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const { kind } = createRefundRequest({
    purchaseId,
    userId,
    reason: parsed.data.reason,
  });

  return redirect(kind === "team_licence" ? "/team" : "/settings");
}
