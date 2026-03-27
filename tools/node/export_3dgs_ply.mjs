#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
    BufferedReadStream,
    ReadStream,
    combine,
    getInputFormat,
    readFile
} from '@playcanvas/splat-transform';

const POSITION_NAMES = ['x', 'y', 'z'];
const NORMAL_NAMES = ['nx', 'ny', 'nz'];
const DC_NAMES = ['f_dc_0', 'f_dc_1', 'f_dc_2'];
const SCALE_NAMES = ['scale_0', 'scale_1', 'scale_2'];
const ROTATION_NAMES = ['rot_0', 'rot_1', 'rot_2', 'rot_3'];
const MIN_REST_COEFFS = 45;
const REST_NAME_PATTERN = /^f_rest_(\d+)$/;

class NodeReadStream extends ReadStream {
    constructor(fileHandle, start, end, progress, totalSize) {
        super(end - start);
        this.fileHandle = fileHandle;
        this.position = start;
        this.end = end;
        this.progress = progress;
        this.totalSize = totalSize;
        this.closed = false;
    }

    async pull(target) {
        if (this.closed) {
            return 0;
        }

        const remaining = this.end - this.position;
        if (remaining <= 0) {
            return 0;
        }

        const bytesToRead = Math.min(target.length, remaining);
        const { bytesRead } = await this.fileHandle.read(target, 0, bytesToRead, this.position);
        this.position += bytesRead;
        this.bytesRead += bytesRead;

        if (this.progress) {
            this.progress(this.bytesRead, this.totalSize);
        }

        return bytesRead;
    }

    close() {
        this.closed = true;
    }
}

class NodeReadSource {
    constructor(fileHandle, size, progress) {
        this.fileHandle = fileHandle;
        this.size = size;
        this.progress = progress;
        this.seekable = true;
        this.closed = false;
    }

    read(start = 0, end = this.size) {
        if (this.closed) {
            throw new Error('Source has been closed');
        }

        const clampedStart = Math.max(0, Math.min(start, this.size));
        const clampedEnd = Math.max(clampedStart, Math.min(end, this.size));
        const raw = new NodeReadStream(this.fileHandle, clampedStart, clampedEnd, this.progress, this.size);
        return new BufferedReadStream(raw, 4 * 1024 * 1024);
    }

    close() {
        this.closed = true;
        this.fileHandle.close();
    }
}

class NodeReadFileSystem {
    async createSource(filename, progress) {
        const fileStats = await stat(filename);
        const fileHandle = await open(filename, 'r');
        if (progress) {
            progress(0, fileStats.size);
        }
        return new NodeReadSource(fileHandle, fileStats.size, progress);
    }
}

class TempFileWriter {
    constructor(fileHandle, finalPath, tmpPath) {
        this.fileHandle = fileHandle;
        this.finalPath = finalPath;
        this.tmpPath = tmpPath;
    }

    async write(data) {
        await this.fileHandle.write(data);
    }

    async close() {
        await this.fileHandle.sync();
        await this.fileHandle.close();
        await rename(this.tmpPath, this.finalPath);
    }
}

class NodeWriteFileSystem {
    async createWriter(filename) {
        await mkdir(dirname(filename), { recursive: true });
        const tmpName = `.${basename(filename)}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`;
        const tmpPath = resolve(dirname(filename), tmpName);
        const fileHandle = await open(tmpPath, 'w');
        return new TempFileWriter(fileHandle, filename, tmpPath);
    }
}

const getRequiredColumn = (table, name) => {
    const column = table.getColumnByName(name);
    if (!column) {
        throw new Error(`Missing required 3DGS column: ${name}`);
    }
    return column.data;
};

const getOptionalColumn = (table, name) => {
    return table.getColumnByName(name)?.data ?? null;
};

const getRestColumnSpecs = (table) => {
    let highestRestIndex = -1;
    const restColumns = new Map();

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
        defaultValue: 0
    }));
};

const buildCanonicalColumnSpecs = (table) => {
    return [
        ...POSITION_NAMES.map((name) => ({ name, data: getRequiredColumn(table, name), defaultValue: 0 })),
        ...NORMAL_NAMES.map((name) => ({ name, data: getOptionalColumn(table, name), defaultValue: 0 })),
        ...DC_NAMES.map((name) => ({ name, data: getRequiredColumn(table, name), defaultValue: 0 })),
        ...getRestColumnSpecs(table),
        { name: 'opacity', data: getRequiredColumn(table, 'opacity'), defaultValue: 0 },
        ...SCALE_NAMES.map((name) => ({ name, data: getRequiredColumn(table, name), defaultValue: 0 })),
        ...ROTATION_NAMES.map((name) => ({ name, data: getRequiredColumn(table, name), defaultValue: 0 }))
    ];
};

const writeCanonical3dgsPly = async (filename, table, outputFs) => {
    const specs = buildCanonicalColumnSpecs(table);
    const header = [
        'ply',
        'format binary_little_endian 1.0',
        `element vertex ${table.numRows}`,
        ...specs.map((spec) => `property float ${spec.name}`),
        'end_header',
        ''
    ].join('\n');

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
};

const parseArgs = (argv) => {
    const inputs = [];
    let output = null;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '-o' || arg === '--output') {
            output = argv[index + 1] ?? null;
            index += 1;
            continue;
        }
        if (arg === '-h' || arg === '--help') {
            printUsage(0);
        }
        inputs.push(arg);
    }

    if (!output || inputs.length === 0) {
        printUsage(1);
    }

    return {
        inputs: inputs.map((value) => resolve(value)),
        output: resolve(output)
    };
};

const printUsage = (code) => {
    const stream = code === 0 ? process.stdout : process.stderr;
    stream.write('Usage: export_3dgs_ply.mjs --output <file.ply> <input> [more inputs...]\n');
    process.exit(code);
};

const main = async () => {
    const { inputs, output } = parseArgs(process.argv.slice(2));
    const readFs = new NodeReadFileSystem();
    const writeFs = new NodeWriteFileSystem();

    let merged = null;
    for (const input of inputs) {
        const tables = await readFile({
            filename: input,
            inputFormat: getInputFormat(input),
            options: {},
            params: [],
            fileSystem: readFs
        });

        if (tables.length === 0) {
            continue;
        }

        const nextTable = tables.length === 1 ? tables[0] : combine(tables);
        merged = merged ? combine([merged, nextTable]) : nextTable;
    }

    if (!merged) {
        throw new Error('The provided inputs did not contain any splat tables.');
    }

    await writeCanonical3dgsPly(output, merged, writeFs);
    process.stdout.write(`${output}\n`);
};

try {
    await main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}
