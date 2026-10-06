# SERVED product and technical delivery plan

This is a proposed portfolio release plan derived from the exported application and [verification record](verification.md). It is not an assertion that Carla led a staffed production program or completed provider acceptance testing. The deployed Replit application is outside this source-only documentation change.

## Release objective and prioritization
A requester can submit and pay for a fictional service request; an authorized server can accept, record an attempt, and produce evidence; each party sees only permitted job data. Role and ownership boundaries precede cosmetic improvements because evidence documents and payments create consequential failure modes.

| Priority | Workstream | Evidence required | Scope decision |
| --- | --- | --- | --- |
| P0 | Identity and job authorization | Cross-role and other-user denial cases on every job/document route | Block release if another account can retrieve private evidence |
| P0 | Assignment and payment integrity | Concurrent acceptance, duplicate webhook, failed payment and payout tests | A tour is not a successful transaction |
| P0 | Completion evidence | Required identity/photo checks and missing-evidence failures | GPS alone does not establish completion |
| P1 | End-to-end job lifecycle | Isolated paid-test job from draft through completion and export | Use test providers and disposable fixtures |
| P1 | Operational wording | Reconcile payout timing and supported jurisdiction claims | Only claim verified behavior |
| P2 | Performance tuning | Measured load time and bundle evidence | Do not refactor chunks without a measured need |

## Dependency and milestone register

| ID | Milestone / dependency | Exit gate | Responsible role to confirm | Status |
| --- | --- | --- | --- | --- |
| D1 | Disposable PostgreSQL and seeded test jobs | Migrations applied to test DB; repeatable cleanup | Implementation owner | Pending |
| D2 | Clerk test users for each role | Valid sessions, expired-session and ownership denial cases | Identity/integration owner | Pending |
| D3 | Stripe test Checkout/Connect and webhook configuration | Paid, failed, duplicate-event and transfer evidence | Payments owner | Pending |
| D4 | Test object storage and notifications | Document ownership checks; mocked/test delivery verified | Integration owner | Pending |
| M1 | Credential-free baseline | Lockfile install, compilation and unit checks | Portfolio owner | Prior reviewed copy passed; see verification |
| M2 | Identity and lifecycle test pass | D1–D4 plus negative and concurrency cases | Roles above, not assigned people | Proposed |
| M3 | Domain/operational review | Jurisdiction and affidavit wording reviewed by qualified domain owner | Domain owner | Proposed |
| M4 | Release decision | M2/M3 evidence, rollback and monitoring agreed | Product/release owner | Proposed |

Critical path: disposable data and identity setup → ownership checks → payment/lifecycle integration → domain review → release decision. Dates should be assigned after service access and test ownership are confirmed; no artificial schedule commitment is presented.

## RAID and decisions

| ID / type | Concern | Response and closure evidence |
| --- | --- | --- |
| I1 / issue | Full suite can import DB modules before skip checks | Repair test bootstrap; absent integration config should skip clearly rather than crash |
| R1 / risk | Duplicate callbacks or acceptance races change financial/job state twice | Replay webhooks and simultaneous acceptance; capture final DB state and idempotency evidence |
| R2 / risk | Document or job data crosses account boundary | Explicit other-owner and other-role requests; require denials |
| A1 / assumption | Jurisdiction and identity rules reflect operational needs | Qualified domain review; separate software checks from legal sufficiency |
| I2 / issue | Public payout wording differs from source timing | Reconcile claims before operational launch |
| D5 / dependency | Test environment can safely exercise provider integration | Test credentials, disposable data and cleanup plan before any integration run |

Decision: extend the existing app instead of adding another marketplace project. Deferred: additional features and load optimization until the existing lifecycle has integration evidence. No tests in this plan authorize real payments, client notifications or background checks.

## Metrics and release evidence
These are targets, not observed production outcomes: 100% planned authorization-denial cases pass; zero duplicate state transitions in repeated callback/concurrency fixtures; all supported lifecycle stages have successful and failed-path evidence; every completed test job has the required evidence package. After a controlled pilot, measure draft-to-submission conversion, time to assignment, first-attempt timeliness and support exceptions. Establish baselines before setting business improvement targets.

Release record should include commit, environment, provider mode, seed fixture, executed cases, failures, unresolved risks and go/no-go rationale. Rollback plan to confirm with deployment owner: restore previous application version, stop new intake if integrity is uncertain, reconcile provider events against DB records, and preserve test/audit evidence. Deployment rollback does not undo an external charge or completed service.

[Product case study](product-case-study.md) · [Integration architecture](architecture.md) · [Verification and pending work](verification.md)
