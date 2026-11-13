import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/team";
import { getCurrentUserId } from "~/lib/session";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { getTeamLicencesForBuyer } from "~/lib/refunds.server";
import { REFUND_INELIGIBLE_MESSAGES } from "~/lib/refunds";
import { formatPrice } from "~/lib/utils";
import { Users, BookOpen, Copy, Check, AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { db } from "~/db";
import {
  teams,
  teamMembers,
  coupons,
  courses,
  users,
  purchases,
  PurchaseStatus,
  TeamMemberRole,
} from "~/db/schema";
import { eq, and } from "drizzle-orm";

function getTeamForAdmin(userId: number) {
  const membership = db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  if (!membership) return undefined;

  return db.select().from(teams).where(eq(teams.id, membership.teamId)).get();
}

// Seats from a refunded licence no longer work, so they are left out.
function getCouponsForTeam(teamId: number) {
  return db
    .select({ coupon: coupons })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .where(
      and(
        eq(coupons.teamId, teamId),
        eq(purchases.status, PurchaseStatus.Active)
      )
    )
    .all()
    .map((row) => row.coupon);
}

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

interface CourseStats {
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  totalSeats: number;
  claimedSeats: number;
}

interface CouponRow {
  id: number;
  code: string;
  courseId: number;
  courseTitle: string;
  redeemedByEmail: string | null;
  createdAt: string;
}

export function meta() {
  return [
    { title: "Team — Cadence" },
    { name: "description", content: "Manage your team's course seats" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const team = getTeamForAdmin(currentUserId);

  if (!team) {
    throw data("You don't have a team. Purchase team seats to create one.", {
      status: 403,
    });
  }

  const allCoupons = getCouponsForTeam(team.id);

  // Build per-course stats
  const courseMap = new Map<
    number,
    {
      courseId: number;
      courseTitle: string;
      courseSlug: string;
      total: number;
      claimed: number;
    }
  >();

  for (const coupon of allCoupons) {
    if (!courseMap.has(coupon.courseId)) {
      const course = getCourseById(coupon.courseId);
      courseMap.set(coupon.courseId, {
        courseId: coupon.courseId,
        courseTitle: course?.title ?? "Unknown Course",
        courseSlug: course?.slug ?? "",
        total: 0,
        claimed: 0,
      });
    }
    const entry = courseMap.get(coupon.courseId)!;
    entry.total++;
    if (coupon.redeemedByUserId !== null) {
      entry.claimed++;
    }
  }

  const courseStats: CourseStats[] = Array.from(courseMap.values()).map(
    (e) => ({
      courseId: e.courseId,
      courseTitle: e.courseTitle,
      courseSlug: e.courseSlug,
      totalSeats: e.total,
      claimedSeats: e.claimed,
    })
  );

  // Build coupon rows with redeemer email
  const couponRows: CouponRow[] = allCoupons.map((coupon) => {
    let redeemedByEmail: string | null = null;
    if (coupon.redeemedByUserId !== null) {
      const user = getUserById(coupon.redeemedByUserId);
      redeemedByEmail = user?.email ?? null;
    }
    const course = getCourseById(coupon.courseId);
    return {
      id: coupon.id,
      code: coupon.code,
      courseId: coupon.courseId,
      courseTitle: course?.title ?? "Unknown Course",
      redeemedByEmail,
      createdAt: coupon.createdAt,
    };
  });

  const licences = getTeamLicencesForBuyer(currentUserId);

  return { courseStats, couponRows, licences };
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/redeem/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
      title="Copy redemption link"
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          Copy link
        </>
      )}
    </button>
  );
}

export default function Team({ loaderData }: Route.ComponentProps) {
  const { courseStats, couponRows, licences } = loaderData;
  const [courseFilter, setCourseFilter] = useState<number | "all">("all");

  const filteredCoupons =
    courseFilter === "all"
      ? couponRows
      : couponRows.filter((c) => c.courseId === courseFilter);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Team</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Team Management</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your team&apos;s course seats and coupon codes
        </p>
      </div>

      {/* Per-course stats */}
      {courseStats.length > 0 && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courseStats.map((stat) => (
            <Card key={stat.courseId}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <h3 className="font-semibold truncate">{stat.courseTitle}</h3>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">
                      {stat.claimedSeats}
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {stat.totalSeats}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      seats claimed
                    </p>
                  </div>
                  <Link to={`/courses/${stat.courseSlug}/purchase?mode=team`}>
                    <Button variant="outline" size="sm">
                      Buy more seats
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {licences.length > 0 && <Licences licences={licences} />}

      {/* Coupon list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Coupons</h2>
          {courseStats.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) =>
                setCourseFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value)
                )
              }
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              <option value="all">All courses</option>
              {courseStats.map((stat) => (
                <option key={stat.courseId} value={stat.courseId}>
                  {stat.courseTitle}
                </option>
              ))}
            </select>
          )}
        </div>

        {filteredCoupons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coupons yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Course</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoupons.map((coupon) => (
                  <tr key={coupon.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-2 py-0.5 text-xs">
                        {coupon.code}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {coupon.courseTitle}
                    </td>
                    <td className="px-4 py-3">
                      {coupon.redeemedByEmail ? (
                        <span className="text-muted-foreground">
                          Claimed by {coupon.redeemedByEmail}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Unclaimed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!coupon.redeemedByEmail && (
                        <CopyButton code={coupon.code} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type LicenceRow = Route.ComponentProps["loaderData"]["licences"][number];

function Licences({ licences }: { licences: LicenceRow[] }) {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-lg font-semibold">Licences</h2>
      <div className="space-y-3">
        {licences.map((licence) => (
          <Card key={licence.purchaseId}>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{licence.courseTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {licence.totalSeats} seats ({licence.claimedSeats} claimed)
                    · {formatPrice(licence.amountPaid)} · bought{" "}
                    {new Date(licence.purchasedAt).toLocaleDateString()}
                  </p>
                </div>
                {licence.status === PurchaseStatus.Refunded && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">
                    Refunded
                  </span>
                )}
              </div>
              {licence.eligibility?.eligible ? (
                <LicenceRefundRequest
                  purchaseId={licence.purchaseId}
                  amount={licence.eligibility.refundAmount}
                />
              ) : (
                licence.status === PurchaseStatus.Active &&
                licence.eligibility && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {REFUND_INELIGIBLE_MESSAGES[licence.eligibility.reason]}
                  </p>
                )
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LicenceRefundRequest({
  purchaseId,
  amount,
}: {
  purchaseId: number;
  amount: number;
}) {
  const fetcher = useFetcher<{ errors?: Record<string, string> }>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const firstError = Object.values(fetcher.data?.errors ?? {})[0];
    if (fetcher.state === "idle" && firstError) {
      toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  if (!isFormOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mt-2 text-muted-foreground"
        onClick={() => setIsFormOpen(true)}
      >
        Request a refund
      </Button>
    );
  }

  return (
    <fetcher.Form
      method="post"
      action={`/purchases/${purchaseId}/refund-request`}
      className="mt-3 space-y-2"
    >
      <p className="text-xs text-muted-foreground">
        Once your refund request is approved, we will send {formatPrice(amount)}{" "}
        back to the card you paid with, and this licence&apos;s seat links will
        stop working.
      </p>
      <Textarea
        name="reason"
        rows={3}
        required
        placeholder="What went wrong?"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? "Sending..." : "Request a refund"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsFormOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </fetcher.Form>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "No team found";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have a team yet.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
