# Phase 1 scope and acceptance

The full development specification was read. The user's later instruction narrows this delivery to the base model and main functional workflow, with enhancements delivered incrementally.

## Implemented

- npm TypeScript workspace: React web, Expo React Native staff mobile, NestJS REST API, Prisma/MySQL, outbox worker, shared calculation and API client.
- Organization, stores, users/roles, customers, catalog, appointments, invoices/items, payments, stock balance/ledger, sequences, idempotency commands, status history, audit, outbox models.
- Staff password login, bcrypt hashing, short-lived signed tokens, account lockout, per-process IP login throttling, password change and session revocation.
- Organization/store-scoped access, role checks, therapist ownership on appointment actions, restricted payroll/clinical data absent from Phase 1.
- Customer creation/search/update API; service/product creation; staff creation by admin; add stores.
- Staff booking with server-side store-hours and therapist overlap validation, timezone conversion, and status workflow: confirmed → checked in → in progress → completed; cancellation/no-show where valid.
- POS links a completed appointment or supports a walk-in invoice. Invoice calculation from trusted catalog prices; fixed-point rounding, role discount limits; atomic numbering, stock consumption, audit/outbox.
- Cash and UPI, split/partial payments; UPI reference deduplication, pending balance reservation, manager verification/rejection, one receipt per successful payment.
- Opening/basic stock receipts and immutable sale/receipt ledger; no negative stock and atomic balance projection.
- Dashboard reconciled from source invoices/verified payments; printable invoice and receipts on web.
- Staff mobile: appointments, booking, billing, Cash/UPI collection, UPI verification, stock receipt, notifications, secure token persistence.
- Outbox delivery worker with claim leases, retries, dead-letter state, event IDs for downstream deduplication. No provider means AWAITING_PROVIDER, not false delivery success.
- OpenAPI route documentation and manual request contract in API.md.

## Deliberately deferred

These are not represented as working features:
- Customer OTP and customer mobile journeys.
- Resource/room availability, therapist skills/rosters/leave, holidays, booking holds, deposits, wait list and public availability.
- Treatment consultations/clinical notes, consent files, packages, memberships and redemptions.
- Refunds/credit notes/reversals, advances, tax registration/GST-compliant statutory invoice layout, reconciliation imports.
- Batch/expiry/reservation stock, purchase orders/goods receipt matching, supplier payments, stock adjustment approvals/transfers.
- Offers/coupons/campaign delivery, attendance/geofencing, commissions/payroll/statutory integrations.
- Upload/object storage, provider templates/quiet hours/consent routing, secured exports.
- Refresh token rotation, password reset UI, advanced permission editor, persistent distributed rate limits, protected external audit archive.
- Full telemetry/alerts, CI security scanning/deployments, native binary signing, store publication, offline mobile writes.

## Current boundaries

Phase 1 is a local development application, not a production release. The staff mobile app requires an API reachable from the device. iOS native compilation requires macOS. Access tokens expire after 30 minutes and require a new login. The web intentionally does not persist tokens across refreshes.

Catalog lists cap at 500; appointment queries use a bounded date range and cap at 500. Growing customer, invoice, payment, audit and stock ledger API lists support UUID cursor parameters; the first web view displays up to 100. A later pagination UI must expose all pages.

Stock quantities are whole units without batches in Phase 1. Do not use this release for fractional or expiry-controlled stock. Opening/receipt records require a reason. Financial documents cannot be edited after posting; reversals/refunds will be added as explicit transactions.

Store-level transactions serialize mutations to prevent overselling and duplicate allocation; a separate therapist lock guards cross-store booking overlap. This favors correctness at Phase 1 scale. Tune lock granularity only after profiling.

Worker webhooks are event integrations, not an SMS implementation. The provider must honor event Idempotency-Key and apply consent/channel policy before sending customer messages. Configure nothing until that integration is ready.

## Next increment

1. Review the core workflow with studio staff and confirm GST/store rules.
2. Add customer/mobile OTP and the availability/resource model.
3. Add invoice reversals/refunds and batch-based procurement.
4. Add packages and treatment sessions.
5. Add workforce, payroll, campaigns and advanced reporting.

## Dependency review

The backend uses NestJS 12 and mobile uses Expo SDK 57 / React Native 0.86. Security fixes are pinned through the lockfile and targeted Prisma tooling overrides. The final dependency audit still reports a moderate UUID advisory propagated through Expo's Xcode build tooling. No high or critical finding remained at the last review. This is a production-release follow-up; native signing/build tooling must be reviewed before distribution.
