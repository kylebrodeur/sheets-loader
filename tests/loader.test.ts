import { vi, describe, it, expect, beforeEach } from 'vitest';

import * as fetcher from '../src/fetcher';
import * as auth from '../src/auth';
import { SheetsLoader, AuthError, SheetNotFoundError, FetchError } from '../src/index';

describe('SheetsLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── load ──────────────────────────────────────────────────────────────────

  it('loads values and caches them', async () => {
    const fakeRows = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue(fakeRows as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader({ cacheTTL: 1 });
    const got1 = await loader.load('sheet1', 'RANGE');
    const got2 = await loader.load('sheet1', 'RANGE');

    expect(got1).toEqual(fakeRows);
    expect(got2).toEqual(fakeRows);
    expect(fetcher.fetchValues).toHaveBeenCalledTimes(1);
  });

  it('uses explicitAuthClient and skips getAuthClient', async () => {
    const fakeClient = {} as unknown as import('google-auth-library').OAuth2Client;
    vi.spyOn(auth, 'getAuthClient');
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue([['v']] as unknown as string[][]);

    const loader = new SheetsLoader({ authClient: fakeClient });
    await loader.load('sheet1', 'RANGE');

    expect(auth.getAuthClient).not.toHaveBeenCalled();
    expect(fetcher.fetchValues).toHaveBeenCalledWith(fakeClient, 'sheet1', 'RANGE');
  });

  it('different sheet+range combinations are cached independently', async () => {
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);
    vi.spyOn(fetcher, 'fetchValues')
      .mockResolvedValueOnce([['r1']] as unknown as string[][])
      .mockResolvedValueOnce([['r2']] as unknown as string[][]);

    const loader = new SheetsLoader();
    const a = await loader.load('sheet1', 'A1:B1');
    const b = await loader.load('sheet1', 'C1:D1');

    expect(a).toEqual([['r1']]);
    expect(b).toEqual([['r2']]);
    expect(fetcher.fetchValues).toHaveBeenCalledTimes(2);
  });

  // ── loadAndMap ────────────────────────────────────────────────────────────

  it('maps rows with mapper', async () => {
    const fakeRows = [
      ['x', '1'],
      ['y', '2'],
    ];
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue(fakeRows as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader();
    const mapped = await loader.loadAndMap('sheetA', 'RANGE', (r) => ({ k: r[0], v: r[1] }));

    expect(mapped).toEqual([
      { k: 'x', v: '1' },
      { k: 'y', v: '2' },
    ]);
  });

  // ── loadWithHeaders ───────────────────────────────────────────────────────

  it('loadWithHeaders keys rows by first-row headers', async () => {
    const fakeRows = [
      ['Name', 'Email', 'Age'],
      ['Alice', 'alice@example.com', '30'],
      ['Bob', 'bob@example.com', '25'],
    ];
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue(fakeRows as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader();
    const rows = await loader.loadWithHeaders('sheet1', 'RANGE');

    expect(rows).toEqual([
      { Name: 'Alice', Email: 'alice@example.com', Age: '30' },
      { Name: 'Bob', Email: 'bob@example.com', Age: '25' },
    ]);
  });

  it('loadWithHeaders returns empty array when sheet is empty', async () => {
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue([] as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader();
    const rows = await loader.loadWithHeaders('sheet1', 'RANGE');

    expect(rows).toEqual([]);
  });

  it('loadWithHeaders skips empty header cells', async () => {
    const fakeRows = [
      ['Name', '', 'Age'],
      ['Alice', 'extra', '30'],
    ];
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue(fakeRows as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader();
    const [row] = await loader.loadWithHeaders('sheet1', 'RANGE');

    expect(Object.keys(row)).not.toContain('');
    expect(row).toHaveProperty('Name', 'Alice');
    expect(row).toHaveProperty('Age', '30');
  });

  it('loadWithHeaders fills missing trailing cells with empty string', async () => {
    const fakeRows = [['A', 'B', 'C'], ['only-a']];
    vi.spyOn(fetcher, 'fetchValues').mockResolvedValue(fakeRows as unknown as string[][]);
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);

    const loader = new SheetsLoader();
    const [row] = await loader.loadWithHeaders('sheet1', 'RANGE');

    expect(row).toEqual({ A: 'only-a', B: '', C: '' });
  });

  // ── error handling ────────────────────────────────────────────────────────

  it('wraps auth failure in AuthError', async () => {
    vi.spyOn(auth, 'getAuthClient').mockRejectedValue(new Error('bad creds'));

    const loader = new SheetsLoader();
    await expect(loader.load('sheet1', 'RANGE')).rejects.toBeInstanceOf(AuthError);
  });

  it('rethrows SheetNotFoundError', async () => {
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);
    vi.spyOn(fetcher, 'fetchValues').mockRejectedValue(new SheetNotFoundError('sheet1'));

    const loader = new SheetsLoader();
    await expect(loader.load('sheet1', 'RANGE')).rejects.toBeInstanceOf(SheetNotFoundError);
  });

  it('wraps fetch failure in FetchError', async () => {
    vi.spyOn(auth, 'getAuthClient').mockResolvedValue(null as unknown);
    vi.spyOn(fetcher, 'fetchValues').mockRejectedValue(new FetchError('timeout'));

    const loader = new SheetsLoader();
    await expect(loader.load('sheet1', 'RANGE')).rejects.toBeInstanceOf(FetchError);
  });
});
