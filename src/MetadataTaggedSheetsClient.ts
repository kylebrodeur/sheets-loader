import { google, sheets_v4 } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";
import { getAuthClient, type AuthConfig } from "./auth.js";
import { AuthError, SheetConfigError, SheetNotFoundError } from "./errors.js";
import type { SheetSource } from "./MappedSheetsLoader.js";

/**
 * `key` is the stable logical identity used in the metadata tag, row records,
 * and dedupe/match configuration. The sheet must already carry column-level
 * developer metadata with key `${tagPrefix}${key}` for every configured
 * column; there is no header fallback, no positional mapping, and no
 * auto-tagging or migration write of any kind.
 */
export interface SheetColumnDefinition {
  key: string;
}

export interface MetadataTaggedSheetsClientConfig {
  /** Ordered column definitions; write order (append) follows this array. */
  columns: readonly SheetColumnDefinition[];
  /**
   * Developer-metadata key prefix, e.g. `"uofd:"`. A column's metadata key is
   * `${tagPrefix}${key}`. Callers own this value so unrelated consumers of
   * the same spreadsheet don't collide.
   */
  tagPrefix: string;
}

export interface SheetsAppendDedupInput {
  spreadsheetId: string;
  sheetName: string;
  /** Logical `key`s used to build the dedupe key, e.g. ["meetingId", "email"]. */
  dedupeColumns: string[];
  /** Each row keyed by logical column `key`; missing keys write as "". */
  rows: Record<string, string>[];
}

export interface AppendDedupResult {
  appended: number;
  skipped: number;
}

export interface UpdateRowResult {
  updated: boolean;
}

// ── A1 helpers ────────────────────────────────────────────────────────────

function quotedSheetName(sheetName: string): string {
  return `'${sheetName.replaceAll("'", "''")}'`;
}

function a1Range(sheetName: string, a1: string): string {
  return `${quotedSheetName(sheetName)}!${a1}`;
}

/** 0-based physical column index -> A1 column letters (0 -> A, 26 -> AA). */
function columnToA1(index: number): string {
  let result = "";
  let n = index + 1;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Normalizes a cell value for equality comparisons only (matching/dedupe) -
 * never applied to a value actually written to a cell. Google Sheets rows
 * routinely carry copy-paste artifacts (trailing `\r`, stray whitespace,
 * inconsistent casing on emails) that must not defeat a match.
 */
function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

const GRID_FIELDS =
  "sheets.properties(title,sheetId),sheets.data(startColumn,rowData(values(formattedValue)),columnMetadata(developerMetadata(metadataKey)))";

interface CellDataLike {
  formattedValue?: string | null | undefined;
}

interface ResolvedColumn {
  key: string;
  physicalIndex: number;
}

interface ResolvedSheetGrid {
  resolvedColumns: ResolvedColumn[];
  dataRowsByPhysicalIndex: Map<number, string>[];
}

/**
 * Fetches `sheetName`'s grid and resolves every configured logical column to
 * a physical index using column-level developer metadata ONLY: a column is
 * resolved iff `sheets.data[].columnMetadata[]` carries a metadata entry with
 * key `${tagPrefix}${logicalKey}`. Header names and physical position never
 * participate in resolution.
 *
 * Every configured logical key must resolve; otherwise a single
 * `SheetConfigError` is thrown naming ALL missing metadata keys, and no
 * mutation of the sheet is attempted. This is the one resolution algorithm
 * shared by reads and writes, so a column read under one logical key is
 * always the same one written back to.
 */
async function resolveSheetGrid(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  columns: readonly SheetColumnDefinition[],
  tagPrefix: string,
): Promise<ResolvedSheetGrid> {
  const spreadsheetRes = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [a1Range(sheetName, "A1:ZZ")],
    includeGridData: true,
    fields: GRID_FIELDS,
  });

  const sheet = spreadsheetRes.data.sheets?.find(
    (s) => s.properties?.title === sheetName,
  );
  if (!sheet) {
    throw new SheetNotFoundError(`${spreadsheetId} (tab "${sheetName}")`);
  }

  const gridData = sheet.data?.[0];
  const startColumn = gridData?.startColumn ?? 0;
  const columnMeta = gridData?.columnMetadata ?? [];
  const rowData = gridData?.rowData ?? [];

  // Row 1 is the display header row by convention (never used for column
  // resolution); data starts on row 2.
  const dataRowsByPhysicalIndex = rowData
    .slice(1)
    .map((row: { values?: CellDataLike[] | undefined }) => {
      const map = new Map<number, string>();
      const values = row.values as CellDataLike[] | undefined;
      if (values) {
        for (let i = 0; i < values.length; i++) {
          map.set(
            startColumn + i,
            (values[i]?.formattedValue ?? "").toString(),
          );
        }
      }
      return map;
    });

  const logicalKeyByPhysicalIndex = new Map<number, string>();
  for (let i = 0; i < columnMeta.length; i++) {
    const physicalIndex = startColumn + i;
    const metas = columnMeta[i]?.developerMetadata ?? [];
    for (const meta of metas) {
      const key = meta.metadataKey;
      if (!key?.startsWith(tagPrefix)) continue;
      logicalKeyByPhysicalIndex.set(physicalIndex, key.slice(tagPrefix.length));
    }
  }

  const missingKeys: string[] = [];
  const resolvedColumns: ResolvedColumn[] = [];
  for (const def of columns) {
    let physicalIndex: number | undefined;
    for (const [idx, key] of logicalKeyByPhysicalIndex.entries()) {
      if (key === def.key) {
        physicalIndex = idx;
        break;
      }
    }
    if (physicalIndex == null) {
      missingKeys.push(def.key);
    } else {
      resolvedColumns.push({ key: def.key, physicalIndex });
    }
  }

  if (missingKeys.length > 0) {
    const missing = missingKeys.map((key) => `"${tagPrefix}${key}"`);
    throw new SheetConfigError(
      `Sheet "${sheetName}" (${spreadsheetId}) is missing required column developer metadata ${missing.join(
        ", ",
      )}. Tag each column with developer metadata before reading or writing; this client never resolves columns by header name or position and never writes metadata itself.`,
    );
  }

  return { resolvedColumns, dataRowsByPhysicalIndex };
}

