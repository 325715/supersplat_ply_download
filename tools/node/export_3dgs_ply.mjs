#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
    BufferedReadStream,
    ReadStream,
    combine,
    getInputFormat,
    getOutputFormat,
    readFile,
    writeFile
} from '@playcanvas/splat-transform';

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

    await writeFile({
        filename: output,
        outputFormat: getOutputFormat(output, {}),
        dataTable: merged,
        options: {}
    }, writeFs);
    process.stdout.write(`${output}\n`);
};

try {
    await main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
}
