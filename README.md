# @kylebrodeur/sheets-loader

[![npm version](https://img.shields.io/npm/v/@kylebrodeur/sheets-loader)](https://www.npmjs.com/package/@kylebrodeur/sheets-loader)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Lightweight TypeScript library for loading and caching data from Google Sheets. Supports both service account (server-to-server) and OAuth2 (user credentials) authentication.

## Installation

```bash
npm install @kylebrodeur/sheets-loader
# or
pnpm add @kylebrodeur/sheets-loader
```

## Quick Start

```ts
import { SheetsLoader } from '@kylebrodeur/sheets-loader';

// Service account (server-to-server)
const loader = new SheetsLoader({
  auth: {
    credentials: {
      client_email: process.env.SA_EMAIL,
      private_key: process.env.SA_KEY,
    },
  },
});

const rows = await loader.load('YOUR_SPREADSHEET_ID', 'Sheet1!A1:B10');
console.log(rows); // string[][]
```

## Authentication

### Service Account

Best for server-side, automated workflows. Create a service account in the Google Cloud Console, share the sheet with the service account email, and pass the credentials:

```ts
const loader = new SheetsLoader({
  auth: {
    credentials: {
      client_email: process.env.SA_EMAIL,
      private_key: process.env.SA_KEY,
    },
  },
});
```

You can also pass a path to a credentials JSON file:

```ts
const loader = new SheetsLoader({
  auth: { credentials: './service-account.json' },
});
```

### OAuth2 (User Credentials)

For apps where users authorize access to their own sheets:

```ts
import { OAuth2Client } from 'google-auth-library';
import { SheetsLoader } from '@kylebrodeur/sheets-loader';

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI,
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const loader = new SheetsLoader({ authClient: oAuth2Client });
const rows = await loader.load('SPREADSHEET_ID', 'Sheet1!A1:C100');
```

#### Full Authorization Code Flow

```ts
// 1. Generate a consent URL for the user
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
console.log('Authorize this app:', authUrl);

// 2. Exchange the code the user pastes back
const { tokens } = await oAuth2Client.getToken(code);
oAuth2Client.setCredentials(tokens);
// Persist tokens securely — never commit them to source control

// 3. Use the client
const loader = new SheetsLoader({ authClient: oAuth2Client });
```

See [examples/oauth-flow.ts](examples/oauth-flow.ts) for a complete runnable example.

## API

### `new SheetsLoader(config?)`

| Option | Type | Description |
|--------|------|-------------|
| `auth` | `AuthConfig` | Auth credentials or file path |
| `authClient` | `JWT \| OAuth2Client` | Pre-built auth client (takes precedence over `auth`) |
| `cacheTTL` | `number` | Cache TTL in seconds (default: `300`) |

### `loader.load(sheetId, range): Promise<string[][]>`

Fetches values for the given range. Results are cached for `cacheTTL` seconds.

### `loader.loadAndMap<T>(sheetId, range, mapper): Promise<T[]>`

Fetches values and maps each row through a mapper function:

```ts
type Product = { id: string; name: string; price: number };

const products = await loader.loadAndMap(
  'SPREADSHEET_ID',
  'Products!A2:C100',
  (row): Product => ({
    id: row[0],
    name: row[1] || 'Unknown',
    price: parseFloat(row[2]) || 0,
  }),
);
```

## Error Handling

```ts
import { AuthError, SheetNotFoundError, FetchError } from '@kylebrodeur/sheets-loader';

try {
  const rows = await loader.load(sheetId, range);
} catch (err) {
  if (err instanceof AuthError) { /* bad credentials */ }
  if (err instanceof SheetNotFoundError) { /* sheet ID not found */ }
  if (err instanceof FetchError) { /* network / API error */ }
}
```

## Type-Safe Column Mapping

`sheets-loader` ships with `MappedSheetsLoader`, which integrates [`@kylebrodeur/type-safe-mapping`](https://github.com/kylebrodeur/type-safe-mapping) to rename sheet column headers to your internal model fields with full TypeScript inference — no manual string indexing.

```ts
import { SheetsLoader, MappedSheetsLoader } from '@kylebrodeur/sheets-loader';
import type { MappingDefinition } from '@kylebrodeur/type-safe-mapping';

// Match your sheet headers exactly
type ProductRow = { 'Product ID': string; 'Product Name': string; 'Unit Price': string };

const mapping = {
  'Product ID':   'id',
  'Product Name': 'name',
  'Unit Price':   'unitPrice',
} as const satisfies MappingDefinition<ProductRow>;

class ProductLoader extends MappedSheetsLoader<ProductRow, typeof mapping> {
  protected fieldMapping = mapping;
}

const loader = new ProductLoader(new SheetsLoader({ auth: { credentials: './sa.json' } }));

// products: { id: string; name: string; unitPrice: string }[]
const products = await loader.loadMapped('SPREADSHEET_ID', 'Products!A1:C500');
```

See [`examples/mapped-loader.ts`](examples/mapped-loader.ts) for the full runnable example.

## Examples

See the [`examples/`](examples/) directory for runnable TypeScript scripts:

- [`mapped-loader.ts`](examples/mapped-loader.ts) — type-safe column renaming with `MappedSheetsLoader`

## Testing

```bash
pnpm test
```

Unit tests mock `getAuthClient` and `fetchValues` to avoid real network calls. Coverage includes caching behavior, retry logic, and all error types.

## License

MIT
