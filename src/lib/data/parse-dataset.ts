import { parse as parseCsv } from "csv-parse/sync";
import ExcelJS from "exceljs";
import type { ColumnSchema, ColumnType, DatasetRow } from "../db/types";

export class DatasetParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DatasetParseError";
  }
}

/** Datasets are stored as jsonb on the row (see the Phase 7 migration) — this keeps that column bounded, not a real "big data" limit. */
export const MAX_DATASET_ROWS = 5000;

export interface ParsedDataset {
  columns: ColumnSchema[];
  rows: DatasetRow[];
}

export async function parseDataset(
  buffer: Buffer,
  mimeType: string | null,
  fileName: string,
): Promise<ParsedDataset> {
  const rawRows = isXlsx(mimeType, fileName) ? await parseXlsxRows(buffer) : parseCsvRows(buffer);

  if (rawRows.length === 0) {
    throw new DatasetParseError("The file has no data rows.");
  }
  if (rawRows.length > MAX_DATASET_ROWS) {
    throw new DatasetParseError(
      `The file has ${rawRows.length} rows, which exceeds the ${MAX_DATASET_ROWS}-row limit for this tool.`,
    );
  }

  const columnNames = Object.keys(rawRows[0]);
  const columns = columnNames.map((name) => inferColumnSchema(name, rawRows));
  const rows = rawRows.map((row) => normalizeRow(row, columns));

  return { columns, rows };
}

function isXlsx(mimeType: string | null, fileName: string): boolean {
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return true;
  return fileName.toLowerCase().endsWith(".xlsx");
}

function parseCsvRows(buffer: Buffer): Record<string, string>[] {
  try {
    return parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  } catch (err) {
    throw new DatasetParseError(`Could not parse CSV: ${(err as Error).message}`, err);
  }
}

async function parseXlsxRows(buffer: Buffer): Promise<Record<string, string>[]> {
  try {
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see extract.ts for why (exceljs's own ambient Buffer type conflicts with @types/node)
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new DatasetParseError("The workbook has no sheets.");

    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (!Array.isArray(row.values)) return;
      const cells = row.values.slice(1).map((v) => (v == null ? "" : String(v)));
      if (rowNumber === 1) {
        headers = cells;
        return;
      }
      const record: Record<string, string> = {};
      headers.forEach((header, i) => {
        record[header] = cells[i] ?? "";
      });
      rows.push(record);
    });
    return rows;
  } catch (err) {
    if (err instanceof DatasetParseError) throw err;
    throw new DatasetParseError(`Could not parse XLSX: ${(err as Error).message}`, err);
  }
}

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function inferColumnSchema(name: string, rows: Record<string, string>[]): ColumnSchema {
  const values = rows.map((r) => (r[name] ?? "").trim());
  const nonMissing = values.filter((v) => v !== "");
  const missingCount = values.length - nonMissing.length;

  return { name, type: inferColumnType(nonMissing), missingCount };
}

function inferColumnType(nonMissingValues: string[]): ColumnType {
  if (nonMissingValues.length === 0) return "text";

  if (nonMissingValues.every((v) => NUMERIC_PATTERN.test(v))) {
    return "numeric";
  }
  if (nonMissingValues.every((v) => DATE_PATTERN.test(v) && !Number.isNaN(Date.parse(v)))) {
    return "date";
  }

  const uniqueCount = new Set(nonMissingValues).size;
  const looksCategorical = uniqueCount <= 20 || uniqueCount <= nonMissingValues.length * 0.2;
  return looksCategorical ? "categorical" : "text";
}

function normalizeRow(row: Record<string, string>, columns: ColumnSchema[]): DatasetRow {
  const result: DatasetRow = {};
  for (const column of columns) {
    const raw = (row[column.name] ?? "").trim();
    if (raw === "") {
      result[column.name] = null;
    } else if (column.type === "numeric") {
      result[column.name] = Number(raw);
    } else {
      result[column.name] = raw;
    }
  }
  return result;
}
