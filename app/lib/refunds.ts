import { PurchaseStatus } from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Refund rules ───
// The rules from GLOSSARY.md ("Refund eligibility", "Refund amount"), in one
// place, with no database access, so the course page, the team page and the
// server all agree.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

type PurchaseBasics = {
  amountPaid: number;
  purchasedAt: string;
  status: PurchaseStatus;
  /** Any refund request at all: a declined one is final. */
  hasRefundRequest: boolean;
};

export type RefundablePurchase =
  | (PurchaseBasics & {
      kind: "individual";
      watchedSeconds: number;
      completedLessons: number;
      totalLessons: number;
    })
  | (PurchaseBasics & {
      kind: "team_licence";
      claimedSeats: number;
    });

export type RefundIneligibleReason =
  | "refunded"
  | "already_requested"
  | "free"
  | "window_closed"
  | "watched_too_much"
  | "completed_too_much"
  | "seat_claimed";

export type RefundEligibility =
  | { eligible: true; refundAmount: number; lastDayOfWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

export const REFUND_INELIGIBLE_MESSAGES: Record<
  RefundIneligibleReason,
  string
> = {
  refunded: "This purchase has already been refunded.",
  already_requested: "There is already a refund request on this purchase.",
  free: "A free purchase cannot be refunded.",
  window_closed: `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
  watched_too_much:
    "You have watched too much of this course to request a refund.",
  completed_too_much:
    "You have completed too much of this course to request a refund.",
  seat_claimed: "A team licence with claimed seats cannot be refunded.",
};

/**
 * The calendar day, in server-local time. The window is counted in whole
 * days, not hours — a purchase at 23:00 still gets all of its fourteenth day.
 */
export function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAtIso: string): string {
  const deadline = new Date(purchasedAtIso);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(deadline);
}

export function checkRefundEligibility(
  purchase: RefundablePurchase,
  now: Date
): RefundEligibility {
  const ineligible = (reason: RefundIneligibleReason): RefundEligibility => ({
    eligible: false,
    reason,
  });

  if (purchase.status === PurchaseStatus.Refunded)
    return ineligible("refunded");
  if (purchase.hasRefundRequest) return ineligible("already_requested");
  if (purchase.amountPaid <= 0) return ineligible("free");

  const lastDayOfWindow = lastDayOfRefundWindow(purchase.purchasedAt);
  if (calendarDay(now) > lastDayOfWindow) return ineligible("window_closed");

  if (purchase.kind === "team_licence") {
    if (purchase.claimedSeats > 0) return ineligible("seat_claimed");
  } else {
    if (purchase.watchedSeconds >= REFUND_WATCH_LIMIT_SECONDS) {
      return ineligible("watched_too_much");
    }
    if (
      purchase.totalLessons > 0 &&
      purchase.completedLessons / purchase.totalLessons >=
        REFUND_COMPLETION_LIMIT
    ) {
      return ineligible("completed_too_much");
    }
  }

  // The refund amount is always the amount paid: for a team licence, the
  // licence total. Never the list price, which can change after the purchase.
  return { eligible: true, refundAmount: purchase.amountPaid, lastDayOfWindow };
}

// ─── Emails ───
// There is no mail transport yet, so the built messages go to the server log.

export type Email = { to: string; subject: string; body: string };

type EmailInput = {
  buyerName: string;
  buyerEmail: string;
  courseTitle: string;
  amount: number;
};

function email(input: EmailInput, subject: string, lines: string[]): Email {
  return {
    to: input.buyerEmail,
    subject: `${subject} — ${input.courseTitle}`,
    body: [
      `Hi ${input.buyerName},`,
      "",
      ...lines,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export function buildRefundRequestedEmail(input: EmailInput): Email {
  return email(input, "Refund requested", [
    `We have your refund request for "${input.courseTitle}".`,
    `It is for ${formatPrice(input.amount)}, the amount you paid.`,
    "",
    "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again once it has been resolved.",
  ]);
}

export function buildRefundedEmail(input: EmailInput): Email {
  return email(input, "Refund sent", [
    `Your refund request for "${input.courseTitle}" was approved.`,
    `We have sent ${formatPrice(input.amount)} back to the card you paid with.`,
  ]);
}

export function buildRefundDeclinedEmail(input: EmailInput): Email {
  return email(input, "Refund request declined", [
    `We have declined your refund request for "${input.courseTitle}".`,
    "Your purchase stays as it is.",
  ]);
}

export function logEmail(message: Email) {
  console.log(
    `[email] to=${message.to} subject=${message.subject}\n${message.body}`
  );
}
