# Vayyom Spa – Development Specification

**Version:** 1.0  
**Companion document:** VayyomSpa_Product_Requirements.prd

## 1. Purpose

This document translates the Vayyom Spa PRD into an implementation baseline for the web application, mobile application, APIs, database, integrations, testing, deployment, and delivery backlog.

## 2. Recommended Solution Architecture

Start with a **modular monolith** for the transactional core, supported by asynchronous workers. Preserve strict module boundaries so high-load modules can later be extracted as services. This reduces distributed-transaction complexity during the first release while keeping the system scalable.

### Client applications

- **Web:** React + TypeScript, responsive admin portal
- **Mobile:** React Native + TypeScript for Android and iOS
- Shared design tokens, validation rules, API types, and permission definitions where practical
- Server state through a query/cache library; limited global client state for identity, active store, and UI preferences

### Backend

- Node.js 22+ with TypeScript
- NestJS REST API using a simple modular-monolith structure
- Prisma ORM for MySQL transactions, migrations, and type-safe queries
- Node.js background worker for notifications, exports, reconciliation, reminders, and scheduled rules
- REST APIs under versioned routes with an OpenAPI contract

### Data and infrastructure

- MySQL 8 as the transactional database
- MySQL-backed booking holds and rate-limit records are sufficient for Phase 1; Redis can be added later only if measured load requires it
- Object storage for documents, purchase invoices, consent, photographs, exports, and payslips
- Message broker or managed queue for reliable background events
- Managed secret store, centralized logs, metrics, traces, and alerting
- CDN for public/static assets

### Architecture boundaries

Modules must communicate through application contracts and domain events. They must not directly update another module's tables. Payment, stock, invoice, package, and payroll posting must occur in controlled application services with database transactions and idempotency.

## 3. Backend Modules

| Module | Responsibility |
|---|---|
| Identity & Access | Customer mobile-number OTP, employee username/password, tokens, roles, permissions, store scope |
| Organization | Stores, resources, hours, holidays, configuration |
| Customer | Profiles, consent, history, files, segmentation |
| Employee | Profiles, skills, store assignments |
| Catalog | Services, products, treatments, packages, price books, taxes |
| Scheduling | Slots, appointments, resources, check-in, wait list |
| Treatment | Consultations, plans, sessions, notes, consent |
| Sales | Cart calculation, invoices, credits, refunds, receipts |
| Payments | Cash/UPI records, UPI verification, allocations, receipts, reconciliation |
| Inventory | Batches, balances, reservations, ledger, counts, adjustments |
| Procurement | Suppliers, POs, goods receipt, purchase invoices, returns |
| Transfer | Store transfer request, dispatch, transit, receipt |
| Marketing | Offers, coupons, campaigns, consent-based audiences |
| Notifications | Templates, queue, providers, delivery history |
| Workforce | Shift, roster, attendance, leave |
| Payroll | Salary, commission, payroll runs, payslips |
| Reporting | Read models, dashboards, exports |
| Governance | Approvals, audit, numbering, attachments, idempotency |

## 4. Web Application Navigation

### Global layout

- Organization/store selector
- Global customer, invoice, appointment, and product search
- Notification and approval inbox
- Role-aware sidebar
- User profile and active shift

### Pages

1. Dashboard
2. Calendar / Appointments
3. Customers
4. Consultations / Treatment Plans
5. Packages / Memberships
6. Billing / POS
7. Sales Invoices / Payments / Refunds
8. Products / Stock
9. Purchase Orders
10. Goods Receipts
11. Purchase Invoices / Supplier Payments
12. Store Transfers
13. Suppliers
14. Offers / Coupons / Campaigns
15. Employees / Rosters
16. Attendance / Leave
17. Salary / Commission / Payroll
18. Reports
19. Approvals
20. Administration / Stores / Roles / Settings / Audit

### Essential admin pages

