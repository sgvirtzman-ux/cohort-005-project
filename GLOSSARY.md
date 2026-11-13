# Glossary

The agreed language for Cadence. Use these terms in code, UI copy, emails, issues and specs. When a term here disagrees with the code, the glossary wins and the code is the bug.

Some terms (**Payment**, **Refund**, **Chargeback**) describe a model Cadence has not built yet. They are defined now so the language is settled before a payments provider arrives.

## Purchases

### Purchase

The order: who bought which course. Not the money; that is the **payment**.

**Active → Refunded**

| State    | Meaning                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| Active   | The purchase stands.                                                                       |
| Refunded | The money has gone back, through a **refund** that succeeded or a **chargeback** that was lost. |

When a purchase becomes Refunded, its **enrollments** are revoked. An approved refund request alone does not make a purchase Refunded; the refund has to succeed.

### Team licence

One purchase covering several seats of a course, bought by a team admin. Each seat is handed out as a code.

### Claimed team seat

A seat from a team licence that a learner has redeemed. Redeeming creates an **enrollment**, not a purchase.

### Enrollment

A learner's access to a course. It comes from an individual purchase or a claimed team seat.

### Amount paid

What was actually paid at checkout, after any **PPP price**. Not the course's list price, which can change after the purchase. For a team licence, it is the total for all seats.

### PPP price

The purchasing-power-parity price: a regional discount on the list price, based on the buyer's country.

## Money

All amounts are whole minor units (cents) with a currency code. Everything is USD today.

### Payment

The money captured for a purchase: amount, currency, and the provider's reference (none until a provider is integrated). One payment per purchase.

### Refund

Money going back to the buyer against a payment. It is created when a refund request is approved, and is linked to both the payment and that request.

**Issued → Succeeded | Failed**

- A failed refund is retried by creating a new refund for the same approved request. Failed attempts stay on record.
- A payment has at most one succeeded refund.

Not the same as a **refund request**: the request is the decision, the refund is the money moving.

### Chargeback

A card dispute opened by the buyer's bank, not through Cadence.

**Opened → Won | Lost**

- Opening a chargeback declines any pending refund request on that payment, so the money cannot go back twice.
- A chargeback against a payment that has already been refunded is contested with proof of the refund.
- A lost chargeback makes the purchase **Refunded**, the same as a succeeded refund.

Never use this word for a refund request.

### Revenue

Payments, minus succeeded refunds, minus lost chargebacks. The platform fee and the instructor's net are worked out on that figure, so a refund reverses both. If the instructor has already been paid their share, it comes off their next payout.

## Refund requests

### Refund request

A buyer asking for their money back on a **purchase**. This is the one name for it, everywhere.

- The buyer-facing action is **Request a refund**.
- A purchase has at most one refund request that is pending or approved. A declined request is final for that purchase.

### Refund request states

**Pending → Approved | Declined**

| State    | Meaning                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- |
| Pending  | Submitted and waiting for **resolution**.                                                     |
| Approved | An admin accepted it, and a **refund** for the **refund amount** is issued.                   |
| Declined | An admin turned it down, or a chargeback was opened on the payment. Nothing is refunded. Final. |

"Requested" names the event, not a state: "requested on 3 Nov", never "status: requested".

### Resolution

An admin approving or declining a **pending** refund request. Only admins resolve refund requests; instructors do not.

### Refund amount

What the buyer gets back when a refund request is approved. It is always the **amount paid**: for a team licence, the full licence total. There are no partial refunds.

### Refund eligibility

Whether a refund request can be raised on a purchase. It is judged once, when the request is made, and that result stands through resolution: slow review or watching while pending cannot take it away.

An individual purchase is eligible when all of these hold:

1. The amount paid is more than zero.
2. Today is within the **refund window**.
3. The learner has watched under 2 hours of the course.
4. The learner has completed under 50% of the course's lessons.

A team licence is eligible when all of these hold:

1. The amount paid is more than zero.
2. Today is within the **refund window**.
3. None of its seats are claimed.

The course page and the server enforce the same rules.

### Refund window

14 calendar days from the day of purchase, counted in whole days. The 14th day counts in full, so a purchase at 23:00 still gets all of day 14.

## Avoid

| Don't say                        | Say instead    | Why                                                               |
| -------------------------------- | -------------- | ----------------------------------------------------------------- |
| Cancellation                     | Refund request | One name for one thing.                                           |
| Reversal                         | Refund request | One name for one thing.                                           |
| Chargeback (for a refund request) | Refund request | A chargeback is a bank dispute, which a refund request is not.    |
| Requested (as a state)           | Pending        | "Requested" is fine for the event.                                |
| Refunded (for a request)         | Approved       | "Refunded" is a purchase state, reached only once the money is back. |
