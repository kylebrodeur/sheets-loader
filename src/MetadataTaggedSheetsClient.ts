import { google, sheets_v4 } from "googleapis";
import type { JWT, OAuth2Client } from "google-auth-library";
import { getAuthClient, type AuthConfig } from "./auth.js";
import { AuthError, SheetConfigError, SheetNotFoundError } from "./errors.js";
import type { SheetSource } from "./MappedSheetsLoader.js";

/**
 * `key` is the stable logical identity used in the metadata tag, row records,
 * and dedupe/match configuration. `header` is the mutable display label used
 * as a fallback when the sheet has no metadata tag for `key` yet.
 */
export interface SheetColumnDefinition {
  key: string;
  header: string;
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

function headerRange(sheetName: string, physicalIndex: number): string {
  return `${quotedSheetName(sheetName)}!${columnToA1(physicalIndex)}1`;
}

const GRID_FIELDS =
  "sheets.properties(title,sheetId),sheets.data(startColumn,rowData(values(formattedValue)),columnMetadata(developerMetadata(metadataKey)))";

interface CellDataLike {
  formattedValue?: string | null | undefined;
}

interface ResolvedColumn {
  key: string;
  header: string;
  physicalIndex: number;
  resolvedByMetadata: boolean;
  isNew: boolean;
}

interface ResolvedSheetGrid {
  sheetId: number;
  resolvedColumns: ResolvedColumn[];
  dataRowsByPhysicalIndex: Map<number, string>[];
  /** Total rows in the grid including the header row - 0 for a fully empty sheet. */
  totalRowCount: number;
}

/**
 * Fetches `sheetName`'s grid and resolves every configured logical column to
 * a physical index.
 *
 * Resolution order for each physical column:
 * 1. Column-level developer metadata with key `${tagPrefix}<logicalKey>`, read
 *    from `sheets.data[].columnMetadata[].developerMetadata`.
 * 2. Configured display header matching the first non-metadata row.
 *
 * This is the one resolution algorithm shared by reads and writes, so a
 * column tagged for reading is always the same one written back to.
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
  if (!sheet || sheet.properties?.sheetId == null) {
    throw new SheetNotFoundError(`${spreadsheetId} (tab "${sheetName}")`);
  }
  const sheetId = sheet.properties.sheetId;

  const gridData = sheet.data?.[0];
  const startColumn = gridData?.startColumn ?? 0;
  const columnMeta = gridData?.columnMetadata ?? [];
  const rowData = gridData?.rowData ?? [];

  const headerByPhysicalIndex = new Map<number, string>();
  const firstRowValues = rowData[0]?.values as CellDataLike[] | undefined;
  if (firstRowValues) {
    for (let i = 0; i < firstRowValues.length; i++) {
      headerByPhysicalIndex.set(
        startColumn + i,
        firstRowValues[i]?.formattedValue ?? "",
      );
    }
  }

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

  // Resolve physical columns by metadata first, then by configured header.
  const logicalKeyByPhysicalIndex = new Map<number, string>();
  const metadataResolvedIndexes = new Set<number>();

  for (let i = 0; i < columnMeta.length; i++) {
    const physicalIndex = startColumn + i;
    const metas = columnMeta[i]?.developerMetadata ?? [];
    for (const meta of metas) {
      const key = meta.metadataKey;
      if (!key?.startsWith(tagPrefix)) continue;
      const logicalKey = key.slice(tagPrefix.length);
      logicalKeyByPhysicalIndex.set(physicalIndex, logicalKey);
      metadataResolvedIndexes.add(physicalIndex);
    }
  }

  for (const [physicalIndex, header] of headerByPhysicalIndex.entries()) {
    if (logicalKeyByPhysicalIndex.has(physicalIndex)) continue;
    const def = columns.find((c) => c.header === header);
    if (def) {
      logicalKeyByPhysicalIndex.set(physicalIndex, def.key);
    }
  }

  // Map each configured logical column to a physical index. Existing tagged
  // or header-matched columns keep their physical position; new columns are
  // appended after every column already populated in the grid.
  let nextPhysicalIndex = 0;
  for (const idx of new Set([
    ...logicalKeyByPhysicalIndex.keys(),
    ...headerByPhysicalIndex.keys(),
  ])) {
    nextPhysicalIndex = Math.max(nextPhysicalIndex, idx + 1);
  }
  for (const row of rowData) {
    const values = row.values as CellDataLike[] | undefined;
    const width = (values?.length ?? 0) + startColumn;
    if (width > nextPhysicalIndex) {
      nextPhysicalIndex = width;
    }
  }

  const resolvedColumns: ResolvedColumn[] = [];
  for (const def of columns) {
    let physicalIndex: number | undefined;
    for (const [idx, key] of logicalKeyByPhysicalIndex.entries()) {
      if (key === def.key) {
        physicalIndex = idx;
        break;
      }
    }
    const resolvedByMetadata =
      physicalIndex != null && metadataResolvedIndexes.has(physicalIndex);
    const isNew = physicalIndex == null;
    if (physicalIndex == null) {
      physicalIndex = nextPhysicalIndex++;
    }
    resolvedColumns.push({
      key: def.key,
      header: def.header,
      physicalIndex,
      resolvedByMetadata,
      isNew,
    });
  }

  return {
    sheetId,
    resolvedColumns,
    dataRowsByPhysicalIndex,
    totalRowCount: rowData.length,
  };
}

/** Tags any column not already resolved by metadata, and backfills headers for new columns. */
async function ensureColumnsTagged(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  sheetId: number,
  resolvedColumns: readonly ResolvedColumn[],
  totalRowCount: number,
  tagPrefix: string,
): Promise<void> {
  // For new columns in an already-populated sheet, write the canonical
  // display header to row 1 at the exact A1 cell first. Existing headers
  // are never overwritten. This must precede metadata tagging so a retry
  // resolves the column by header and completes the tag, rather than
  // leaving a permanently headerless tagged column.
  const newColumnHeaders = resolvedColumns
    .filter((c) => c.isNew && totalRowCount > 0)
    .sort((a, b) => a.physicalIndex - b.physicalIndex)
    .map((c) => ({
      range: headerRange(sheetName, c.physicalIndex),
      values: [[c.header]],
    }));
  if (newColumnHeaders.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: newColumnHeaders },
    });
  }

  // Bootstrap metadata for any column not resolved by metadata (header
  // fallback or newly assigned). This metadata-only batchUpdate never
  // writes cell data.
  const columnsNeedingMetadata = resolvedColumns
    .filter((c) => !c.resolvedByMetadata)
    .sort((a, b) => a.physicalIndex - b.physicalIndex);
  if (columnsNeedingMetadata.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: columnsNeedingMetadata.map((c) => ({
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: `${tagPrefix}${c.key}`,
              metadataValue: c.key,
              visibility: "DOCUMENT",
              location: {
                dimensionRange: {
                  sheetId,
                  dimension: "COLUMNS",
                  startIndex: c.physicalIndex,
                  endIndex: c.physicalIndex + 1,
                },
              },
            },
          },
        })),
      },
    });
  }
}

