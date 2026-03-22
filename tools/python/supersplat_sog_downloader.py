#!/usr/bin/env python3
"""
Download published SuperSplat scene resources for a public scene.

Supported inputs:
- https://superspl.at/scene/<hash>
- https://superspl.at/s?id=<hash>
- https://superspl.at/view?id=<hash>
- direct meta.json URL
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen


USER_AGENT = "Mozilla/5.0 (compatible; SuperSplatSceneDownloader/1.0)"
CONTENT_URL_RE = re.compile(r"const\s+contentUrl\s*=\s*['\"]([^'\"]+)['\"]")
SCENE_HASH_RE = re.compile(r"/scene/([A-Za-z0-9]+)")


class DownloaderError(RuntimeError):
    pass


def fetch_text(url: str, timeout: float = 30.0) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            encoding = response.headers.get("Content-Encoding", "")
            if encoding.lower() == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", errors="replace")
    except HTTPError as exc:
        raise DownloaderError(f"HTTP {exc.code} while fetching {url}") from exc
    except URLError as exc:
        raise DownloaderError(f"Network error while fetching {url}: {exc.reason}") from exc


def fetch_bytes(url: str, timeout: float = 60.0) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            encoding = response.headers.get("Content-Encoding", "")
            if encoding.lower() == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return raw
    except HTTPError as exc:
        raise DownloaderError(f"HTTP {exc.code} while downloading {url}") from exc
    except URLError as exc:
        raise DownloaderError(f"Network error while downloading {url}: {exc.reason}") from exc


def extract_scene_hash(url: str) -> str | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    if "id" in query and query["id"]:
        return query["id"][0]

    match = SCENE_HASH_RE.search(parsed.path)
    if match:
        return match.group(1)

    return None


def classify_content_url(content_url: str) -> str:
    lower_path = urlparse(content_url).path.lower()

    if lower_path.endswith("/lod-meta.json") or lower_path.endswith("lod-meta.json"):
        return "lod"
    if lower_path.endswith("/meta.json") or lower_path.endswith("meta.json"):
        return "sog"
    if lower_path.endswith(".compressed.ply"):
        return "compressed_ply"
    if lower_path.endswith(".sog"):
        return "sog_bundled"
    if lower_path.endswith(".ply"):
        return "ply"

    raise DownloaderError(f"Unsupported published content type for URL: {content_url}")


def resolve_content_url(input_url: str) -> tuple[str, str]:
    parsed = urlparse(input_url)

    if parsed.scheme not in {"http", "https"}:
        raise DownloaderError(f"Unsupported URL scheme: {parsed.scheme or '(missing)'}")

    try:
        classify_content_url(input_url)
        scene_hash = extract_scene_hash(input_url) or "supersplat_scene"
        return input_url, scene_hash
    except DownloaderError:
        pass

    if parsed.netloc.lower() != "superspl.at":
        raise DownloaderError(
            "Only superspl.at scene/share/view URLs or a direct supported content URL are supported."
        )

    scene_hash = extract_scene_hash(input_url)
    if not scene_hash:
        raise DownloaderError("Could not extract the scene id from the provided URL.")

    share_url = f"https://superspl.at/s?id={scene_hash}"
    html = fetch_text(share_url)
    match = CONTENT_URL_RE.search(html)
    if not match:
        raise DownloaderError(
            f"Could not find contentUrl in the share page: {share_url}. "
            "The site may have changed its page structure."
        )

    return match.group(1), scene_hash


def collect_meta_files(node: Any) -> set[str]:
    files: set[str] = set()

    if isinstance(node, dict):
        for key, value in node.items():
            if key == "files" and isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        files.add(item)
            else:
                files.update(collect_meta_files(value))
    elif isinstance(node, list):
        for item in node:
            files.update(collect_meta_files(item))

    return files


def collect_lod_meta_refs(meta: dict[str, Any]) -> list[str]:
    refs: list[str] = []

    environment = meta.get("environment")
    if isinstance(environment, str) and environment:
        refs.append(environment)

    filenames = meta.get("filenames")
    if isinstance(filenames, list):
        for item in filenames:
            if isinstance(item, str) and item:
                refs.append(item)

    return refs


def is_lod_meta(meta: dict[str, Any]) -> bool:
    return "filenames" in meta or "lodLevels" in meta


def download_meta_tree(
    meta_url: str,
    local_meta_path: Path,
    overwrite: bool,
    visited_meta_urls: set[str],
    downloaded_files: set[Path],
    downloaded_meta_paths: list[Path],
) -> None:
    normalized_url = meta_url
    if normalized_url in visited_meta_urls:
        return
    visited_meta_urls.add(normalized_url)

    local_meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_text = fetch_text(meta_url)
    if not local_meta_path.exists() or overwrite:
        local_meta_path.write_text(meta_text, encoding="utf-8")
        print(f"[ok]   {local_meta_path.relative_to(local_meta_path.parents[1] if len(local_meta_path.parents) > 1 else local_meta_path.parent)}")
    else:
        print(f"[skip] {local_meta_path.name}")

    downloaded_meta_paths.append(local_meta_path)
    downloaded_files.add(local_meta_path)

    meta = json.loads(meta_text)

    for asset_name in sorted(collect_meta_files(meta)):
        asset_url = urljoin(meta_url, asset_name)
        destination = local_meta_path.parent / asset_name
        download_file(asset_url, destination, overwrite=overwrite)
        downloaded_files.add(destination)

    for child_ref in collect_lod_meta_refs(meta):
        child_url = urljoin(meta_url, child_ref)
        child_local_meta = local_meta_path.parent / child_ref
        download_meta_tree(
            child_url,
            child_local_meta,
            overwrite=overwrite,
            visited_meta_urls=visited_meta_urls,
            downloaded_files=downloaded_files,
            downloaded_meta_paths=downloaded_meta_paths,
        )


def infer_output_dir(scene_hash: str, explicit_output: str | None) -> Path:
    if explicit_output:
        return Path(explicit_output).expanduser().resolve()
    return (Path.cwd() / "downloads" / scene_hash).resolve()


def download_file(url: str, destination: Path, overwrite: bool) -> None:
    if destination.exists() and not overwrite:
        print(f"[skip] {destination.name}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    data = fetch_bytes(url)
    destination.write_bytes(data)
    print(f"[ok]   {destination.name} ({len(data)} bytes)")


def download_supersplat_scene(
    input_url: str,
    output_dir: Path,
    overwrite: bool = False,
) -> dict[str, Any]:
    content_url, scene_hash = resolve_content_url(input_url)
    output_dir.mkdir(parents=True, exist_ok=True)
    scene_kind = classify_content_url(content_url)

    print(f"Scene id : {scene_hash}")
    print(f"Meta URL : {content_url}")
    print(f"Output   : {output_dir}")

    downloaded_files: set[Path] = set()
    downloaded_meta_paths: list[Path] = []

    if scene_kind in {"lod", "sog"}:
        root_meta_text = fetch_text(content_url)
        root_meta = json.loads(root_meta_text)
        root_meta_filename = Path(urlparse(content_url).path).name or "meta.json"
        root_meta_path = output_dir / "meta.json"
        scene_kind = "lod" if is_lod_meta(root_meta) else "sog"

        if scene_kind == "lod":
            print("Scene    : streamed LOD")
        else:
            print("Scene    : unbundled SOG")

        download_meta_tree(
            content_url,
            root_meta_path,
            overwrite=overwrite,
            visited_meta_urls=set(),
            downloaded_files=downloaded_files,
            downloaded_meta_paths=downloaded_meta_paths,
        )

        asset_count = len([p for p in downloaded_files if p.suffix.lower() != ".json"])
        print(f"Assets   : {asset_count} files")
        primary_local_path = root_meta_path
        root_meta_filename_value = root_meta_filename
    else:
        filename = Path(urlparse(content_url).path).name
        primary_local_path = output_dir / filename
        print(f"Scene    : direct {scene_kind}")
        download_file(content_url, primary_local_path, overwrite=overwrite)
        downloaded_files.add(primary_local_path)
        print("Assets   : 1 file")
        root_meta_filename_value = filename

    manifest = {
        "source_url": input_url,
        "scene_hash": scene_hash,
        "meta_url": content_url,
        "root_meta_filename": root_meta_filename_value,
        "scene_kind": scene_kind,
        "downloaded_files": [
            str(path.relative_to(output_dir)).replace("\\", "/")
            for path in sorted(downloaded_files)
        ],
        "downloaded_meta_files": [
            str(path.relative_to(output_dir)).replace("\\", "/")
            for path in downloaded_meta_paths
        ],
    }
    (output_dir / "download_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    print("[ok]   download_manifest.json")
    print("Done.")

    return {
        "scene_hash": scene_hash,
        "meta_url": content_url,
        "meta_path": primary_local_path,
        "output_dir": output_dir,
        "scene_kind": scene_kind,
        "downloaded_files": manifest["downloaded_files"],
        "downloaded_meta_files": manifest["downloaded_meta_files"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download SuperSplat published SOG resources from a public scene URL."
    )
    parser.add_argument("url", help="SuperSplat scene/share/view URL, or a direct meta.json URL")
    parser.add_argument(
        "-o",
        "--output",
        help="Output directory. Defaults to ./downloads/<scene_hash>",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite files that already exist",
    )
    args = parser.parse_args()

    try:
        scene_hash = extract_scene_hash(args.url) or "supersplat_scene"
        output_dir = infer_output_dir(scene_hash, args.output)
        download_supersplat_scene(args.url, output_dir, overwrite=args.overwrite)
        return 0

    except DownloaderError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"Error: Invalid JSON in meta.json: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
