# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-09-03

### Changed

- **Breaking:** `MetadataTaggedSheetsClient` / `createMetadataTaggedSheetsClient` are now
  strictly metadata-only. Column resolution requires pre-existing column-level developer
  metadata with key `${tagPrefix}${key}` for every configured logical key, for reads and
  writes alike. The header-name fallback, positional assignment of new columns, and the
  self-healing auto-tag writes (`createDeveloperMetadata` / header backfill) are removed
  entirely - when any configured key is untagged, the client throws `SheetConfigError` naming
  ALL missing metadata keys and never mutates the sheet.
- **Breaking:** `SheetColumnDefinition` is now just `{ key: string }`; the `header` display
  label is gone. Appending to an empty but pre-tagged sheet appends data rows only (no
  synthesized header row).
- Added exported `MetadataTaggedSheetsClientLike` interface naming the factory's return type.

## [0.3.0] - 2026-09-01

### Changed

- **Breaking:** `updateRow`'s signature changed from `(spreadsheetId, sheetName, matchKey,
  matchValue, updates)` to `(spreadsheetId, sheetName, match, updates)`, where `match` is a
  `Record<string, string>` of one or more column keys to values, ALL of which must match
  (AND semantics) for a row to be updated. A single-column match is just a one-entry object.
  This exists because a single match column can be ambiguous - e.g. several rows sharing one
  order id - where a second, more selective column (present on only the intended row) removes
  the ambiguity without depending on physical row order. Throws `SheetConfigError` for an
  empty `match` object.

## [0.2.1] - 2026-08-31

### Fixed

- `updateRow` and `appendDedup` now normalize cell values (trim + lowercase) before comparing them
  for row matching and dedupe. Previously an exact `===` compare meant a stray `\r`, trailing
  whitespace, or a casing difference in a stored cell (both routine copy-paste artifacts in Google
  Sheets) would silently defeat a match, causing writes to no-op with no error. Normalization is
  applied only for comparison — it never changes a value actually written to a cell.

## [0.2.0] - 2026-08-14

### Added

- `MetadataTaggedSheetsClient` (and the lower-level `createMetadataTaggedSheetsClient` factory): a
  rename/reorder-proof Sheets client that resolves columns via a caller-supplied developer-metadata
  tag prefix first, falling back to header-name matching, and self-heals by tagging
  header-resolved/new columns going forward. Read (`loadWithHeaders`) satisfies `SheetSource`, so it
  composes directly with the existing `MappedSheetsLoader`. Write support: `appendDedup` (append
  with dedupe on one or more columns) and `updateRow` (update specific cells in an already-matched
  row).
- `SheetConfigError` for caller misconfiguration (an unknown dedupe/match/update column key).

## [0.1.1] - 2026-07-21

### Fixed

- Preserve the generated Google Sheets `values.get` resource receiver when fetching values, avoiding Google API context errors.

## [0.1.0] - 2026-03-08

### Added

- Initial release
- `SheetsLoader` class for loading rows from Google Sheets via the Sheets API v4
- `loadWithHeaders()` for returning rows keyed by the first-row header values
- `MappedSheetsLoader` abstract class for type-safe column renaming using `@kylebrodeur/type-safe-mapping`
- Service-account (JWT) and OAuth2 authentication support via `google-auth-library`
- `SimpleCache` for in-process caching of sheet responses (`node-cache`)
- `getAuthClient` helper for constructing authenticated `JWT` or `OAuth2Client` instances
- `fetchValues` low-level helper for direct Sheets API requests
- Comprehensive error hierarchy (`SheetsLoaderError`, `AuthError`, `FetchError`, `ParseError`)
- Full TypeScript strict-mode types and exported type declarations

[0.2.0]: https://github.com/kylebrodeur/sheets-loader/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/kylebrodeur/sheets-loader/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kylebrodeur/sheets-loader/releases/tag/v0.1.0
