import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_URLS = [
  'https://live.railwaymonitor.in/camera1/',
  'https://live.railwaymonitor.in/camera2/',
  'https://live.railwaymonitor.in/camera3/',
  'https://live.railwaymonitor.in/camera4/',
  'https://kiosk1.railwaymonitor.in/vnc.html',
];

const MARKERS = /video|stream|iframe|m3u8|webrtc|img|canvas|noVNC|vnc|connect|button/i;

function parseUrlList() {
  const raw = process.env.LIVE_SMOKE_URLS || '';
  if (raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_URLS;
}

async function probe(url, { retries = 2 } = {}) {
  const started = performance.now();
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const ttfb = Math.round(performance.now() - t0);
      const text = await res.text();
      const total = Math.round(performance.now() - started);
      return {
        url,
        ok: res.ok,
        status: res.status,
        ttfb_ms: ttfb,
        total_ms: total,
        has_marker: MARKERS.test(text),
        snippet: text.slice(0, 200).replace(/\s+/g, ' '),
      };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return {
    url,
    ok: false,
    status: 0,
    ttfb_ms: null,
    total_ms: Math.round(performance.now() - started),
    has_marker: false,
    error: lastErr?.message || 'fetch failed',
  };
}

describe(
  'Production live smoke (Railway Monitoring)',
  { skip: process.env.LIVE_SMOKE !== '1' },
  () => {
    let results;

    before(async () => {
      const urls = parseUrlList();
      results = await Promise.all(urls.map((u) => probe(u)));
      const reportDir = path.join(__dirname, 'reports');
      fs.mkdirSync(reportDir, { recursive: true });
      const report = {
        generated_at: new Date().toISOString(),
        targets: results.map((r) => ({
          url: r.url,
          ok: r.ok,
          status: r.status,
          ttfb_ms: r.ttfb_ms,
          total_ms: r.total_ms,
          has_marker: r.has_marker,
          error: r.error || null,
        })),
        summary: {
          all_ok: results.every((r) => r.ok && r.status === 200),
          avg_total_ms: Math.round(
            results.reduce((a, r) => a + (r.total_ms || 0), 0) / Math.max(1, results.length)
          ),
        },
      };
      fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    });

    test('All URLs return HTTP 200', () => {
      for (const r of results) {
        assert.strictEqual(r.ok, true, `${r.url} status=${r.status} err=${r.error || ''}`);
        assert.strictEqual(r.status, 200, r.url);
      }
    });

    test('Responses include expected HTML markers', () => {
      for (const r of results) {
        assert.ok(r.has_marker, `markers missing for ${r.url}`);
      }
    });

    test('Parallel fetch completes within budget', () => {
      const max = Math.max(...results.map((r) => r.total_ms || 0));
      assert.ok(max < 15000, `slowest ${max}ms`);
    });
  }
);
