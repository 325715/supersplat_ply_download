import type { ResolveResult, SceneKind } from "../types";

const HASH_RE = /^[A-Za-z0-9]+$/;
const CLOUD_FRONT_HOST = "d28zzqy0iyovbz.cloudfront.net";
const VERSION_RE = /\/([A-Za-z0-9]+)\/v(\d+)\//;
const MAX_CONTENT_VERSION = 20;
const CONTENT_SUFFIXES = [
  "lod-meta.json",
  "meta.json",
  "scene.compressed.ply",
  "scene.sog",
  "scene.ply",
] as const;

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
      const sceneMatch = url.pathname.match(VERSION_RE);
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

function getVersionCandidates(preferredVersion?: number | null): number[] {
  const seen = new Set<number>();
  const candidates: number[] = [];

  if (preferredVersion && preferredVersion > 0) {
    seen.add(preferredVersion);
    candidates.push(preferredVersion);
  }

  for (let version = MAX_CONTENT_VERSION; version >= 1; version -= 1) {
    if (seen.has(version)) {
      continue;
    }
    seen.add(version);
    candidates.push(version);
  }

  return candidates;
}

async function resolveVersionedScene(sceneHash: string, preferredVersion?: number | null): Promise<ResolveResult | null> {
  for (const version of getVersionCandidates(preferredVersion)) {
    const base = `https://${CLOUD_FRONT_HOST}/${sceneHash}/v${version}/`;

    for (const suffix of CONTENT_SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (!(await probeUrl(candidate))) {
        continue;
      }

      return {
        sceneHash,
        contentUrl: candidate,
        kind: classifyContentUrl(candidate),
      };
    }
  }

  return null;
}

export async function resolveSceneInput(value: string): Promise<ResolveResult> {
  const trimmed = value.trim();

  try {
    const directUrl = new URL(trimmed);
    if (directUrl.hostname === CLOUD_FRONT_HOST) {
      const versionMatch = directUrl.pathname.match(VERSION_RE);
      try {
        return {
          sceneHash: normalizeSceneInput(trimmed),
          contentUrl: directUrl.toString(),
          kind: classifyContentUrl(directUrl.toString()),
        };
      } catch {
        if (versionMatch) {
          const resolved = await resolveVersionedScene(versionMatch[1], Number(versionMatch[2]));
          if (resolved) {
            return resolved;
          }
        }
      }
    }
  } catch {
    // Fall back to hash-based resolution.
  }

  const sceneHash = normalizeSceneInput(trimmed);
  const resolved = await resolveVersionedScene(sceneHash);
  if (resolved) {
    return resolved;
  }

  throw new Error(
    "Could not find a public downloadable scene payload for this hash. The scene may be private, deleted, or published in a format this app does not support yet."
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
