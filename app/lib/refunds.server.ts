import { data } from "react-router";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  sql,
} from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  payments,
  purchases,
  refundRequests,
  refunds,
  users,
  videoWatchEvents,
  LessonProgressStatus,
  PurchaseStatus,
  RefundRequestStatus,
  RefundStatus,
} from "~/db/schema";
import {
  REFUND_INELIGIBLE_MESSAGES,
  buildRefundDeclinedEmail,
  buildRefundRequestedEmail,
  buildRefundedEmail,
  checkRefundEligibility,
  logEmail,
  type RefundEligibility,
  type RefundablePurchase,
} from "~/lib/refunds";

// ─── Reading purchases ───

function getCourseLessonIds(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getWatchedSeconds(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]): number {
  if (lessonIds.length === 0) return 0;

  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return row?.count ?? 0;
}

function getSeats(purchaseId: number) {
  return db
    .select({ redeemedAt: coupons.redeemedAt })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .all();
}

function hasRefundRequest(purchaseId: number): boolean {
  return !!db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(eq(refundRequests.purchaseId, purchaseId))
    .get();
}

/** A purchase with the facts the refund rules need, or undefined. */
export function getRefundablePurchase(purchaseId: number) {
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .get();
  if (!purchase) return undefined;

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();
  if (!course) return undefined;

  const basics = {
    amountPaid: purchase.amountPaid,
    purchasedAt: purchase.createdAt,
    status: purchase.status,
    hasRefundRequest: hasRefundRequest(purchase.id),
  };

  const seats = getSeats(purchase.id);
  let facts: RefundablePurchase;

  if (seats.length > 0) {
    facts = {
      ...basics,
      kind: "team_licence",
      claimedSeats: seats.filter((seat) => seat.redeemedAt !== null).length,
    };
  } else {
    const lessonIds = getCourseLessonIds(course.id);
    facts = {
      ...basics,
      kind: "individual",
      watchedSeconds: getWatchedSeconds(purchase.userId, lessonIds),
      completedLessons: getCompletedLessonCount(purchase.userId, lessonIds),
      totalLessons: lessonIds.length,
    };
  }

  return { purchase, course, facts };
}

export function getRefundEligibility(
  purchaseId: number,
  now: Date = new Date()
): RefundEligibility | null {
  const found = getRefundablePurchase(purchaseId);
  return found ? checkRefundEligibility(found.facts, now) : null;
}

/**
 * The buyer's most recent purchase of a course for themselves — not a team
 * licence they bought for others.
 */
export function getLatestIndividualPurchase(userId: number, courseId: number) {
  const licencePurchaseIds = db
    .select({ id: coupons.purchaseId })
    .from(coupons);

  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        notInArray(purchases.id, licencePurchaseIds)
      )
    )
    .orderBy(desc(purchases.createdAt))
    .get();
}

// ─── Refund requests ───

