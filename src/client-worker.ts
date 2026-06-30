import {
  MemoryReadFileSystem,
  UrlReadFileSystem,
  WebPCodec,
  combine,
  getInputFormat,
  getOutputFormat,
  readFile,
  writeFile,
} from "@playcanvas/splat-transform";
import type { FileSystem, Writer } from "@playcanvas/splat-transform/dist/lib/io/write/file-system";
import webpWasmUrl from "@playcanvas/splat-transform/lib/webp.wasm?url";

import { fetchJson, resolveSceneInput } from "./lib/supersplat";
import type {
  CacheInfo,
  LodInfo,
  ProgressInfo,
  ResolveResult,
  WorkerDownload,
  WorkerMessage,
  WorkerRequest,
} from "./types";

interface LodRootMeta {
  environment?: string;
  filenames?: string[];
}

type PlannedDownloadTask =
  | {
      kind: "meta";
      url: string;
      localPath: string;
      bytes: Uint8Array;
    }
  | {
      kind: "asset";
      url: string;
      localPath: string;
    };

type DownloadPlanSummary = {
  tasks: PlannedDownloadTask[];
  size: number;
  entryCount: number;
};

WebPCodec.wasmUrl = webpWasmUrl;

const workerScope = self as DedicatedWorkerGlobalScope;
const textEncoder = new TextEncoder();

function post(message: WorkerMessage): void {
  workerScope.postMessage(message);
}

function status(
  requestId: string,
  message: string,
  extras?: Partial<Extract<WorkerMessage, { type: "status" }>>,
): void {
  post({
    type: "status",
    requestId,
    message,
    ...extras,
  });
}

function makeProgress(current: number, total: number, indeterminate = false): ProgressInfo {
  return {
    current,
    total: Math.max(total, 1),
    indeterminate,
  };
}

function deriveLodLevel(path: string): number | null {
  const firstPart = path.split("/")[0] ?? path;
  const prefix = firstPart.split("_", 1)[0] ?? "";
  return /^\d+$/.test(prefix) ? Number(prefix) : null;
}

function isLikelyMemoryError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /array buffer allocation failed|out of memory|invalid array buffer length|memory access out of bounds/i.test(text);
}

function formatWorkerError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (isLikelyMemoryError(error)) {
    return [
      "Browser memory limit reached while converting this scene.",
      "Large streamed LOD scenes, especially LOD 0, can exceed what a browser tab can hold.",
      "Set the LOD range start to 1 or higher to skip the heaviest level, uncheck Include Environment, or use the local Python script for the full scene.",
    ].join(" ");
  }
  return text;
}

function isLevelInRange(level: number, request: WorkerRequest): boolean {
  if (request.lodMinLevel !== null && level < request.lodMinLevel) {
    return false;
  }
  if (request.lodMaxLevel !== null && level > request.lodMaxLevel) {
    return false;
  }
  return true;
}

function makeLodInfo(allLevels: number[], selectedLevels: number[], request: WorkerRequest): LodInfo {
  return {
    availableLevels: allLevels,
    selectedLevels,
    defaultSelection: request.lodMinLevel === null && request.lodMaxLevel === null,
  };
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function getCacheInfo(basePath: string): CacheInfo {
  return {
    kind: "opfs",
    path: `/${basePath}`,
    label: "OPFS browser cache",
  };
}

function getStorageDirectory(): Promise<FileSystemDirectoryHandle> {
  const storageWithDirectory = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };

  if (!storageWithDirectory.getDirectory) {
    throw new Error("This browser does not support the Origin Private File System needed for large exports.");
  }

  return storageWithDirectory.getDirectory();
}

async function ensureDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }
  return current;
}

async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

async function getFileHandleForPath(
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const segments = splitPath(path);
  if (segments.length === 0) {
    throw new Error("Invalid OPFS path.");
  }

  const fileName = segments.pop() as string;
  const root = await getStorageDirectory();
  const directory = create
    ? await ensureDirectory(root, segments)
    : segments.length > 0
      ? await resolveDirectory(root, segments)
      : root;

  return directory.getFileHandle(fileName, create ? { create: true } : undefined);
}

