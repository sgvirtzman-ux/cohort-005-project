import { useEffect } from "react";
import { data, isRouteErrorResponse, Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import type { Route } from "./+types/admin.refund-requests";
import { db } from "~/db";
import {
  RefundRequestStatus,
  RefundStatus,
  UserRole,
  users,
} from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import {
  getRefundRequestsForAdmin,
  resolveRefundRequest,
  retryRefund,
} from "~/lib/refunds.server";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { RefundRequestBadge } from "~/components/refund-request-badge";

const actionSchema = z.object({
  intent: z.enum(["approve", "decline", "retry"]),
  requestId: z.coerce.number().int().positive(),
});

async function requireAdmin(request: Request) {
  const userId = await requireUserId(request);
  const user = db.select().from(users).where(eq(users.id, userId)).get();

  if (!user || user.role !== UserRole.Admin) {
    throw data("Only admins can resolve refund requests.", { status: 403 });
  }

  return user;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return { refundRequests: getRefundRequestsForAdmin() };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, actionSchema);

  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const { intent, requestId } = parsed.data;

  if (intent === "retry") {
    retryRefund(requestId);
  } else {
    resolveRefundRequest({
      requestId,
      adminUserId: admin.id,
      decision: intent,
    });
  }

  return { success: true, intent };
}

type RefundRequestRow =
  Route.ComponentProps["loaderData"]["refundRequests"][number];

const SUCCESS_MESSAGES = {
  approve: "Refund request approved and refund sent.",
  decline: "Refund request declined.",
  retry: "Refund sent again.",
} as const;

function RefundRequestActions({ row }: { row: RefundRequestRow }) {
  const fetcher = useFetcher<{
    success: boolean;
    intent: keyof typeof SUCCESS_MESSAGES;
  }>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(SUCCESS_MESSAGES[fetcher.data.intent]);
    }
  }, [fetcher.state, fetcher.data]);

  function submit(intent: "approve" | "decline" | "retry") {
    fetcher.submit({ intent, requestId: String(row.id) }, { method: "post" });
  }

  if (row.status === RefundRequestStatus.Pending) {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isSubmitting}
          onClick={() => submit("approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => submit("decline")}
        >
          Decline
        </Button>
      </div>
    );
  }

  if (
    row.status === RefundRequestStatus.Approved &&
    row.refundStatus !== RefundStatus.Succeeded
  ) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={isSubmitting}
        onClick={() => submit("retry")}
      >
        Retry refund
      </Button>
    );
  }

  return null;
}

export default function AdminRefundRequests({
  loaderData,
}: Route.ComponentProps) {
  const { refundRequests } = loaderData;
  const pendingCount = refundRequests.filter(
    (row) => row.status === RefundRequestStatus.Pending
  ).length;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          {pendingCount === 1
            ? "One refund request is pending."
            : `${pendingCount} refund requests are pending.`}
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No refund requests yet.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Course</th>
                    <th className="px-4 py-3 text-left font-medium">Buyer</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Refund amount
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-left font-medium">State</th>
                    <th className="px-4 py-3 text-left font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {refundRequests.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/courses/${row.courseSlug}`}
                          className="font-medium hover:underline"
                        >
                          {row.courseTitle}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {row.isLicence
                            ? "Team licence"
                            : "Individual purchase"}{" "}
                          · requested{" "}
                          {new Date(row.requestedAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{row.buyerName}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.buyerEmail}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {formatPrice(row.refundAmount)}
                      </td>
                      <td className="max-w-xs px-4 py-3">{row.reason}</td>
                      <td className="px-4 py-3">
                        <RefundRequestBadge
                          status={row.status}
                          refundStatus={row.refundStatus}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <RefundRequestActions row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 403 ? "Access denied" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
