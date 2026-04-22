#!/usr/bin/env python3
"""
Download a public SuperSplat scene and convert its published resources to PLY.

Supported inputs:
- https://superspl.at/scene/<hash>
- https://superspl.at/s?id=<hash>
- https://superspl.at/view?id=<hash>
- direct meta.json URL
- local meta.json path
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

from supersplat_sog_downloader import (
    DownloaderError,
    collect_lod_meta_refs,
    download_supersplat_scene,
    extract_scene_hash,
    infer_output_dir,
    is_lod_meta,
)

LOCAL_EXPORT_SCRIPT = (
    Path(__file__).resolve().parents[1] / "node" / "export_3dgs_ply.mjs"
)


def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"}


def resolve_local_input_path(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if path.is_dir():
        meta_candidate = path / "meta.json"
        if meta_candidate.exists():
            return meta_candidate
        raise DownloaderError(
            "Directory input must contain meta.json, scene.compressed.ply, .sog, or another supported file."
        )
    if not path.exists():
        raise DownloaderError(f"Local input was not found: {path}")
    return path


def find_command(candidates: list[str]) -> str | None:
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def build_local_export_command(
    input_paths: list[Path],
    ply_path: Path,
) -> list[str]:
    node = find_command(["node", "node.exe"])
    if not node:
        raise DownloaderError("Could not find 'node'. Please install Node.js to export PLY with @playcanvas/splat-transform.")

    if not LOCAL_EXPORT_SCRIPT.exists():
        raise DownloaderError(f"Local exporter script was not found: {LOCAL_EXPORT_SCRIPT}")

    return [
        node,
        str(LOCAL_EXPORT_SCRIPT),
        "--output",
        str(ply_path),
        *(str(path) for path in input_paths),
    ]


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True)


def emit_completed_process_output(result: subprocess.CompletedProcess[str]) -> None:
    if result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print(result.stderr, end="" if result.stderr.endswith("\n") else "\n", file=sys.stderr)


def collect_local_meta_inputs(root_meta_path: Path) -> list[Path]:
    visited: set[Path] = set()
    leaf_inputs: list[Path] = []

    def walk(meta_path: Path) -> None:
        resolved = meta_path.resolve()
        if resolved in visited:
            return
        visited.add(resolved)

        try:
            meta = json.loads(resolved.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise DownloaderError(f"Referenced meta.json was not found: {resolved}") from exc
        except json.JSONDecodeError as exc:
            raise DownloaderError(f"Invalid JSON in {resolved}: {exc}") from exc

        if is_lod_meta(meta):
            refs = collect_lod_meta_refs(meta)
            if not refs:
                raise DownloaderError(f"LOD metadata has no child meta references: {resolved}")
            for ref in refs:
                walk((resolved.parent / ref).resolve())
            return

        leaf_inputs.append(resolved)

    walk(root_meta_path)
    return leaf_inputs


def load_meta_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DownloaderError(f"Referenced meta.json was not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise DownloaderError(f"Invalid JSON in {path}: {exc}") from exc


def is_json_meta_path(path: Path) -> bool:
    return path.name.lower() == "meta.json"


def is_direct_scene_file(path: Path) -> bool:
    lower = path.name.lower()
    return lower.endswith(".compressed.ply") or lower.endswith(".sog") or lower.endswith(".ply")


def extract_lod_level(child_ref: str) -> int | None:
    first_part = Path(child_ref).parts[0] if Path(child_ref).parts else child_ref
    prefix = first_part.split("_", 1)[0]
    if prefix.isdigit():
        return int(prefix)
    return None


def collect_split_lod_inputs(
    root_meta_path: Path,
    include_environment: bool = True,
) -> dict[int, list[Path]]:
    root_meta = load_meta_json(root_meta_path)
    if not is_lod_meta(root_meta):
        return {0: collect_local_meta_inputs(root_meta_path)}

    lod_groups: dict[int, list[Path]] = {}
    filenames = root_meta.get("filenames")
    if not isinstance(filenames, list) or not filenames:
        raise DownloaderError(f"LOD metadata has no filenames list: {root_meta_path}")

    env_ref = root_meta.get("environment")
    env_meta_path = None
    if include_environment and isinstance(env_ref, str) and env_ref:
        env_meta_path = (root_meta_path.parent / env_ref).resolve()
        if not env_meta_path.exists():
            raise DownloaderError(f"Environment meta.json was not found: {env_meta_path}")

    for child_ref in filenames:
        if not isinstance(child_ref, str) or not child_ref:
            continue
        level = extract_lod_level(child_ref)
        if level is None:
            continue
        child_meta_path = (root_meta_path.parent / child_ref).resolve()
        if not child_meta_path.exists():
            raise DownloaderError(f"LOD child meta.json was not found: {child_meta_path}")
        lod_groups.setdefault(level, [])
        if env_meta_path and env_meta_path not in lod_groups[level]:
            lod_groups[level].append(env_meta_path)
        lod_groups[level].append(child_meta_path)

    if not lod_groups:
        raise DownloaderError(f"Could not derive any LOD groups from: {root_meta_path}")

    return dict(sorted(lod_groups.items()))


def run_transform(input_paths: list[Path], ply_path: Path) -> None:
    if not input_paths:
        raise DownloaderError("No input files were found for conversion.")

    local_command = build_local_export_command(input_paths, ply_path)
    print(f"Inputs   : {len(input_paths)} source files")
    print(f"Convert  : {ply_path}")
    print(f"Command  : {' '.join(local_command)}")

    local_result = run_command(local_command)
    emit_completed_process_output(local_result)
    if local_result.returncode == 0:
        return

    raise DownloaderError(f"Local @playcanvas/splat-transform exporter exited with code {local_result.returncode}")


def resolve_split_output_paths(
    base_output: str | None,
    default_prefix: Path,
    levels: list[int],
) -> dict[int, Path]:
    if not levels:
        raise DownloaderError("No LOD levels were found for split export.")

    if base_output is None:
        base_prefix = default_prefix
    else:
        candidate = Path(base_output).expanduser().resolve()
        if candidate.suffix.lower() == ".ply":
            base_prefix = candidate.with_suffix("")
        else:
            base_prefix = candidate / default_prefix.name

    return {
        level: (base_prefix.parent / f"{base_prefix.name}.lod{level}.ply").resolve()
        for level in levels
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download a SuperSplat scene and convert its published SOG resources to PLY."
    )
    parser.add_argument(
        "input",
        help="SuperSplat URL, direct meta.json URL, local meta.json path, or a directory containing meta.json",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="PLY output path. Defaults to ./downloads/<scene_hash>/<scene_hash>.ply for URLs or alongside meta.json for local input.",
    )
    parser.add_argument(
        "--workdir",
        help="Download directory for URL inputs. Defaults to ./downloads/<scene_hash>",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing downloaded files and output PLY",
    )
    parser.add_argument(
        "--split-lods",
        action="store_true",
        help="For streamed LOD scenes, export one PLY per LOD level instead of merging everything",
    )
    args = parser.parse_args()

    try:
        if is_url(args.input):
            scene_hash = extract_scene_hash(args.input) or "supersplat_scene"
            workdir = infer_output_dir(scene_hash, args.workdir)
            result = download_supersplat_scene(args.input, workdir, overwrite=args.overwrite)
            input_path = result["meta_path"]
            default_ply = workdir / f"{result['scene_hash']}.ply"
        else:
            input_path = resolve_local_input_path(args.input)
            default_ply = input_path.with_suffix(".ply")

        use_split_lods = args.split_lods
        if use_split_lods and not is_json_meta_path(input_path):
            print(
                "Note     : --split-lods only applies to streamed LOD scenes. "
                "This scene publishes a single direct file, so falling back to normal conversion."
            )
            use_split_lods = False

        if use_split_lods and is_json_meta_path(input_path):
            root_meta = load_meta_json(input_path)
            if not is_lod_meta(root_meta):
                print(
                    "Note     : --split-lods was requested, but this scene is not a streamed LOD root. "
                    "Falling back to normal conversion."
                )
                use_split_lods = False

        if use_split_lods:
            lod_groups = collect_split_lod_inputs(input_path, include_environment=True)
            output_paths = resolve_split_output_paths(
                args.output,
                default_ply.resolve().with_suffix(""),
                list(lod_groups.keys()),
            )

            for level, ply_path in output_paths.items():
                if ply_path.exists() and not args.overwrite:
                    raise DownloaderError(
                        f"Output PLY already exists: {ply_path}. Use --overwrite to replace it."
                    )

            for level, meta_inputs in lod_groups.items():
                ply_path = output_paths[level]
                ply_path.parent.mkdir(parents=True, exist_ok=True)
                print(f"LOD      : {level}")
                run_transform(meta_inputs, ply_path)
                if not ply_path.exists():
                    raise DownloaderError(
                        f"Conversion finished but output PLY was not found: {ply_path}"
                    )
                print(f"[ok]   {ply_path}")
        else:
            ply_path = Path(args.output).expanduser().resolve() if args.output else default_ply.resolve()
            if ply_path.exists() and not args.overwrite:
                raise DownloaderError(
                    f"Output PLY already exists: {ply_path}. Use --overwrite to replace it."
                )

            ply_path.parent.mkdir(parents=True, exist_ok=True)
            if is_json_meta_path(input_path):
                meta_inputs = collect_local_meta_inputs(input_path)
                run_transform(meta_inputs, ply_path)
            elif is_direct_scene_file(input_path):
                run_transform([input_path], ply_path)
            else:
                raise DownloaderError(f"Unsupported local input file: {input_path}")

            if not ply_path.exists():
                raise DownloaderError(f"Conversion finished but output PLY was not found: {ply_path}")

            print(f"[ok]   {ply_path}")

        print("Done.")
        return 0

    except DownloaderError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
