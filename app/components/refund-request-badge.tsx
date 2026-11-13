import { RefundRequestStatus, RefundStatus } from "~/db/schema";

const STYLES = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  gray: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
} as const;

function describe(
  status: RefundRequestStatus,
  refundStatus: RefundStatus | null
): { label: string; tone: keyof typeof STYLES } {
  switch (status) {
    case RefundRequestStatus.Pending:
      return { label: "Pending", tone: "amber" };
    case RefundRequestStatus.Declined:
      return { label: "Declined", tone: "gray" };
    case RefundRequestStatus.Approved:
      if (refundStatus === RefundStatus.Failed) {
        return { label: "Approved · refund failed", tone: "red" };
      }
      return { label: "Approved", tone: "green" };
  }
}

/**
 * A refund request's state. "Refunded" is a purchase state, never a request
 * state (see GLOSSARY.md), so an approved request reads "Approved" whether or
 * not its refund has gone through, unless the refund failed.
 */
export function RefundRequestBadge({
  status,
  refundStatus,
}: {
  status: RefundRequestStatus;
  refundStatus: RefundStatus | null;
}) {
  const { label, tone } = describe(status, refundStatus);
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[tone]}`}
    >
      {label}
    </span>
  );
}