/**
 * The metadata-tagged client contract: `SheetSource` reads plus `appendDedup`
 * / `updateRow` writes over the same metadata-resolved columns.
 */
export interface MetadataTaggedSheetsClientLike extends SheetSource {
  appendDedup(input: SheetsAppendDedupInput): Promise<AppendDedupResult>;
  updateRow(
    spreadsheetId: string,
    sheetName: string,
    match: Record<string, string>,
    updates: Record<string, string>,
  ): Promise<UpdateRowResult>;
}

/**
 * A strictly metadata-tagged Google Sheets client.
 *
 * Reads (`loadWithHeaders`) satisfy `SheetSource`, so an instance plugs
 * directly into `MappedSheetsLoader` for typed field mapping. Writes
 * (`appendDedup`, `updateRow`) use the same column resolution, so a column
 * read under one logical key is always the column written back to.
 *
 * Every configured logical key requires pre-existing column developer
 * metadata `${tagPrefix}${key}`; missing metadata is a hard error naming all
 * missing keys, with no header fallback and no auto-tagging write.
 */
export function createMetadataTaggedSheetsClient(
  sheets: sheets_v4.Sheets,
  config: MetadataTaggedSheetsClientConfig,
): MetadataTaggedSheetsClientLike {
  const { columns, tagPrefix } = config;

  function requireColumn(key: string): void {
    if (!columns.some((c) => c.key === key)) {
      throw new SheetConfigError(
        `Column "${key}" is not defined in the configured columns.`,
      );
    }
  }

  return {
    async loadWithHeaders(spreadsheetId, range) {
      const sheetName =
        range
          .split("!")[0]
          ?.replace(/^'(.*)'$/, "$1")
          .replaceAll("''", "'") ?? range;
      const { resolvedColumns, dataRowsByPhysicalIndex } =
        await resolveSheetGrid(
          sheets,
          spreadsheetId,
          sheetName,
          columns,
          tagPrefix,
        );

      return dataRowsByPhysicalIndex.map((row) => {
        const record: Record<string, string> = {};
        for (const col of resolvedColumns) {
          record[col.key] = row.get(col.physicalIndex) ?? "";
        }
        return record;
      });
    },

    async appendDedup(
      input: SheetsAppendDedupInput,
    ): Promise<AppendDedupResult> {
      for (const key of input.dedupeColumns) requireColumn(key);

      const { resolvedColumns, dataRowsByPhysicalIndex } =
        await resolveSheetGrid(
          sheets,
          input.spreadsheetId,
          input.sheetName,
          columns,
          tagPrefix,
        );

      const dedupeIndexes = input.dedupeColumns.map((key) => {
        const col = resolvedColumns.find((c) => c.key === key)!;
        return col.physicalIndex;
      });

      const seenKeys = new Set<string>();
      for (const row of dataRowsByPhysicalIndex) {
        seenKeys.add(
          JSON.stringify(
            dedupeIndexes.map((idx) => normalizeForMatch(row.get(idx) ?? "")),
          ),
        );
      }

      const toAppend: string[][] = [];
      let skipped = 0;
      for (const row of input.rows) {
        const key = JSON.stringify(
          input.dedupeColumns.map((k) => normalizeForMatch(row[k] ?? "")),
        );
        if (seenKeys.has(key)) {
          skipped++;
          continue;
        }
        seenKeys.add(key);

        const maxIndex = Math.max(
          0,
          ...resolvedColumns.map((c) => c.physicalIndex),
        );
        const physicalRow = new Array(maxIndex + 1).fill("");
        for (const col of resolvedColumns) {
          physicalRow[col.physicalIndex] = row[col.key] ?? "";
        }
        toAppend.push(physicalRow);
      }

      if (toAppend.length === 0) {
        return { appended: 0, skipped };
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range: a1Range(input.sheetName, "A1"),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: toAppend },
      });

      return { appended: toAppend.length, skipped };
    },

    async updateRow(
      spreadsheetId: string,
      sheetName: string,
      match: Record<string, string>,
      updates: Record<string, string>,
    ): Promise<UpdateRowResult> {
      const matchKeys = Object.keys(match);
      if (matchKeys.length === 0) {
        throw new SheetConfigError(
          "updateRow requires at least one match column.",
        );
      }
      for (const key of matchKeys) requireColumn(key);
      for (const key of Object.keys(updates)) requireColumn(key);

      const { resolvedColumns, dataRowsByPhysicalIndex } =
        await resolveSheetGrid(
          sheets,
          spreadsheetId,
          sheetName,
          columns,
          tagPrefix,
        );

      // Every match column must equal (AND semantics) - a single-column match
      // is just this with one entry. Compound matches exist because some
      // columns (e.g. a shared order id) are ambiguous alone: several rows
      // from the same order can share it, so a second, more selective column
      // narrows to the exact intended row regardless of physical row order.
      const matchCols = matchKeys.map((key) => {
        const col = resolvedColumns.find((c) => c.key === key)!;
        return { physicalIndex: col.physicalIndex, value: normalizeForMatch(match[key]!) };
      });

      const rowIndex = dataRowsByPhysicalIndex.findIndex((row) =>
        matchCols.every(
          ({ physicalIndex, value }) =>
            normalizeForMatch(row.get(physicalIndex) ?? "") === value,
        ),
      );
      if (rowIndex === -1) {
        return { updated: false };
      }

      // +2: 1-based A1 rows, plus the header row.
      const sheetRow = rowIndex + 2;
      const data = Object.entries(updates).map(([key, value]) => {
        const col = resolvedColumns.find((c) => c.key === key)!;
        return {
          range: `${quotedSheetName(sheetName)}!${columnToA1(col.physicalIndex)}${sheetRow}`,
          values: [[value]],
        };
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: "RAW", data },
      });

      return { updated: true };
    },
  };
}

