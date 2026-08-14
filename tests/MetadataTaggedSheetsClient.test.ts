import { describe, it, expect, vi } from "vitest";
import type { sheets_v4 } from "googleapis";
import {
  createMetadataTaggedSheetsClient,
  type SheetColumnDefinition,
} from "../src/MetadataTaggedSheetsClient";
import { SheetConfigError, SheetNotFoundError } from "../src/errors";

const COLUMNS: readonly SheetColumnDefinition[] = [
  { key: "cohortId", header: "Stripe ID" },
  { key: "intellumPathId", header: "Intellum Path ID" },
];

const TAG_PREFIX = "uofd:";

interface GridFixture {
  sheetId?: number;
  title?: string;
  headers?: (string | undefined)[];
  /** developerMetadata keys per physical column index, e.g. { 0: "uofd:cohortId" }. */
  metadataByColumn?: Record<number, string[]>;
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

  const columnMetadata = headers.map((_, i) => ({
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
    it("resolves columns by metadata tag first", async () => {
      // Headers are reordered/renamed vs. the configured display header, but
      // metadata tags still identify the logical column correctly.
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

    it("falls back to configured header when no metadata tag exists", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [["aiAcceleratorMar2026", "path-123"]],
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

    it("defaults missing values to empty string", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID"],
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
        metadataByColumn: {
          0: [`${TAG_PREFIX}cohortId`],
          1: [`${TAG_PREFIX}intellumPathId`],
        },
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

    it("tags columns resolved only by header fallback", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [],
      });

      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await client.appendDedup({
        spreadsheetId: "SHEET_ID",
        sheetName: "CohortIndex",
        dedupeColumns: ["cohortId"],
        rows: [{ cohortId: "c1", intellumPathId: "p1" }],
      });

      expect(sheets.spreadsheets.batchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            requests: expect.arrayContaining([
              expect.objectContaining({
                createDeveloperMetadata: expect.objectContaining({
                  developerMetadata: expect.objectContaining({
                    metadataKey: `${TAG_PREFIX}cohortId`,
                  }),
                }),
              }),
            ]),
          },
        }),
      );
    });

    it("writes canonical headers first when appending to a fully empty sheet", async () => {
      const sheets = fakeSheets({ headers: [], rows: [] });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await client.appendDedup({
        spreadsheetId: "SHEET_ID",
        sheetName: "CohortIndex",
        dedupeColumns: ["cohortId"],
        rows: [{ cohortId: "c1", intellumPathId: "p1" }],
      });

      expect(sheets.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            values: [
              ["Stripe ID", "Intellum Path ID"],
              ["c1", "p1"],
            ],
          },
        }),
      );
    });

    it("throws SheetConfigError for an unknown dedupe column", async () => {
      const sheets = fakeSheets({ headers: ["Stripe ID"], rows: [] });
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
        metadataByColumn: {
          0: [`${TAG_PREFIX}cohortId`],
          1: [`${TAG_PREFIX}intellumPathId`],
        },
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
        "cohortId",
        "c2",
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

    it("returns updated: false when no row matches", async () => {
      const sheets = fakeSheets({
        headers: ["Stripe ID", "Intellum Path ID"],
        rows: [["c1", "p1"]],
      });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      const result = await client.updateRow(
        "SHEET_ID",
        "CohortIndex",
        "cohortId",
        "no-such-cohort",
        {
          intellumPathId: "x",
        },
      );

      expect(result).toEqual({ updated: false });
      expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
    });

    it("throws SheetConfigError for an unknown update column", async () => {
      const sheets = fakeSheets({ headers: ["Stripe ID"], rows: [["c1"]] });
      const client = createMetadataTaggedSheetsClient(sheets, {
        columns: COLUMNS,
        tagPrefix: TAG_PREFIX,
      });

      await expect(
        client.updateRow("SHEET_ID", "CohortIndex", "cohortId", "c1", {
          notAColumn: "x",
        }),
      ).rejects.toThrow(SheetConfigError);
    });
  });
});
