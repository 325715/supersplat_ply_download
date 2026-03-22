import "./styles.css";

import { formatBytes } from "./lib/supersplat";
import type { CacheInfo, LodInfo, WorkerDownload, WorkerMessage, WorkerRequest } from "./types";

type Locale = "zh" | "en";
type BannerState = "idle" | "working" | "done" | "error";
type WindowWithPickers = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
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
    "form.splitTitle": "分级导出 LOD",
    "form.splitDesc": "默认开启。流式场景会按 LOD 分别导出。",
    "form.envTitle": "包含环境层",
    "form.envDesc": "如果场景提供环境 splats，会一起并入导出结果。",
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
    "downloads.note": "结果会先写入浏览器缓存，点击文件后通过 Save As 导出。",
    "downloads.autoClear": "所有结果至少保存一次后自动清理缓存",
    "downloads.clearOnClose": "关闭当前标签页时自动清理缓存",
    waiting: "等待输入",
    unresolved: "尚未解析",
    lodEmpty: "识别到 LOD 场景后会显示级别信息",
    idle: "空闲",
    ready: "就绪。",
    empty: "还没有生成任何文件。",
    saveAs: "Save As",
    download: "下载",
    preparing: "准备中...",
    cachedSuffix: "已缓存到浏览器本地",
    invalidRange: "起始 LOD 不能大于结束 LOD。",
    clearManual: "已清理当前任务生成的文件和缓存。",
    autoCleared: "所有缓存文件至少保存一次后，已自动清理缓存。",
    saveDone: "已通过 Save As 保存 {name}。",
    blobDone: "已通过浏览器下载方式导出 {name}。",
    cacheCleared: "已清理 {count} 个缓存任务。",
    cacheRecovered: "已清理上次页面遗留的 {count} 个缓存任务。",
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
    generatedFiles: "已生成 {count} 个文件",
    "banner.idle.title": "准备就绪",
    "banner.idle.detail": "粘贴一个 SuperSplat 链接后开始转换。",
    "banner.working.title": "正在处理",
    "banner.working.detail": "浏览器正在解析并转换这个场景。",
    "banner.done.title": "转换完成",
    "banner.done.detail": "已生成 {count} 个文件，下面可以直接保存。",
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
    "form.splitTitle": "Split LODs",
    "form.splitDesc": "Enabled by default. Streamed scenes export one file per LOD.",
    "form.envTitle": "Include environment",
    "form.envDesc": "Merge environment splats into the exported results when available.",
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
    "downloads.note": "Results are written into browser cache first, then exported with Save As.",
    "downloads.autoClear": "Auto clear cache after every result has been saved once",
    "downloads.clearOnClose": "Auto clear cache when this tab closes",
    waiting: "Waiting for input",
    unresolved: "Not resolved yet",
    lodEmpty: "LOD details will appear after a streamed scene is detected",
    idle: "Idle",
    ready: "Ready.",
    empty: "No files generated yet.",
    saveAs: "Save As",
    download: "Download",
    preparing: "Preparing...",
    cachedSuffix: "cached in browser storage",
    invalidRange: "Start LOD must be less than or equal to End LOD.",
    clearManual: "Cleared generated files and cache for the current job.",
    autoCleared: "Auto-cleared cache after every result was saved once.",
    saveDone: "Saved {name} with Save As.",
    blobDone: "Exported {name} using the browser download fallback.",
    cacheCleared: "Cleared {count} cached jobs.",
    cacheRecovered: "Removed {count} leftover cached jobs from a previous tab.",
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
    generatedFiles: "Generated {count} file{suffix}",
    "banner.idle.title": "Ready",
    "banner.idle.detail": "Paste a SuperSplat URL to begin.",
    "banner.working.title": "Working",
    "banner.working.detail": "This scene is being resolved and converted in your browser.",
    "banner.done.title": "Done",
    "banner.done.detail": "Generated {count} file{suffix}. You can save them below.",
    "banner.error.title": "Failed",
    "banner.error.detail": "An error occurred during conversion. Check the log for details.",
  },
};

const pickerWindow = window as WindowWithPickers;
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let locale: Locale = (localStorage.getItem(LOCALE_KEY) as Locale) || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en");
let activeRequestId: string | null = null;
let activeMemoryUrls: string[] = [];
let activeCleanupPaths = new Set<string>();
let currentDownloads: WorkerDownload[] = [];
let currentLodInfo: LodInfo | null = null;
let savedCachedFiles = new Set<string>();
let bannerState: BannerState = "idle";
let bannerContext: { count?: number; detail?: string } = {};

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const form = q<HTMLFormElement>("#converter-form")!;
const sceneUrlInput = q<HTMLInputElement>("#scene-url")!;
const splitLodsInput = q<HTMLInputElement>("#split-lods")!;
const includeEnvironmentInput = q<HTMLInputElement>("#include-environment")!;
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
  updateDownloadButtons();
  renderBanner();

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
  currentLodInfo = null;
  savedCachedFiles.clear();
  updateLodInfo(null);
}