async function removeOpfsPath(path: string): Promise<void> {
  const segments = splitPath(path);
  if (segments.length === 0) {
    return;
  }

  const entryName = segments.pop() as string;
  const root = await getStorageDirectory();
  const directory = segments.length > 0 ? await resolveDirectory(root, segments) : root;
  await directory.removeEntry(entryName, { recursive: true });
}

async function statOpfsFile(path: string): Promise<number> {
  const fileHandle = await getFileHandleForPath(path, false);
  const file = await fileHandle.getFile();
  return file.size;
}

class OpfsWriter implements Writer {
  constructor(private readonly writable: FileSystemWritableFileStream) {}

  async write(data: Uint8Array): Promise<void> {
    await this.writable.write(data);
  }

  async close(): Promise<void> {
    await this.writable.close();
  }
}

class OpfsWriteFileSystem implements FileSystem {
  constructor(private readonly basePath: string) {}

  async mkdir(path: string): Promise<void> {
    const segments = splitPath([this.basePath, path].filter(Boolean).join("/"));
    const root = await getStorageDirectory();
    await ensureDirectory(root, segments);
  }

  async createWriter(filename: string): Promise<Writer> {
    const path = [this.basePath, filename].filter(Boolean).join("/");
    const fileHandle = await getFileHandleForPath(path, true);
    const writable = await fileHandle.createWritable();
    return new OpfsWriter(writable);
  }
}

class CachedFetchReadFileSystem {
  private readonly memoryFs = new MemoryReadFileSystem();

  constructor(private readonly baseUrl: string) {}