- Store list, add/edit store, hours, resources, tax and numbering
- User/role/permission matrix
- Product/service/package masters
- Opening stock import and stock policies
- Supplier and purchase configuration
- Offer/notification templates
- Attendance and payroll policy
- Payment/tax/provider settings
- Audit log and import/export center

## 5. Mobile Application Navigation

### Customer tabs

- Home
- Appointments
- Packages
- Bills & Payments
- Profile

### Employee tabs

- Today
- Appointments
- Billing
- Stock
- More: attendance, leave, payslips, notifications

Role and feature flags determine which tabs and actions appear. All authorization remains server enforced.

## 6. Database Design Guidelines

### Required conventions

- Use UUID/ULID or equivalent non-sequential public identifiers; database keys may remain optimized internal values.
- Every tenant-owned table includes organization_id.
- Operational tables include store_id when store-specific.
- Store UTC timestamps plus originating timezone where legally or operationally relevant.
- Use decimal/fixed precision for money and quantity; never floating point.
- Money fields include currency.
- Rows include created_at, created_by, updated_at, updated_by, and version/concurrency token.
- Use status history tables for important workflows.
- Avoid hard deletion of transactions. Use inactive flags for masters and reversal documents for posted transactions.
- Encrypt especially sensitive fields and store files outside the database with secured references.

### Critical transaction tables

#### invoice

- id, organization_id, store_id, customer_id, appointment_id
- invoice_number, invoice_date, status, currency
- subtotal, discount_total, taxable_total, tax_total, round_off, grand_total
- paid_total, refunded_total, due_total
- sales_employee_id, counter_id, notes, version

#### invoice_item

- invoice_id, item_type, product/service/package reference
- description snapshot, quantity, unit_price
- discount, tax code/rate/amount, line_total
- source appointment/package reference

#### payment

- id, invoice/customer reference, method, amount, currency
- payment method (Cash/UPI), UPI transaction/reference number, optional proof
- status, idempotency_key, paid_at, received_by

#### stock_ledger

- id, store_id, product_id, batch_id
- transaction_type, reference_type, reference_id
- quantity_in, quantity_out, unit_cost, running reference
- occurred_at, posted_by, reversal_of_id, reason

#### stock_balance

- store_id, product_id, batch_id
- on_hand, reserved, available, damaged, in_transit
- version

#### customer_package

- customer_id, package_definition_id, originating_store_id
- purchased_sessions/value, consumed_sessions/value
- start_at, expires_at, status, invoice_id, version

#### appointment

- customer_id, store_id, provider_id, resource_id
- start_at, end_at, status, source
- deposit_required, deposit_paid, notes, version

#### purchase_invoice

- supplier_id, store_id, supplier_invoice_number/date
- purchase_order_id, goods_receipt_id, status
- subtotal, tax, charges, total, paid, due
- attachment_id, duplicate_check_hash, version

### Important indexes

- Appointment by store/start/end/status and provider/start/end/status
- Customer by normalized mobile, email, name
- Invoice by store/date/status, customer/date, invoice number
- Payment by UPI reference, store/date, employee/date, and idempotency key
- Stock balance unique on store/product/batch
- Stock ledger by store/product/occurred date and reference
- Purchase invoice unique/guarded by organization/supplier/invoice number
- Package by customer/status/expiry
- Attendance unique by employee/date/shift as policy permits
- Audit by organization/entity/date and user/date

## 7. API Baseline

Use routes such as:

```text
/api/v1/auth/*
/api/v1/stores/*
/api/v1/customers/*
/api/v1/employees/*
/api/v1/services/*
/api/v1/products/*
/api/v1/appointments/*
/api/v1/treatment-plans/*
/api/v1/packages/*
/api/v1/invoices/*
/api/v1/payments/*
/api/v1/payments/{id}/verify
/api/v1/stock/*
/api/v1/suppliers/*
/api/v1/purchase-orders/*
/api/v1/goods-receipts/*
/api/v1/purchase-invoices/*
/api/v1/stock-transfers/*
/api/v1/offers/*
/api/v1/notifications/*
/api/v1/attendance/*
/api/v1/leave/*
/api/v1/payroll/*
/api/v1/reports/*
/api/v1/approvals/*
/api/v1/admin/*
```

