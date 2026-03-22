import type { ResolveResult, SceneKind } from "../types";

const HASH_RE = /^[A-Za-z0-9]+$/;
const CLOUD_FRONT_HOST = "d28zzqy0iyovbz.cloudfront.net";

function extractHashFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === "superspl.at") {
      const id = url.searchParams.get("id");
      if (id && HASH_RE.test(id)) {
        return id;
      }

      const sceneMatch = url.pathname.match(/\/scene\/([A-Za-z0-9]+)/);
      if (sceneMatch) {
        return sceneMatch[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function classifyContentUrl(contentUrl: string): SceneKind {
  const lowerPath = new URL(contentUrl).pathname.toLowerCase();

  if (lowerPath.endsWith("/lod-meta.json") || lowerPath.endsWith("lod-meta.json")) {
    return "lod";
  }
  if (lowerPath.endsWith("/meta.json") || lowerPath.endsWith("meta.json")) {
    return "sog";
  }
  if (lowerPath.endsWith(".compressed.ply")) {
    return "compressed_ply";
  }
  if (lowerPath.endsWith(".sog")) {
    return "sog_bundled";
  }
  if (lowerPath.endsWith(".ply")) {
    return "ply";
  }

  throw new Error(`Unsupported published content URL: ${contentUrl}`);
}

export function normalizeSceneInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Please enter a SuperSplat scene URL, direct content URL, or scene hash.");
  }

  if (HASH_RE.test(trimmed)) {
    return trimmed;
  }

  const hash = extractHashFromUrl(trimmed);
  if (hash) {
    return hash;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname === CLOUD_FRONT_HOST) {
      const sceneMatch = url.pathname.match(/\/([A-Za-z0-9]+)\/v1\//);
      if (!sceneMatch) {
        throw new Error("Could not derive the scene hash from this direct content URL.");
      }
      return sceneMatch[1];
    }
  } catch {
    throw new Error("The input is not a recognized SuperSplat URL or scene hash.");
  }

  throw new Error("The input is not a recognized SuperSplat URL or scene hash.");
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      mode: "cors",
      redirect: "follow",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveSceneInput(value: string): Promise<ResolveResult> {
  const trimmed = value.trim();

  try {
    const directUrl = new URL(trimmed);
    if (directUrl.hostname === CLOUD_FRONT_HOST) {
      return {
        sceneHash: normalizeSceneInput(trimmed),
        contentUrl: directUrl.toString(),
        kind: classifyContentUrl(directUrl.toString()),
      };
    }
  } catch {
    // Fall back to hash-based resolution.
  }

  const sceneHash = normalizeSceneInput(trimmed);
  const base = `https://${CLOUD_FRONT_HOST}/${sceneHash}/v1/`;
  const candidates = [
    `${base}lod-meta.json`,
    `${base}meta.json`,
    `${base}scene.compressed.ply`,
    `${base}scene.sog`,
    `${base}scene.ply`,
  ];

  for (const candidate of candidates) {
    if (await probeUrl(candidate)) {
      return {
        sceneHash,
        contentUrl: candidate,
        kind: classifyContentUrl(candidate),
      };
    }
  }

  throw new Error(
    "Could not find a public downloadable scene payload for this hash. The scene may be private, deleted, or use a format this app does not support yet."
  );
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = units[0];
  for (const next of units) {
    unit = next;
    if (size < 1024 || next === units[units.length - 1]) {
      break;
    }
    size /= 1024;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${unit}`;
}
