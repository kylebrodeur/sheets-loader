import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import * as fetcher from '../src/fetcher';
import * as auth from '../src/auth';
import { SheetsLoader } from '../src/index';

describe('SheetsLoader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
    // fetchValues should be called only once due to caching
    expect(fetcher.fetchValues).toHaveBeenCalledTimes(1);
  });

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
});
