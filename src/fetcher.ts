import { google } from 'googleapis';
import type { JWT, OAuth2Client } from 'google-auth-library';
import { SheetNotFoundError, FetchError } from './errors';

type AuthClient = JWT | OAuth2Client | string | null | undefined;

export async function fetchValues(
  authClient: AuthClient,
  sheetId: string,
  range: string,
  options?: { retries?: number },
): Promise<string[][]> {
  const maxRetries = options?.retries ?? 3;
  const client = google.sheets({
    version: 'v4',
    auth: authClient as unknown as JWT | OAuth2Client,
  });

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxRetries) {
    try {
      const getFn = (client.spreadsheets.values.get as unknown) as (
        params: { spreadsheetId: string; range: string },
      ) => Promise<any>;

      const res: any = await getFn({ spreadsheetId: sheetId, range });

      if (!res || !res.data) return [];
      return (res.data.values as string[][]) || [];
    } catch (err: unknown) {
      lastErr = err;
      const e = err as { code?: number };
      if (e.code === 404) {
        throw new SheetNotFoundError(sheetId);
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }

  throw new FetchError(String(lastErr ?? 'unknown'));
}
