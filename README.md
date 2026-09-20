# gsh-analytics-feed

Daily **GA4 page-engagement and channel reports** for [Grand Strategy Hub](https://grand-strategy-hub.pages.dev), stored as machine-readable JSON in a **public** repo so the analytics can be read programmatically (by the site's AI workflows) without anyone navigating the GA4 UI or screenshotting.

Costs **$0**: Google's Analytics Data API free tier (25,000 requests/day, 60,000 tokens/day per property) is far beyond what this site uses. GitHub Actions free tier runs the daily cron.

## Outputs

| File | Contents |
|---|---|
| `ga4-page-report.json` | Top 50 pages by engagement time: sessions, active users, avg session duration, engagement duration, engaged sessions, page views |
| `ga4-channel-report.json` | Channel breakdown: sessions, engaged sessions, engagement rate, avg session duration |

Fetchable at (public, no auth):
```
https://raw.githubusercontent.com/AhmadAmeen/gsh-analytics-feed/main/ga4-page-report.json
https://raw.githubusercontent.com/AhmadAmeen/gsh-analytics-feed/main/ga4-channel-report.json
```

## Security model

- **Only numbers live in this repo.** No reports contain personal data or credentials.
- The **service account key never enters the repo**. It is stored as a GitHub Actions secret. In CI the script writes it to the **OS temp dir** (outside the workspace) and hands it to the Google client via Application Default Credentials, so it can never be committed. GitHub also masks secret values in logs.
- Locally, the key is expected at `./ga4-service-account.json`, which is gitignored.

## One-time setup

### 1. Google Cloud side (done once in the Cloud Console, ~10 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project (e.g. `grand-strategy-hub-analytics`).
2. APIs & Services → Library → enable **Google Analytics Data API**.
3. APIs & Services → Credentials → Create Credentials → **Service account** (e.g. `ga4-reader`), then Keys → Add Key → JSON. This downloads the key file. Treat it like a password.
4. Google Analytics → Admin → **Property Access Management** → Add users → paste the key's `client_email` → role **Viewer**.
5. Google Analytics → Admin → Property Settings → copy the **numeric Property ID** (NOT the `G-XXXXXXX` Measurement ID; the API needs the numeric one).

### 2. Repo secrets (this repo)

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `GA4_SERVICE_ACCOUNT_KEY` | The **entire contents** of the service-account JSON file |
| `GA4_PROPERTY_ID` | The numeric property id from step 1.5 |

### 3. Workflow permissions

Settings → Actions → General → Workflow permissions → **"Read and write permissions"** (belt-and-braces alongside the `permissions: contents: write` block in the workflow).

## Local run

```bash
npm install
# place ga4-service-account.json in repo root (gitignored)
node ga4-report.js
```

## First run (to confirm everything works)

Actions tab → **GA4 Report Sync** → **Run workflow** (this uses the `workflow_dispatch` trigger). Confirm `ga4-page-report.json` and `ga4-channel-report.json` appear in the repo root afterward. The workflow also runs automatically daily at 18:00 UTC.

## Troubleshooting

- **"Permission denied" / 403**: the `client_email` from the key isn't in the property's **Property Access Management** as **Viewer** (the most common miss), or the wrong account was added.
- **"Property not found"**: the Measurement ID (`G-XXXXXXX`) was pasted instead of the numeric Property ID.
- **Secrets changed?** Update them in Settings → Secrets; no file changes needed.

## Extending later

The same service account can be added to **Search Console** (Settings → Users and permissions → Restricted) for GSC query/impression data in the same feed pattern. Script to be added once GA4 is confirmed working.