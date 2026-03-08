# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/kylebrodeur/sheets-loader/releases/tag/v0.1.0
