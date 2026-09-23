# Phase 1 API

Base URL: http://localhost:4000/api/v1. Swagger: http://localhost:4000/api/docs.

All protected calls use Authorization: Bearer <token> and X-Store-Id: <authorized store UUID>. If omitted, the first assigned store is used. Unauthorized store choices return 403. Transaction commands require Idempotency-Key (8–100 letters/digits/underscore/hyphen). Retain the same key and body after a network failure. Reusing a key for another actor/store/body returns 409.

Money is a decimal string in INR. Version values are integers. Dates use ISO 8601 timestamps with timezone. Invalid requests return Problem Details with status, detail and traceId. No raw database exceptions or secrets are returned.

| Route | Method | Body / behavior |
|---|---|---|
| /health | GET | Database readiness |
| /auth/login | POST | username, password → token and safe user |
| /auth/me | GET | Current user |
| /auth/logout | POST | {} → revoke all current user sessions |
| /auth/password | POST | currentPassword, newPassword (12+ chars) → revoke sessions |
| /stores | GET / POST | List assigned stores; admin creation: name, timezone, opensAt, closesAt |
| /employees | GET / POST | Names/roles in active store; admin creates name, username, password, role |
| /customers | GET / POST | search/cursor; create name, mobile, optional email, marketingConsent |
| /customers/:id | PATCH | Customer fields plus current version |
| /services | GET / POST | name, price, taxRate, duration |
| /products | GET / POST | name, sku, price, taxRate, minimumStock |
| /appointments | GET / POST | GET from/to (max 93 days); POST customerId, serviceId, providerId, startsAt, optional notes |
| /appointments/:id/transition | POST | status, version |
| /invoices | GET / POST | GET cursor; POST customerId, optional appointmentId, discountPercent, items: [{catalogItemId, quantity}] |
| /invoices/:id | GET | Scoped invoice with immutable items and receipts |
| /payments | GET / POST | GET cursor; POST invoiceId, method CASH or UPI, amount, UPI reference |
| /payments/:id/verify | POST | Manager: decision VERIFY or REJECT, version, reason required for rejection |
| /stock | GET | Stock projection including zero balances |
| /stock/receive | POST | productId, positive integer quantity, reason |
| /stock/ledger | GET | Immutable ledger, cursor |
| /reports/dashboard | GET | Source reconciled totals and upcoming appointments |
| /admin/audit | GET | Manager-only activity, cursor |
| /notifications | GET | Manager-only outbox delivery status |

Creation of stores, appointments, invoice posting, payment recording/verification and stock receipt require Idempotency-Key. Catalog/customer/staff creation uses unique constraints rather than the command retry table.

Each user belongs to one organization. Store assignment and role come from the database on every request; JWT claims cannot grant broader scope. Only ADMIN creates users and stores. MANAGER/ADMIN edit catalog or verify UPI. RECEPTION handles customers/bookings/POS and up to 10% discount. THERAPIST accesses assigned appointments. INVENTORY receives stock. No customer endpoint is exposed before OTP and ownership checks are implemented.

An appointment can be linked to an invoice only once, after completion, and the invoice must include its service. Walk-in invoices may omit appointmentId.
