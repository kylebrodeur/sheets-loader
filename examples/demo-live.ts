#!/usr/bin/env ts-node
/**
 * demo-live.ts — Live end-to-end demo of @kylebrodeur/sheets-loader
 *
 * Loads real data from a Google Sheet and runs the full flow:
 * raw load → loadWithHeaders → cache hit verification.
 *
 * Run:
 *   SHEET_ID=<id> RANGE="Sheet1!A1:D20" SA_CREDENTIALS=./service-account.json \
 *     npx tsx examples/demo-live.ts
 *
 *   # Or inline credentials:
 *   SHEET_ID=<id> RANGE="Sheet1!A1:D20" SA_EMAIL=<email> SA_KEY=<key> \
 *     npx tsx examples/demo-live.ts
 */

import { SheetsLoader } from '../src/index.js';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};

const step = (n: number, msg: string) =>
  process.stdout.write(`\n${c.bold}${c.cyan}[${n}]${c.reset} ${c.bold}${msg}${c.reset}\n`);
const ok = (msg: string) => console.log(`  ${c.green}✔${c.reset}  ${msg}`);

async function main() {
  const SHEET_ID = process.env.SHEET_ID;
  const RANGE = process.env.RANGE ?? 'Sheet1!A1:Z100';

  if (!SHEET_ID) {
    console.error('Error: SHEET_ID environment variable is required');
    process.exit(1);
  }

  const authConfig = process.env.SA_CREDENTIALS
    ? { credentials: process.env.SA_CREDENTIALS }
    : process.env.SA_EMAIL && process.env.SA_KEY
      ? { credentials: { client_email: process.env.SA_EMAIL, private_key: process.env.SA_KEY.replace(/\\n/g, '\n') } }
      : undefined;

  if (!authConfig) {
    console.error('Error: Provide SA_CREDENTIALS (path to JSON file) or SA_EMAIL + SA_KEY');
    process.exit(1);
  }

  const loader = new SheetsLoader({ auth: authConfig });

  // 1. Raw string[][]
  step(1, `SheetsLoader.load() → "${RANGE}"`);
  const rawRows = await loader.load(SHEET_ID, RANGE);
  ok(`Loaded ${rawRows.length} rows`);
  if (rawRows[0]) console.log(`  ${c.dim}Headers: ${JSON.stringify(rawRows[0])}${c.reset}`);
  if (rawRows[1]) console.log(`  ${c.dim}Row 1:   ${JSON.stringify(rawRows[1])}${c.reset}`);

  // 2. Header-keyed records
  step(2, 'SheetsLoader.loadWithHeaders() → named-key records');
  const headerRows = await loader.loadWithHeaders(SHEET_ID, RANGE);
  ok(`${headerRows.length} data rows keyed by header`);
  if (headerRows[0]) console.log(`  ${c.dim}${JSON.stringify(headerRows[0], null, 2)}${c.reset}`);

  if (rawRows.length === 0) {
    console.log(`  ${c.yellow}⚠ No rows returned${c.reset}`);
    return;
  }

  // 3. Cache hit
  step(3, 'Cache hit — calling load() again');
  const t0 = Date.now();
  await loader.load(SHEET_ID, RANGE);
  ok(`Second call returned in ${Date.now() - t0}ms (served from cache)`);

  console.log(`\n${c.bold}${c.green}Live demo complete.${c.reset}\n`);
  console.log(`For a fully typed MappedSheetsLoader example, see examples/mapped-loader.ts`);
}

main().catch(console.error);
