import "./styles.css";

import { MemoryFileSystem, ZipFileSystem } from "@playcanvas/splat-transform";
import { formatBytes } from "./lib/supersplat";
import type { CacheInfo, LodInfo, ProgressInfo, WorkerDownload, WorkerMessage, WorkerRequest } from "./types";

type Locale = "zh" | "en";
type BannerState = "idle" | "working" | "done" | "error";
type ToastTone = "success" | "error" | "info";
type ZipEntry = {
  path: string;
  size: number;
  source:
    | { kind: "file"; file: File }
    | { kind: "buffer"; buffer: Uint8Array };
};
type WindowWithPickers = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

type CopyMap = Record<Locale, Record<string, string>>;

const PENDING_CLEANUP_KEY = "supersplat.pendingCleanupPaths.v1";
const LOCALE_KEY = "supersplat.uiLocale.v1";

const copy: CopyMap = {
  zh: {
    title: "SuperSplat PLY Download",
    "brand.title": "SuperSplat PLY Download",
    "brand.subtitle": "一个简易的 SuperSplat 网址下载模型的简易下载器。",
    "form.title": "输入",
    "form.sceneLabel": "SuperSplat 链接或场景 ID",
    "form.scenePlaceholder": "例如 https://superspl.at/scene/8429e5e2 或 8429e5e2",
    "form.convert": "开始转换",
    "form.preserveTitle": "保留原始流式 LOD",
    "form.preserveDesc": "仅对流式场景生效。会下载完整目录结构，便于直接交回 SuperSplat 使用。",
    "form.splitTitle": "分级导出 LOD",
    "form.splitDesc": "默认开启。流式场景会按 LOD 分别导出。",
    "form.envTitle": "包含环境层",
    "form.envDesc": "如果场景提供环境 splats，会一起并入导出结果。",
    "form.zipTitle": "导出为 ZIP",
    "form.zipDesc": "把当前结果打包成一个 zip 文件下载。分级 LOD 和目录结构都会一起打包。",
    "form.rangeTitle": "LOD 范围",
    "form.rangeDesc": "留空表示包含全部可用级别。",
    "form.rangeStart": "起始",
    "form.rangeEnd": "结束",
    "status.title": "状态",
    "status.detectedLabel": "识别类型",
    "status.resolvedLabel": "内容地址",
    "status.lodLabel": "LOD 信息",
    "status.progressLabel": "进度",
    "log.title": "日志",
    "log.busy": "处理中",
    "downloads.title": "结果",
    "downloads.clear": "清理缓存",
    "downloads.note": "结果会先写入浏览器缓存，然后按文件或目录导出到本地。",
    "downloads.autoClear": "所有结果至少保存一次后自动清理缓存",
    "downloads.clearOnClose": "关闭当前标签页时自动清理缓存",
    waiting: "等待输入",
    unresolved: "尚未解析",
    lodEmpty: "识别到 LOD 场景后会显示级别信息",
    idle: "空闲",
    ready: "就绪。",
    empty: "还没有生成任何文件。",
    saveAs: "Save As",
    exportFolder: "导出目录",
    exportZip: "导出 ZIP",
    download: "下载",
    preparing: "准备中...",
    cachedSuffix: "已缓存到浏览器本地",
    cachedDirSuffix: "目录已缓存到浏览器本地",
    invalidRange: "起始 LOD 不能大于结束 LOD。",
    clearManual: "已清理当前任务生成的文件和缓存。",
    autoCleared: "所有缓存文件至少保存一次后，已自动清理缓存。",
    saveDone: "已通过 Save As 保存 {name}。",
    exportFolderDone: "已把目录 {name} 导出到本地文件夹。",
    blobDone: "已通过浏览器下载方式导出 {name}。",
    exportStarted: "开始导出 {name}。",
    exportProgressFile: "正在导出 {name} · {percent} ({written}/{total})",
    exportProgressFolder: "正在导出 {name} · {filesDone}/{filesTotal} 个文件 · {percent} ({written}/{total})",
    exportProgressZip: "正在打包 {name} · {filesDone}/{filesTotal} 个文件 · {percent} ({written}/{total})",
    exportCancelled: "已取消导出 {name}。",
    exportZipDone: "已导出压缩包 {name}。",
    zipContents: "{size} · 打包 {count} 个结果",
    exportFolderUnsupported: "当前浏览器不支持目录导出，请改用支持 File System Access API 的浏览器。",
    cacheCleared: "已清理 {count} 个缓存任务。",
    cacheRecovered: "已清理上次页面遗留的 {count} 个缓存任务。",
    directoryInfo: "{size} · {count} 个文件 · 入口 {root}",
    lodAvailable: "可用级别：{levels}",
    lodSelectedAll: "当前选择：全部可用级别",
    lodSelected: "当前选择：{levels}",
    startTag: "[start]",
    errorTag: "[error]",
    clearTag: "[clear]",
    saveTag: "[save]",
    cacheTag: "[cache]",
    kind_lod: "流式 LOD",
    kind_sog: "SOG",
    kind_compressed_ply: "compressed PLY",
    kind_sog_bundled: "打包 SOG",
    kind_ply: "PLY",
    generatedFiles: "已生成 {count} 个结果",
    "banner.idle.title": "准备就绪",
    "banner.idle.detail": "粘贴一个 SuperSplat 链接后开始转换。",
    "banner.working.title": "正在处理",
    "banner.working.detail": "浏览器正在解析并转换这个场景。",
    "banner.done.title": "转换完成",
    "banner.done.detail": "已生成 {count} 个结果，下面可以直接保存。",
    "banner.error.title": "转换失败",
    "banner.error.detail": "处理过程中出现错误，请查看日志。",
  },
  en: {
    title: "SuperSplat PLY Download",
    "brand.title": "SuperSplat PLY Download",
    "brand.subtitle": "A lightweight downloader that turns public SuperSplat URLs into model files.",
    "form.title": "Input",
    "form.sceneLabel": "SuperSplat URL or scene ID",
    "form.scenePlaceholder": "For example https://superspl.at/scene/8429e5e2 or 8429e5e2",
    "form.convert": "Convert",
    "form.preserveTitle": "Preserve streamed LOD",
    "form.preserveDesc": "Only applies to streamed scenes. Downloads the full folder tree so it can be reused directly in SuperSplat.",
    "form.splitTitle": "Split LODs",
    "form.splitDesc": "Enabled by default. Streamed scenes export one file per LOD.",
    "form.envTitle": "Include environment",
    "form.envDesc": "Merge environment splats into the exported results when available.",
    "form.zipTitle": "Export as ZIP",
    "form.zipDesc": "Bundle the current results into a single zip file. Split LODs and preserved folders are packed together.",
    "form.rangeTitle": "LOD range",
    "form.rangeDesc": "Leave blank to include every available level.",
    "form.rangeStart": "Start",
    "form.rangeEnd": "End",
    "status.title": "Status",
    "status.detectedLabel": "Detected type",
    "status.resolvedLabel": "Content URL",
    "status.lodLabel": "LOD info",
    "status.progressLabel": "Progress",
    "log.title": "Log",
    "log.busy": "Working",
    "downloads.title": "Results",
    "downloads.clear": "Clear cache",
    "downloads.note": "Results are written into browser cache first, then exported as files or folders.",
    "downloads.autoClear": "Auto clear cache after every result has been saved once",
    "downloads.clearOnClose": "Auto clear cache when this tab closes",
    waiting: "Waiting for input",
    unresolved: "Not resolved yet",
    lodEmpty: "LOD details will appear after a streamed scene is detected",
    idle: "Idle",
    ready: "Ready.",
    empty: "No files generated yet.",
    saveAs: "Save As",
    exportFolder: "Export Folder",
    exportZip: "Export ZIP",
    download: "Download",
    preparing: "Preparing...",
    cachedSuffix: "cached in browser storage",
    cachedDirSuffix: "folder cached in browser storage",
    invalidRange: "Start LOD must be less than or equal to End LOD.",
    clearManual: "Cleared generated files and cache for the current job.",
    autoCleared: "Auto-cleared cache after every result was saved once.",
    saveDone: "Saved {name} with Save As.",
    exportFolderDone: "Exported folder {name} to a local directory.",
    blobDone: "Exported {name} using the browser download fallback.",
    exportStarted: "Started exporting {name}.",
    exportProgressFile: "Exporting {name} · {percent} ({written}/{total})",
    exportProgressFolder: "Exporting {name} · {filesDone}/{filesTotal} files · {percent} ({written}/{total})",
    exportProgressZip: "Packing {name} · {filesDone}/{filesTotal} files · {percent} ({written}/{total})",
    exportCancelled: "Cancelled export for {name}.",
    exportZipDone: "Exported zip archive {name}.",
    zipContents: "{size} · packaged {count} result{suffix}",
    exportFolderUnsupported: "This browser does not support directory export. Please use a browser with the File System Access API.",
    cacheCleared: "Cleared {count} cached jobs.",
    cacheRecovered: "Removed {count} leftover cached jobs from a previous tab.",
    directoryInfo: "{size} · {count} files · entry {root}",
    lodAvailable: "Available levels: {levels}",
    lodSelectedAll: "Selected: all available levels",
    lodSelected: "Selected: {levels}",
    startTag: "[start]",
    errorTag: "[error]",
    clearTag: "[clear]",
    saveTag: "[save]",
    cacheTag: "[cache]",
    kind_lod: "streamed LOD",
    kind_sog: "SOG",
    kind_compressed_ply: "compressed PLY",
    kind_sog_bundled: "bundled SOG",
    kind_ply: "PLY",
    generatedFiles: "Generated {count} result{suffix}",
    "banner.idle.title": "Ready",
    "banner.idle.detail": "Paste a SuperSplat URL to begin.",
    "banner.working.title": "Working",
    "banner.working.detail": "This scene is being resolved and converted in your browser.",
    "banner.done.title": "Done",
    "banner.done.detail": "Generated {count} result{suffix}. You can save them below.",
    "banner.error.title": "Failed",
    "banner.error.detail": "An error occurred during conversion. Check the log for details.",
  },
};

