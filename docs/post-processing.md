# Post-processing Sheets Rows

Small examples for converting raw `string[][]` rows into typed objects and doing simple validation/filtering.

Example: convert rows into typed objects and filter invalid rows

```ts
type Person = { name: string; email: string; age?: number };

function rowsToPeople(rows: string[][]): Person[] {
  return rows
    .map(r => ({ name: r[0]?.trim() || '', email: r[1]?.trim() || '', age: r[2] ? Number(r[2]) : undefined }))
    .filter(p => p.name && p.email && /@/.test(p.email));
}

// usage
// const rows = await loader.load(sheetId, 'Sheet1!A2:C100');
// const people = rowsToPeople(rows);
```

Notes:
- Validate and sanitize fields before trusting them in downstream systems.
- Use a lightweight validator (zod, Joi) when you need stronger type guarantees.
