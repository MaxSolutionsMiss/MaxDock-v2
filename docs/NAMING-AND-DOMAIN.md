# Naming: the GitHub organisation, the repositories, and the domain

A recommendation, not a change. Renaming a GitHub organisation is done in GitHub's own
settings by an owner — I cannot do it and should not — but everything it breaks on this
side is listed here, and it is small.

## The shape you described

Max Solutions is the company. MaxDock is one product; MaxMetrics is coming; there will
be others. So the company is the brand and each product is a name under it. Every
recommendation below follows from that one sentence.

---

## 1. The organisation

**`MaxSolutionsMiss` → `maxsolutions`.** Check availability first; if it is taken,
`max-solutions` next, and `maxsolutionsinc` last. Lower case, because GitHub displays
organisation names as typed but URLs are case-insensitive and every other reference to
them in tooling is lower case.

Drop the `Miss`. It reads as "Mississauga", which was true when Mississauga was the
only site — there are twelve now, in three countries — and it reads as a typo to
anybody who does not know that.

**What GitHub handles for you.** The old organisation URL redirects. Every repository
URL under it redirects. `git push` and `git fetch` against the old remote keep working
through that redirect, so nothing breaks the moment you press the button.

**What it does break, and it matters here.** GitHub Pages is served from
`<organisation>.github.io`. Rename the organisation and the staging URL becomes
`https://maxsolutions.github.io/MaxDock/`. That is not something to rely on a
redirect for, and the address appears in twelve places in this repository — the smoke
test's `BASE`, `README.md`, `DEPLOYMENT.md`, `docs/STATUS.md` and the two audit
documents. One commit fixes all of them, and it should land in the same hour as the
rename so CI is never pointing at a URL that has moved.

**Nothing else is affected.** The Supabase project reference, the publishable key in
`js/db.js`, RLS, the data — none of it knows or cares what the repository is called.

**When.** Now is a better time than later: nothing outside the company links to the
staging URL yet, and the alternative is doing it during a cutover when several other
things are moving at once.

---

## 2. The repositories

**One repository per product**, named after the product in lower case:

| Repository | Holds |
|---|---|
| `maxdock` | this application |
| `maxmetrics` | the KPI product, when it starts |

**Done, 2026-08-05.** `MaxDock-v2` is now `MaxDock`. The two reasons this said to wait were
both cleared first: the old repository was backed up, renamed to `maxdock-v1` and archived, and
the smoke workflow's URLs moved in the same hour as the rename. Lower-casing it to `maxdock`
is still open and is a separate, smaller move -- GitHub treats repository names as
case-insensitive for uniqueness, so it is a rename of one repository and nothing else.

**Resist a shared repository until something is actually shared.** If MaxMetrics ends
up using this stylesheet and these Supabase contracts, a `maxsolutions-platform`
repository earns its place then. Creating it in advance produces a folder everybody has
to check out and nobody edits.

---

## 3. The domain

**Buy one company domain and give each product a subdomain.**

```
maxsolutions.ca          the company site
dock.maxsolutions.ca     MaxDock
metrics.maxsolutions.ca  MaxMetrics
```

`.ca` first: the company is Canadian, it reads local to the customers and carriers who
will use this, and it is cheaper to defend than a `.com`. Hold `maxsolutions.com` as
well if it is free and point it at the same place — that is insurance, not an address
to publish.

**Subdomains rather than paths**, and the reason is not aesthetic. Each product is its
own static site in its own repository, and GitHub Pages allows one custom domain per
repository. `dock.maxsolutions.ca` → the `maxdock` repository is a direct mapping with a
`CNAME` file and nothing else. `maxsolutions.ca/dock` would mean either forcing every
product into one repository or standing up a reverse proxy to stitch them together —
work with no upside while these are static files.

**`dock.` rather than `maxdock.`.** `maxdock.maxsolutions.ca` says "max" twice and reads
worse every time. The product is still called MaxDock everywhere a person sees it — in
the interface, on the deck, in conversation. The subdomain only has to say which
product, and the domain either side of it already says whose.

**Do not make `maxdock.com` the primary.** It makes one product the brand, which is the
opposite of what you described.

---

## Order of operations

1. Check `maxsolutions` is free as a GitHub organisation, and buy `maxsolutions.ca`.
   These are the two decisions; everything after is mechanical.
2. Rename the organisation in GitHub settings.
3. Same hour: the twelve URL references and the smoke test's `BASE` in this repository,
   and `git remote set-url` on any local clone. One commit, and CI proves it.
4. Confirm `https://maxsolutions.github.io/MaxDock/` serves the preview.
5. At cutover, and not before: rename `MaxDock` to `maxdock`, add the custom domain
   in Pages settings, commit the `CNAME`, and point `dock.maxsolutions.ca` at it.

Steps 3 and 4 are mine whenever you have done step 2.