const pickerWindow = window as WindowWithPickers;
const worker = new Worker(new URL("./client-worker.ts", import.meta.url), { type: "module" });
let locale: Locale = (localStorage.getItem(LOCALE_KEY) as Locale) || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
let activeRequestId: string | null = null;
let activeMemoryUrls: string[] = [];
let activeCleanupPaths = new Set<string>();
let currentDownloads: WorkerDownload[] = [];
let currentCleanupPath: string | null = null;
let currentLodInfo: LodInfo | null = null;
let savedCachedFiles = new Set<string>();
let bannerState: BannerState = "idle";
let bannerContext: { count?: number; detail?: string } = {};
let activeProgress: ProgressInfo | null = null;

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const form = q<HTMLFormElement>("#converter-form")!;
const sceneUrlInput = q<HTMLInputElement>("#scene-url")!;
const preserveStreamedLodInput = q<HTMLInputElement>("#preserve-streamed-lod")!;
const splitLodsInput = q<HTMLInputElement>("#split-lods")!;
const includeEnvironmentInput = q<HTMLInputElement>("#include-environment")!;
const exportAsZipInput = q<HTMLInputElement>("#export-as-zip")!;
const lodMinLevelInput = q<HTMLInputElement>("#lod-min-level")!;
const lodMaxLevelInput = q<HTMLInputElement>("#lod-max-level")!;
const autoClearCacheInput = q<HTMLInputElement>("#auto-clear-cache")!;
const clearCacheOnCloseInput = q<HTMLInputElement>("#clear-cache-on-close")!;
const convertButton = q<HTMLButtonElement>("#convert-button")!;
const clearResultsButton = q<HTMLButtonElement>("#clear-results")!;
const detectedKindElement = q<HTMLElement>("#detected-kind")!;
const resolvedUrlElement = q<HTMLElement>("#resolved-url")!;
const lodInfoElement = q<HTMLElement>("#lod-info")!;
const progressTextElement = q<HTMLElement>("#progress-text")!;
const logOutputElement = q<HTMLElement>("#log-output")!;
const downloadsElement = q<HTMLElement>("#downloads")!;
const busyPill = q<HTMLElement>("#busy-pill")!;
const statusBanner = q<HTMLElement>("#status-banner")!;
const statusBannerTitle = q<HTMLElement>("#status-banner-title")!;
const statusBannerDetail = q<HTMLElement>("#status-banner-detail")!;
const taskProgressBar = q<HTMLElement>("#task-progress-bar")!;
const taskProgressMeta = q<HTMLElement>("#task-progress-meta")!;
const toastStack = q<HTMLElement>("#toast-stack")!;
const langButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-lang-button]"));

