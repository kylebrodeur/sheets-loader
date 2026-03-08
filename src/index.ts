import { getAuthClient, AuthConfig } from './auth';
import type { JWT, OAuth2Client } from 'google-auth-library';
import { fetchValues } from './fetcher';
import { SimpleCache, makeCacheKey } from './cache';
import { AuthError, FetchError, SheetNotFoundError } from './errors';

export type SheetsLoaderConfig = {
  auth?: AuthConfig;
  cacheTTL?: number;
  /**
   * Optional pre-constructed auth client. If provided, it will be used directly
   * and `auth` will be ignored. Accepts `JWT` (service account) or `OAuth2Client`.
   */
  authClient?: JWT | OAuth2Client;
};

export class SheetsLoader {
  private authConfig?: AuthConfig;
  private explicitAuthClient?: JWT | OAuth2Client | undefined;
  private cache: SimpleCache;

  constructor(config?: SheetsLoaderConfig) {
    this.authConfig = config?.auth;
    this.explicitAuthClient = config?.authClient;
    this.cache = new SimpleCache(config?.cacheTTL ?? 300);
  }

  async load(sheetId: string, range: string): Promise<string[][]> {
    const key = makeCacheKey(sheetId, range);
    const cached = this.cache.get<string[][]>(key);
    if (cached) return cached;

    let authClient: JWT | OAuth2Client | string | null | undefined;
    if (this.explicitAuthClient) {
      authClient = this.explicitAuthClient;
    } else {
      try {
        authClient = await getAuthClient(this.authConfig);
      } catch (err: unknown) {
        throw new AuthError((err as Error)?.message, {
          cause: err as Error,
        } as unknown as ErrorOptions);
      }
    }

    try {
      const rows = await fetchValues(authClient as JWT | OAuth2Client | string | null | undefined, sheetId, range);
      this.cache.set(key, rows);
      return rows;
    } catch (err: unknown) {
      if (err instanceof SheetNotFoundError) throw err;
      throw new FetchError((err as Error)?.message, {
        cause: err as Error,
      } as unknown as ErrorOptions);
    }
  }

  async loadAndMap<T>(sheetId: string, range: string, mapper: (row: string[]) => T): Promise<T[]> {
    const rows = await this.load(sheetId, range);
    return rows.map(mapper);
  }

  /**
   * Load a range where the first row is treated as column headers.
   * Returns an array of records keyed by the header values.
   *
   * Useful for pairing with a field-mapping library (e.g. @kylebrodeur/type-safe-mapping)
   * to rename sheet columns to your internal model keys.
   *
   * @example
   * const rows = await loader.loadWithHeaders('SHEET_ID', 'Sheet1!A1:C100');
   * // rows[0] → { 'First Name': 'Alice', 'Email': 'alice@example.com', 'Age': '30' }
   */
  async loadWithHeaders(
    sheetId: string,
    range: string,
  ): Promise<Record<string, string>[]> {
    const [headerRow, ...dataRows] = await this.load(sheetId, range);
    if (!headerRow) return [];
    return dataRows.map((row) =>
      Object.fromEntries(headerRow.map((header, i) => [header, row[i] ?? ''])),
    );
  }
}

export { getAuthClient } from './auth';
export { fetchValues } from './fetcher';
export { SimpleCache } from './cache';
export { AuthError, SheetNotFoundError, FetchError } from './errors';
export { MappedSheetsLoader } from './MappedSheetsLoader';
export type { SheetSource } from './MappedSheetsLoader';
