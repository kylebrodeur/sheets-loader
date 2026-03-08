import { describe, it, expect } from 'vitest';
import { makeCacheKey } from '../src/cache';

describe('cache key', () => {
  it('builds stable key from sheetId and range', () => {
    const key = makeCacheKey('sheet123', 'Sheet1!A1:B2');
    expect(key).toBe('sheet123::Sheet1!A1:B2');
  });
});
