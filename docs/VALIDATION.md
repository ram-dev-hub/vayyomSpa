# Phase 1 validation — 23 September 2026

Environment: Windows, Node 24.14.1, project-local MySQL 8.4.9, database vayyom_spa.

| Check | Result |
|---|---|
| Clean dependency install (npm ci) | Passed |
| MySQL migration and seed | Passed |
| Web/API/worker production builds | Passed |
| All workspace TypeScript checks | Passed |
| Unit rules | 7 passed |
| Live-MySQL integration scenarios | Passed |
| Chrome full staff workflow | Passed |
| Desktop and 390px responsive viewport | Passed; no horizontal overflow or browser runtime errors |
| Expo SDK 57 Android and iOS bundles | Passed |
| API readiness | Healthy; MySQL connected |
| Git whitespace check | Passed |

Integration scenarios cover concurrent appointment conflicts, status/version checks, receipt retries, store-changed retries, the last-stock-unit race, invoice rollback, split Cash/UPI allocation, pending UPI balance reservation, verification permissions, overpayment prevention, tenant/store isolation, discount limits, audit/outbox and logout revocation.

The browser test creates a temporary organization and follows login → customer → appointment → checked in → in progress → completed → linked invoice → UPI submission → manager verification → receipt display. Test records are cleaned up. Screenshots are in ignored .local/phase1-desktop.png and .local/phase1-responsive.png.

Native-device/emulator execution, signed APK/IPA builds, external notification delivery, production security/deployment, and later-phase business flows were not validated. Mobile results are JavaScript/Hermes bundle checks, not native binary acceptance.

Dependency audit: 10 moderate findings propagated from the UUID dependency in Expo/Xcode build tooling; no high or critical findings at the last audit. Review before a production release.