function t(key: string, vars: Record<string, string | number> = {}): string {
  const template = copy[locale][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function kindLabel(kind: string): string {
  return copy[locale][`kind_${kind}`] ?? kind;
}

function getBannerText(state: BannerState, context: { count?: number; detail?: string }) {
  if (context.detail) {
    return {
      title: t(`banner.${state}.title`),
      detail: context.detail,
    };
  }

  if (state === "done") {
    return {
      title: t("banner.done.title"),
      detail: locale === "zh"
        ? t("banner.done.detail", { count: context.count ?? 0 })
        : t("banner.done.detail", { count: context.count ?? 0, suffix: (context.count ?? 0) === 1 ? "" : "s" }),
    };
  }

  return {
    title: t(`banner.${state}.title`),
    detail: t(`banner.${state}.detail`),
  };
}

function renderBanner(): void {
  statusBanner.classList.remove(
    "status-banner-idle",
    "status-banner-working",
    "status-banner-done",
    "status-banner-error",
  );
  statusBanner.classList.add(`status-banner-${bannerState}`);
  const content = getBannerText(bannerState, bannerContext);
  statusBannerTitle.textContent = content.title;
  statusBannerDetail.textContent = content.detail;
}

function setBanner(state: BannerState, context: { count?: number; detail?: string } = {}): void {
  bannerState = state;
  bannerContext = context;
  renderBanner();
  renderTaskProgress();
}

function setLocale(next: Locale): void {
  locale = next;
  localStorage.setItem(LOCALE_KEY, next);
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  document.title = t("title");

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key) {
      el.placeholder = t(key);
    }
  });

  langButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.langButton === next);
  });

  updateLodInfo(currentLodInfo);
  if (currentDownloads.length > 0 && currentCleanupPath) {
    renderDownloads(currentDownloads, currentCleanupPath);
  } else {
    updateDownloadButtons();
  }
  renderBanner();
  renderTaskProgress();

  if (!logOutputElement.textContent || logOutputElement.textContent === copy.zh.ready || logOutputElement.textContent === copy.en.ready) {
    logOutputElement.textContent = t("ready");
  }

  if (downloadsElement.classList.contains("empty")) {
    renderDownloadsEmpty();
  }

  if (detectedKindElement.dataset.state !== "filled") {
    detectedKindElement.textContent = t("waiting");
  }
  if (resolvedUrlElement.dataset.state !== "filled") {
    resolvedUrlElement.textContent = t("unresolved");
  }
  if (progressTextElement.dataset.state !== "filled") {
    progressTextElement.textContent = t("idle");
  }
}

function appendLog(line: string): void {
  const current = logOutputElement.textContent?.trim();
  logOutputElement.textContent = current && current !== t("ready") ? `${current}\n${line}` : line;
  logOutputElement.scrollTop = logOutputElement.scrollHeight;
}

function showToast(message: string, tone: ToastTone = "info"): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toastStack.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 4200);
}

function renderTaskProgress(): void {
  const progress = activeProgress;
  const percent = progress ? Math.max(0, Math.min(1, progress.current / Math.max(progress.total, 1))) : 0;
  taskProgressBar.classList.remove(
    "task-progress-bar-idle",
    "task-progress-bar-working",
    "task-progress-bar-done",
    "task-progress-bar-error",
  );
  taskProgressBar.classList.add(`task-progress-bar-${bannerState}`);
  taskProgressBar.parentElement?.classList.toggle("is-indeterminate", !!progress?.indeterminate);
  taskProgressBar.style.width = progress?.indeterminate ? "38%" : `${Math.round(percent * 100)}%`;

  if (!progress) {
    taskProgressMeta.textContent = t("idle");
    return;
  }

  if (progress.indeterminate) {
    taskProgressMeta.textContent = t("preparing");
    return;
  }

  taskProgressMeta.textContent = `${Math.round(percent * 100)}% · ${progress.current}/${Math.max(progress.total, 1)}`;
}

function setTaskProgress(progress: ProgressInfo | null): void {
  activeProgress = progress;
  renderTaskProgress();
}

