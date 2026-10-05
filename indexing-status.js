/**
 * indexing-status.js
 *
 * Full-site indexing monitor for Grand Strategy Hub.
 *
 * Reads every URL from the live sitemap, inspects each via Google's URL
 * Inspection API (read-only), and writes indexing-status.json so the team can
 * watch "unknown to Google" and "indexed" counts over time.
 *
 * Designed to run on the same cron as ga4-sync.yml (twice daily). Uses the
 * existing service account which is read-only — no write permission needed.
 *
 * Output:
 *   indexing-status.json
 *     {
 *       "generatedAt": "...",
 *       "checked": 74, "indexed": 0, "crawledNotIndexed": 0,
 *       "discoveredNotIndexed": 0, "unknownToGoogle": 0, "errors": 0,
 *       "rows": [ { "url", "status", "verdict" } ]
 *     }
 */

const { google } = require('googleapis');
const fs = require('fs');

const credentials = process.env.GA4_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.GA4_SERVICE_ACCOUNT_KEY)
  : JSON.parse(fs.readFileSync('./ga4-service-account.json', 'utf8'));

const SITE_URL = 'https://grand-strategy-hub.pages.dev/';
const SITEMAP_URL = 'https://grand-strategy-hub.pages.dev/sitemap-0.xml';
const MAX_INSPECTIONS = 150; // keep well under Google's ~600/day/query quota
const DELAY_MS = 300;

async function getSitemapUrls() {
  const res = await fetch(SITEMAP_URL);
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1]);
}

async function inspectUrl(sc, url) {
  const r = await sc.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl: SITE_URL },
  });
  const st = (r.data.inspectionResult && r.data.inspectionResult.indexStatusResult) || {};
  return { status: st.coverageState || 'unknown', verdict: st.verdict || 'none' };
}

function categorize(status) {
  if (status === 'Submitted and indexed') return 'indexed';
  if (status === 'Crawled - currently not indexed') return 'crawledNotIndexed';
  if (status === 'Discovered - currently not indexed') return 'discoveredNotIndexed';
  if (status === 'URL is unknown to Google') return 'unknownToGoogle';
  return 'other';
}

(async () => {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.searchconsole({ version: 'v1', auth });

  const urls = await getSitemapUrls();
  console.log(`Found ${urls.length} URLs in sitemap`);

  const counts = { indexed: 0, crawledNotIndexed: 0, discoveredNotIndexed: 0, unknownToGoogle: 0, other: 0, errors: 0 };
  const rows = [];

  for (let i = 0; i < urls.length; i++) {
    if (i >= MAX_INSPECTIONS) {
      console.log(`stopping at ${MAX_INSPECTIONS} inspections`);
      break;
    }
    const url = urls[i];
    process.stdout.write(`[${i + 1}/${Math.min(urls.length, MAX_INSPECTIONS)}] ${url} ... `);
    try {
      const { status } = await inspectUrl(sc, url);
      const cat = categorize(status);
      counts[cat]++;
      rows.push({ url, status, category: cat });
      console.log(cat);
    } catch (e) {
      counts.errors++;
      rows.push({ url, status: `ERROR: ${e.message}`, category: 'error' });
      console.log(`ERROR ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    checked: rows.length,
    ...counts,
    rows,
  };
  fs.writeFileSync('indexing-status.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('\n=== SUMMARY ===');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log(`Wrote indexing-status.json (${rows.length} rows)`);
})().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});