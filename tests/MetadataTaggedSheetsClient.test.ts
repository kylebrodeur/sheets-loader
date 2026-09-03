import { describe, it, expect, vi } from "vitest";
import type { sheets_v4 } from "googleapis";
import {
  createMetadataTaggedSheetsClient,
  type SheetColumnDefinition,
} from "../src/MetadataTaggedSheetsClient";
import { SheetConfigError, SheetNotFoundError } from "../src/errors";

const COLUMNS: readonly SheetColumnDefinition[] = [
  { key: "cohortId" },
  { key: "intellumPathId" },
];

const TAG_PREFIX = "uofd:";

const ALL_TAGGED = {
  0: [`${TAG_PREFIX}cohortId`],
  1: [`${TAG_PREFIX}intellumPathId`],
} as const;

interface GridFixture {
  sheetId?: number;
  title?: string;
  /** Display labels in row 1; never used for column resolution. */
  headers?: (string | undefined)[];
  /** developerMetadata keys per physical column index, e.g. { 0: "uofd:cohortId" }. */
  metadataByColumn?: Record<number, readonly string[]>;
  rows?: string[][];
}

function fakeSheets(fixture: GridFixture): sheets_v4.Sheets {
  const {
    sheetId = 111,
    title = "CohortIndex",
    headers = [],
    metadataByColumn = {},
    rows = [],
  } = fixture;

  // columnMetadata can reach beyond the header row: a sheet pre-tagged by an
  // operator may carry metadata on columns with no cell values at all.
  const metadataWidth = Math.max(
    headers.length,
    ...Object.keys(metadataByColumn).map((i) => Number(i) + 1),
    0,
  );
  const columnMetadata = Array.from({ length: metadataWidth }, (_, i) => ({
    developerMetadata: (metadataByColumn[i] ?? []).map((metadataKey) => ({
      metadataKey,
    })),
  }));

  const rowData = [
    ...(headers.length > 0
      ? [{ values: headers.map((h) => ({ formattedValue: h })) }]
      : []),
    ...rows.map((row) => ({ values: row.map((v) => ({ formattedValue: v })) })),
  ];

  return {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: {
          sheets: [
            {
              properties: { title, sheetId },
              data: [{ startColumn: 0, rowData, columnMetadata }],
            },
          ],
        },
      }),
      batchUpdate: vi.fn().mockResolvedValue({}),
      values: {
        get: vi.fn(),
        append: vi.fn().mockResolvedValue({}),
        batchUpdate: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as sheets_v4.Sheets;
}