function getUser(userId: number) {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

export function createRefundRequest(input: {
  purchaseId: number;
  userId: number;
  reason: string;
  now?: Date;
}) {
  const found = getRefundablePurchase(input.purchaseId);
  if (!found) throw data("Purchase not found.", { status: 404 });

  const { purchase, course, facts } = found;

  if (purchase.userId !== input.userId) {
    throw data("Only the buyer can request a refund.", { status: 403 });
  }

  const eligibility = checkRefundEligibility(facts, input.now ?? new Date());
  if (!eligibility.eligible) {
    throw data(REFUND_INELIGIBLE_MESSAGES[eligibility.reason], {
      status: eligibility.reason === "already_requested" ? 409 : 403,
    });
  }

  const request = db
    .insert(refundRequests)
    .values({
      purchaseId: purchase.id,
      requestedByUserId: input.userId,
      reason: input.reason,
      refundAmount: eligibility.refundAmount,
    })
    .returning()
    .get();

  const buyer = getUser(input.userId);
  if (buyer) {
    logEmail(
      buildRefundRequestedEmail({
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        courseTitle: course.title,
        amount: request.refundAmount,
      })
    );
  }

  return { request, kind: facts.kind };
}

function getRefundRequestWithContext(requestId: number) {
  return db
    .select({
      request: refundRequests,
      purchase: purchases,
      courseTitle: courses.title,
      buyerName: users.name,
      buyerEmail: users.email,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(refundRequests.requestedByUserId, users.id))
    .where(eq(refundRequests.id, requestId))
    .get();
}

export type RefundDecision = "approve" | "decline";

/** An admin approving or declining a pending refund request. */
export function resolveRefundRequest(input: {
  requestId: number;
  adminUserId: number;
  decision: RefundDecision;
}) {
  const found = getRefundRequestWithContext(input.requestId);
  if (!found) throw data("Refund request not found.", { status: 404 });

  if (found.request.status !== RefundRequestStatus.Pending) {
    throw data("This refund request has already been resolved.", {
      status: 409,
    });
  }

  const resolved = {
    resolvedAt: new Date().toISOString(),
    resolvedByUserId: input.adminUserId,
  };

  if (input.decision === "decline") {
    db.update(refundRequests)
      .set({ status: RefundRequestStatus.Declined, ...resolved })
      .where(eq(refundRequests.id, input.requestId))
      .run();

    logEmail(
      buildRefundDeclinedEmail({
        buyerName: found.buyerName,
        buyerEmail: found.buyerEmail,
        courseTitle: found.courseTitle,
        amount: found.request.refundAmount,
      })
    );
    return;
  }

  db.update(refundRequests)
    .set({ status: RefundRequestStatus.Approved, ...resolved })
    .where(eq(refundRequests.id, input.requestId))
    .run();

  issueRefund(input.requestId);
}

// ─── Refunds (the money) ───

function getPaymentForPurchase(purchaseId: number) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.purchaseId, purchaseId))
    .get();
}

function getRefundsForRequest(requestId: number) {
  return db
    .select()
    .from(refunds)
    .where(eq(refunds.refundRequestId, requestId))
    .orderBy(desc(refunds.issuedAt), desc(refunds.id))
    .all();
}

/** Issues a refund for an approved request, and sends it to be processed. */
function issueRefund(requestId: number) {
  const found = getRefundRequestWithContext(requestId);
  if (!found) throw data("Refund request not found.", { status: 404 });

  const payment = getPaymentForPurchase(found.purchase.id);
  if (!payment) {
    throw data("This purchase has no payment to refund.", { status: 409 });
  }

  const refund = db
    .insert(refunds)
    .values({
      refundRequestId: requestId,
      paymentId: payment.id,
      amount: found.request.refundAmount,
      currency: found.request.currency,
    })
    .returning()
    .get();

  processRefund(refund.id);
  return refund;
}

/**
 * Where a payment provider will plug in. With no provider yet, the money is
 * returned by hand, so every refund succeeds as soon as it is issued.
 */
function processRefund(refundId: number) {
  completeRefund(refundId, { succeeded: true });
}

export function completeRefund(
  refundId: number,
  outcome: { succeeded: true } | { succeeded: false; failureReason: string }
) {
  const refund = db
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .get();
  if (!refund) throw data("Refund not found.", { status: 404 });

  if (refund.status !== RefundStatus.Issued) {
    throw data("This refund has already completed.", { status: 409 });
  }

  const completedAt = new Date().toISOString();

  if (!outcome.succeeded) {
    db.update(refunds)
      .set({
        status: RefundStatus.Failed,
        failureReason: outcome.failureReason,
        completedAt,
      })
      .where(eq(refunds.id, refundId))
      .run();
    return;
  }

  db.update(refunds)
    .set({ status: RefundStatus.Succeeded, completedAt })
    .where(eq(refunds.id, refundId))
    .run();

  const found = getRefundRequestWithContext(refund.refundRequestId);
  if (!found) return;

  markPurchaseRefunded(found.purchase.id);

  logEmail(
    buildRefundedEmail({
      buyerName: found.buyerName,
      buyerEmail: found.buyerEmail,
      courseTitle: found.courseTitle,
      amount: refund.amount,
    })
  );
}

