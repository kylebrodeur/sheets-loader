import NodeCache from 'node-cache';

export class SimpleCache {
  private cache: NodeCache;

  constructor(ttlSeconds = 300) {
    this.cache = new NodeCache({ stdTTL: ttlSeconds });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set<T>(key: string, value: T, ttl?: number) {
    if (ttl === undefined) {
      return this.cache.set(key, value);
    }
    return this.cache.set(key, value, ttl);
  }

  del(key: string) {
    return this.cache.del(key);
  }
}

export function makeCacheKey(sheetId: string, range: string) {
  return `${sheetId}::${range}`;
}
