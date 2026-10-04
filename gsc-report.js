// GSC Report Sync for Grand Strategy Hub.
// Pulls query+page level Search Console data (clicks, impressions, CTR, position)
// from the Google Search Console API and writes it as JSON with a generatedAt
// timestamp, matching the convention used by the GA4 feeds in this repo.

const { google } = require('googleapis');
const fs = require('fs');

const credentials = process.env.GA4_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_KEY)
  : JSON.parse(fs.readFileSync('./ga4-service-account.json', 'utf8'));

// Must match exactly how the property appears in Search Console's property list
// (prefix property, trailing slash included).
const SITE_URL = 'https://grand-strategy-hub.pages.dev/';

async function getQueriesReport() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: dateNDaysAgo(28),
      endDate: dateNDaysAgo(0),
      dimensions: ['query', 'page'],
      rowLimit: 250,
    },
  });

  const rows = (response.data.rows || []).map((r) => ({
    query: r.keys[0],
    page: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  const out = { generatedAt: new Date().toISOString(), rows };
  fs.writeFileSync('gsc-queries-report.json', JSON.stringify(out, null, 2));
  console.log(`Wrote ${rows.length} rows to gsc-queries-report.json`);
  rows.slice(0, 10).forEach((r) =>
    console.log(`  ${r.query} -> ${r.clicks} clicks / ${r.impressions} imp / pos ${r.position}`)
  );
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

getQueriesReport().catch((err) => {
  console.error(err);
  process.exit(1);
});