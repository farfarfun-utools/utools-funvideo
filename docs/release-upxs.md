v0.4.2：统一通过根目录 `build.sh` 构建前端，npm 包名调整为 `@farfarfun/utools-funvideo`；插件显示名和用户数据格式不变。

视频工坊 `v0.4.1`：新增替换背景音乐，以及 `queue_videos` AI/MCP 工具。工具只校验本机视频并加入队列，不自动运行 FFmpeg 或写文件。

下载 `utools-funvideo-0.4.2.upxs` 后导入 uTools。此包由 GitHub Actions 使用组织统一的 `utools-devtools` 打包并校验，附带 `SHA256SUMS`。视频处理依赖 uTools FFmpeg 扩展，首次使用时按提示安装。

该版本已通过自动化测试和打包校验；uTools 宿主中的安装及实际视频处理仍需分别验收。