### API standards

- JSON requests/responses with OpenAPI documentation
- Problem Details error responses with trace ID and safe field validation
- Cursor pagination for growing transaction lists
- Idempotency-Key header for payment, invoice-posting, goods receipt, stock transfer receipt, and other retry-sensitive commands
- ETag/version field for optimistic concurrency
- Correlation ID propagated into jobs and integrations
- Store scope derived from authenticated authorization, not blindly trusted from request data
- Separate command endpoints for transitions, such as `/appointments/{id}/cancel`, instead of arbitrary status editing

## 8. Transaction and Consistency Rules

### Invoice posting

1. Validate customer, store, item prices, taxes, discounts, and permissions.
2. Recalculate totals on server.
3. Allocate invoice number inside a transaction.
4. Post invoice and applicable stock/package movements.
5. Write outbox events.
6. Commit once.
7. Process notifications asynchronously.

### Cash/UPI payment recording

1. Load the invoice and calculate the outstanding balance on the server.
2. Validate that the payment method is Cash or UPI.
3. For UPI, require a transaction/reference number and accept optional proof.
4. Check request idempotency and reject duplicate store/reference combinations.
5. Record Cash as Paid or UPI as Pending Verification.
6. Authorized staff verifies or rejects the UPI entry.
7. Allocate the verified amount and create one receipt.
8. Publish reconciliation and notification events.

### Stock

- The ledger is the source of truth; balance is a transactionally maintained projection.
- All stock commands lock/version-check affected balance rows.
- A reversal creates an opposite ledger entry linked to the original.
- Transfers use paired dispatch and receipt entries.
- Stock count differences require reason and approval according to threshold.

## 9. Security Design

**Customer authentication**

- Customer enters a mobile number and receives an OTP through the configured SMS provider.
- Store only a hashed OTP with expiry, resend delay, attempt count, and rate-limit data.
- A valid OTP creates the customer session; customers do not use passwords.

**Employee and administrator authentication**

- Employees and administrators use a username and password.
- Hash passwords with Argon2id or bcrypt using an appropriate work factor.
- Apply failed-login lockout, administrator-assisted reset, password change, and session revocation.
- Keep access-token lifetime short and rotate refresh tokens.
- Policy-based authorization: permission + organization + store + ownership + data sensitivity.
- Field-level suppression for salary, clinical notes, mobile numbers, and payment references.
- Signed, expiring file access URLs.
- Upload allowlist, size limits, malware scan, metadata stripping when appropriate.
- CSRF protection where cookie authentication is used.
- Content Security Policy and secure headers for web.
- Certificate pinning only if operationally sustainable; otherwise strong TLS and mobile platform controls.
- Rooted/jailbroken-device risk policy for employee payment features.
- Audit events sent to append-only protected storage.
- Dependency, SAST, DAST, secret, container, and infrastructure scanning in CI/CD.

## 10. Notifications

### Event examples

- AppointmentCreated, AppointmentConfirmed, AppointmentReminderDue
- AppointmentCancelled, CustomerCheckedIn, TreatmentCompleted
- InvoicePosted, PaymentCaptured, PaymentFailed, RefundCompleted
- PackageExpiring, PackageBalanceLow
- StockBelowMinimum, BatchNearExpiry
- PurchaseApprovalRequired, TransferReceived
- LeaveApprovalRequired, PayrollPublished
- OfferCampaignScheduled

### Delivery rules

- Event creates notification request through an outbox.
- Worker renders a versioned template.
- Consent, quiet hours, channel preferences, and provider limits are checked.
- Provider response and retries are recorded.
- Permanent failure goes to a dead-letter workflow and operational alert.

## 11. Dashboards and Reporting

