# SuperSplat PLY Download

[English README](../README.md)

体验网址: [https://guwinston.github.io/supersplat_ply_download/](https://guwinston.github.io/supersplat_ply_download/)

一个简易的 SuperSplat 场景下载与转换工具。

这个仓库包含两部分：

- `tools/python/` 里的 Python CLI：适合本地批量下载、转换、处理大场景
- 浏览器前端：适合直接打开网页，粘贴 `superspl.at` 链接后导出 `PLY`

## 功能概览

- 支持 `superspl.at/scene/<id>`、`/s?id=<id>`、`/view?id=<id>`
- 支持普通 `meta.json`、`lod-meta.json`、`scene.compressed.ply`、直出的 `ply`
- 支持把公开发布的场景资源转换为 `PLY`
- LOD 场景支持按级别拆分导出
- 前端版本纯浏览器运行，不需要后端服务

## 目录结构

```text
.
├─ docs/
│  └─ README.zh-CN.md
├─ tools/
│  └─ python/
│     ├─ supersplat_sog_downloader.py
│     └─ supersplat_to_ply.py
├─ src/
├─ index.html
├─ package.json
└─ README.md
```

## Python 用法

### 依赖

- Python 3.10+
- Node.js
- `splat-transform`、`npx` 或 `npm exec`

脚本会按下面顺序自动寻找转换命令：

1. `splat-transform`
2. `npx @playcanvas/splat-transform`
3. `npm exec @playcanvas/splat-transform`

如果你想手动安装：

```bash
npm install -g @playcanvas/splat-transform
```

### 1. 只下载 SuperSplat 公开资源

```bash
python tools/python/supersplat_sog_downloader.py "https://superspl.at/scene/67841e9d"
```

默认下载到：

```text
./downloads/67841e9d
```

可选参数：

```bash
python tools/python/supersplat_sog_downloader.py "https://superspl.at/scene/67841e9d" -o ./downloads/67841e9d --overwrite
```

说明：

- 这个脚本只下载当前页面公开发布的资源
- 对普通 SOG 会下载 `meta.json + webp`
- 对 LOD 场景会递归下载所有子块 `meta.json`

### 2. 一步下载并转换成 PLY

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d"
```

默认输出到：

```text
./downloads/67841e9d/67841e9d.ply
```

可选参数：

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d" --overwrite
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/67841e9d" --workdir ./downloads -o ./output/scene.ply
```

### 3. LOD 场景按级别拆分导出

```bash
python tools/python/supersplat_to_ply.py "https://superspl.at/scene/8429e5e2" --split-lods --overwrite
```

输出类似：

```text
8429e5e2.lod0.ply
8429e5e2.lod1.ply
8429e5e2.lod2.ply
...
```

### 4. 对本地已下载场景继续转换

普通场景：

```bash
python tools/python/supersplat_to_ply.py ./downloads/67841e9d/meta.json --overwrite
```

LOD 根场景：

```bash
python tools/python/supersplat_to_ply.py ./downloads/8429e5e2/meta.json --split-lods --overwrite
```

Direct compressed ply：

```bash
python tools/python/supersplat_to_ply.py ./downloads/c67edb74/scene.compressed.ply --overwrite
```

## 本地运行网页

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

本地预览生产构建：

```bash
npm run build
npm run preview
```

## 前端版本说明

前端版本是纯浏览器执行：

- 浏览器直接请求公开的 SuperSplat 资源
- 浏览器本地转换
- 结果先写入浏览器私有缓存，再通过 `Save As` 导出

优点：

- 不需要后端服务
- 不需要数据库
- 不需要云服务器

限制：

- 超大的 LOD 场景仍可能受浏览器内存限制
- 大场景建议使用 Python CLI
- 如果未来目标站点修改了 CORS 策略，纯前端方案可能会失效

## 推荐使用方式

- 小中型场景、临时体验：直接使用网页版本
- 超大 LOD 场景、批处理：使用 `tools/python/supersplat_to_ply.py`

## References

本项目依赖或参考了以下 SuperSplat / PlayCanvas 相关项目：

- SuperSplat: [https://superspl.at/](https://superspl.at/)
- PlayCanvas `@playcanvas/splat-transform`: [https://github.com/playcanvas/splat-transform](https://github.com/playcanvas/splat-transform)
- PlayCanvas Engine: [https://github.com/playcanvas/engine](https://github.com/playcanvas/engine)

## 许可证与免责声明

- 本仓库是非官方工具，与 SuperSplat、PlayCanvas 官方没有隶属关系。
- 本仓库依赖的第三方库许可证以上游项目为准，本仓库不会覆盖或替代这些上游许可证。
- 当前使用到的 `@playcanvas/splat-transform` 和 `playcanvas` 依赖在其各自 `package.json` 中标注为 `MIT`，但你在分发、商用或二次集成前，仍应自行检查上游仓库中的最新许可证文本。
- 本工具处理的是目标页面当前公开发布的资源，不保证等于作者原始上传的源文件。
- 场景内容、模型数据及其版权归原作者或发布者所有。请仅在你有权访问、下载和使用这些资源的前提下使用本工具。