  async createSource(filename: string, progress?: (loaded: number, total?: number) => void) {
    const cached = this.memoryFs.get(filename);
    if (cached) {
      return this.memoryFs.createSource(filename, progress);
    }

    const url = new URL(filename, this.baseUrl).toString();
    let response: Response;
    try {
      response = await fetch(url, { mode: "cors" });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }
    } catch (err) {
      try {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
        response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${url} via proxy: HTTP ${response.status}`);
        }
      } catch {
        throw err;
      }
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    this.memoryFs.set(filename, bytes);
    if (progress) {
      progress(bytes.byteLength, bytes.byteLength);
    }
    return this.memoryFs.createSource(filename, progress);
  }
}

function createUrlReadTarget(inputUrl: string): { fileSystem: { createSource: (filename: string, progress?: (loaded: number, total?: number) => void) => Promise<unknown> }; filename: string } {
  const parsed = new URL(inputUrl);
  const filename = parsed.pathname.split("/").filter(Boolean).pop();
  if (!filename) {
    throw new Error(`Could not derive a filename from URL: ${inputUrl}`);
  }

  const baseUrl = new URL("./", parsed).toString();
  return {
    fileSystem: filename.toLowerCase().endsWith("meta.json")
      ? new CachedFetchReadFileSystem(baseUrl)
      : new UrlReadFileSystem(baseUrl),
    filename,
  };
}

function collectMetaFiles(node: unknown, files = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectMetaFiles(item, files);
    }
    return files;
  }

  if (!node || typeof node !== "object") {
    return files;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "files" && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item) {
          files.add(item);
        }
      }
      continue;
    }
    collectMetaFiles(value, files);
  }

  return files;
}

function collectLodMetaRefsLocal(meta: LodRootMeta): string[] {
  const refs: string[] = [];

  if (typeof meta.environment === "string" && meta.environment) {
    refs.push(meta.environment);
  }

  if (Array.isArray(meta.filenames)) {
    for (const item of meta.filenames) {
      if (typeof item === "string" && item) {
        refs.push(item);
      }
    }
  }

  return refs;
}

function resolveRelativePath(baseFilePath: string, relativePath: string): string {
  return new URL(relativePath, `https://local.invalid/${baseFilePath}`).pathname.replace(/^\/+/, "");
}

async function fetchText(url: string): Promise<string> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }
    return response.text();
  } catch (err) {
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url} via proxy: HTTP ${response.status}`);
      }
      return response.text();
    } catch {
      throw err;
    }
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Failed to download ${url} via proxy: HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      throw err;
    }
  }
}

async function writeOpfsFile(fs: FileSystem, filename: string, data: Uint8Array): Promise<void> {
  const writer = await fs.createWriter(filename);
  await writer.write(data);
  await writer.close();
}

async function planMetaTree(
  request: WorkerRequest,
  resolved: ResolveResult,
  metaUrl: string,
  localMetaPath: string,
  cacheInfo: CacheInfo,
  visitedMetaUrls: Set<string>,
): Promise<DownloadPlanSummary> {
  const normalizedUrl = new URL(metaUrl).toString();
  if (visitedMetaUrls.has(normalizedUrl)) {
    return {
      tasks: [],
      size: 0,
      entryCount: 0,
    };
  }
  visitedMetaUrls.add(normalizedUrl);

  status(request.id, `Scanning ${localMetaPath}`, {
    detectedKind: resolved.kind,
    contentUrl: resolved.contentUrl,
    detail: normalizedUrl,
    cacheInfo,
    progress: makeProgress(0, 1, true),
  });

  const metaText = await fetchText(normalizedUrl);
  const metaBytes = textEncoder.encode(metaText);
  const tasks: PlannedDownloadTask[] = [{
    kind: "meta",
    url: normalizedUrl,
    localPath: localMetaPath,
    bytes: metaBytes,
  }];
  let size = metaBytes.byteLength;
  let entryCount = 1;

  const meta = JSON.parse(metaText) as LodRootMeta;

  for (const assetName of Array.from(collectMetaFiles(meta)).sort()) {
    tasks.push({
      kind: "asset",
      url: new URL(assetName, normalizedUrl).toString(),
      localPath: resolveRelativePath(localMetaPath, assetName),
    });
    entryCount += 1;
  }

  for (const childRef of collectLodMetaRefsLocal(meta)) {
    const childSummary = await planMetaTree(
      request,
      resolved,
      new URL(childRef, normalizedUrl).toString(),
      resolveRelativePath(localMetaPath, childRef),
      cacheInfo,
      visitedMetaUrls,
    );
    tasks.push(...childSummary.tasks);
    size += childSummary.size;
    entryCount += childSummary.entryCount;
  }

  return {
    tasks,
    size,
    entryCount,
  };
}

async function downloadOriginalStreamedLod(
  request: WorkerRequest,
  resolved: ResolveResult,
  outputBaseName: string,
  outputBasePath: string,
  cacheInfo: CacheInfo,
): Promise<WorkerDownload> {
  const rootFileName = new URL(resolved.contentUrl).pathname.split("/").filter(Boolean).pop() ?? "lod-meta.json";
  const localRootPath = `${outputBaseName}/${rootFileName}`;
  const outputFs = new OpfsWriteFileSystem(outputBasePath);

  const plan = await planMetaTree(
    request,
    resolved,
    resolved.contentUrl,
    localRootPath,
    cacheInfo,
    new Set<string>(),
  );

  const totalTasks = Math.max(plan.tasks.length, 1);
  let downloadedCount = 0;
  let downloadedSize = 0;

  for (const task of plan.tasks) {
    status(request.id, `Downloading ${task.localPath}`, {
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      detail: task.url,
      cacheInfo,
      progress: makeProgress(downloadedCount, totalTasks),
    });

    if (task.kind === "meta") {
      await writeOpfsFile(outputFs, task.localPath, task.bytes);
      downloadedSize += task.bytes.byteLength;
    } else {
      const assetBytes = await fetchBytes(task.url);
      await writeOpfsFile(outputFs, task.localPath, assetBytes);
      downloadedSize += assetBytes.byteLength;
    }

    downloadedCount += 1;
    await yieldToBrowser();
  }

  return {
    storage: "opfs-directory",
    fileName: outputBaseName,
    size: downloadedSize || plan.size,
    opfsPath: `${outputBasePath}/${outputBaseName}`,
    entryCount: plan.entryCount,
    rootFileName,
  };
}

async function convertInputsToPly(
  request: WorkerRequest,
  resolved: ResolveResult,
  inputUrls: string[],
  outputName: string,
  progressLabel: string,
  outputBasePath: string,
  cacheInfo: CacheInfo,
  lodInfo?: LodInfo,
  progressBase = 0,
  progressTotal = inputUrls.length + 1,
): Promise<WorkerDownload> {
  let merged: Awaited<ReturnType<typeof readFile>>[number] | null = null;

  for (let index = 0; index < inputUrls.length; index += 1) {
    const url = inputUrls[index];
    status(request.id, `${progressLabel} (${index + 1}/${inputUrls.length})`, {
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      detail: url,
      cacheInfo,
      lodInfo,
      progress: makeProgress(progressBase + index, progressTotal),
    });

    const readTarget = createUrlReadTarget(url);
    const tables = await readFile({
      filename: readTarget.filename,
      inputFormat: getInputFormat(readTarget.filename),
      options: {},
      params: [],
      fileSystem: readTarget.fileSystem,
    });

    if (tables.length === 0) {
      continue;
    }

    const nextTable = tables.length === 1 ? tables[0] : combine(tables);
    merged = merged ? combine([merged, nextTable]) : nextTable;

    await yieldToBrowser();
  }

  if (!merged) {
    throw new Error("The provided source files did not contain any splat tables.");
  }

  status(request.id, `Writing ${outputName} to local browser cache`, {
    detectedKind: resolved.kind,
    contentUrl: resolved.contentUrl,
    cacheInfo,
    lodInfo,
    progress: makeProgress(progressBase + inputUrls.length, progressTotal),
  });

  const outputFs = new OpfsWriteFileSystem(outputBasePath);
  await writeFile(
    {
      filename: outputName,
      outputFormat: getOutputFormat(outputName, {}),
      dataTable: merged,
      options: {},
    },
    outputFs,
  );

  const opfsPath = `${outputBasePath}/${outputName}`;
  return {
    storage: "opfs",
    fileName: outputName,
    mimeType: "application/octet-stream",
    opfsPath,
    size: await statOpfsFile(opfsPath),
  };
}

async function buildDownloads(
  request: WorkerRequest,
  resolved: ResolveResult,
  outputBasePath: string,
  cacheInfo: CacheInfo,
): Promise<{ downloads: WorkerDownload[]; lodInfo?: LodInfo }> {
  const outputBaseName = resolved.sceneHash || "supersplat-scene";

  if (resolved.kind === "ply") {
    const download = await convertInputsToPly(
      request,
      resolved,
      [resolved.contentUrl],
      `${outputBaseName}.ply`,
      "Canonicalizing direct PLY into 3DGS format",
      outputBasePath,
      cacheInfo,
      undefined,
      0,
      2,
    );

    return {
      downloads: [download],
    };
  }

  if (request.preserveStreamedLod && resolved.kind !== "lod") {
    status(request.id, "Preserve streamed LOD was requested, but this scene is not a streamed LOD payload. Falling back to PLY.", {
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      cacheInfo,
      progress: makeProgress(0, 1, true),
    });
  }

  if (resolved.kind !== "lod") {
    if (request.splitLods) {
      status(request.id, "Split LODs requested, but this scene has a single payload. Falling back to one PLY.", {
        detectedKind: resolved.kind,
        contentUrl: resolved.contentUrl,
        cacheInfo,
        progress: makeProgress(0, 1, true),
      });
    }

    const download = await convertInputsToPly(
      request,
      resolved,
      [resolved.contentUrl],
      `${outputBaseName}.ply`,
      "Converting single published payload to PLY",
      outputBasePath,
      cacheInfo,
      undefined,
      0,
      2,
    );
    return { downloads: [download] };
  }

  if (request.preserveStreamedLod) {
    status(request.id, "Scanning streamed LOD payload layout", {
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      cacheInfo,
      detail: "The complete folder tree will be preserved so it can be exported and reused as a streamed scene.",
      progress: makeProgress(0, 1, true),
    });

    const download = await downloadOriginalStreamedLod(
      request,
      resolved,
      outputBaseName,
      outputBasePath,
      cacheInfo,
    );

    return {
      downloads: [download],
    };
  }

  status(request.id, "Fetching streamed LOD manifest", {
    detectedKind: resolved.kind,
    contentUrl: resolved.contentUrl,
    cacheInfo,
    progress: makeProgress(0, 1, true),
  });
  const root = await fetchJson<LodRootMeta>(resolved.contentUrl);
  const rootUrl = new URL(resolved.contentUrl);
  const childRefs = root.filenames ?? [];
  const environmentUrl = root.environment
    ? new URL(root.environment, rootUrl).toString()
    : null;

  const childEntries = childRefs
    .map((ref) => ({
      level: deriveLodLevel(ref),
      url: new URL(ref, rootUrl).toString(),
    }))
    .filter((entry) => entry.level !== null) as Array<{ level: number; url: string }>;

  const allLevels = Array.from(new Set(childEntries.map((entry) => entry.level))).sort((a, b) => a - b);
  const selectedEntries = childEntries.filter((entry) => isLevelInRange(entry.level, request));
  if (selectedEntries.length === 0) {
    throw new Error("No streamed LOD chunks matched the selected LOD range.");
  }

  const selectedLevels = Array.from(new Set(selectedEntries.map((entry) => entry.level))).sort((a, b) => a - b);
  const lodInfo = makeLodInfo(allLevels, selectedLevels, request);
  status(request.id, "Detected streamed LOD levels", {
    detectedKind: resolved.kind,
    contentUrl: resolved.contentUrl,
    cacheInfo,
    lodInfo,
    detail: `Available LODs: ${allLevels.join(", ")}`,
    progress: makeProgress(0, 1),
  });

  if (!request.splitLods) {
    const mergedInputs = [
      ...(environmentUrl && request.includeEnvironment ? [environmentUrl] : []),
      ...selectedEntries.map((entry) => entry.url),
    ];
    const totalProgressSteps = mergedInputs.length + 1;
    const download = await convertInputsToPly(
      request,
      resolved,
      mergedInputs,
      `${outputBaseName}.ply`,
      selectedLevels.length > 1
        ? `Merging LOD ${selectedLevels[0]}-${selectedLevels[selectedLevels.length - 1]} into one PLY`
        : `Merging LOD ${selectedLevels[0]} into one PLY`,
      outputBasePath,
      cacheInfo,
      lodInfo,
      0,
      totalProgressSteps,
    );
    return { downloads: [download], lodInfo };
  }

  const groups = new Map<number, string[]>();
  for (const entry of selectedEntries) {
    const list = groups.get(entry.level) ?? [];
    if (environmentUrl && request.includeEnvironment && !list.includes(environmentUrl)) {
      list.push(environmentUrl);
    }
    list.push(entry.url);
    groups.set(entry.level, list);
  }

  const downloads: WorkerDownload[] = [];
  const totalProgressSteps = selectedLevels.reduce((sum, level) => sum + ((groups.get(level) ?? []).length + 1), 0);
  let progressBase = 0;
  for (const level of selectedLevels) {
    const urls = groups.get(level) ?? [];
    downloads.push(
      await convertInputsToPly(
        request,
        resolved,
        urls,
        `${outputBaseName}.lod${level}.ply`,
        `Converting LOD ${level} from ${Math.max(urls.length - (request.includeEnvironment && environmentUrl ? 1 : 0), 0)} chunk files`,
        outputBasePath,
        cacheInfo,
        lodInfo,
        progressBase,
        totalProgressSteps,
      ),
    );
    progressBase += urls.length + 1;
  }

  return { downloads, lodInfo };
}

workerScope.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (!request?.id) {
    return;
  }

  const outputBasePath = `jobs/${request.id}`;
  const cacheInfo = getCacheInfo(outputBasePath);

  try {
    status(request.id, "Preparing browser cache", {
      cacheInfo,
      detail: "Results will be written into OPFS first, then saved out on demand.",
      progress: makeProgress(0, 1, true),
    });
    status(request.id, "Resolving scene input", {
      cacheInfo,
      progress: makeProgress(0, 1, true),
    });
    const resolved = await resolveSceneInput(request.sceneUrl);
    status(request.id, `Detected ${resolved.kind} payload`, {
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      cacheInfo,
      progress: makeProgress(0, 1, true),
    });

    const { downloads, lodInfo } = await buildDownloads(request, resolved, outputBasePath, cacheInfo);
    workerScope.postMessage({
      type: "done",
      requestId: request.id,
      downloads,
      detectedKind: resolved.kind,
      contentUrl: resolved.contentUrl,
      cleanupPath: outputBasePath,
      lodInfo,
      cacheInfo,
      progress: makeProgress(1, 1),
    } satisfies WorkerMessage);
  } catch (error) {
    try {
      await removeOpfsPath(outputBasePath);
    } catch {
      // Best-effort cleanup only.
    }

    post({
      type: "error",
      requestId: request.id,
      error: formatWorkerError(error),
      cacheInfo,
      progress: makeProgress(1, 1),
    });
  }
});
