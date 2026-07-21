# Deploying embersovereignty.com

The public site, form handler, Durable Object binding, and Cloudflare Worker configuration live in this directory. The Worker name is `ember`; the custom domains are `embersovereignty.com` and `www.embersovereignty.com`.

## Normal path

Pushes to `main` that touch `site/**` or the site workflow run `.github/workflows/deploy-site.yml`:

1. run the Worker tests;
2. deploy `site/wrangler.jsonc` to the existing Cloudflare Worker;
3. retain the Worker's existing `RESEND_API_KEY` and `EXPORT_KEY` bindings.

The team repo needs:

- repository variable `CLOUDFLARE_ACCOUNT_ID`;
- repository secret `CLOUDFLARE_API_TOKEN`, scoped to Workers Scripts Edit, Workers Routes Edit, and Memberships Read on the account that owns the domain.

`RESEND_API_KEY` and `EXPORT_KEY` already live on the Worker and survive a code deploy. Put rotated values in Cloudflare directly; do not add them to this repository unless the deployment workflow is deliberately changed to own secret rotation.

## Cutover state

The live Worker is currently deployed from `davidlsneider/ember-site`. Keep that workflow available until the first green team-repo deployment and live verification. After that, disable the old workflow rather than deleting the repository; its history is useful recovery evidence.

## Verify

```bash
npm test
npx wrangler deploy --dry-run
curl -sSIL https://embersovereignty.com/
curl -sSIL https://embersovereignty.com/briefing/
```

Verify the apex and `www`, the form page, CSP/security headers, the `/briefing/sent/` success page, and a known static asset. A real form submission sends an email, so do not use a synthetic live lead without naming it clearly.
