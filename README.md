# SuperSplat PLY Download

[中文文档](./docs/README.zh-CN.md)

Live demo: [https://guwinston.github.io/supersplat_ply_download/](https://guwinston.github.io/supersplat_ply_download/)

A lightweight downloader and converter for public SuperSplat scenes.

This repository contains two parts:

- `tools/python/` Python CLI tools for local downloading and conversion, especially for large scenes
- A browser-based frontend for directly exporting `PLY` from a `superspl.at` URL

## Features

- Supports `superspl.at/scene/<id>`, `/s?id=<id>`, and `/view?id=<id>`
- Supports `meta.json`, `lod-meta.json`, `scene.compressed.ply`, and direct `ply`
- Converts published public scene payloads into `PLY`
- Supports split export for streamed LOD scenes
- Frontend runs fully in the browser, with no backend service required
- Python CLI works on Windows and Linux

## Project Structure

```text
.
|-- docs/
|   `-- README.zh-CN.md
|-- tools/
|   `-- python/
|       |-- supersplat_sog_downloader.py
|       `-- supersplat_to_ply.py
|-- src/
|-- index.html
|-- package.json
`-- README.md
```

## Python CLI

### Requirements

- Python 3.10+
- Node.js
- `splat-transform`, `npx`, or `npm exec`

The scripts look for a conversion command in this order:

1. `splat-transform`
2. `npx @playcanvas/splat-transform`
3. `npm exec @playcanvas/splat-transform`

Optional manual install:

```bash
npm install -g @playcanvas/splat-transform
```

### Linux / WSL compatibility

On some older Linux or WSL environments, native `@playcanvas/splat-transform` may fail with errors such as:

- `GLIBCXX_3.4.29 not found`
- `ERR_DLOPEN_FAILED`
- `libstdc++.so.6`
- `webgpu/dist/linux-x64.dawn.node`

This usually means the distro runtime is too old for the bundled native `webgpu` module. In that case, `sudo apt install libstdc++6` may still not help if the distro repository itself only provides an older `libstdc++`.

Recommended Linux versions:

- Ubuntu 22.04 or newer
- Ubuntu 24.04 recommended
- Debian 12 or newer

If you hit the errors above, the recommended options are:

- Upgrade your Linux / WSL distribution to a newer version
- Use the browser frontend instead of the Python CLI for quick one-off conversions
- Use Windows directly if your local Windows environment already works

For older Linux / WSL environments, upgrading the distro is more reliable than trying to patch `libstdc++` manually.

### Download published SuperSplat resources only

```bash
python tools/python/supersplat_sog_downloader.py "https://superspl.at/scene/67841e9d"
```

Default output directory:

```text
./downloads/67841e9d
```

Optional arguments:

```bash
python tools/python/supersplat_sog_downloader.py "https://superspl.at/scene/67841e9d" -o ./downloads/67841e9d --overwrite
```

Notes:

- This downloads the currently published public payload only
- For standard SOG scenes it downloads `meta.json + webp`
- For streamed LOD scenes it recursively downloads child `meta.json` files

### Download and convert to PLY in one step

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d"
```

Default output path:

```text
./downloads/67841e9d/67841e9d.ply
```

Optional arguments:

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d" --overwrite
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d" --workdir ./downloads -o ./output/scene.ply
```

If you hit Linux / WSL runtime errors here, upgrading the distro or using the browser frontend is recommended.

### Split LOD export

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/8429e5e2" --split-lods --overwrite
```

Example outputs:

```text
8429e5e2.lod0.ply
8429e5e2.lod1.ply
8429e5e2.lod2.ply
...
```

### Convert from local files

Standard scene:

```bash
python tools/python/supersplat_to_ply.py ./downloads/67841e9d/meta.json --overwrite
```

LOD root scene:

```bash
python tools/python/supersplat_to_ply.py ./downloads/8429e5e2/meta.json --split-lods --overwrite
```

Direct compressed ply:

```bash
python tools/python/supersplat_to_ply.py ./downloads/c67edb74/scene.compressed.ply --overwrite
```

## Run the Web App Locally

Install dependencies:

```bash
npm install
```

Start dev server:

```bash
npm run dev
```

Preview production build locally:

```bash
npm run build
npm run preview
```

## Browser Version Notes

The frontend runs entirely in the browser:

- It fetches public SuperSplat resources directly
- It converts locally in the browser
- It writes results to browser-private cache first, then exports with `Save As`

Advantages:

- No backend service
- No database
- No cloud server required

Limitations:

- Very large LOD scenes may still hit browser memory limits
- For large scenes, the Python CLI is recommended
- If target-site CORS behavior changes in the future, the browser-only workflow may stop working

## Recommended Usage

- Small and medium scenes, quick testing: use the web app
- Large streamed LOD scenes or batch workflows: use `tools/python/supersplat_to_ply.py`
- Older Linux / WSL with native `GLIBCXX` or `webgpu` errors: upgrade the distro or use the browser frontend

## References

This project depends on or references the following SuperSplat / PlayCanvas related projects:

- SuperSplat: [https://superspl.at/](https://superspl.at/)
- PlayCanvas `@playcanvas/splat-transform`: [https://github.com/playcanvas/splat-transform](https://github.com/playcanvas/splat-transform)
- PlayCanvas Engine: [https://github.com/playcanvas/engine](https://github.com/playcanvas/engine)

## License / Disclaimer

- This repository is a non-official tool and is not affiliated with SuperSplat or PlayCanvas.
- Third-party dependencies follow their own upstream licenses. This repository does not replace or override those licenses.
- The currently used `@playcanvas/splat-transform` and `playcanvas` dependencies are marked as `MIT` in their package metadata, but you should still verify the latest upstream license texts before redistribution, commercial use, or deeper integration.
- This tool works with the currently published public payloads of a scene and does not guarantee access to the creator's original source files.
- Scene content, model data, and copyright remain with the original author or publisher. Only use this tool where you have the right to access, download, and use the content.
