// GA4 Report Sync for Grand Strategy Hub.
// Pulls page-engagement and channel reports from GA4 and writes them as JSON.
//
// Auth (two ways):
//   1. CI / GitHub Actions: GA4_SERVICE_ACCOUNT_KEY (the full service-account JSON)
//      and GA4_PROPERTY_ID arrive as environment variables from repo secrets. The key
//      is parsed in memory and NEVER written to disk.
//   2. Local: ga4-service-account.json sits next to this script (gitignored). The
//      property id comes from GA4_PROPERTY_ID or falls back to the value below.

const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const fs = require('fs');

const credentials = process.env.GA4_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_KEY)
  : undefined;

const analyticsDataClient = new BetaAnalyticsDataClient(
  credentials ? { credentials } : { keyFilename: './ga4-service-account.json' }
);

// Numeric GA4 property id (NOT the G-XXXXXX measurement id).
const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '553014412';

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
    console.log(`  ${r.page}: ${r.userEngagementDurationSec}s engagement, ${r.sessions} sessions`)
  );
  console.log('--- channels ---');
  channelRows.forEach((r) => console.log(`  ${r.channel}: ${r.sessions} sessions`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});