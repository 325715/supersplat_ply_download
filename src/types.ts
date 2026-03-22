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
}

interface WorkerDownloadBase {
  fileName: string;
  mimeType: string;
  size: number;
}

export type WorkerDownload =
  | (WorkerDownloadBase & {
      storage: "memory";
      buffer: ArrayBuffer;
    })
  | (WorkerDownloadBase & {
      storage: "opfs";
      opfsPath: string;
    });

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
    }
  | {
      type: "error";
      requestId: string;
      error: string;
      cacheInfo?: CacheInfo;
    };
