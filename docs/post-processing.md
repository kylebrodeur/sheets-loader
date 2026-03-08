# Post-processing Sheets Rows

Small examples for converting loaded sheet data into typed objects.

## Preferred: `loadWithHeaders` + `MappedSheetsLoader`

For sheets with header rows, prefer `loadWithHeaders()` over positional `load()` so
column reorders don't silently break your mapping. Pair with `MappedSheetsLoader`
from `@kylebrodeur/type-safe-mapping` to rename columns to your model fields with
full type inference:

```ts
import { SheetsLoader, MappedSheetsLoader } from '@kylebrodeur/sheets-loader';
import type { MappingDefinition } from '@kylebrodeur/type-safe-mapping';

type PersonRow = { Name: string; Email: string; Age: string; [key: string]: string };

const mapping = { Name: 'name', Email: 'email', Age: 'age' } as const satisfies MappingDefinition<PersonRow>;

class PersonLoader extends MappedSheetsLoader<PersonRow, typeof mapping> {
  protected fieldMapping = mapping;
}

const raw = await new PersonLoader(loader).loadMapped(sheetId, 'Sheet1!A1:C100');
// raw: { name: string; email: string; age: string }[]

// Coerce types after renaming
const people = raw
  .map(r => ({ name: r.name.trim(), email: r.email.trim(), age: r.age ? Number(r.age) : undefined }))
  .filter(p => p.name && /@/.test(p.email));
```

## Manual: `load` with positional mapper

Still useful when there is no header row, or for simple one-off scripts:

```ts
type Person = { name: string; email: string; age?: number };

function rowsToPeople(rows: string[][]): Person[] {
  return rows
    .map(r => ({ name: r[0]?.trim() || '', email: r[1]?.trim() || '', age: r[2] ? Number(r[2]) : undefined }))
    .filter(p => p.name && p.email && /@/.test(p.email));
}

// const rows = await loader.load(sheetId, 'Sheet1!A2:C100'); // skip header row manually
// const people = rowsToPeople(rows);
```

Notes:
- Validate and sanitize fields before trusting them in downstream systems.
- Use a lightweight validator (zod, Joi) when you need stronger runtime type guarantees.