/**
 * A metadata-tag-first, header-fallback, self-healing Google Sheets client.
 *
 * Reads (`loadWithHeaders`) satisfy `SheetSource`, so an instance plugs
 * directly into `MappedSheetsLoader` for typed field mapping. Writes
 * (`appendDedup`, `updateRow`) use the same column resolution, so a column
 * read under one logical key is always the column written back to.
 */
export function createMetadataTaggedSheetsClient(
  sheets: sheets_v4.Sheets,
  config: MetadataTaggedSheetsClientConfig,
): SheetSource & {
  appendDedup(input: SheetsAppendDedupInput): Promise<AppendDedupResult>;
  updateRow(
    spreadsheetId: string,
    sheetName: string,
    matchKey: string,
    matchValue: string,
    updates: Record<string, string>,
  ): Promise<UpdateRowResult>;
} {
  const { columns, tagPrefix } = config;

  function requireColumn(key: string): SheetColumnDefinition {
    const def = columns.find((c) => c.key === key);
    if (!def) {
      throw new SheetConfigError(
        `Column "${key}" is not defined in the configured columns.`,
      );
    }
    return def;
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
      const {
        sheetId,
        resolvedColumns,
        dataRowsByPhysicalIndex,
        totalRowCount,
      } = await resolveSheetGrid(
        sheets,
        input.spreadsheetId,
        input.sheetName,
        columns,
        tagPrefix,
      );

      const dedupeIndexes = input.dedupeColumns.map((key) => {
        requireColumn(key);
        const col = resolvedColumns.find((c) => c.key === key);
        if (!col) {
          throw new SheetConfigError(
            `Dedupe column "${key}" could not be resolved for sheet "${input.sheetName}".`,
          );
        }
        return col.physicalIndex;
      });

      await ensureColumnsTagged(
        sheets,
        input.spreadsheetId,
        input.sheetName,
        sheetId,
        resolvedColumns,
        totalRowCount,
        tagPrefix,
      );

      const seenKeys = new Set<string>();
      for (const row of dataRowsByPhysicalIndex) {
        seenKeys.add(
          JSON.stringify(dedupeIndexes.map((idx) => row.get(idx) ?? "")),
        );
      }

      const toAppend: string[][] = [];
      let skipped = 0;
      for (const row of input.rows) {
        const key = JSON.stringify(
          input.dedupeColumns.map((k) => row[k] ?? ""),
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

      let appendValues = toAppend;
      if (totalRowCount === 0) {
        const headerMaxIndex = Math.max(
          0,
          ...resolvedColumns.map((c) => c.physicalIndex),
        );
        const headerRow = new Array(headerMaxIndex + 1).fill("");
        for (const col of resolvedColumns) {
          headerRow[col.physicalIndex] = col.header;
        }
        appendValues = [headerRow, ...toAppend];
      }

      await sheets.spreadsheets.values.append({
        spreadsheetId: input.spreadsheetId,
        range: a1Range(input.sheetName, "A1"),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: appendValues },
      });

      return { appended: toAppend.length, skipped };
    },

    async updateRow(
      spreadsheetId: string,
      sheetName: string,
      matchKey: string,
      matchValue: string,
      updates: Record<string, string>,
    ): Promise<UpdateRowResult> {
      requireColumn(matchKey);
      for (const key of Object.keys(updates)) requireColumn(key);

      const {
        sheetId,
        resolvedColumns,
        dataRowsByPhysicalIndex,
        totalRowCount,
      } = await resolveSheetGrid(
        sheets,
        spreadsheetId,
        sheetName,
        columns,
        tagPrefix,
      );

      const matchCol = resolvedColumns.find((c) => c.key === matchKey);
      if (!matchCol) {
        throw new SheetConfigError(
          `Match column "${matchKey}" could not be resolved for sheet "${sheetName}".`,
        );
      }

      const rowIndex = dataRowsByPhysicalIndex.findIndex(
        (row) => (row.get(matchCol.physicalIndex) ?? "") === matchValue,
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

      await ensureColumnsTagged(
        sheets,
        spreadsheetId,
        sheetName,
        sheetId,
        resolvedColumns,
        totalRowCount,
        tagPrefix,
      );

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
  private delegate?: ReturnType<typeof createMetadataTaggedSheetsClient>;

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
    matchKey: string,
    matchValue: string,
    updates: Record<string, string>,
  ) {
    const delegate = await this.getDelegate();
    return delegate.updateRow(
      spreadsheetId,
      sheetName,
      matchKey,
      matchValue,
      updates,
    );
  }
}
