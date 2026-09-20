// GA4 Report Sync for Grand Strategy Hub.
// Pulls page-engagement and channel reports from GA4 and writes them as JSON.
//
// Auth (two ways):
//   1. CI / GitHub Actions: pass GA4_SERVICE_ACCOUNT_KEY (the entire service-account
//      JSON, as a secret) and GA4_PROPERTY_ID (numeric property id, as a secret) via
//      environment variables. The key is written to the OS temp dir, NEVER the
//      workspace, so it cannot end up in a commit. The Google client picks it up
//      via Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS path).
//   2. Local: drop ga4-service-account.json next to this script (gitignored) and
//      optionally set GA4_PROPERTY_ID. The script falls back to a hardcoded id for
//      one-off local runs.

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');
const os = require('os');
const path = require('path');

// --- auth ---------------------------------------------------------------
const clientOptions = {};
if (process.env.GA4_SERVICE_ACCOUNT_KEY) {
  // CI path: write the key out of the workspace so it can never be committed.
  const tmpKeyPath = path.join(os.tmpdir(), 'ga4-sa.json');
  fs.writeFileSync(tmpKeyPath, process.env.GA4_SERVICE_ACCOUNT_KEY);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpKeyPath;
  clientOptions.keyFilename = tmpKeyPath;
} else if (fs.existsSync('./ga4-service-account.json')) {
  // Local path: key file next to the script (gitignored).
  clientOptions.keyFilename = './ga4-service-account.json';
} else {
  console.error(
    'No GA4 service account key found.\n' +
    '  CI:           set the GA4_SERVICE_ACCOUNT_KEY secret.\n' +
    '  Local:        place ga4-service-account.json in the repo root.'
  );
  process.exit(1);
}

const analyticsDataClient = new BetaAnalyticsDataClient(clientOptions);

// Numeric GA4 property id (NOT the G-XXXXXX measurement id).
const PROPERTY_ID = process.env.GA4_PROPERTY_ID || 'REPLACE_WITH_YOUR_PROPERTY_ID';

// --- reports ------------------------------------------------------------
async function getPageEngagementReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
      { name: 'userEngagementDuration' },
      { name: 'engagedSessions' },
      { name: 'screenPageViews' },
    ],
    orderBys: [{ metric: { metricName: 'userEngagementDuration' }, desc: true }],
    limit: 50,
  });

  const rows = (response.rows || []).map((row) => ({
    page: row.dimensionValues[0].value,
    sessions: row.metricValues[0].value,
    activeUsers: row.metricValues[1].value,
    avgSessionDurationSec: row.metricValues[2].value,
    userEngagementDurationSec: row.metricValues[3].value,
    engagedSessions: row.metricValues[4].value,
    pageViews: row.metricValues[5].value,
  }));

  fs.writeFileSync('ga4-page-report.json', JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} rows to ga4-page-report.json`);
  return rows;
}

async function getChannelReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
      { name: 'averageSessionDuration' },
    ],
  });

  const rows = (response.rows || []).map((row) => ({
    channel: row.dimensionValues[0].value,
    sessions: row.metricValues[0].value,
    engagedSessions: row.metricValues[1].value,
    engagementRate: row.metricValues[2].value,
    avgSessionDurationSec: row.metricValues[3].value,
  }));

  fs.writeFileSync('ga4-channel-report.json', JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} rows to ga4-channel-report.json`);
  return rows;
}

async function main() {
  const pageRows = await getPageEngagementReport();
  const channelRows = await getChannelReport();

  console.log('\n--- top 10 pages by engagement time ---');
  pageRows.slice(0, 10).forEach((r) =>
    console.log(`  ${r.page}: ${r.userEngagementDurationSec}s engagement`)
  );
  console.log('--- channels (sessions) ---');
  channelRows.forEach((r) => console.log(`  ${r.channel}: ${r.sessions}`));
  console.log('\nOutput: ga4-page-report.json + ga4-channel-report.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});