function readPendingCleanupPaths(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_CLEANUP_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writePendingCleanupPaths(paths: Iterable<string>): void {
  const values = Array.from(new Set(Array.from(paths)));
  if (values.length === 0) {
    localStorage.removeItem(PENDING_CLEANUP_KEY);
  } else {
    localStorage.setItem(PENDING_CLEANUP_KEY, JSON.stringify(values));
  }
}

function syncPendingCleanupPaths(): void {
  writePendingCleanupPaths(activeCleanupPaths);
}

function queueCleanupOnClose(): void {
  if (!clearCacheOnCloseInput.checked || activeCleanupPaths.size === 0) {
    return;
  }
  const pending = new Set(readPendingCleanupPaths());
  activeCleanupPaths.forEach((path) => pending.add(path));
  writePendingCleanupPaths(pending);
}

function setBusy(isBusy: boolean): void {
  [
    convertButton,
    sceneUrlInput,
    preserveStreamedLodInput,
    splitLodsInput,
    includeEnvironmentInput,
    lodMinLevelInput,
    lodMaxLevelInput,
    autoClearCacheInput,
    clearCacheOnCloseInput,
  ].forEach((element) => {
    element.disabled = isBusy;
  });
  busyPill.classList.toggle("hidden", !isBusy);
  updateExportModeControls();
}

function updateExportModeControls(): void {
  const preserveStreamedLod = preserveStreamedLodInput.checked;
  splitLodsInput.disabled = preserveStreamedLod || !!activeRequestId;
  includeEnvironmentInput.disabled = preserveStreamedLod || !!activeRequestId;
  lodMinLevelInput.disabled = preserveStreamedLod || !!activeRequestId;
  lodMaxLevelInput.disabled = preserveStreamedLod || !!activeRequestId;
}

async function getStorageDirectory(): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
  if (!storage.getDirectory) {
    throw new Error("OPFS unsupported");
  }
  return storage.getDirectory();
}

async function resolveDirectory(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

async function getFileHandleFromPath(path: string): Promise<FileSystemFileHandle> {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error("Invalid cached file path.");
  }
  const root = await getStorageDirectory();
  const directory = parts.length > 0 ? await resolveDirectory(root, parts) : root;
  return directory.getFileHandle(fileName);
}

async function getDirectoryHandleFromPath(path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  const root = await getStorageDirectory();
  return parts.length > 0 ? resolveDirectory(root, parts) : root;
}

async function removeOpfsPath(path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  const entryName = parts.pop()!;
  const root = await getStorageDirectory();
  const directory = parts.length > 0 ? await resolveDirectory(root, parts) : root;
  await directory.removeEntry(entryName, { recursive: true });
}

async function cleanupPaths(paths: string[], announce: boolean): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  await Promise.all(paths.map(async (path) => {
    try {
      await removeOpfsPath(path);
    } catch {
      // best effort
    }
  }));
  if (announce) {
    appendLog(`${t("cacheTag")} ${t("cacheCleared", { count: paths.length })}`);
  }
}

async function cleanupPersistedPaths(): Promise<void> {
  const pending = readPendingCleanupPaths();
  if (pending.length === 0) {
    return;
  }
  await cleanupPaths(pending, false);
  writePendingCleanupPaths([]);
  appendLog(`${t("cacheTag")} ${t("cacheRecovered", { count: pending.length })}`);
}

async function cleanupActiveArtifacts(): Promise<void> {
  const paths = Array.from(activeCleanupPaths);
  activeCleanupPaths.clear();
  syncPendingCleanupPaths();
  await cleanupPaths(paths, paths.length > 0);
  currentDownloads = [];
  currentCleanupPath = null;
  currentLodInfo = null;
  savedCachedFiles.clear();
  updateLodInfo(null);
  setTaskProgress(null);
}

function renderDownloadsEmpty(): void {
  downloadsElement.classList.add("empty");
  downloadsElement.innerHTML = `<p>${t("empty")}</p>`;
}

function resetDownloads(): void {
  activeMemoryUrls.forEach((url) => URL.revokeObjectURL(url));
  activeMemoryUrls = [];
  currentDownloads = [];
  currentCleanupPath = null;
  savedCachedFiles.clear();
  renderDownloadsEmpty();
}

function clearRenderedDownloads(): void {
  activeMemoryUrls.forEach((url) => URL.revokeObjectURL(url));
  activeMemoryUrls = [];
  downloadsElement.classList.remove("empty");
  downloadsElement.innerHTML = "";
}

function describeLodInfo(lodInfo: LodInfo | null): string {
  if (!lodInfo) {
    return t("lodEmpty");
  }
  const available = t("lodAvailable", { levels: lodInfo.availableLevels.join(", ") });
  const selected = lodInfo.defaultSelection
    ? t("lodSelectedAll")
    : t("lodSelected", { levels: lodInfo.selectedLevels.join(", ") });
  return `${available} | ${selected}`;
}

function updateLodInfo(lodInfo: LodInfo | null): void {
  currentLodInfo = lodInfo;
  lodInfoElement.textContent = describeLodInfo(lodInfo);
  lodInfoElement.dataset.state = lodInfo ? "filled" : "empty";
}

function updateDownloadButtons(): void {
  if (exportAsZipInput.checked && currentDownloads.length > 0) {
    const button = downloadsElement.querySelector<HTMLButtonElement>(".download-link");
    if (button) {
      button.textContent = t("exportZip");
    }
    return;
  }

  downloadsElement.querySelectorAll<HTMLButtonElement>(".download-link").forEach((button, index) => {
    const download = currentDownloads[index];
    if (download) {
      button.textContent = download.storage === "opfs-directory"
        ? t("exportFolder")
        : download.storage === "opfs"
          ? t("saveAs")
          : t("download");
    }
  });
}