- Transactional APIs serve drill-down pages.
- Background jobs build summary tables/materialized views by store/day/item/employee.
- MySQL summary tables can serve Phase 1 dashboards; Redis caching can be introduced later only after measuring a need.
- Dashboard cards display last-updated time.
- Export requests return a job ID and notify the user when the secured file is ready.
- Financial report calculations must be reconciled against source invoices and payments before release.

## 12. Testing Strategy

### Automated

- Unit tests for price, tax, discount, package, commission, attendance, and stock rules
- Integration tests with a real test database for transactions and authorization
- Contract tests for OTP SMS and notification providers
- End-to-end tests for priority workflows on web and mobile
- Idempotency, concurrency, reversal, and retry tests
- Migration and backward-compatibility tests
- Performance tests for calendar, POS, stock lookup, dashboards, OTP requests, and payment submissions
- Security tests for broken object authorization, store isolation, upload attacks, injection, and privilege escalation

### Mandatory test cases

- Two users attempt to take the last slot.
- Two counters attempt to sell the last stock unit.
- Mobile sends the same UPI submission more than once.
- Invoice posting fails while a UPI entry is awaiting verification.
- Transfer receipt differs from dispatch.
- Package expires across a timezone boundary.
- Discount exceeds the user's threshold.
- Payroll is changed after approval.
- Mobile device loses network during payment response.
- User changes active store and retries an earlier request.

## 13. CI/CD and Environments

### Environments

- Local
- Development
- QA/Test
- UAT
- Production

Production data must not be copied unmasked into non-production.

### Pipeline

1. Restore/install dependencies.
2. Lint and format validation.
3. Unit and integration tests.
4. Build web, mobile, APIs, workers, and migrations.
5. Generate/check API contract.
6. Security and dependency scans.
7. Container image build, signing, and registry push.
8. Deploy to test and run smoke/end-to-end tests.
9. Approval for production.
10. Rolling or blue/green deployment.
11. Post-deployment smoke checks and monitoring.

Database migrations must be backward compatible for rolling deployment and must have a tested rollback/forward-fix plan.

## 14. Observability

### Core telemetry

- HTTP request count, latency, status, and route
- Database query duration and pool utilization
- Cache hit/miss and queue lag
- Appointment conflict/hold failures
- Invoice posting, payment, refund, and reconciliation failures
- Stock negative attempts, adjustment value, and transfer discrepancy
- Notification success/failure
- Attendance and payroll job failures
- Mobile crash-free sessions

### Required correlation

Use one correlation/trace ID across client request, API, database activity, background event, provider call, and notification. Do not log OTPs, tokens, clinical notes, full payment data, or sensitive salary fields.

## 15. Delivery Epics

### EPIC-01 Platform foundation

- Repository and solution setup
- Environments, CI/CD, identity, roles, permissions
- Organization/store configuration
- Audit, file storage, numbering, shared components

### EPIC-02 Customer and catalog

- Customer profiles and consent
- Services, treatments, products, packages
- Price books, taxes, search, import

### EPIC-03 Appointment and treatment

- Availability engine and calendar
- Customer booking and deposit
- Check-in/status workflow
- Treatment plan, consent, session completion

### EPIC-04 Billing and payments

- POS calculation and invoice posting
- Cash, UPI, split, partial, and advance payment
- UPI reference submission and employee verification
- Refund, credit note, reconciliation

### EPIC-05 Inventory and procurement

- Stock ledger/balance/batches
- Supplier, PO, receipt, purchase invoice
- Count, adjustment, return, alerts
- Inter-store transfer

### EPIC-06 Packages and offers

- Package purchase/consumption/expiry
- Membership and coupon engine
- Campaign and notification workflow

### EPIC-07 Employee and payroll

- Employee, roster, attendance, leave
- Commission and payroll
- Approval and payslip

### EPIC-08 Dashboards and reports

- Operational dashboards
- Finance, appointment, inventory, customer, and workforce reports
- Export center

### EPIC-09 Mobile

- Customer authentication and booking
- Customer bills/packages/payments
- Employee appointments, billing, stock
- Attendance, leave, payslip, notifications

