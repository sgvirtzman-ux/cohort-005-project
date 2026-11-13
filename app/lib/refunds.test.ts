import { describe, it, expect } from "vitest";
import { PurchaseStatus } from "~/db/schema";
import {
  REFUND_WATCH_LIMIT_SECONDS,
  buildRefundRequestedEmail,
  checkRefundEligibility,
  lastDayOfRefundWindow,
  type RefundablePurchase,
} from "./refunds";

// Local times, so the calendar-day arithmetic matches the server's.
const PURCHASED_AT = new Date(2026, 10, 1, 23, 0).toISOString(); // 1 Nov, 23:00
const DAY_14 = new Date(2026, 10, 15, 22, 0); // last day of the window
const DAY_15 = new Date(2026, 10, 16, 0, 30);

function individual(
  overrides: Partial<Extract<RefundablePurchase, { kind: "individual" }>> = {}
): RefundablePurchase {
  return {
    kind: "individual",
    amountPaid: 4999,
    purchasedAt: PURCHASED_AT,
    status: PurchaseStatus.Active,
    hasRefundRequest: false,
    watchedSeconds: 0,
    completedLessons: 0,
    totalLessons: 10,
    ...overrides,
  };
}

function teamLicence(
  overrides: Partial<Extract<RefundablePurchase, { kind: "team_licence" }>> = {}
): RefundablePurchase {
  return {
    kind: "team_licence",
    amountPaid: 5 * 5999,
    purchasedAt: PURCHASED_AT,
    status: PurchaseStatus.Active,
    hasRefundRequest: false,
    claimedSeats: 0,
    ...overrides,
  };
}

describe("checkRefundEligibility", () => {
  describe("an individual purchase", () => {
    it("is eligible for the amount paid inside the window", () => {
      expect(checkRefundEligibility(individual(), DAY_14)).toEqual({
        eligible: true,
        refundAmount: 4999,
        lastDayOfWindow: "2026-11-15",
      });
    });

    it("refunds the amount paid, not the list price, for a PPP purchase", () => {
      const result = checkRefundEligibility(
        individual({ amountPaid: 2500 }),
        DAY_14
      );
      expect(result).toMatchObject({ eligible: true, refundAmount: 2500 });
    });

    it("closes the window after the fourteenth calendar day", () => {
      expect(checkRefundEligibility(individual(), DAY_15)).toEqual({
        eligible: false,
        reason: "window_closed",
      });
    });

    it("is ineligible once two hours have been watched", () => {
      const result = checkRefundEligibility(
        individual({ watchedSeconds: REFUND_WATCH_LIMIT_SECONDS }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "watched_too_much" });
    });

    it("is ineligible once half the lessons are completed", () => {
      const result = checkRefundEligibility(
        individual({ completedLessons: 5, totalLessons: 10 }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "completed_too_much" });
    });

    it("ignores completion for a course with no lessons", () => {
      const result = checkRefundEligibility(
        individual({ completedLessons: 0, totalLessons: 0 }),
        DAY_14
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("a team licence", () => {
    it("is eligible for the licence total while no seats are claimed", () => {
      const result = checkRefundEligibility(teamLicence(), DAY_14);
      expect(result).toMatchObject({ eligible: true, refundAmount: 5 * 5999 });
    });

    it("is ineligible once any seat is claimed", () => {
      const result = checkRefundEligibility(
        teamLicence({ claimedSeats: 1 }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "seat_claimed" });
    });

    it("still closes with the refund window", () => {
      const result = checkRefundEligibility(teamLicence(), DAY_15);
      expect(result).toEqual({ eligible: false, reason: "window_closed" });
    });
  });

  describe("any purchase", () => {
    it("is ineligible when it was free", () => {
      const result = checkRefundEligibility(
        individual({ amountPaid: 0 }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "free" });
    });

    it("is ineligible when a refund request already exists, even a declined one", () => {
      const result = checkRefundEligibility(
        individual({ hasRefundRequest: true }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "already_requested" });
    });

    it("is ineligible once refunded", () => {
      const result = checkRefundEligibility(
        individual({ status: PurchaseStatus.Refunded }),
        DAY_14
      );
      expect(result).toEqual({ eligible: false, reason: "refunded" });
    });
  });
});

describe("lastDayOfRefundWindow", () => {
  it("gives a late-evening purchase all of its fourteenth day", () => {
    expect(lastDayOfRefundWindow(PURCHASED_AT)).toBe("2026-11-15");
  });
});

describe("buildRefundRequestedEmail", () => {
  it("calls it a refund request and quotes the amount paid", () => {
    const message = buildRefundRequestedEmail({
      buyerName: "Ada",
      buyerEmail: "ada@example.com",
      courseTitle: "TypeScript",
      amount: 2500,
    });

    expect(message.subject).toBe("Refund requested — TypeScript");
    expect(message.body).toContain("refund request");
    expect(message.body).toContain("$25.00");
    expect(message.body).not.toMatch(/reversal|chargeback|cancel/i);
  });
});
