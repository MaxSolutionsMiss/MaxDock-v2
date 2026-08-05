# Retiring MaxDock v1 and taking its name

A click-by-click procedure, in the order that does not break anything. Written to be followed
at the keyboard rather than read.

The goal: `MaxDock-v2` becomes `MaxDock`, the old repository is preserved and retired, and no
account operation stops working on the way. Nothing user-facing changes — the application never
says "v2". Every page title is already `· MaxDock`, and the only `v2` in the codebase is a
service-worker cache key in `app/sw.js` that nobody sees. "v2" lives in the repository name and
the staging URL, nowhere else.

**Who does what.** Steps marked **[owner]** are GitHub and Supabase settings; no tool in this
build can reach them. Steps marked **[build]** are commits in this repository.

---

## The one thing that makes the order matter

The **deployed** `maxdock-invite-user` function sends invited people and password resets to:

```ts
redirectTo: `${appUrl}/set-password.html`
```

where `appUrl` is `MAXDOCK_APP_URL`, falling back to `https://maxsolutionsmiss.github.io/MaxDock/db04`.

That is what is live today. The copy in this repository no longer says it — see below — but a file
in a repository redirects nobody. Until it is deployed, the sentence above is the truth.

`set-password.html` **exists only in the old repository** — `db04/set-password.html`, wired to
v1's own stylesheet and scripts. This repository has no equivalent.

So the old repository is not idle history. It is currently serving the page every invitation and
every password reset lands on. Rename it, delete it, or point `MAXDOCK_APP_URL` at v2 while that
line still says `/set-password.html`, and the next person invited gets a 404 — with no error
anybody can act on.

**The fix is not to build that page here.** This application already has the screen. `index.html`
at the repository root is the login page and it carries the password panel: `js/pages/login.js`
handles `?mode=setup`, handles `?mode=recovery`, handles the `PASSWORD_RECOVERY` event, and
`js/db.js` creates the client with `detectSessionInUrl: true`, so the tokens in an emailed link
establish a session before the panel is shown. It is also where this application's own "forgot
password" already sends people. A second password-setting page would be two screens doing one job
with two sets of validation and two sets of error messages.

So the function points at `${appUrl}/?mode=setup` instead, which is a one-line change already
committed here, and step 1 is deploying it rather than writing a page.

One thing that is *not* a problem, contrary to what a quick reading of `docs/GO_LIVE_AUDIT.md`
§1.2 suggests: CORS survives this. The function computes

```ts
const allowedOrigin = new URL(appUrl).origin;
```

which is `https://maxsolutionsmiss.github.io` whatever the path. Renaming a repository inside the
same organisation does not move the origin, so sign-in, account creation, password reset,
username change and account deletion keep working throughout. It is the *links in emails* that
break, not the API. Renaming the **organisation** is the case that moves the origin, and that is
a different procedure.

---

## Steps 1 and 2 — [owner] Set the secret and deploy the function, in that order, one sitting

These are one step in two halves and must not be separated. The deployed function currently sends
people to v1's `set-password.html`; the version in this repository sends them to this
application's `?mode=setup`. Whichever is deployed has to agree with wherever `MAXDOCK_APP_URL`
points, and both halves below make them agree.

**Do not start this while v1 is still the application people are being invited to.** The moment
the new function is deployed, every invitation and every password reset goes to v2. That is the
intent, but it is a cutover, not a preparation.

**1. The secret.** Supabase Dashboard → project `rywzqepzramurbrpmept` → **Edge Functions** →
**Secrets** (also reachable as Project Settings → Edge Functions → Secrets).

| Name | Value |
|---|---|
| `MAXDOCK_APP_URL` | `https://maxsolutionsmiss.github.io/MaxDock-v2` |

No trailing slash needed; the function strips one if present. Use the **current** repository name
here. The rename is separated from this deliberately, so each can be tested on its own.

**2. The function.** Deploy `supabase/functions/maxdock-invite-user/index.ts` from this repository
— Edge Functions → `maxdock-invite-user`. Keep **Verify JWT with legacy secret** OFF, as the file
header says.

**Verify.** Invite a test user. The email should land on
`https://maxsolutionsmiss.github.io/MaxDock-v2/?mode=setup`, show the "Set your password" panel,
and sign them in once saved. Then use "Forgot password" on the same login screen and confirm the
recovery route lands on the same panel.

**Undo.** Redeploy the previous function from the v1 repository and delete the secret. Both halves
have to go back together, for the same reason they went forward together.

## Step 3 — [owner] Point Supabase Auth at v2

Supabase Dashboard → **Authentication** → **URL Configuration**.

| Field | Value |
|---|---|
| Site URL | `https://maxsolutionsmiss.github.io/MaxDock-v2/` |
| Redirect URLs | add `https://maxsolutionsmiss.github.io/MaxDock-v2/**` |

Leave the old entries in place for now. Extra redirect URLs are permitted and cost nothing; they
are removed in step 8, once nothing needs them.

**Verify.** Use "Forgot password" on the v2 login screen. The email should return to v2.

## Step 4 — [owner] Back up the old repository

Thirty seconds, and it is what makes every step after this reversible. It holds 77 branches that
exist in no other repository — v2 shares no history with it; v2's root commit is
`9a915cc`, "Initialize MaxDock v2 repository", 24 July.

