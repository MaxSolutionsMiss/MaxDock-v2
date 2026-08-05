# MaxDock Deployment and Cutover Rules

This document is implementation-owned. It defines how MaxDock is deployed and how the eventual production cutover is controlled.

## Environments

### Current production

The existing MaxDock repository and website remain the operational production system. They are not modified, renamed or removed during the rebuild.

### Rebuild staging

`https://maxsolutionsmiss.github.io/MaxDock/` is the staging environment for the rebuild.

During the rebuild, the `main` branch of `MaxDock` represents the latest reviewed staging state. It is not the production replacement, even when a stage is deployed successfully.

## Stage deployment loop

Every implementation stage follows this sequence:

1. Create a fresh feature branch from the latest reviewed `main`.
2. Build only the current stage against the four documents in `/docs/`.
3. Update `docs/STATUS.md` with completed work, unfinished work, decisions and questions.
4. Open a draft pull request.
5. Run both architecture gates and their clean/bad fixture tests.
6. Resolve every CI error. Warnings must be reviewed and explained.
7. Review the pull request without automatic merging.
8. Merge only after the user explicitly approves the stage.
9. Deploy the merged stage to the stable MaxDock staging URL.
10. Ask Claude to audit the repository and deployed staging site.
11. Add Claude's dated audit under `/docs/` through the design-to-implementation bridge.
12. Correct every accepted audit finding before the next stage starts.

No later stage begins while the current stage has unresolved acceptance failures.

## Failure rule

When a build, deployment, RPC integration or browser test fails:

- stop the stage;
- record the failure in `docs/STATUS.md`;
- identify and correct the root cause in the canonical file;
- rerun the same verification;
- do not add override stylesheets, patch scripts, numbered release assets, runtime injection or alternate deployment paths.

A workaround that leaves the underlying failure in place is not an accepted completion.

## Secrets and configuration

- Client-safe Supabase values are supplied through the approved deployment configuration.
- Service-role keys, administrative secrets and private credentials never enter the repository or browser code.
- Database authorization remains enforced by Supabase RLS and approved RPCs, not by hidden interface controls.

## Production cutover gate

MaxDock does not replace the existing production MaxDock until all of the following are complete:

- all eight implementation stages are complete;
- both automated architecture gates pass in strict static mode;
- Claude's final visual and technical audit is accepted;
- authenticated testing is completed for customer, coordinator, shipping manager, site admin and system admin roles;
- customer data isolation and RLS are verified with real test accounts;
- concurrent booking, routed appointments, capacity enforcement and after-hours behaviour are verified;
- America/Toronto timezone and daylight-saving transition cases are verified;
- phone and iPad readability, 10–15 dock layouts, text-size settings and no-scroll board behaviour are accepted;
- session expiry, Wi-Fi interruption and polling suspension/resume behaviour are accepted;
- a rollback point for the old application is documented and retained.

## Final cutover

The final cutover is a separate approved change, not an automatic consequence of completing a stage.

Before cutover:

1. Tag and preserve the last accepted old MaxDock release.
2. Tag the accepted MaxDock release.
3. Confirm database compatibility and rollback steps.
4. Schedule the cutover during an approved operational window.
5. Verify login, booking, queue and administrator functions immediately after cutover.
6. Keep the rollback release available until the agreed stabilization period is complete.

No repository is deleted during cutover. Renaming, domain changes and retirement of the old system happen only after explicit approval.