function setProgressStatus(message: string, state: BannerState = "working", progress: ProgressInfo | null = null): void {
  progressTextElement.textContent = message;
  progressTextElement.dataset.state = "filled";
  setTaskProgress(progress);
  setBanner(state, { detail: message });
}

function formatPercent(completed: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  const clamped = Math.max(0, Math.min(1, completed / total));
  return `${Math.round(clamped * 100)}%`;
}

function describeFileExportProgress(name: string, written: number, total: number): string {
  return t("exportProgressFile", {
    name,
    percent: formatPercent(written, total),
    written: formatBytes(written),
    total: formatBytes(total),
  });
}

function describeDirectoryExportProgress(
  name: string,
  filesDone: number,
  filesTotal: number,
  written: number,
  total: number,
): string {
  return t("exportProgressFolder", {
    name,
    filesDone,
    filesTotal,
    percent: formatPercent(written, total),
    written: formatBytes(written),
    total: formatBytes(total),
  });
}

async function copyFileToWritable(
  sourceFile: File,
  writable: FileSystemWritableFileStream,
  onProgress?: (writtenBytes: number, totalBytes: number) => void,
): Promise<void> {
  const reader = sourceFile.stream().getReader();
  let writtenBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        await writable.write(value);
        writtenBytes += value.byteLength;
        onProgress?.(writtenBytes, sourceFile.size);
      }
    }
    onProgress?.(sourceFile.size, sourceFile.size);
  } finally {
    reader.releaseLock();
    await writable.close();
  }
}

type DirectoryCopyState = {
  completedFiles: number;
  totalFiles: number;
  writtenBytes: number;
  totalBytes: number;
};

async function copyDirectoryRecursive(
  sourceDirectory: FileSystemDirectoryHandle,
  targetDirectory: FileSystemDirectoryHandle,
  state: DirectoryCopyState,
  onProgress?: (state: DirectoryCopyState) => void,
): Promise<void> {
  for await (const [name, handle] of sourceDirectory.entries()) {
    if (handle.kind === "directory") {
      const nextTarget = await targetDirectory.getDirectoryHandle(name, { create: true });
      await copyDirectoryRecursive(handle, nextTarget, state, onProgress);
      continue;
    }

    const sourceFile = await handle.getFile();
    const targetFile = await targetDirectory.getFileHandle(name, { create: true });
    const baseBytes = state.writtenBytes;
    await copyFileToWritable(sourceFile, await targetFile.createWritable(), (writtenBytes) => {
      onProgress?.({
        ...state,
        writtenBytes: baseBytes + writtenBytes,
      });
    });
    state.writtenBytes = baseBytes + sourceFile.size;
    state.completedFiles += 1;
    onProgress?.({ ...state });
  }
}

class FileStreamWriter {
  constructor(private readonly writable: FileSystemWritableFileStream) {}

  async write(data: Uint8Array): Promise<void> {
    await this.writable.write(data);
  }

  async close(): Promise<void> {
    await this.writable.close();
  }
}

function normalizeZipName(name: string): string {
  const trimmed = name.replace(/\.zip$/i, "");
  return `${trimmed}.zip`;
}

function deriveZipFileName(downloads: WorkerDownload[]): string {
  if (downloads.length === 0) {
    return "supersplat-export.zip";
  }

  if (downloads.length === 1) {
    return normalizeZipName(downloads[0].fileName.replace(/\.[^.]+$/u, ""));
  }

  const first = downloads[0].fileName;
  const stripped = first.replace(/\.lod\d+\.[^.]+$/iu, "").replace(/\.[^.]+$/u, "");
  return normalizeZipName(stripped || "supersplat-export");
}

async function collectDirectoryZipEntries(
  sourceDirectory: FileSystemDirectoryHandle,
  prefix: string,
  entries: ZipEntry[],
): Promise<void> {
  for await (const [name, handle] of sourceDirectory.entries()) {
    if (handle.kind === "directory") {
      await collectDirectoryZipEntries(handle, `${prefix}${name}/`, entries);
      continue;
    }

    const file = await handle.getFile();
    entries.push({
      path: `${prefix}${name}`,
      size: file.size,
      source: { kind: "file", file },
    });
  }
}

async function collectZipEntries(downloads: WorkerDownload[]): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  for (const download of downloads) {
    if (download.storage === "opfs-directory") {
      const sourceDirectory = await getDirectoryHandleFromPath(download.opfsPath);
      await collectDirectoryZipEntries(sourceDirectory, `${download.fileName}/`, entries);
      continue;
    }

    if (download.storage === "opfs") {
      const file = await (await getFileHandleFromPath(download.opfsPath)).getFile();
      entries.push({
        path: download.fileName,
        size: file.size,
        source: { kind: "file", file },
      });
      continue;
    }

    entries.push({
      path: download.fileName,
      size: download.buffer.byteLength,
      source: { kind: "buffer", buffer: new Uint8Array(download.buffer) },
    });
  }
  return entries;
}

async function writeZipEntryData(
  entry: ZipEntry,
  writer: { write(data: Uint8Array): Promise<void>; close(): Promise<void> },
  onProgress: (writtenBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (entry.source.kind === "buffer") {
    await writer.write(entry.source.buffer);
    onProgress(entry.size, entry.size);
    await writer.close();
    return;
  }

  const reader = entry.source.file.stream().getReader();
  let writtenBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        await writer.write(value);
        writtenBytes += value.byteLength;
        onProgress(writtenBytes, entry.size);
      }
    }
    onProgress(entry.size, entry.size);
  } finally {
    reader.releaseLock();
    await writer.close();
  }
}