## 16. Sample User Stories and Acceptance Criteria

### US-APPT-01 – Book an available appointment

**As a** customer, **I want** to select a store, service, and available time **so that** I can confirm my visit.

**Acceptance criteria**

- Only slots satisfying service, provider, resource, store-hours, leave, and buffer rules are offered.
- A temporary hold prevents another customer from taking the slot during checkout.
- Required deposit is calculated on the server.
- Successful UPI verification or permitted Cash-at-store selection confirms exactly one appointment.
- Failure/expiry releases the hold.
- Customer receives confirmation and the appointment appears in web and mobile.

### US-BILL-01 – Create a Cash/UPI invoice

**As a** receptionist, **I want** to bill services and products using Cash, UPI, or both **so that** the customer can settle the bill.

**Acceptance criteria**

- Server recalculates item price, discount, tax, and grand total.
- User cannot exceed permitted discount.
- Cash plus verified UPI allocations must equal the paid amount.
- Product stock and package use are posted exactly once.
- Invoice and both receipts are printable and visible in customer history.

### US-STOCK-01 – Receive purchased stock

**As an** inventory manager, **I want** to record received batches **so that** store stock and expiry tracking are correct.

**Acceptance criteria**

- Receipt can be partial against an approved PO.
- Batch and expiry are mandatory for configured items.
- Posting creates immutable stock-ledger entries and updates balance atomically.
- Duplicate request retry does not receive stock twice.
- Purchase invoice may be matched without changing stock a second time.

### US-PKG-01 – Consume a treatment session

**As a** therapist, **I want** to consume one eligible package session after treatment **so that** the balance stays accurate.

**Acceptance criteria**

- Package must be active, unexpired, eligible at the store, and have remaining sessions.
- Session is linked to appointment and employee.
- Repeated completion request cannot consume twice.
- Reversal requires permission and reason.
- Updated balance is immediately visible to the customer.

### US-ATT-01 – Mobile attendance

**As an** employee, **I want** to check in for my assigned shift **so that** attendance is captured.

**Acceptance criteria**

- User has an active assignment and shift.
- If geofence is enabled, location must satisfy policy or request regularization.
- Duplicate check-in is rejected safely.
- Employee sees status and manager sees it in the dashboard.
- Manual corrections retain original values and approval history.

## 17. Initial Sprint Plan

### Sprint 0

- Confirm open PRD decisions
- Finalize UX flows and design system
- Establish repositories, CI/CD, environments, observability, and security baseline
- Define API/error/audit conventions and database migration process

### Sprint 1

- Authentication, organization, store, user, role, permission
- Service/product/customer master foundations
- App shell for web and mobile

### Sprint 2

- Calendar, availability, appointment creation, customer booking
- Basic notifications and store resources

### Sprint 3

- POS cart, tax/discount calculation, invoice and cash/manual payment
- Customer invoice history

### Sprint 4

- UPI-reference submission, verification, deposit, and refund foundation
- Product stock ledger and sale consumption

### Sprint 5

- Suppliers, purchase orders, goods receipt, purchase invoice
- Stock dashboard and low-stock alerts

Subsequent sprints deliver packages, transfers, offers, attendance, payroll, reports, staff mobile features, and expanded treatment workflows based on business priority.

## 18. Pre-development Decisions

The product owner should approve:

1. Separate vs single role-aware mobile apps.
2. Hosting preference and target region for the Node.js/MySQL solution.
3. OTP SMS and notification providers plus store UPI IDs/QR codes.
4. Store and GST registration model.
5. Package cross-store/family rules.
6. Invoice, refund, discount, stock, purchase, and payroll approvals.
7. Offline requirements.
8. Hair-transplant clinical fields and retention.
9. Payroll scope and statutory integration.
10. Expected peak workload and data migration volume.

Once these are confirmed, the team should create wireframes, an entity-relationship model, API contracts, a threat model, and sprint-level stories in the delivery tool.
