import { beforeEach, describe, expect, it, vi } from "vitest";

const sheetsMock = vi.hoisted(() => vi.fn());

vi.mock("googleapis", () => ({
  google: {
    sheets: sheetsMock,
  },
}));

import { fetchValues } from "../src/fetcher";

describe("fetchValues", () => {
  beforeEach(() => {
    sheetsMock.mockReset();
  });

  it("calls values.get with the generated resource as receiver", async () => {
    const rows = [["tab", "approvedAt", "csv"]];
    const valuesResource = {
      context: { marker: "bound" },
      async get(this: { context?: unknown }, request: unknown) {
        if (!this?.context) throw new TypeError("missing Google API context");
        expect(request).toEqual({
          spreadsheetId: "sheet-id",
          range: "_ApprovedSnapshot!A:C",
        });
        return { data: { values: rows } };
      },
    };

    sheetsMock.mockReturnValue({
      spreadsheets: {
        values: valuesResource,
      },
    });

    await expect(
      fetchValues(null, "sheet-id", "_ApprovedSnapshot!A:C", { retries: 1 }),
    ).resolves.toEqual(rows);
  });
});