describe("createMetadataTaggedSheetsClient", () => {
  describe("loadWithHeaders", () => {
    it("resolves columns by metadata tag only, regardless of header names or order", async () => {
      // Headers are reordered/renamed vs. any display label, but metadata
      // tags still identify the logical column correctly.
      const sheets = fakeSheets({
        headers: ["Renamed Path Column", "Renamed Cohort Column"],
        metadataByColumn: {
          0: [`${TAG_PREFIX}intellumPathId`],
          1: [`${TAG_PREFIX}cohortId`],
        },
        rows: [["path-123", "aiAcceleratorMar2026"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const rows = await client.loadWithHeaders(
        "SHEET_ID",
        "CohortIndex!A1:Z100",
      );

      expect(rows).toEqual([
        { cohortId: "aiAcceleratorMar2026", intellumPathId: "path-123" },
      ]);
    });

    it("throws SheetConfigError naming every missing metadata key, even when headers match exactly", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [["aiAcceleratorMar2026", "path-123"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const error = await client
        .loadWithHeaders("SHEET_ID", "CohortIndex!A1:Z100")
        .then(
          () => {
            throw new Error("expected loadWithHeaders to reject");
          },
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(SheetConfigError);
      const message = (error as Error).message;
      expect(message).toContain(`${TAG_PREFIX}cohortId`);
      expect(message).toContain(`${TAG_PREFIX}intellumPathId`);
    });

    it("names only the missing metadata keys when some columns are already tagged", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: { 0: [`${TAG_PREFIX}cohortId`] },
        rows: [["aiAcceleratorMar2026", "path-123"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const error = await client
        .loadWithHeaders("SHEET_ID", "CohortIndex!A1:Z100")
        .then(
          () => {
            throw new Error("expected loadWithHeaders to reject");
          },
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(SheetConfigError);
      const message = (error as Error).message;
      expect(message).toContain(`${TAG_PREFIX}intellumPathId`);
      expect(message).not.toContain(`${TAG_PREFIX}cohortId`);
    });

    it("never self-heals: a failed read performs no metadata or value writes", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [["aiAcceleratorMar2026", "path-123"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.loadWithHeaders("SHEET_ID", "CohortIndex!A1:Z100"),
      ).rejects.toThrow(SheetConfigError);

      expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it("defaults missing cell values to empty string for tagged columns", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        // Row carries a value only for the first tagged column.
        rows: [["aiAcceleratorMar2026"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const rows = await client.loadWithHeaders(
        "SHEET_ID",
        "CohortIndex!A1:Z100",
      );

      expect(rows).toEqual([
        { cohortId: "aiAcceleratorMar2026", intellumPathId: "" },
      ]);
    });

    it("throws SheetNotFoundError when the tab doesn't exist", async () => {
      const sheets = fakeSheets({ title: "SomeOtherTab" });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.loadWithHeaders("SHEET_ID", "CohortIndex!A1:Z100"),
      ).rejects.toThrow(SheetNotFoundError);
    });
  });

  describe("appendDedup", () => {
    it("appends new rows and skips ones matching the dedupe key", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["existing-cohort", "path-1"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.appendDedup({
        spreadsheetId: "SHEET_ID",
        sheetName: "CohortIndex",
        dedupeColumns: ["cohortId"],
        rows: [
          { cohortId: "existing-cohort", intellumPathId: "path-1" },
          { cohortId: "new-cohort", intellumPathId: "path-2" },
        ],
      });

      expect(result).toEqual({ appended: 1, skipped: 1 });
      expect(sheets.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { values: [["new-cohort", "path-2"]] },
        }),
      );
    });

    it("throws SheetConfigError naming missing metadata keys and writes nothing when columns are untagged", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const error = await client
        .appendDedup({
          spreadsheetId: "SHEET_ID",
          sheetName: "CohortIndex",
          dedupeColumns: ["cohortId"],
          rows: [{ cohortId: "c1", intellumPathId: "p1" }],
        })
        .then(
          () => {
            throw new Error("expected appendDedup to reject");
          },
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(SheetConfigError);
      expect((error as Error).message).toContain(`${TAG_PREFIX}cohortId`);
      expect((error as Error).message).toContain(
        `${TAG_PREFIX}intellumPathId`,
      );
      // No auto-tag or migration write: the sheet is left exactly as found.
      expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
      expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it("appends data rows only to an empty sheet that is already pre-tagged", async () => {
      // No header row and no values, but the operator already tagged both
      // columns - the client writes exactly the data rows, nothing else.
      const sheets = fakeSheets({ headers: [], metadataByColumn: ALL_TAGGED, rows: [] });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.appendDedup({
        spreadsheetId: "SHEET_ID",
        sheetName: "CohortIndex",
        dedupeColumns: ["cohortId"],
        rows: [{ cohortId: "c1", intellumPathId: "p1" }],
      });

      expect(result).toEqual({ appended: 1, skipped: 0 });
      expect(sheets.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { values: [["c1", "p1"]] },
        }),
      );
    });

    it("throws SheetConfigError for an unknown dedupe column", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.appendDedup({
          spreadsheetId: "SHEET_ID",
          sheetName: "CohortIndex",
          dedupeColumns: ["notAColumn"],
          rows: [],
        }),
      ).rejects.toThrow(SheetConfigError);
    });
  });

  describe("updateRow", () => {
    it("updates the matched row's cells and leaves others untouched", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [
          ["c1", "p1"],
          ["c2", "p2"],
        ],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        { cohortId: "c2" },
        {
          intellumPathId: "p2-fulfilled",
        },
      );

      expect(result).toEqual({ updated: true });
      expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            valueInputOption: "RAW",
            // Row 1 is the header; c2 is the second data row -> sheet row 3.
            data: [{ range: "'CohortIndex'!B3", values: [["p2-fulfilled"]] }],
          },
        }),
      );
    });

    it("throws SheetConfigError naming missing metadata keys and writes nothing when columns are untagged", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [["c1", "p1"]],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const error = await client
        .updateRow(
          "SHEET_ID",
          "CohortIndex",
          { cohortId: "c1" },
          { intellumPathId: "p1-fulfilled" },
        )
        .then(
          () => {
            throw new Error("expected updateRow to reject");
          },
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(SheetConfigError);
      expect((error as Error).message).toContain(`${TAG_PREFIX}cohortId`);
      expect((error as Error).message).toContain(
        `${TAG_PREFIX}intellumPathId`,
      );
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
      expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });

    it("returns updated: false when no row matches", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["c1", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        { cohortId: "no-such-cohort" },
        {
          intellumPathId: "x",
        },
      );

      expect(result).toEqual({ updated: false });
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it("throws SheetConfigError for an unknown update column", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["c1", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.updateRow("SHEET_ID", "CohortIndex", { cohortId: "c1" }, {
          notAColumn: "x",
        }),
      ).rejects.toThrow(SheetConfigError);
    });

    it("throws SheetConfigError for an empty match object", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["c1", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.updateRow("SHEET_ID", "CohortIndex", {}, { intellumPathId: "x" }),
      ).rejects.toThrow(SheetConfigError);
    });

    it("compound match requires ALL columns to match - a partial match on one column is not enough", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [
          // Same "Stripe ID" (shared order id), different "Intellum Path ID"
          // (standing in for a second, more selective column) - mirrors two
          // roster rows from one order (purchaser + a placeholder seat)
          // sharing an order id but not an email.
          ["order-1", "placeholder-label"],
          ["order-1", "real@example.com"],
        ],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        { cohortId: "order-1", intellumPathId: "real@example.com" },
        { intellumPathId: "matched-the-second-row" },
      );

      expect(result).toEqual({ updated: true });
      expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          // Row 1 is the header; "order-1"/"real@example.com" is the SECOND
          // data row -> sheet row 3, not row 2 (which shares "order-1" alone).
          requestBody: { valueInputOption: "RAW", data: [{ range: "'CohortIndex'!B3", values: [["matched-the-second-row"]] }] },
        }),
      );
    });

    it("matches despite trailing whitespace/newline artifacts in the stored cell", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["c1@example.com\r", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        { cohortId: "c1@example.com" },
        { intellumPathId: "fulfilled" },
      );

      expect(result).toEqual({ updated: true });
    });

    it("matches despite a casing difference between the stored cell and the match value", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["Person@Example.com", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        { cohortId: "person@example.com" },
        { intellumPathId: "fulfilled" },
      );

      expect(result).toEqual({ updated: true });
    });
  });

  describe("appendDedup whitespace/casing tolerance", () => {
    it("treats a dedupe key as a duplicate despite trailing whitespace or casing differences", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        metadataByColumn: ALL_TAGGED,
        rows: [["Person@Example.com ", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.appendDedup({
        spreadsheetId: "SHEET_ID",
        sheetName: "CohortIndex",
        dedupeColumns: ["cohortId"],
        rows: [{ cohortId: "person@example.com\r", intellumPathId: "p1" }],
      });

      expect(result).toEqual({ appended: 0, skipped: 1 });
    });
  });
});
