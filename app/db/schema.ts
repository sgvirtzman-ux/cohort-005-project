import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export enum UserRole {
  Student = "student",
  Instructor = "instructor",
  Admin = "admin",
}

export enum CourseStatus {
  Draft = "draft",
  Published = "published",
  Archived = "archived",
}

export enum LessonProgressStatus {
  NotStarted = "not_started",
  InProgress = "in_progress",
  Completed = "completed",
}

export enum QuestionType {
  MultipleChoice = "multiple_choice",
  TrueFalse = "true_false",
}

export enum PurchaseStatus {
  Active = "active",
  Refunded = "refunded",
}

export enum RefundRequestStatus {
  Pending = "pending",
  Approved = "approved",
  Declined = "declined",
}

export enum RefundStatus {
  Issued = "issued",
  Succeeded = "succeeded",
  Failed = "failed",
}

export const DEFAULT_CURRENCY = "USD";

export enum TeamMemberRole {
  Admin = "admin",
  Member = "member",
}

// ─── Tables ───

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().$type<UserRole>(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const courses = sqliteTable("courses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  notes: text("notes"),
  // Markdown, non-empty. Enforced on write.
  salesCopy: text("sales_copy").notNull(),
  instructorId: integer("instructor_id")
    .notNull()
    .references(() => users.id),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  status: text("status").notNull().$type<CourseStatus>(),
  coverImageUrl: text("cover_image_url"),
  price: integer("price").notNull().default(0),
  pppEnabled: integer("ppp_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const modules = sqliteTable("modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  title: text("title").notNull(),
  position: integer("position").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const lessons = sqliteTable("lessons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modules.id),
  title: text("title").notNull(),
  content: text("content"),
  videoUrl: text("video_url"),
  githubRepoUrl: text("github_repo_url"),
  position: integer("position").notNull(),
  durationMinutes: integer("duration_minutes"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const enrollments = sqliteTable(
  "enrollments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    enrolledAt: text("enrolled_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    completedAt: text("completed_at"),
  },
  (table) => [index("enrollments_course_idx").on(table.courseId)]
);

export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    status: text("status").notNull().$type<LessonProgressStatus>(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("lesson_progress_user_lesson_idx").on(table.userId, table.lessonId),
  ]
);

export const quizzes = sqliteTable("quizzes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  title: text("title").notNull(),
  passingScore: real("passing_score").notNull(),
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  questionText: text("question_text").notNull(),
  questionType: text("question_type").notNull().$type<QuestionType>(),
  position: integer("position").notNull(),
});

export const quizOptions = sqliteTable("quiz_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  optionText: text("option_text").notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
});

export const quizAttempts = sqliteTable("quiz_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  quizId: integer("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  score: real("score").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  attemptedAt: text("attempted_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const quizAnswers = sqliteTable("quiz_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: integer("attempt_id")
    .notNull()
    .references(() => quizAttempts.id),
  questionId: integer("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  selectedOptionId: integer("selected_option_id")
    .notNull()
    .references(() => quizOptions.id),
});

export const purchases = sqliteTable(
  "purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    amountPaid: integer("amount_paid").notNull(),
    country: text("country"),
    status: text("status")
      .notNull()
      .$type<PurchaseStatus>()
      .default(PurchaseStatus.Active),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("purchases_course_idx").on(table.courseId)]
);

// The money captured for a purchase. One per purchase. The provider reference
// stays null until a payment provider is integrated.
export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchases.id),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default(DEFAULT_CURRENCY),
    providerReference: text("provider_reference"),
    capturedAt: text("captured_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("payments_purchase_unique").on(table.purchaseId)]
);

// A buyer asking for their money back. A purchase gets at most one: a declined
// request is final, and an approved one is never repeated.
export const refundRequests = sqliteTable(
  "refund_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    purchaseId: integer("purchase_id")
      .notNull()
      .references(() => purchases.id),
    requestedByUserId: integer("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status")
      .notNull()
      .$type<RefundRequestStatus>()
      .default(RefundRequestStatus.Pending),
    // The buyer's own words.
    reason: text("reason").notNull(),
    // Eligibility is judged once, when the request is made, and this amount
    // stands through resolution.
    refundAmount: integer("refund_amount").notNull(),
    currency: text("currency").notNull().default(DEFAULT_CURRENCY),
    requestedAt: text("requested_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("refund_requests_purchase_unique").on(table.purchaseId),
  ]
);

// Money going back against a payment. A failed refund is retried by issuing a
// new one for the same request; a payment has at most one that succeeded.
export const refunds = sqliteTable(
  "refunds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    refundRequestId: integer("refund_request_id")
      .notNull()
      .references(() => refundRequests.id),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default(DEFAULT_CURRENCY),
    status: text("status")
      .notNull()
      .$type<RefundStatus>()
      .default(RefundStatus.Issued),
    providerReference: text("provider_reference"),
    failureReason: text("failure_reason"),
    issuedAt: text("issued_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("refunds_request_idx").on(table.refundRequestId),
    uniqueIndex("refunds_one_success_per_payment")
      .on(table.paymentId)
      .where(sql`${table.status} = 'succeeded'`),
  ]
);

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  role: text("role").notNull().$type<TeamMemberRole>(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const coupons = sqliteTable("coupons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id),
  courseId: integer("course_id")
    .notNull()
    .references(() => courses.id),
  code: text("code").notNull().unique(),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  redeemedByUserId: integer("redeemed_by_user_id").references(() => users.id),
  redeemedAt: text("redeemed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const courseRatings = sqliteTable(
  "course_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id),
    // Whole stars, 1–5. Enforced on write.
    rating: integer("rating").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("course_ratings_user_course_unique").on(
      table.userId,
      table.courseId
    ),
  ]
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lessonId: integer("lesson_id")
      .notNull()
      .references(() => lessons.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    // Null for a top-level comment. Replies are one level deep only — a parent
    // must itself be top-level. Enforced on write.
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => comments.id
    ),
    // Markdown, 1–5000 chars. Enforced on write, rendered by
    // renderComment (untrusted input — never renderMarkdown).
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // Null until the author edits. An explicit column rather than comparing
    // updatedAt to createdAt, which collide when both writes land in the same
    // millisecond.
    editedAt: text("edited_at"),
    // Soft delete. Deleted top-level comments keep their replies readable.
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("comments_lesson_idx").on(table.lessonId),
    index("comments_parent_idx").on(table.parentId),
  ]
);

export const videoWatchEvents = sqliteTable("video_watch_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  lessonId: integer("lesson_id")
    .notNull()
    .references(() => lessons.id),
  eventType: text("event_type").notNull(),
  positionSeconds: real("position_seconds").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
