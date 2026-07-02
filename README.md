# businesscoachvas.com — SEO Dashboard

An auto-refreshing SEO dashboard for **businesscoachvas.com**, hosted on GitHub Pages.
It shows a 28-day reporting window compared against the prior 28 days, pulling from:

- **Google Search Console** — clicks, impressions, CTR, average position, top queries, top pages
- **Google Analytics 4** — sessions, users, engagement, pageviews, traffic by channel
- **Semrush** — organic keywords, estimated traffic, backlinks, referring domains, authority score

The page is a static `index.html` that reads `data.json`. A scheduled GitHub Action
re-pulls the data **every day at 06:00 UTC** and commits an updated `data.json`, which
redeploys Pages automatically. A "Last updated" timestamp shows on the page.

---

## One-time setup (required before the daily refresh works)

The Action runs on GitHub's servers, so it needs its own read-only credentials, stored as
**repository secrets**. Add them under **Settings → Secrets and variables → Actions → New repository secret**.

> ⚠️ Add these in the GitHub UI only. Never commit them to the repo or paste them into chat/email.

### 1. `GCP_SA_KEY` — Google service account

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project and a
   **service account**. Under it, create a **JSON key** and download it.
2. Enable these APIs in the project: **Google Search Console API** and **Google Analytics Data API**.
3. Grant the service account **read** access to each property:
   - **Search Console** → property `sc-domain:businesscoachvas.com` → Settings → *Users and permissions* →
     add the service-account email (the `client_email` in the JSON) with **Full** or **Restricted** access.
   - **GA4** → property **Business Coaching VAs** (`properties/509524329`) → Admin →
     *Property Access Management* → add the service-account email as **Viewer**.
4. Paste the **entire JSON file contents** as the value of the `GCP_SA_KEY` secret.

### 2. `SEMRUSH_API_KEY` — Semrush API key

- From your Semrush account → **Subscription info / API**, copy the API key and save it as `SEMRUSH_API_KEY`.
- Note: Semrush API access requires a Business plan or an API-units add-on, and each refresh consumes a
  small number of API units.

### 3. Enable GitHub Pages

- **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch **`main`**, folder **`/ (root)`**.
- The live URL will be `https://<owner>.github.io/businesscoachvas-seo-dashboard/`.

### 4. First run

- Go to the **Actions** tab → **Refresh SEO data** → **Run workflow** to trigger the first pull manually
  and confirm the secrets work. After that it runs automatically every day.

---

## Local test (optional)

```bash
npm install
GCP_SA_KEY="$(cat service-account.json)" SEMRUSH_API_KEY="xxxx" npm run pull
# open index.html via a local static server (fetch of data.json needs http, not file://)
npx serve .
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Dashboard UI; renders from `data.json` |
| `data.json` | Latest metrics (overwritten by the daily Action) |
| `scripts/pull.mjs` | Fetches GSC + GA4 + Semrush, writes `data.json` |
| `.github/workflows/refresh.yml` | Scheduled daily refresh |

---
_Prepared by The VA Group._