function describeZipExportProgress(
  name: string,
  filesDone: number,
  filesTotal: number,
  written: number,
  total: number,
): string {
  return t("exportProgressZip", {
    name,
    filesDone,
    filesTotal,
    percent: formatPercent(written, total),
    written: formatBytes(written),
    total: formatBytes(total),
  });
}

async function writeZipArchive(
  downloads: WorkerDownload[],
  zipFileName: string,
  outputWriter: { write(data: Uint8Array): Promise<void>; close(): Promise<void> },
): Promise<void> {
  const entries = await collectZipEntries(downloads);
  const zipFs = new ZipFileSystem(outputWriter);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let completedFiles = 0;
  let writtenBytes = 0;

  setProgressStatus(
    t("exportStarted", { name: zipFileName }),
    "working",
    { current: 0, total: Math.max(entries.length, 1) },
  );
  appendLog(`${t("saveTag")} ${t("exportStarted", { name: zipFileName })}`);

  for (const entry of entries) {
    const baseBytes = writtenBytes;
    const zipEntryWriter = await zipFs.createWriter(entry.path);
    await writeZipEntryData(entry, zipEntryWriter, (entryWrittenBytes) => {
      setProgressStatus(
        describeZipExportProgress(zipFileName, completedFiles, entries.length, baseBytes + entryWrittenBytes, totalBytes),
        "working",
        { current: completedFiles, total: Math.max(entries.length, 1) },
      );
    });
    writtenBytes = baseBytes + entry.size;
    completedFiles += 1;
    setProgressStatus(
      describeZipExportProgress(zipFileName, completedFiles, entries.length, writtenBytes, totalBytes),
      "working",
      { current: completedFiles, total: Math.max(entries.length, 1) },
    );
  }

  await zipFs.close();
}

