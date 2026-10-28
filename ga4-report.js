// GA4 Report Sync for Grand Strategy Hub.
// Pulls page-engagement, channel, and Direct-channel diagnostics from GA4 and
// writes them as JSON. Each report embeds a `generatedAt` timestamp so stale
// files are machine-detectable: identical decimals across days means the cron
// did not actually refresh, not that traffic reproduced exactly.

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

const DATE_RANGES = [{ startDate: '28daysAgo', endDate: 'today' }];

// Direct-channel filter used by the two diagnostic reports.
const DIRECT_FILTER_EXPRESSION = {
  filter: {
    fieldName: 'sessionDefaultChannelGroup',
    inListFilter: { values: ['Direct'] },
  },
};

function writeReport(file, rows) {
  const out = { generatedAt: new Date().toISOString(), rows };
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Wrote ${rows.length} rows to ${file}`);
}

async function getPageEngagementReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: DATE_RANGES,
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

  writeReport('ga4-page-report.json', rows);
  return rows;
}

async function getChannelReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: DATE_RANGES,
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

  writeReport('ga4-channel-report.json', rows);
  return rows;
}

async function getDirectLandingReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: DATE_RANGES,
    dimensions: [{ name: 'landingPage' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
      { name: 'engagementRate' },
      { name: 'screenPageViews' },
    ],
    dimensionFilter: DIRECT_FILTER_EXPRESSION,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 30,
  });

  const rows = (response.rows || []).map((row) => ({
    landingPage: row.dimensionValues[0].value,
    sessions: row.metricValues[0].value,
    activeUsers: row.metricValues[1].value,
    avgSessionDurationSec: row.metricValues[2].value,
    engagementRate: row.metricValues[3].value,
    pageViews: row.metricValues[4].value,
  }));

  writeReport('ga4-direct-landing-report.json', rows);
  return rows;
}

async function getDirectBrowserReport() {
  const [response] = await analyticsDataClient.runReport({
    property: `properties/${PROPERTY_ID}`,
    dateRanges: DATE_RANGES,
    dimensions: [{ name: 'browser' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'averageSessionDuration' },
      { name: 'engagedSessions' },
      { name: 'engagementRate' },
    ],
    dimensionFilter: DIRECT_FILTER_EXPRESSION,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 30,
  });

  const rows = (response.rows || []).map((row) => ({
    browser: row.dimensionValues[0].value,
    sessions: row.metricValues[0].value,
    activeUsers: row.metricValues[1].value,
    avgSessionDurationSec: row.metricValues[2].value,
    engagedSessions: row.metricValues[3].value,
    engagementRate: row.metricValues[4].value,
  }));

  writeReport('ga4-direct-browser-report.json', rows);
  return rows;
}

// Outbound clicks to Amazon (the KDP books). GA4 Enhanced Measurement records
// outbound clicks as the `click` event with a `linkUrl`; filtering linkUrl to
// amazon.* isolates the book links. Isolated in its own try/catch so a failure
// here (e.g. Enhanced Measurement off, no click events at all) can never break
// the core reports above.
async function getAmazonClicksReport() {
  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: DATE_RANGES,
      dimensions: [{ name: 'pagePath' }, { name: 'linkUrl' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: { matchType: 'EXACT', value: 'click' },
              },
            },
            {
              filter: {
                fieldName: 'linkUrl',
                stringFilter: {
                  matchType: 'CONTAINS',
                  value: 'amazon.',
                  caseSensitive: false,
                },
              },
            },
          ],
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 100,
    });

    const rows = (response.rows || []).map((row) => ({
      page: row.dimensionValues[0].value,
      linkUrl: row.dimensionValues[1].value,
      clicks: row.metricValues[0].value,
    }));

    writeReport('ga4-amazon-clicks.json', rows);
    return rows;
  } catch (err) {
    console.error('Amazon clicks report failed (continuing):', err.message || err);
    const out = {
      generatedAt: new Date().toISOString(),
      error: String((err && err.message) || err),
      rows: [],
    };
    fs.writeFileSync('ga4-amazon-clicks.json', JSON.stringify(out, null, 2));
    return [];
  }
}

// QR scans for the Blood & Crown promo: every scan lands on /go/blood-crown/
// (GA4-tracked redirect page, 1.2s then Amazon). A redirect page has ~zero
// engagement time so it never appears in the top-50 page report — it needs
// its own exact-match report. 28d window = all scans since the page went
// live (Oct 27, 2026). Same isolated try/catch pattern as the Amazon report.
async function getGoPageReport() {
  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${PROPERTY_ID}`,
      dateRanges: DATE_RANGES,
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'activeUsers' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'EXACT', value: '/go/blood-crown/' },
        },
      },
      limit: 10,
    });

    const rows = (response.rows || []).map((row) => ({
      page: row.dimensionValues[0].value,
      pageViews: row.metricValues[0].value,
      sessions: row.metricValues[1].value,
      activeUsers: row.metricValues[2].value,
    }));

    writeReport('ga4-go-clicks.json', rows);
    return rows;
  } catch (err) {
    console.error('Go page report failed (continuing):', err.message || err);
    const out = {
      generatedAt: new Date().toISOString(),
      error: String((err && err.message) || err),
      rows: [],
    };
    fs.writeFileSync('ga4-go-clicks.json', JSON.stringify(out, null, 2));
    return [];
  }
}

async function main() {
  const pageRows = await getPageEngagementReport();
  const channelRows = await getChannelReport();
  const directLandingRows = await getDirectLandingReport();
  const directBrowserRows = await getDirectBrowserReport();

  console.log('\n--- top 10 pages by engagement time ---');
  pageRows.slice(0, 10).forEach((r) =>
    console.log(`  ${r.page}: ${r.userEngagementDurationSec}s engagement, ${r.sessions} sessions`)
  );
  console.log('--- channels ---');
  channelRows.forEach((r) => console.log(`  ${r.channel}: ${r.sessions} sessions`));
  console.log('--- direct landings ---');
  directLandingRows.slice(0, 5).forEach((r) =>
    console.log(`  ${r.landingPage}: ${r.sessions} sessions`)
  );
  console.log('--- direct browsers ---');
  directBrowserRows.forEach((r) => console.log(`  ${r.browser}: ${r.sessions} sessions`));

  const amazonClickRows = await getAmazonClicksReport();
  console.log('--- amazon outbound clicks (28d) ---');
  if (amazonClickRows.length === 0) {
    console.log('  (none recorded)');
  } else {
    amazonClickRows.forEach((r) => console.log(`  ${r.page} -> ${r.linkUrl}: ${r.clicks} clicks`));
  }

  const goRows = await getGoPageReport();
  console.log('--- /go/blood-crown/ QR scans (28d) ---');
  if (goRows.length === 0) {
    console.log('  (none recorded)');
  } else {
    goRows.forEach((r) => console.log(`  ${r.page}: ${r.pageViews} views, ${r.sessions} sessions`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});