export type MetadataTaggedSheetsClientConfigWithAuth =
  MetadataTaggedSheetsClientConfig & {
    auth?: AuthConfig;
    authClient?: JWT | OAuth2Client;
  };

/**
 * Stateful convenience wrapper around `createMetadataTaggedSheetsClient` that
 * resolves auth the same way `SheetsLoader` does, building the underlying
 * `sheets_v4.Sheets` client lazily on first use.
 *
 * Prefer `createMetadataTaggedSheetsClient` directly when you already have a
 * `sheets_v4.Sheets` client (e.g. in tests, or sharing one across services).
 */
export class MetadataTaggedSheetsClient {
  private readonly authConfig?: AuthConfig;
  private readonly explicitAuthClient?: JWT | OAuth2Client;
  private readonly config: MetadataTaggedSheetsClientConfig;
  private delegate?: MetadataTaggedSheetsClientLike;

  constructor(config: MetadataTaggedSheetsClientConfigWithAuth) {
    this.authConfig = config.auth;
    this.explicitAuthClient = config.authClient;
    this.config = { columns: config.columns, tagPrefix: config.tagPrefix };
  }

  private async getDelegate() {
    if (this.delegate) return this.delegate;
    let authClient: JWT | OAuth2Client;
    if (this.explicitAuthClient) {
      authClient = this.explicitAuthClient;
    } else {
      try {
        authClient = (await getAuthClient({
          ...this.authConfig,
          scopes: this.authConfig?.scopes ?? [
            "https://www.googleapis.com/auth/spreadsheets",
          ],
        })) as JWT | OAuth2Client;
      } catch (err: unknown) {
        throw new AuthError((err as Error)?.message, { cause: err as Error });
      }
    }
    const sheets = google.sheets({ version: "v4", auth: authClient });
    this.delegate = createMetadataTaggedSheetsClient(sheets, this.config);
    return this.delegate;
  }

  async loadWithHeaders(spreadsheetId: string, range: string) {
    const delegate = await this.getDelegate();
    return delegate.loadWithHeaders(spreadsheetId, range);
  }

  async appendDedup(input: SheetsAppendDedupInput) {
    const delegate = await this.getDelegate();
    return delegate.appendDedup(input);
  }

  async updateRow(
    spreadsheetId: string,
    sheetName: string,
    match: Record<string, string>,
    updates: Record<string, string>,
  ) {
    const delegate = await this.getDelegate();
    return delegate.updateRow(spreadsheetId, sheetName, match, updates);
  }
}