function renderDownloadsEmpty(): void {
  downloadsElement.classList.add("empty");
  downloadsElement.innerHTML = `<p>${t("empty")}</p>`;
}

function resetDownloads(): void {
  activeMemoryUrls.forEach((url) => URL.revokeObjectURL(url));
  activeMemoryUrls = [];
  currentDownloads = [];
  savedCachedFiles.clear();
  renderDownloadsEmpty();
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
  downloadsElement.querySelectorAll<HTMLButtonElement>(".download-link").forEach((button, index) => {
    const download = currentDownloads[index];
    if (download) {
      button.textContent = download.storage === "opfs" ? t("saveAs") : t("download");
    }
  });
}

async function copyFileToWritable(sourceFile: File, writable: FileSystemWritableFileStream): Promise<void> {
  const reader = sourceFile.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        await writable.write(value);
      }
    }
  } finally {
    reader.releaseLock();
    await writable.close();
  }
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
  if (pickerWindow.showSaveFilePicker) {
    const target = await pickerWindow.showSaveFilePicker({
      suggestedName: download.fileName,
      types: [{ description: "PLY files", accept: { "application/octet-stream": [".ply"] } }],
    });
    await copyFileToWritable(file, await target.createWritable());
    appendLog(`${t("saveTag")} ${t("saveDone", { name: download.fileName })}`);
    return;
  }

  const url = URL.createObjectURL(file);
  activeMemoryUrls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = download.fileName;
  link.click();
  appendLog(`${t("saveTag")} ${t("blobDone", { name: download.fileName })}`);
}

async function maybeAutoClearCache(): Promise<void> {
  if (!autoClearCacheInput.checked) {
    return;
  }
  const cachedDownloads = currentDownloads.filter((download) => download.storage === "opfs");
  if (cachedDownloads.length === 0 || !cachedDownloads.every((download) => savedCachedFiles.has(download.opfsPath))) {
    return;
  }
  await cleanupActiveArtifacts();
  appendLog(`${t("cacheTag")} ${t("autoCleared")}`);
}

function renderDownloads(downloads: WorkerDownload[], cleanupPath: string): void {
  resetDownloads();
  currentDownloads = downloads;
  activeCleanupPaths.add(cleanupPath);
  syncPendingCleanupPaths();

  const fragment = document.createDocumentFragment();
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
    info.textContent = `${formatBytes(download.size)}${download.storage === "opfs" ? ` · ${t("cachedSuffix")}` : ""}`;

    meta.append(name, info);

    const button = document.createElement("button");
    button.className = "download-link";
    button.type = "button";
    button.textContent = download.storage === "opfs" ? t("saveAs") : t("download");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = t("preparing");
      try {
        if (download.storage === "opfs") {
          await triggerOpfsDownload(download);
          savedCachedFiles.add(download.opfsPath);
          await maybeAutoClearCache();
        } else {
          await triggerMemoryDownload(download);
        }
      } catch (error) {
        appendLog(`${t("errorTag")} ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        button.disabled = false;
        button.textContent = previous ?? (download.storage === "opfs" ? t("saveAs") : t("download"));
      }
    });

    item.append(meta, button);
    fragment.append(item);
  }

  downloadsElement.classList.remove("empty");
  downloadsElement.innerHTML = "";
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
  logOutputElement.textContent = t("ready");
  updateLodInfo(null);
  setBanner("working");
  appendLog(`${t("startTag")} ${request.sceneUrl}`);
  if (request.lodMinLevel !== null || request.lodMaxLevel !== null) {
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
    setBanner("error", { detail: message.error });
    appendLog(`${t("errorTag")} ${message.error}`);
    setBusy(false);
    activeRequestId = null;
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
  setBanner("done", { count: message.downloads.length });
  renderDownloads(message.downloads, message.cleanupPath);
  setBusy(false);
  activeRequestId = null;
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
  });
});

clearResultsButton.addEventListener("click", async () => {
  await cleanupActiveArtifacts();
  resetDownloads();
  progressTextElement.textContent = t("idle");
  progressTextElement.dataset.state = "empty";
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
void cleanupPersistedPaths();