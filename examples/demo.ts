#!/usr/bin/env ts-node
/**
 * demo.ts — Mocked end-to-end demo of @kylebrodeur/sheets-loader
 *
 * Runs completely offline. Uses an in-process fake SheetSource so you can
 * record the output without real credentials.
 *
 * Run:
 *   pnpm demo
 *   # or directly:
 *   npx tsx examples/demo.ts
 */

import { MappedSheetsLoader } from '../src/MappedSheetsLoader.js';
import type { SheetSource } from '../src/MappedSheetsLoader.js';
import type { MappingDefinition } from '@kylebrodeur/type-safe-mapping';

// ── Terminal colours (no external dep) ───────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
};

function log(msg: string) { process.stdout.write(msg + '\n'); }
function step(n: number, msg: string) {
  log(`\n${c.bold}${c.cyan}[${n}]${c.reset} ${c.bold}${msg}${c.reset}`);
}
function ok(msg: string) { log(`  ${c.green}✔${c.reset}  ${msg}`); }
function show(obj: unknown) { log(`  ${c.dim}→${c.reset}  ${JSON.stringify(obj)}`); }

// ── Mock SheetSource ──────────────────────────────────────────────────────────
//
// SheetSource is the seam between SheetsLoader and MappedSheetsLoader.
// In production, you pass a real SheetsLoader. For demos/tests, any
// object satisfying { loadWithHeaders(...) } works.

const FAKE_ROWS: Record<string, string>[] = [
  { 'Product ID': 'SKU-001', 'Product Name': 'Wireless Mouse',      'Unit Price': '29.99', 'In Stock': 'true'  },
  { 'Product ID': 'SKU-002', 'Product Name': 'Mechanical Keyboard',  'Unit Price': '89.99', 'In Stock': 'true'  },
  { 'Product ID': 'SKU-003', 'Product Name': 'USB-C Hub',            'Unit Price': '45.00', 'In Stock': 'false' },
  { 'Product ID': 'SKU-004', 'Product Name': 'Monitor Stand',        'Unit Price': '39.99', 'In Stock': 'true'  },
];

const mockSource: SheetSource = {
  loadWithHeaders: async (sheetId, range) => {
    log(`  ${c.dim}[mock] loadWithHeaders("${sheetId}", "${range}") → ${FAKE_ROWS.length} rows${c.reset}`);
    return FAKE_ROWS;
  },
};

// ── Types & mapping ───────────────────────────────────────────────────────────

type ProductSheetRow = {
  'Product ID': string;
  'Product Name': string;
  'Unit Price': string;
  'In Stock': string;
  [key: string]: string; // index signature required: mapped values must be keyof TSource
};

const mapping = {
  'Product ID':   'id',
  'Product Name': 'name',
  'Unit Price':   'unitPrice',
  'In Stock':     'inStock',
} as const satisfies MappingDefinition<ProductSheetRow>;

class ProductLoader extends MappedSheetsLoader<ProductSheetRow, typeof mapping> {
  protected fieldMapping = mapping;
}

// ── Step 1: raw header-keyed rows ─────────────────────────────────────────────

async function main() {
  step(1, 'SheetSource.loadWithHeaders() — named-key records');
  const headerRows = await mockSource.loadWithHeaders('MY_SHEET', 'Products!A1:D5');
  ok(`${headerRows.length} rows keyed by column header:`);
  headerRows.forEach(show);

  // 2. MappedSheetsLoader — rename column headers to model fields
  step(2, 'MappedSheetsLoader.loadMapped() — rename headers → model fields');
  const loader = new ProductLoader(mockSource);
  const mapped = await loader.loadMapped('MY_SHEET', 'Products!A1:D5');
  ok(`Mapped ${mapped.length} products:`);
  mapped.forEach(show);

  // 3. Post-process — coerce string values to domain types
  step(3, 'Post-process — coerce to domain types');
  const products = mapped.map((p) => ({
    id: p.id,
    name: p.name,
    unitPrice: parseFloat(p.unitPrice),
    inStock: p.inStock === 'true',
  }));
  ok('Final typed models:');
  products.forEach(show);

  // 4. reverseMap — back to original column header keys
  step(4, 'reverseMap() — back to sheet column header keys');
  const reversed = loader.reverseMap(mapped[0]);
  ok('reverseMap(mapped[0]):');
  show(reversed);

  log(`\n${c.bold}${c.green}All steps complete.${c.reset} Run demo-live.ts with real credentials to hit the API.\n`);
}

main().catch(console.error);

