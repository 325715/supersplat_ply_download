export type SceneKind =
  | "lod"
  | "sog"
  | "compressed_ply"
  | "sog_bundled"
  | "ply";

export interface ResolveResult {
  sceneHash: string;
  contentUrl: string;
  kind: SceneKind;
}

export interface WorkerRequest {
  id: string;
  sceneUrl: string;
  splitLods: boolean;
  includeEnvironment: boolean;
  lodMinLevel: number | null;
  lodMaxLevel: number | null;
  preserveStreamedLod: boolean;
}

interface WorkerFileDownloadBase {
  fileName: string;
  mimeType: string;
  size: number;
}

export type WorkerDownload =
  | (WorkerFileDownloadBase & {
      storage: "memory";
      buffer: ArrayBuffer;
    })
  | (WorkerFileDownloadBase & {
      storage: "opfs";
      opfsPath: string;
    })
  | {
      storage: "opfs-directory";
      fileName: string;
      size: number;
      opfsPath: string;
      entryCount: number;
      rootFileName: string;
    };

export interface LodInfo {
  availableLevels: number[];
  selectedLevels: number[];
  defaultSelection: boolean;
}

export interface CacheInfo {
  kind: "opfs";
  path: string;
  label: string;
}

export interface ProgressInfo {
  current: number;
  total: number;
  indeterminate?: boolean;
}

export type WorkerMessage =
  | {
      type: "status";
      requestId: string;
      message: string;
      detail?: string;
      detectedKind?: SceneKind;
      contentUrl?: string;
      lodInfo?: LodInfo;
      cacheInfo?: CacheInfo;
      progress?: ProgressInfo;
    }
  | {
      type: "done";
      requestId: string;
      downloads: WorkerDownload[];
      detectedKind: SceneKind;
      contentUrl: string;
      cleanupPath: string;
      lodInfo?: LodInfo;
      cacheInfo: CacheInfo;
      progress?: ProgressInfo;
    }
  | {
      type: "error";
      requestId: string;
      error: string;
      cacheInfo?: CacheInfo;
      progress?: ProgressInfo;
    };