```
git clone --mirror https://github.com/MaxSolutionsMiss/MaxDock maxdock-v1.git
tar czf maxdock-v1-archive.tar.gz maxdock-v1.git
```

Keep the tarball somewhere that is not a laptop.

**What this does not capture:** issues, pull request review threads, and the wiki. A mirror clone
takes git objects only. If any of that is worth keeping, export it before step 6.

## Step 5 — [owner] Rename the old repository out of the way

`MaxSolutionsMiss/MaxDock` → Settings → **Repository name** → `maxdock-v1` → **Rename**.

This is what frees the name. Archiving does not: GitHub repository names are **case-insensitive
for uniqueness**, so `MaxDock` and `maxdock` collide, and an archived repository still holds its
name.

GitHub creates a redirect from `MaxDock` to `maxdock-v1`, and releases it the moment another
repository claims `MaxDock` in step 7 — so old links end up on the new application rather than on
a 404, which is the outcome to want.

**Verify.** `https://github.com/MaxSolutionsMiss/maxdock-v1` loads.

**Undo.** Rename it back. Renames are free and reversible in both directions.

## Step 6 — [owner] Archive it

`maxdock-v1` → Settings → Danger Zone → **Archive this repository**.

Read-only, off the active list, says "superseded" without an explanation, one click to undo.

**Deletion is still available afterwards** and this is the point of doing it in this order:
archiving turns "delete the old repository" from a decision that has to be right today into one
that can be made in a month, from a repository that is already out of the way, with a tarball on
disk. Issues and pull request threads do not come back from that tarball, so there is no hurry to
find out whether they mattered.

**Unverified, and worth checking before archiving rather than after:** whether GitHub Pages keeps
serving an archived repository. If v1's site has to stay reachable for a while, do step 5 and skip
this step — the rename is what frees the name; this is tidiness.

## Step 7 — [owner] Rename v2

`MaxSolutionsMiss/MaxDock-v2` → Settings → **Repository name** → `MaxDock` → **Rename**.

The Pages URL becomes `https://maxsolutionsmiss.github.io/MaxDock/`. Two things move with it and
are handled in the next two steps. Nothing in the application itself needs changing: `basePath()`
in `js/router.js` and `js/session.js` derives the path at runtime, and the manifest's `start_url`
and `scope` are relative.

**Verify.** `https://maxsolutionsmiss.github.io/MaxDock/` serves the application. It may take a
few minutes for Pages to republish.

**Tell anybody who installed the PWA to reinstall it.** A service worker is scoped to a path. An
installation at `/MaxDock-v2/` is orphaned by this rename — the icon stays on the phone and stops
working. This is the one step with a cost that cannot be undone by undoing the step.

## Step 8 — [owner] Update the two settings to the new name, then prune

Same two places as steps 2 and 3:

| Where | To |
|---|---|
| `MAXDOCK_APP_URL` | `https://maxsolutionsmiss.github.io/MaxDock` (redeploy not needed; the function reads it per invocation) |
| Auth Site URL | `https://maxsolutionsmiss.github.io/MaxDock/` |
| Auth Redirect URLs | add `https://maxsolutionsmiss.github.io/MaxDock/**`, then remove the `MaxDock-v2` and `db04` entries |

Prune the old redirect URLs only after the new ones are confirmed working. There is no penalty for
leaving them a day and a real one for removing the entry that is still in use.

## Step 9 — [build] Sweep the references

Eight files carry the old name. One commit, and CI proves it:

- `.github/workflows/smoke-full-preview.yml` — `BASE`, four occurrences
- `README.md`, `DEPLOYMENT.md`
- `docs/STATUS.md`, `docs/ROLLBACK.md`, `docs/NAMING-AND-DOMAIN.md`
- `docs/AUDIT-2026-07-24.md`, `docs/AUDIT-2026-07-24-STAGE1.md`

It should land in the same hour as step 7, so the smoke test is never pointing at a URL that has
moved.

---

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Invitation link 404s or shows the sign-in form instead of the password panel | `MAXDOCK_APP_URL` and the deployed function disagree: one names v1, the other sends to `?mode=setup` | Make them agree. The secret is read per invocation, so fixing it needs no redeploy; changing which function is deployed does |
| Password reset email returns to the wrong host | Auth Site URL not updated | Authentication → URL Configuration |
| A button does nothing, console shows a CORS error | The **organisation** was renamed, not just the repository | Set `MAXDOCK_APP_URL` to the new origin |
| Smoke workflow fails on 404 | Step 9 has not landed | Land it, or re-run after it does |
| Installed phone app stops opening | Service worker scope moved with the rename | Reinstall from the new URL |

Every step from 2 to 8 is reversible on its own. Step 4 is what makes the irreversible one —
deleting the old repository, whenever that is decided — safe to defer indefinitely.

## Related

- `docs/NAMING-AND-DOMAIN.md` — why `maxdock` lower case, the organisation rename, and the domain
- `docs/GO_LIVE_AUDIT.md` §1.2–1.3 — the account-service failure modes this procedure avoids
- `docs/DEPLOYMENT.md` — what "cutover" means and what still has to be true before it
