import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("~/db", async () => {
  const { createTestDb } = await import("~/test/setup");
  return { db: createTestDb() };
});

import { db } from "~/db";
import * as schema from "~/db/schema";
import { seedBaseData } from "~/test/setup";
import {
  completeRefund,
  createRefundRequest,
  getLatestIndividualPurchase,
  resolveRefundRequest,
  retryRefund,
} from "./refunds.server";

type TestDb = Parameters<typeof seedBaseData>[0];
const testDb = db as unknown as TestDb;

let base: ReturnType<typeof seedBaseData>;
let emailCount = 0;

beforeEach(() => {
  for (const table of [
    schema.refunds,
    schema.refundRequests,
    schema.payments,
    schema.coupons,
    schema.teamMembers,
    schema.teams,
    schema.enrollments,
    schema.purchases,
    schema.courses,
    schema.categories,
    schema.users,
  ]) {
    testDb.delete(table).run();
  }
  base = seedBaseData(testDb);
  emailCount = 0;
  vi.spyOn(console, "log").mockImplementation(() => {
    emailCount++;
  });
});

function buyIndividually(amountPaid = 4999) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId: base.course.id, amountPaid })
    .returning()
    .get();
  testDb
    .insert(schema.payments)
    .values({ purchaseId: purchase.id, amount: amountPaid })
    .run();
  testDb
    .insert(schema.enrollments)
    .values({ userId: base.user.id, courseId: base.course.id })
    .run();
  return purchase;
}

function buyLicence(seats: number, seatPrice = 5999) {
  const purchase = testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      amountPaid: seats * seatPrice,
    })
    .returning()
    .get();
  testDb
    .insert(schema.payments)
    .values({ purchaseId: purchase.id, amount: purchase.amountPaid })
    .run();
  const team = testDb.insert(schema.teams).values({}).returning().get();
  for (let i = 0; i < seats; i++) {
    testDb
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `code-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .run();
  }
  return purchase;
}

function getPurchase(id: number) {
  return testDb
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.id, id))
    .get();
}

function isEnrolled() {
  return !!testDb
    .select()
    .from(schema.enrollments)
    .where(eq(schema.enrollments.userId, base.user.id))
    .get();
}

function refundsFor(requestId: number) {
  return testDb
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.refundRequestId, requestId))
    .all();
}

const reason = "It was not what I expected.";

describe("requesting a refund", () => {
  it("records a pending request for the amount paid and emails the buyer", () => {
    const purchase = buyIndividually(2500);

    const { request, kind } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });

    expect(kind).toBe("individual");
    expect(request.status).toBe(schema.RefundRequestStatus.Pending);
    expect(request.refundAmount).toBe(2500);
    expect(emailCount).toBe(1);
  });

  it("refuses someone who is not the buyer", () => {
    const purchase = buyIndividually();
    expect(() =>
      createRefundRequest({
        purchaseId: purchase.id,
        userId: base.instructor.id,
        reason,
      })
    ).toThrow();
  });

  it("refuses a second request, even after a decline", () => {
    const purchase = buyIndividually();
    const { request } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });
    resolveRefundRequest({
      requestId: request.id,
      adminUserId: base.instructor.id,
      decision: "decline",
    });

    expect(() =>
      createRefundRequest({
        purchaseId: purchase.id,
        userId: base.user.id,
        reason,
      })
    ).toThrow();
  });

  it("refunds a team licence for its total while no seats are claimed", () => {
    const purchase = buyLicence(5);

    const { request, kind } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });

    expect(kind).toBe("team_licence");
    expect(request.refundAmount).toBe(5 * 5999);
  });
});

describe("resolving a refund request", () => {
  it("on approval, refunds the payment, marks the purchase Refunded and revokes access", () => {
    const purchase = buyIndividually();
    const { request } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });

    resolveRefundRequest({
      requestId: request.id,
      adminUserId: base.instructor.id,
      decision: "approve",
    });

    const [refund] = refundsFor(request.id);
    expect(refund.status).toBe(schema.RefundStatus.Succeeded);
    expect(refund.amount).toBe(4999);
    expect(getPurchase(purchase.id)?.status).toBe(
      schema.PurchaseStatus.Refunded
    );
    expect(isEnrolled()).toBe(false);
  });

  it("on decline, refunds nothing and keeps access", () => {
    const purchase = buyIndividually();
    const { request } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });

    resolveRefundRequest({
      requestId: request.id,
      adminUserId: base.instructor.id,
      decision: "decline",
    });

    expect(refundsFor(request.id)).toHaveLength(0);
    expect(getPurchase(purchase.id)?.status).toBe(schema.PurchaseStatus.Active);
    expect(isEnrolled()).toBe(true);
  });

  it("cannot resolve the same request twice", () => {
    const purchase = buyIndividually();
    const { request } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });
    resolveRefundRequest({
      requestId: request.id,
      adminUserId: base.instructor.id,
      decision: "decline",
    });

    expect(() =>
      resolveRefundRequest({
        requestId: request.id,
        adminUserId: base.instructor.id,
        decision: "approve",
      })
    ).toThrow();
  });
});

describe("retrying a refund", () => {
  it("issues a new refund after a failure, and allows only one success", () => {
    const purchase = buyIndividually();
    const { request } = createRefundRequest({
      purchaseId: purchase.id,
      userId: base.user.id,
      reason,
    });
    testDb
      .update(schema.refundRequests)
      .set({ status: schema.RefundRequestStatus.Approved })
      .where(eq(schema.refundRequests.id, request.id))
      .run();
    const payment = testDb
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.purchaseId, purchase.id))
      .get();
    if (!payment) throw new Error("no payment");
    const failed = testDb
      .insert(schema.refunds)
      .values({
        refundRequestId: request.id,
        paymentId: payment.id,
        amount: 4999,
      })
      .returning()
      .get();
    completeRefund(failed.id, {
      succeeded: false,
      failureReason: "Card closed",
    });
    expect(getPurchase(purchase.id)?.status).toBe(schema.PurchaseStatus.Active);

    retryRefund(request.id);

    const statuses = refundsFor(request.id).map((refund) => refund.status);
    expect(statuses.sort()).toEqual([
      schema.RefundStatus.Failed,
      schema.RefundStatus.Succeeded,
    ]);
    expect(getPurchase(purchase.id)?.status).toBe(
      schema.PurchaseStatus.Refunded
    );
    expect(() => retryRefund(request.id)).toThrow();
  });
});

describe("getLatestIndividualPurchase", () => {
  it("ignores a team licence the user bought for others", () => {
    const own = buyIndividually();
    buyLicence(3);

    expect(getLatestIndividualPurchase(base.user.id, base.course.id)?.id).toBe(
      own.id
    );
  });
});
