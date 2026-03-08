/**
 * Example: MappedSheetsLoader — type-safe column renaming
 *
 * Extends MappedSheetsLoader (which wraps MappedServiceBase from
 * @kylebrodeur/type-safe-mapping) to automatically rename sheet column
 * headers to your internal model fields in a single typed call.
 *
 * Run (after building the package):
 *   SA_EMAIL=<email> SA_KEY=<key> SHEET_ID=<id> npx ts-node examples/mapped-loader.ts
 */

import { SheetsLoader, MappedSheetsLoader } from '../src';
import type { MappingDefinition } from '@kylebrodeur/type-safe-mapping';

// ── 1. Declare the shape that matches your sheet's column headers exactly ──────

type ProductSheetRow = {
  'Product ID': string;
  'Product Name': string;
  'Unit Price': string;
  'In Stock': string;
  [key: string]: string; // required: mapping values must also be keyof TSource
};

// ── 2. Define the column → model field mapping ─────────────────────────────────

const productMapping = {
  'Product ID': 'id',
  'Product Name': 'name',
  'Unit Price': 'unitPrice',
  'In Stock': 'inStock',
} as const satisfies MappingDefinition<ProductSheetRow>;

// ── 3. Extend MappedSheetsLoader and implement fieldMapping ────────────────────

class ProductSheetLoader extends MappedSheetsLoader<ProductSheetRow, typeof productMapping> {
  protected fieldMapping = productMapping;
}

// ── 4. Use it ──────────────────────────────────────────────────────────────────

async function main() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID environment variable is required');

  const sheetsLoader = new SheetsLoader({
    auth: {
      credentials: {
        client_email: process.env.SA_EMAIL!,
        private_key: process.env.SA_KEY!.replace(/\\n/g, '\n'),
      },
    },
  });

  const loader = new ProductSheetLoader(sheetsLoader);

  // products is fully typed: { id: string; name: string; unitPrice: string; inStock: string }[]
  const products = await loader.loadMapped(sheetId, 'Products!A1:D500');

  console.log(`Loaded ${products.length} products`);
  console.log('First product:', products[0]);

  // Post-process: coerce types after renaming
  const parsed = products.map((p) => ({
    id: p.id,
    name: p.name,
    unitPrice: parseFloat(p.unitPrice) || 0,
    inStock: p.inStock?.toLowerCase() === 'true',
  }));

  console.log('Parsed first product:', parsed[0]);
}

main().catch(console.error);
