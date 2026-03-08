import { describe, it, expect, vi } from 'vitest';
import { MappedSheetsLoader, SheetSource } from '../src/MappedSheetsLoader';
import type { MappingDefinition } from '@kylebrodeur/type-safe-mapping';

// ── Fixture ───────────────────────────────────────────────────────────────────

type ProductRow = {
  'Product ID': string;
  'Product Name': string;
  'Unit Price': string;
  [key: string]: string;
};

const mapping = {
  'Product ID': 'id',
  'Product Name': 'name',
  'Unit Price': 'unitPrice',
} as const satisfies MappingDefinition<ProductRow>;

class ProductLoader extends MappedSheetsLoader<ProductRow, typeof mapping> {
  protected fieldMapping = mapping;
}

function makeSource(rows: Record<string, string>[]): SheetSource {
  return { loadWithHeaders: vi.fn().mockResolvedValue(rows) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MappedSheetsLoader', () => {
  it('renames sheet column headers to model fields', async () => {
    const source = makeSource([
      { 'Product ID': 'p1', 'Product Name': 'Widget', 'Unit Price': '9.99' },
    ]);

    const result = await new ProductLoader(source).loadMapped('SHEET', 'A1:C10');

    expect(result).toEqual([{ id: 'p1', name: 'Widget', unitPrice: '9.99' }]);
  });

  it('maps multiple rows', async () => {
    const source = makeSource([
      { 'Product ID': 'p1', 'Product Name': 'Widget', 'Unit Price': '9.99' },
      { 'Product ID': 'p2', 'Product Name': 'Gadget', 'Unit Price': '24.50' },
    ]);

    const result = await new ProductLoader(source).loadMapped('SHEET', 'A1:C10');

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: 'p2', name: 'Gadget', unitPrice: '24.50' });
  });

  it('returns empty array when source returns no rows', async () => {
    const source = makeSource([]);
    const result = await new ProductLoader(source).loadMapped('SHEET', 'A1:C10');
    expect(result).toEqual([]);
  });

  it('skips undefined source fields gracefully (partial rows)', async () => {
    const source = makeSource([
      { 'Product ID': 'p3' }, // Name and Price missing
    ]);

    const [result] = await new ProductLoader(source).loadMapped('SHEET', 'A1:C10');

    expect(result.id).toBe('p3');
    // missing fields are omitted, not undefined-exploding
    expect('name' in result).toBe(false);
  });

  it('calls loadWithHeaders with the correct sheetId and range', async () => {
    const source = makeSource([]);
    await new ProductLoader(source).loadMapped('MY_SHEET_ID', 'Products!A1:C500');
    expect(source.loadWithHeaders).toHaveBeenCalledWith('MY_SHEET_ID', 'Products!A1:C500');
  });

  it('reverseMap returns original column header keys', () => {
    const loader = new ProductLoader(makeSource([]));
    const reversed = loader.reverseMap({ id: 'p1', name: 'Widget', unitPrice: '9.99' });
    expect(reversed).toEqual({
      'Product ID': 'p1',
      'Product Name': 'Widget',
      'Unit Price': '9.99',
    });
  });
});
