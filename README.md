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
import { SheetsLoader } from "@kylebrodeur/sheets-loader";

// Service account (server-to-server)
const loader = new SheetsLoader({
  auth: {
    credentials: {
      client_email: process.env.SA_EMAIL,
      private_key: process.env.SA_KEY,
    },
  },
});

const rows = await loader.load("YOUR_SPREADSHEET_ID", "Sheet1!A1:B10");
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
  auth: { credentials: "./service-account.json" },
});
```

### OAuth2 (User Credentials)

For apps where users authorize access to their own sheets:

```ts
import { OAuth2Client } from "google-auth-library";
import { SheetsLoader } from "@kylebrodeur/sheets-loader";

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI,
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const loader = new SheetsLoader({ authClient: oAuth2Client });
const rows = await loader.load("SPREADSHEET_ID", "Sheet1!A1:C100");
```

#### Full Authorization Code Flow

```ts
// 1. Generate a consent URL for the user
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
console.log("Authorize this app:", authUrl);

// 2. Exchange the code the user pastes back
const { tokens } = await oAuth2Client.getToken(code);
oAuth2Client.setCredentials(tokens);
// Persist tokens securely — never commit them to source control

// 3. Use the client
const loader = new SheetsLoader({ authClient: oAuth2Client });
```

See [docs/oauth.md](docs/oauth.md) for endpoint details and token persistence guidance.

## API

### `new SheetsLoader(config?)`

| Option       | Type                  | Description                                          |
| ------------ | --------------------- | ---------------------------------------------------- |
| `auth`       | `AuthConfig`          | Auth credentials or file path                        |
| `authClient` | `JWT \| OAuth2Client` | Pre-built auth client (takes precedence over `auth`) |
| `cacheTTL`   | `number`              | Cache TTL in seconds (default: `300`)                |

### `loader.load(sheetId, range): Promise<string[][]>`

Fetches values for the given range. Results are cached for `cacheTTL` seconds.

### `loader.loadWithHeaders(sheetId, range): Promise<Record<string, string>[]>`

Like `load()`, but treats the first row as column headers and returns an array of objects keyed by those headers. Empty header cells are skipped.

```ts
const rows = await loader.loadWithHeaders("SPREADSHEET_ID", "Sheet1!A1:C100");
// rows[0] → { 'First Name': 'Alice', 'Email': 'alice@example.com', 'Age': '30' }
```

### `loader.loadAndMap<T>(sheetId, range, mapper): Promise<T[]>`

Fetches values and maps each row through a mapper function:

```ts
type Product = { id: string; name: string; price: number };

const products = await loader.loadAndMap(
  "SPREADSHEET_ID",
  "Products!A2:C100",
  (row): Product => ({
    id: row[0],
    name: row[1] || "Unknown",
    price: parseFloat(row[2]) || 0,
  }),
);
```

## Error Handling

```ts
import {
  AuthError,
  SheetNotFoundError,
  FetchError,
} from "@kylebrodeur/sheets-loader";

try {
  const rows = await loader.load(sheetId, range);
} catch (err) {
  if (err instanceof AuthError) {
    /* bad credentials */
  }
  if (err instanceof SheetNotFoundError) {
    /* sheet ID not found */
  }
  if (err instanceof FetchError) {
    /* network / API error */
  }
}
```

## Type-Safe Column Mapping

`sheets-loader` ships with `MappedSheetsLoader`, which integrates [`@kylebrodeur/type-safe-mapping`](https://github.com/kylebrodeur/type-safe-mapping) to rename sheet column headers to your internal model fields with full TypeScript inference — no manual string indexing.

```ts
import { SheetsLoader, MappedSheetsLoader } from "@kylebrodeur/sheets-loader";
import type { MappingDefinition } from "@kylebrodeur/type-safe-mapping";

// TSource must include an index signature because mapped field names
// (e.g. 'id') must also satisfy keyof TSource at the type level.
type ProductRow = {
  "Product ID": string;
  "Product Name": string;
  "Unit Price": string;
  [key: string]: string;
};

