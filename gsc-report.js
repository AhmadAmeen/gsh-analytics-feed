// GSC Report Sync for Grand Strategy Hub.
// Pulls query+page level Search Console data (clicks, impressions, CTR, position)
// with pagination so the totals are complete, and writes gsc-queries-report.json
// with a generatedAt timestamp, true totals, and the top rows sorted by clicks.

const { google } = require('googleapis');
const fs = require('fs');

const credentials = process.env.GA4_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_KEY)
  : JSON.parse(fs.readFileSync('./ga4-service-account.json', 'utf8'));

// Must match exactly how the property appears in Search Console's property list
// (prefix property, trailing slash included).
const SITE_URL = 'https://grand-strategy-hub.pages.dev/';

const PAGE_SIZE = 250;
const MAX_ROWS = 20000; // hard safety cap

async function fetchAllRows(searchconsole) {
  const rows = [];
  let startRow = 0;
  for (;;) {
    const response = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: dateNDaysAgo(28),
        endDate: dateNDaysAgo(0),
        dimensions: ['query', 'page'],
        rowLimit: PAGE_SIZE,
        startRow,
      },
    });
    const batch = response.data.rows || [];
    for (const r of batch) {
      rows.push({
        query: r.keys[0],
        page: r.keys[1],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        position: r.position,
      });
    }
    startRow += batch.length;
    if (batch.length < PAGE_SIZE || startRow >= MAX_ROWS) break;
  }
  return rows;
}
async function getQueriesReport() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const rows = await fetchAllRows(searchconsole);

  const totals = rows.reduce(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }),
    { clicks: 0, impressions: 0 }
  );
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  totals.position = totals.impressions
    ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / totals.impressions
    : 0;

  const topRows = [...rows].sort((a, b) => b.clicks - a.clicks).slice(0, 500);

  const out = {
    generatedAt: new Date().toISOString(),
    totals,
    rowCount: rows.length,
    rows: topRows,
  };
  fs.writeFileSync('gsc-queries-report.json', JSON.stringify(out, null, 2));
  console.log(`Wrote ${rows.length} total rows (${topRows.length} kept).`);
  console.log(`Totals: ${totals.clicks} clicks / ${totals.impressions} impressions / ctr ${(totals.ctr * 100).toFixed(2)}% / pos ${totals.position.toFixed(1)}`);
  topRows.slice(0, 10).forEach((r) =>
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