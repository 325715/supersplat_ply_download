import type { DataTable } from "@playcanvas/splat-transform";
import type { FileSystem } from "@playcanvas/splat-transform/dist/lib/io/write/file-system";

const POSITION_NAMES = ["x", "y", "z"] as const;
const NORMAL_NAMES = ["nx", "ny", "nz"] as const;
const DC_NAMES = ["f_dc_0", "f_dc_1", "f_dc_2"] as const;
const SCALE_NAMES = ["scale_0", "scale_1", "scale_2"] as const;
const ROTATION_NAMES = ["rot_0", "rot_1", "rot_2", "rot_3"] as const;
const MIN_REST_COEFFS = 45;
const REST_NAME_PATTERN = /^f_rest_(\d+)$/;

type NumericColumn = ArrayLike<number>;

interface ColumnSpec {
  name: string;
  data: NumericColumn | null;
  defaultValue: number;
}

function getRequiredColumn(table: DataTable, name: string): NumericColumn {
  const column = table.getColumnByName(name);
  if (!column) {
    throw new Error(`Missing required 3DGS column: ${name}`);
  }
  return column.data as NumericColumn;
}

function getOptionalColumn(table: DataTable, name: string): NumericColumn | null {
  const column = table.getColumnByName(name);
  return (column?.data as NumericColumn | undefined) ?? null;
}

function getRestColumnSpecs(table: DataTable): ColumnSpec[] {
  let highestRestIndex = -1;
  const restColumns = new Map<number, NumericColumn>();

  for (const name of table.columnNames) {
    const match = REST_NAME_PATTERN.exec(name);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    highestRestIndex = Math.max(highestRestIndex, index);
    restColumns.set(index, getRequiredColumn(table, name));
  }

  const restCount = Math.max(MIN_REST_COEFFS, highestRestIndex + 1, 0);
  return Array.from({ length: restCount }, (_, index) => ({
    name: `f_rest_${index}`,
    data: restColumns.get(index) ?? null,
    defaultValue: 0,
  }));
}

function buildCanonicalColumnSpecs(table: DataTable): ColumnSpec[] {
  return [
    ...POSITION_NAMES.map((name) => ({
      name,
      data: getRequiredColumn(table, name),
      defaultValue: 0,
    })),
    ...NORMAL_NAMES.map((name) => ({
      name,
      data: getOptionalColumn(table, name),
      defaultValue: 0,
    })),
    ...DC_NAMES.map((name) => ({
      name,
      data: getRequiredColumn(table, name),
      defaultValue: 0,
    })),
    ...getRestColumnSpecs(table),
    {
      name: "opacity",
      data: getRequiredColumn(table, "opacity"),
      defaultValue: 0,
    },
    ...SCALE_NAMES.map((name) => ({
      name,
      data: getRequiredColumn(table, name),
      defaultValue: 0,
    })),
    ...ROTATION_NAMES.map((name) => ({
      name,
      data: getRequiredColumn(table, name),
      defaultValue: 0,
    })),
  ];
}

export async function writeCanonical3dgsPly(
  filename: string,
  table: DataTable,
  outputFs: FileSystem,
): Promise<void> {
  const specs = buildCanonicalColumnSpecs(table);
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${table.numRows}`,
    ...specs.map((spec) => `property float ${spec.name}`),
    "end_header",
    "",
  ].join("\n");

  const writer = await outputFs.createWriter(filename);
  await writer.write(new TextEncoder().encode(header));

  const rowSize = specs.length * Float32Array.BYTES_PER_ELEMENT;
  const chunkRows = 1024;
  const chunkBuffer = new Uint8Array(chunkRows * rowSize);
  const chunkView = new DataView(chunkBuffer.buffer);

  for (let start = 0; start < table.numRows; start += chunkRows) {
    const end = Math.min(start + chunkRows, table.numRows);
    let offset = 0;

    for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
      for (const spec of specs) {
        const value = spec.data ? spec.data[rowIndex] : spec.defaultValue;
        chunkView.setFloat32(offset, value, true);
        offset += Float32Array.BYTES_PER_ELEMENT;
      }
    }

    await writer.write(chunkBuffer.subarray(0, offset));
  }

  await writer.close();
}