const mapping = {
  "Product ID": "id",
  "Product Name": "name",
  "Unit Price": "unitPrice",
} as const satisfies MappingDefinition<ProductRow>;

class ProductLoader extends MappedSheetsLoader<ProductRow, typeof mapping> {
  protected fieldMapping = mapping;
}

const loader = new ProductLoader(
  new SheetsLoader({ auth: { credentials: "./sa.json" } }),
);

// products: { id: string; name: string; unitPrice: string }[]
const products = await loader.loadMapped("SPREADSHEET_ID", "Products!A1:C500");
```

See [`examples/mapped-loader.ts`](examples/mapped-loader.ts) for the full runnable example.

## Rename/Reorder-Proof Columns (Metadata Tagging)

`MappedSheetsLoader` (above) renames columns by matching literal header text — fragile if someone
renames or reorders a column in the sheet. `MetadataTaggedSheetsClient` resolves columns by a
Google Sheets column-level [developer metadata](https://developers.google.com/sheets/api/guides/metadata)
tag, and ONLY by that tag: every configured logical key must already exist as column-level
developer metadata with key `${tagPrefix}${key}` on the sheet, for reads and writes alike. There
is no header-name fallback, no positional mapping, and no auto-tagging or migration write — if any
configured key is untagged, the client throws `SheetConfigError` naming all missing metadata keys
and leaves the sheet untouched. Tag the columns up front (e.g. one-off via the Sheets API's
`createDeveloperMetadata`, or an admin script), then use the client for reads and writes: append
rows with dedupe, and update specific cells in an already-matched row.

```ts
import { MetadataTaggedSheetsClient } from "@kylebrodeur/sheets-loader";

const client = new MetadataTaggedSheetsClient({
  auth: { credentials: "./sa.json" },
  tagPrefix: "myapp:", // your own namespace, so unrelated tools don't collide
  columns: [
    { key: "cohortId" },        // requires existing "myapp:cohortId" column metadata
    { key: "intellumPathId" },  // requires existing "myapp:intellumPathId" column metadata
  ],
});

// Read — satisfies SheetSource, so it plugs directly into MappedSheetsLoader
// for typed field mapping on top, if you want it.
const rows = await client.loadWithHeaders("SPREADSHEET_ID", "CohortIndex!A1:Z100");
// rows: [{ cohortId: "aiAcceleratorMar2026", intellumPathId: "path-123" }, ...]

// Write — append new rows, skipping ones that match on the given key(s).
await client.appendDedup({
  spreadsheetId: "SPREADSHEET_ID",
  sheetName: "CohortIndex",
  dedupeColumns: ["cohortId"],
  rows: [{ cohortId: "aiAcceleratorMay2026", intellumPathId: "path-456" }],
});

// Write — update specific cells in the row matching a column's value.
await client.updateRow(
  "SPREADSHEET_ID",
  "CohortIndex",
  "cohortId",
  "aiAcceleratorMar2026",
  { intellumPathId: "path-123-updated" },
);
```

If you already have a `sheets_v4.Sheets` client (e.g. shared across services, or in tests), use the
lower-level `createMetadataTaggedSheetsClient(sheets, config)` function instead of the class — same
API, no auth handling.

## Examples

See the [`examples/`](examples/) directory for runnable TypeScript scripts:

- [`mapped-loader.ts`](examples/mapped-loader.ts) — type-safe column renaming with `MappedSheetsLoader`

See the [`docs/`](docs/) directory for deeper guides:

- [`docs/oauth.md`](docs/oauth.md) — OAuth2 authorization code flow and token management
- [`docs/post-processing.md`](docs/post-processing.md) — transforming and validating loaded rows

## Testing

```bash
pnpm test
```

Unit tests mock `getAuthClient`, `fetchValues`, and the generated Sheets API `values.get` resource to avoid real network calls. Coverage includes caching behavior, retry logic, generated resource receiver binding, and all error types.

## License

MIT
