# Deploying embersovereignty.com

The public site, form handler, Durable Object binding, and Cloudflare Worker configuration live in this directory. The Worker name is `ember`; the custom domains are `embersovereignty.com` and `www.embersovereignty.com`.

## Normal path

Pushes to `main` that touch `site/**`, the built whitepaper PDF, or the site workflow run `.github/workflows/deploy-site.yml`:

1. stage the tracked whitepaper PDF as a Worker asset;
2. run the Worker tests;
3. deploy `site/wrangler.jsonc` to the existing Cloudflare Worker;
4. retain the Worker's existing `RESEND_API_KEY` and `EXPORT_KEY` bindings.

The canonical paper URL is `/whitepaper`. The Worker serves `whitepaper/ember-whitepaper.pdf` inline at that path; the deploy workflow copies the built artifact from `../whitepaper/ember-whitepaper.pdf`, so the document has one tracked PDF source.

The team repo needs:

- repository variable `CLOUDFLARE_ACCOUNT_ID`;
- repository secret `CLOUDFLARE_API_TOKEN`, scoped to Workers Scripts Edit, Workers Routes Edit, and Memberships Read on the account that owns the domain.

`RESEND_API_KEY` and `EXPORT_KEY` already live on the Worker and survive a code deploy. Put rotated values in Cloudflare directly; do not add them to this repository unless the deployment workflow is deliberately changed to own secret rotation.

## Cutover state

Cutover completed on 2026-07-21. This team repo owns deployments. The old `davidlsneider/ember-site` repo remains as recovery history with its deploy workflow disabled.

## Verify

```bash
npm test
npx wrangler deploy --dry-run
curl -sSIL https://embersovereignty.com/
curl -sSIL https://embersovereignty.com/briefing/
curl -sSIL https://embersovereignty.com/whitepaper
```

Verify the apex and `www`, the form page, CSP/security headers, the `/briefing/sent/` success page, `/whitepaper` as an inline PDF response, and a known static asset. A real form submission sends an email, so do not use a synthetic live lead without naming it clearly.
