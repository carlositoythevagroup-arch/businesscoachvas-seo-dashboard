// Pulls SEO metrics for businesscoachvas.com and writes data.json.
// Runs inside the GitHub Action. Reads two secrets from the environment:
//   GCP_SA_KEY       - full Google service-account JSON (one line)
//   SEMRUSH_API_KEY  - Semrush API key
// The service account must have READ access to both:
//   - GSC property  sc-domain:businesscoachvas.com   (Search Console > Settings > Users)
//   - GA4 property  properties/509524329             (GA4 Admin > Property Access Management, Viewer)

import { writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const GSC_SITE      = 'sc-domain:businesscoachvas.com';
const GA4_ID        = 'properties/509524329';
const SEMRUSH_DOMAIN = 'businesscoachvas.com';
const SEMRUSH_DB     = 'us';

const SEMRUSH_KEY = process.env.SEMRUSH_API_KEY;
if (!process.env.GCP_SA_KEY) throw new Error('Missing GCP_SA_KEY secret');
if (!SEMRUSH_KEY) throw new Error('Missing SEMRUSH_API_KEY secret');
const SA = JSON.parse(process.env.GCP_SA_KEY);

// ---- date windows: current = last 28 days ending yesterday; prior = the 28 before that ----
const fmt = d => d.toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };
const curEnd = daysAgo(1),  curStart = daysAgo(28);
const prevEnd = daysAgo(29), prevStart = daysAgo(56);
const windowObj = { current: [fmt(curStart), fmt(curEnd)], prior: [fmt(prevStart), fmt(prevEnd)] };

const auth = new JWT({
  email: SA.client_email,
  key: SA.private_key,
  scopes: [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ],
});

async function googlePost(url, body) {
  const headers = { ...(await auth.getRequestHeaders()), 'Content-Type': 'application/json' };
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const gscUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE)}/searchAnalytics/query`;
const gscTotals = (start, end) =>
  googlePost(gscUrl, { startDate: start, endDate: end }).then(j => (j.rows && j.rows[0]) || { clicks: 0, impressions: 0, ctr: 0, position: 0 });
const gscDim = (start, end, dim) =>
  googlePost(gscUrl, { startDate: start, endDate: end, dimensions: [dim], rowLimit: 10 }).then(j => j.rows || []);

const ga4Url = `https://analyticsdata.googleapis.com/v1beta/${GA4_ID}:runReport`;
function ga4Metrics(range) {
  return googlePost(ga4Url, {
    dateRanges: [{ startDate: range[0], endDate: range[1] }],
    metrics: [
      { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
      { name: 'engagedSessions' }, { name: 'averageSessionDuration' }, { name: 'screenPageViews' },
    ],
  }).then(j => {
    const v = (j.rows && j.rows[0] && j.rows[0].metricValues.map(m => Number(m.value))) || [0,0,0,0,0,0];
    return { sessions: v[0], totalUsers: v[1], newUsers: v[2], engagedSessions: v[3], avgSessionDuration: v[4], pageviews: v[5] };
  });
}

// ---- Semrush: response is ';'-delimited CSV with a header row ----
async function semrush(base, params) {
  const url = base + '?' + new URLSearchParams({ key: SEMRUSH_KEY, ...params });
  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok || text.startsWith('ERROR')) throw new Error(`Semrush ${r.status}: ${text.slice(0,200)}`);
  const [head, row] = text.trim().split(/\r?\n/);
  if (!row) return {};
  const keys = head.split(';'), vals = row.split(';');
  return Object.fromEntries(keys.map((k, i) => [k.trim(), vals[i]]));
}

const num = x => (x == null || x === '' ? 0 : Number(x));

async function main() {
  const [gCur, gPrev, queries, pages, aCur, aPrev, channelsResp, sRanks, sLinks] = await Promise.all([
    gscTotals(...windowObj.current),
    gscTotals(...windowObj.prior),
    gscDim(windowObj.current[0], windowObj.current[1], 'query'),
    gscDim(windowObj.current[0], windowObj.current[1], 'page'),
    ga4Metrics(windowObj.current),
    ga4Metrics(windowObj.prior),
    googlePost(ga4Url, {
      dateRanges: [{ startDate: windowObj.current[0], endDate: windowObj.current[1] }],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }),
    semrush('https://api.semrush.com/', { type: 'domain_ranks', domain: SEMRUSH_DOMAIN, database: SEMRUSH_DB,
      export_columns: 'Db,Dn,Rk,Or,Ot,Oc,Ad' }),
    semrush('https://api.semrush.com/analytics/v1/', { type: 'backlinks_overview', target: SEMRUSH_DOMAIN,
      target_type: 'root_domain', export_columns: 'ascore,total,domains_num,urls_num,follows_num,nofollows_num' }),
  ]);

  const channels = (channelsResp.rows || []).map(r => ({
    channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value),
  }));

  const data = {
    site: SEMRUSH_DOMAIN,
    last_updated: new Date().toISOString(),
    window: windowObj,
    gsc: { current: gCur, prior: gPrev },
    ga4: { current: aCur, prior: aPrev },
    channels,
    queries: queries.map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position })),
    pages: pages.map(r => ({ page: r.keys[0].replace(/^https?:\/\/[^/]+/, '') || '/', clicks: r.clicks, impressions: r.impressions, position: r.position })),
    semrush: {
      organic_keywords: num(sRanks['Organic Keywords']),
      organic_traffic: num(sRanks['Organic Traffic']),
      rank: num(sRanks['Rank']),
      adwords_keywords: num(sRanks['Adwords Keywords']),
      authority_score: num(sLinks.ascore),
      backlinks_total: num(sLinks.total),
      referring_domains: num(sLinks.domains_num),
      follows: num(sLinks.follows_num),
      nofollows: num(sLinks.nofollows_num),
    },
  };

  writeFileSync(new URL('../data.json', import.meta.url), JSON.stringify(data, null, 2));
  console.log('Wrote data.json — window', windowObj.current.join(' .. '));
}

main().catch(e => { console.error(e); process.exit(1); });