async function triggerZipDownload(downloads: WorkerDownload[]): Promise<void> {
  const zipFileName = deriveZipFileName(downloads);

  if (pickerWindow.showSaveFilePicker) {
    const target = await pickerWindow.showSaveFilePicker({
      suggestedName: zipFileName,
      types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
    });
    await writeZipArchive(downloads, zipFileName, new FileStreamWriter(await target.createWritable()));
    const doneMessage = t("exportZipDone", { name: zipFileName });
    setProgressStatus(doneMessage, "done", { current: 1, total: 1 });
    appendLog(`${t("saveTag")} ${doneMessage}`);
    showToast(doneMessage, "success");
    return;
  }

  const memoryFs = new MemoryFileSystem();
  await writeZipArchive(downloads, zipFileName, memoryFs.createWriter(zipFileName));
  const zipBuffer = (memoryFs as unknown as { results: Map<string, Uint8Array> }).results.get(zipFileName);
  if (!zipBuffer) {
    throw new Error(`Failed to build ${zipFileName}.`);
  }

  const blob = new Blob([zipBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  activeMemoryUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = zipFileName;
  link.click();
  const doneMessage = t("exportZipDone", { name: zipFileName });
  setProgressStatus(doneMessage, "done", { current: 1, total: 1 });
  appendLog(`${t("saveTag")} ${doneMessage}`);
  showToast(doneMessage, "success");
}

async function triggerMemoryDownload(download: Extract<WorkerDownload, { storage: "memory" }>): Promise<void> {
  const blob = new Blob([download.buffer], { type: download.mimeType });
  const url = URL.createObjectURL(blob);
  activeMemoryUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.fileName;
  link.click();
}

async function triggerOpfsDownload(download: Extract<WorkerDownload, { storage: "opfs" }>): Promise<void> {
  const file = await (await getFileHandleFromPath(download.opfsPath)).getFile();
  setProgressStatus(t("exportStarted", { name: download.fileName }), "working", { current: 0, total: Math.max(file.size, 1) });
  appendLog(`${t("saveTag")} ${t("exportStarted", { name: download.fileName })}`);
  if (pickerWindow.showSaveFilePicker) {
    const target = await pickerWindow.showSaveFilePicker({
      suggestedName: download.fileName,
      types: [{ description: "PLY files", accept: { "application/octet-stream": [".ply"] } }],
    });
    await copyFileToWritable(file, await target.createWritable(), (writtenBytes, totalBytes) => {
      setProgressStatus(
        describeFileExportProgress(download.fileName, writtenBytes, totalBytes),
        "working",
        { current: writtenBytes, total: Math.max(totalBytes, 1) },
      );
    });
    const doneMessage = t("saveDone", { name: download.fileName });
    setProgressStatus(doneMessage, "done", { current: 1, total: 1 });
    appendLog(`${t("saveTag")} ${doneMessage}`);
    showToast(doneMessage, "success");
    return;
  }

  const url = URL.createObjectURL(file);
  activeMemoryUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.fileName;
  link.click();
  const doneMessage = t("blobDone", { name: download.fileName });
  setProgressStatus(doneMessage, "done", { current: 1, total: 1 });
  appendLog(`${t("saveTag")} ${doneMessage}`);
  showToast(doneMessage, "success");
}

async function triggerOpfsDirectoryDownload(
  download: Extract<WorkerDownload, { storage: "opfs-directory" }>,
): Promise<void> {
  if (!pickerWindow.showDirectoryPicker) {
    throw new Error(t("exportFolderUnsupported"));
  }

  const sourceDirectory = await getDirectoryHandleFromPath(download.opfsPath);
  const targetRoot = await pickerWindow.showDirectoryPicker();
  const targetDirectory = await targetRoot.getDirectoryHandle(download.fileName, { create: true });
  const state: DirectoryCopyState = {
    completedFiles: 0,
    totalFiles: download.entryCount,
    writtenBytes: 0,
    totalBytes: download.size,
  };
  const startMessage = t("exportStarted", { name: download.fileName });
  setProgressStatus(startMessage, "working", { current: 0, total: Math.max(download.entryCount, 1) });
  appendLog(`${t("saveTag")} ${startMessage}`);
  await copyDirectoryRecursive(sourceDirectory, targetDirectory, state, (nextState) => {
    setProgressStatus(
      describeDirectoryExportProgress(
        download.fileName,
        nextState.completedFiles,
        nextState.totalFiles,
        nextState.writtenBytes,
        nextState.totalBytes,
      ),
      "working",
      { current: nextState.completedFiles, total: Math.max(nextState.totalFiles, 1) },
    );
  });
  const doneMessage = t("exportFolderDone", { name: download.fileName });
  setProgressStatus(doneMessage, "done", { current: 1, total: 1 });
  appendLog(`${t("saveTag")} ${doneMessage}`);
  showToast(doneMessage, "success");
}

async function maybeAutoClearCache(): Promise<void> {
  if (!autoClearCacheInput.checked) {
    return;
  }
  const cachedDownloads = currentDownloads.filter((download) => download.storage === "opfs" || download.storage === "opfs-directory");
  if (cachedDownloads.length === 0 || !cachedDownloads.every((download) => savedCachedFiles.has(download.opfsPath))) {
    return;
  }
  await cleanupActiveArtifacts();
  appendLog(`${t("cacheTag")} ${t("autoCleared")}`);
}

function handleDownloadError(error: unknown, fallbackName: string): void {
  if (error instanceof DOMException && error.name === "AbortError") {
    const cancelledMessage = t("exportCancelled", { name: fallbackName });
    setProgressStatus(cancelledMessage, "done");
    appendLog(`${t("saveTag")} ${cancelledMessage}`);
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  setProgressStatus(message, "error");
  appendLog(`${t("errorTag")} ${message}`);
  showToast(message, "error");
}

function renderDownloads(downloads: WorkerDownload[], cleanupPath: string): void {
  clearRenderedDownloads();
  currentDownloads = downloads;
  currentCleanupPath = cleanupPath;
  activeCleanupPaths.add(cleanupPath);
  syncPendingCleanupPaths();

  const fragment = document.createDocumentFragment();

  if (exportAsZipInput.checked) {
    const item = document.createElement("div");
    item.className = "download-item";

    const meta = document.createElement("div");
    meta.className = "download-meta";

    const zipFileName = deriveZipFileName(downloads);
    const totalSize = downloads.reduce((sum, download) => sum + download.size, 0);

    const name = document.createElement("p");
    name.className = "download-name";
    name.textContent = zipFileName;

    const info = document.createElement("p");
    info.className = "download-info";
    info.textContent = locale === "zh"
      ? t("zipContents", { size: formatBytes(totalSize), count: downloads.length })
      : t("zipContents", { size: formatBytes(totalSize), count: downloads.length, suffix: downloads.length === 1 ? "" : "s" });

    meta.append(name, info);

    const button = document.createElement("button");
    button.className = "download-link";
    button.type = "button";
    button.textContent = t("exportZip");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = t("preparing");
      try {
        await triggerZipDownload(downloads);
        downloads
          .filter((download) => download.storage === "opfs" || download.storage === "opfs-directory")
          .forEach((download) => savedCachedFiles.add(download.opfsPath));
        await maybeAutoClearCache();
      } catch (error) {
        handleDownloadError(error, zipFileName);
      } finally {
        button.disabled = false;
        button.textContent = previous ?? t("exportZip");
      }
    });

    item.append(meta, button);
    fragment.append(item);
  } else {
    for (const download of downloads) {
      const item = document.createElement("div");
      item.className = "download-item";

      const meta = document.createElement("div");
      meta.className = "download-meta";

      const name = document.createElement("p");
      name.className = "download-name";
      name.textContent = download.fileName;

      const info = document.createElement("p");
      info.className = "download-info";
      info.textContent = download.storage === "opfs-directory"
        ? t("directoryInfo", {
            size: formatBytes(download.size),
            count: download.entryCount,
            root: download.rootFileName,
          })
        : `${formatBytes(download.size)}${download.storage === "opfs" ? ` · ${t("cachedSuffix")}` : ""}`;

      meta.append(name, info);

      const button = document.createElement("button");
      button.className = "download-link";
      button.type = "button";
      button.textContent = download.storage === "opfs-directory"
        ? t("exportFolder")
        : download.storage === "opfs"
          ? t("saveAs")
          : t("download");
      button.addEventListener("click", async () => {
        button.disabled = true;
        const previous = button.textContent;
        button.textContent = t("preparing");
        try {
          if (download.storage === "opfs-directory") {
            await triggerOpfsDirectoryDownload(download);
            savedCachedFiles.add(download.opfsPath);
            await maybeAutoClearCache();
          } else if (download.storage === "opfs") {
            await triggerOpfsDownload(download);
            savedCachedFiles.add(download.opfsPath);
            await maybeAutoClearCache();
          } else {
            await triggerMemoryDownload(download);
          }
        } catch (error) {
          handleDownloadError(error, download.fileName);
        } finally {
          button.disabled = false;
          button.textContent = previous
            ?? (download.storage === "opfs-directory"
              ? t("exportFolder")
              : download.storage === "opfs"
                ? t("saveAs")
                : t("download"));
        }
      });

      item.append(meta, button);
      fragment.append(item);
    }
  }

  downloadsElement.classList.remove("empty");
  downloadsElement.append(fragment);
}

function parseOptionalLevel(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function beginRequest(request: WorkerRequest): void {
  activeRequestId = request.id;
  detectedKindElement.textContent = t("waiting");
  detectedKindElement.dataset.state = "empty";
  resolvedUrlElement.textContent = t("unresolved");
  resolvedUrlElement.dataset.state = "empty";
  progressTextElement.textContent = t("idle");
  progressTextElement.dataset.state = "empty";
  setTaskProgress({ current: 0, total: 1, indeterminate: true });
  logOutputElement.textContent = t("ready");
  updateLodInfo(null);
  setBanner("working");
  appendLog(`${t("startTag")} ${request.sceneUrl}`);
  if (request.preserveStreamedLod) {
    appendLog("[config] Preserve original streamed LOD structure");
  }
  if (!request.preserveStreamedLod && (request.lodMinLevel !== null || request.lodMaxLevel !== null)) {
    appendLog(`[config] LOD ${request.lodMinLevel ?? "auto"} -> ${request.lodMaxLevel ?? "auto"}`);
  }
  resetDownloads();
  setBusy(true);
  worker.postMessage(request);
}

worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (!activeRequestId || message.requestId !== activeRequestId) {
    return;
  }

  if (message.lodInfo) {
    updateLodInfo(message.lodInfo);
  }

  if (message.type === "status") {
    progressTextElement.textContent = message.message;
    progressTextElement.dataset.state = "filled";
    setTaskProgress(message.progress ?? { current: 0, total: 1, indeterminate: true });
    setBanner("working", { detail: message.message });
    if (message.detectedKind) {
      detectedKindElement.textContent = kindLabel(message.detectedKind);
      detectedKindElement.dataset.state = "filled";
    }
    if (message.contentUrl) {
      resolvedUrlElement.textContent = message.contentUrl;
      resolvedUrlElement.dataset.state = "filled";
    }
    appendLog(`[status] ${message.message}`);
    if (message.detail) {
      appendLog(`         ${message.detail}`);
    }
    return;
  }

  if (message.type === "error") {
    progressTextElement.textContent = message.error;
    progressTextElement.dataset.state = "filled";
    setTaskProgress(message.progress ?? { current: 1, total: 1 });
    setBanner("error", { detail: message.error });
    appendLog(`${t("errorTag")} ${message.error}`);
    activeRequestId = null;
    setBusy(false);
    return;
  }

  detectedKindElement.textContent = kindLabel(message.detectedKind);
  detectedKindElement.dataset.state = "filled";
  resolvedUrlElement.textContent = message.contentUrl;
  resolvedUrlElement.dataset.state = "filled";
  progressTextElement.textContent = locale === "zh"
    ? t("generatedFiles", { count: message.downloads.length })
    : t("generatedFiles", { count: message.downloads.length, suffix: message.downloads.length === 1 ? "" : "s" });
  progressTextElement.dataset.state = "filled";
  setTaskProgress(message.progress ?? { current: 1, total: 1 });
  setBanner("done", { count: message.downloads.length });
  renderDownloads(message.downloads, message.cleanupPath);
  activeRequestId = null;
  setBusy(false);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const sceneUrl = sceneUrlInput.value.trim();
  if (!sceneUrl) {
    sceneUrlInput.focus();
    return;
  }

  const lodMinLevel = parseOptionalLevel(lodMinLevelInput.value);
  const lodMaxLevel = parseOptionalLevel(lodMaxLevelInput.value);
  if (lodMinLevel !== null && lodMaxLevel !== null && lodMinLevel > lodMaxLevel) {
    progressTextElement.textContent = t("invalidRange");
    progressTextElement.dataset.state = "filled";
    setTaskProgress({ current: 1, total: 1 });
    setBanner("error", { detail: t("invalidRange") });
    appendLog(`${t("errorTag")} ${t("invalidRange")}`);
    lodMinLevelInput.focus();
    return;
  }

  await cleanupActiveArtifacts();
  beginRequest({
    id: crypto.randomUUID(),
    sceneUrl,
    splitLods: splitLodsInput.checked,
    includeEnvironment: includeEnvironmentInput.checked,
    lodMinLevel,
    lodMaxLevel,
    preserveStreamedLod: preserveStreamedLodInput.checked,
  });
});

