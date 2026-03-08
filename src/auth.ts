import fs from 'fs/promises';
import { GoogleAuth, JWT, OAuth2Client } from 'google-auth-library';

export type AuthConfig = {
  /**
   * Path to credentials JSON file or the parsed credentials object.
   * For service accounts use { client_email, private_key }.
   * For OAuth2 client credential flow use { client_id, client_secret, refresh_token?, access_token? }.
   */
  credentials?: Record<string, unknown> | string;
  scopes?: string[];
};

export async function getAuthClient(config?: AuthConfig): Promise<JWT | OAuth2Client> {
  const scopes = config?.scopes ?? ['https://www.googleapis.com/auth/spreadsheets.readonly'];

  let creds: unknown = config?.credentials;
  if (typeof creds === 'string') {
    const raw = await fs.readFile(creds, { encoding: 'utf8' });
    creds = JSON.parse(raw);
  }

  try {
    // service account (JWT)
    const sa = creds as { client_email?: string; private_key?: string } | undefined;
    if (sa && sa.client_email && sa.private_key) {
      const jwt = new JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes,
      } as unknown as Record<string, unknown>);
      return jwt;
    }

    // OAuth2 credential object (client + refresh_token/access_token)
    const oa = creds as { client_id?: string; client_secret?: string; refresh_token?: string; access_token?: string } | undefined;
    if (oa && oa.client_id && oa.client_secret) {
      const o2 = new OAuth2Client(oa.client_id, oa.client_secret);
      if (oa.refresh_token || oa.access_token) {
        const token: Record<string, unknown> = {};
        if (oa.refresh_token) token.refresh_token = oa.refresh_token;
        if (oa.access_token) token.access_token = oa.access_token;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (o2 as any).setCredentials(token);
      }
      return o2;
    }

    // Fallback to application default credentials via GoogleAuth
    const ga = new GoogleAuth({
      credentials: creds as Record<string, unknown> | undefined,
      scopes,
    });
    return (await ga.getClient()) as JWT | OAuth2Client;
  } catch (err: unknown) {
    throw new Error('Failed to create auth client', { cause: err as Error });
  }
}