/** Retries an approved request whose latest refund failed. */
export function retryRefund(requestId: number) {
  const found = getRefundRequestWithContext(requestId);
  if (!found) throw data("Refund request not found.", { status: 404 });

  if (found.request.status !== RefundRequestStatus.Approved) {
    throw data("Only an approved refund request can be retried.", {
      status: 409,
    });
  }

  const [latest] = getRefundsForRequest(requestId);
  if (latest && latest.status !== RefundStatus.Failed) {
    throw data("Only a failed refund can be retried.", { status: 409 });
  }

  return issueRefund(requestId);
}

/**
 * The money is back: the purchase becomes Refunded and its enrollments are
 * revoked. A team licence can only be refunded with no seats claimed, so it
 * has no enrollments; its unclaimed seat codes stop working instead.
 */
function markPurchaseRefunded(purchaseId: number) {
  const purchase = db
    .update(purchases)
    .set({ status: PurchaseStatus.Refunded })
    .where(eq(purchases.id, purchaseId))
    .returning()
    .get();

  const isLicence = getSeats(purchaseId).length > 0;
  if (isLicence) return;

  db.delete(enrollments)
    .where(
      and(
        eq(enrollments.userId, purchase.userId),
        eq(enrollments.courseId, purchase.courseId)
      )
    )
    .run();
}

// ─── Lists for pages ───

function latestRefundStatus(requestId: number): RefundStatus | null {
  const [latest] = getRefundsForRequest(requestId);
  return latest?.status ?? null;
}

const requestColumns = {
  id: refundRequests.id,
  purchaseId: refundRequests.purchaseId,
  status: refundRequests.status,
  reason: refundRequests.reason,
  refundAmount: refundRequests.refundAmount,
  requestedAt: refundRequests.requestedAt,
  resolvedAt: refundRequests.resolvedAt,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

/** Every refund request a buyer has made, newest first. */
export function getRefundRequestsForUser(userId: number) {
  return db
    .select(requestColumns)
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refundRequests.requestedByUserId, userId))
    .orderBy(desc(refundRequests.requestedAt))
    .all()
    .map((row) => ({ ...row, refundStatus: latestRefundStatus(row.id) }));
}

/** Every refund request, pending first, for the admin page. */
export function getRefundRequestsForAdmin() {
  const isLicence = sql<number>`exists (select 1 from ${coupons} where ${coupons.purchaseId} = ${purchases.id})`;

  return db
    .select({
      ...requestColumns,
      buyerName: users.name,
      buyerEmail: users.email,
      isLicence,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(refundRequests.requestedByUserId, users.id))
    .orderBy(
      sql`case when ${refundRequests.status} = ${RefundRequestStatus.Pending} then 0 else 1 end`,
      desc(refundRequests.requestedAt)
    )
    .all()
    .map((row) => ({
      ...row,
      isLicence: Boolean(row.isLicence),
      refundStatus: latestRefundStatus(row.id),
    }));
}

/** The team licences a user has bought, with what the refund rules say. */
export function getTeamLicencesForBuyer(
  userId: number,
  now: Date = new Date()
) {
  const licencePurchaseIds = db
    .selectDistinct({ id: coupons.purchaseId })
    .from(coupons)
    .where(isNotNull(coupons.purchaseId));

  const rows = db
    .select({
      purchaseId: purchases.id,
      courseTitle: courses.title,
      amountPaid: purchases.amountPaid,
      status: purchases.status,
      purchasedAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        eq(purchases.userId, userId),
        inArray(purchases.id, licencePurchaseIds)
      )
    )
    .orderBy(desc(purchases.createdAt))
    .all();

  return rows.map((row) => {
    const seats = getSeats(row.purchaseId);
    return {
      ...row,
      totalSeats: seats.length,
      claimedSeats: seats.filter((seat) => seat.redeemedAt !== null).length,
      eligibility: getRefundEligibility(row.purchaseId, now),
    };
  });
}