clearResultsButton.addEventListener("click", async () => {
  await cleanupActiveArtifacts();
  resetDownloads();
  progressTextElement.textContent = t("idle");
  progressTextElement.dataset.state = "empty";
  setTaskProgress(null);
  setBanner("idle");
  appendLog(`${t("clearTag")} ${t("clearManual")}`);
});

clearCacheOnCloseInput.addEventListener("change", () => {
  if (!clearCacheOnCloseInput.checked) {
    writePendingCleanupPaths([]);
  } else {
    syncPendingCleanupPaths();
  }
});

preserveStreamedLodInput.addEventListener("change", () => {
  updateExportModeControls();
});

exportAsZipInput.addEventListener("change", () => {
  if (currentDownloads.length > 0 && currentCleanupPath) {
    renderDownloads(currentDownloads, currentCleanupPath);
  }
});

langButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const next = button.dataset.langButton;
    if (next === "zh" || next === "en") {
      setLocale(next);
    }
  });
});

window.addEventListener("pagehide", () => {
  queueCleanupOnClose();
  if (clearCacheOnCloseInput.checked) {
    void cleanupPaths(Array.from(activeCleanupPaths), false);
  }
});
window.addEventListener("beforeunload", queueCleanupOnClose);

setLocale(locale);
setBanner("idle");
renderDownloadsEmpty();
updateExportModeControls();
void cleanupPersistedPaths();
