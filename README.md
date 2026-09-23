# Vayyom Spa — Phase 1

React web portal, Expo React Native staff app, NestJS API, MySQL/Prisma database, and a notification outbox worker.

This increment implements the base models and staff workflow:
**customer → appointment → treatment status → invoice → Cash/verified UPI → receipt**, with product stock received and consumed transactionally.

See [base model](docs/MODEL.md), [Phase 1 scope and next steps](docs/PHASE-1.md), [API contract](docs/API.md), and the original [development specification](VayyomSpa_Development_Specification.md).

## Requirements

- Node.js 24 LTS recommended (tested locally with Node 24).
- Local MySQL 8, default 127.0.0.1:3306, database **vayyom_spa**.
- For mobile: Expo Go matching SDK 57, or an Expo development build. Android emulator uses 10.0.2.2 to reach the host; a physical device needs the computer's LAN address. iOS native builds require macOS/Xcode.

## Start after local setup

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

Web: **http://localhost:5173**

API: **http://localhost:4000/api/v1**

Swagger: **http://localhost:4000/api/docs**

Username: **admin**. Use the generated **SEED_ADMIN_PASSWORD** value in your local `.env`. No shared default password is committed.

The starter starts the project-local MySQL server if necessary and runs web/API. It does not install a Windows service. Keep the terminal open while developing. Optional worker: `npm run dev:worker`.

## First setup with an existing MySQL server

1. Create database `vayyom_spa` using utf8mb4 and a dedicated local user with privileges on that database.
2. Copy `.env.example` to `.env`; set DATABASE_URL, a random JWT_SECRET of at least 32 characters, and a unique SEED_ADMIN_PASSWORD of at least 12 characters.
3. Run:

```powershell
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Seed is non-destructive and does nothing if username admin already exists. It creates a main store, administrator and five sample catalog items; no fake customers, financial transactions or stock.

## Optional project-local MySQL on Windows

Download the official [MySQL 8.4.9 Windows ZIP](https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.9-winx64.zip), then extract it so `.local/mysql-8.4.9-winx64/bin/mysqld.exe` exists.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
npm run db:deploy
npm run db:seed
npm run dev
```

Setup binds MySQL to loopback, creates vayyom_spa and a dedicated user, generates random root/application/admin/JWT secrets, and writes ignored local configuration. It refuses to replace existing .env or database data. The root client config is .local/mysql-admin.ini. To stop only this local instance gracefully:

```powershell
& .local/mysql-8.4.9-winx64/bin/mysqladmin.exe --defaults-file=.local/mysql-admin.ini shutdown
```

## Mobile

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
npm run build -w @vayyom/shared
npm run dev:mobile
```

Set EXPO_PUBLIC_API_URL in apps/mobile/.env to your reachable API URL. Sign in with a staff account created through the web Team screen. Tokens are stored in platform SecureStore. Staff roles determine tabs and the server enforces permissions. Customer OTP and customer tabs are a later phase.

## First workflow

1. Sign in. Create a therapist account in Team if needed.
2. Add a customer; review or create services/products.
3. Receive product opening stock with a reason.
4. Book a future appointment within store hours; check in, start and complete it.
5. Post an invoice through Billing / POS.
6. Collect cash or submit a UPI reference. A manager verifies UPI after checking the bank record.
7. Open the invoice to print its details and successful payment receipts.

In POS, choose a completed appointment to prefill its guest and service, or create a walk-in bill. Linked appointments can be billed only once.

## Verification

```powershell
npm run build
npm run typecheck
npm test
# Start the API and MySQL first:
npm run test:integration
npm run test:browser
```

Integration tests create their own test organization in the local database and clean up only those records. They cover concurrent booking/stock, transaction rollback, payment retry/verification, store isolation, discounts, audit/outbox, and logout revocation. Never point them at a production database.

## Layout

- apps/web — responsive staff portal
- apps/mobile — Android/iOS staff application
- apps/api — authentication, master data, scoped read APIs and transaction services
- apps/worker — leased outbox delivery and retries
- packages/shared — fixed-point calculations, API client and types
- prisma — MySQL schema, migration and seed
- tests — unit and live-MySQL integration checks
- scripts — local Windows setup/start helpers

Detailed limitations and the next increments are in [docs/PHASE-1.md](docs/PHASE-1.md). This is a local development foundation; external providers, statutory invoice requirements and production deployment remain future work.
