# 视频工坊 FunVideo

基于 [uTools FFmpeg 扩展](https://www.u-tools.cn/docs/api-reference/ffmpeg.html)的本地批量视频处理插件。首版支持压缩为 MP4、按时间裁剪、按宽度调整尺寸、转换为 MP4/MKV/WebM，以及提取 M4A 音频。

## 使用

在 uTools 开发者工具中选择 `utools/plugin.json` 导入开发版，或从 GitHub Actions 的 `utools-funvideo-developer-files` 下载完整插件目录后导入。输入“视频工坊”进入，也可在 uTools 中选中视频文件后使用“用视频工坊处理”。添加视频、选择输出文件夹和处理方式，然后开始处理。首次使用时，uTools 会引导安装 FFmpeg 扩展。

任务串行处理，逐项显示进度和错误；可以取消当前任务、重试失败任务。输出文件不会覆盖源文件或已有同名文件。插件不上传视频，不保存文件历史。输出视频保留第一条视频轨和可选的第一条音轨；提取音频需要源文件有音轨。WebM 转换依赖 uTools FFmpeg 扩展中提供 VP9/Opus 编码器，需在目标平台验收。

## 开发与打包

界面使用原生 HTML/CSS/JavaScript，无前端构建依赖。`utools/preload.js` 负责文件访问与调用 `utools.runFFmpeg()`，`utools/tasks.js` 负责生成参数。GitHub Actions 执行语法检查、测试和开发目录打包；本工作区不在本机运行构建、测试或打包。

`identity.json` 的 `pluginId` 留空，因为新插件尚未在 uTools 官方开发者工具注册。获得该插件的官方 ID 后填入；组织 Secrets `UTOOLS_MID`、`UTOOLS_UID`、`UTOOLS_CELLPHONE` 可用时，CI 才会调用组织现有的 `utools-devtools` 生成 UPXS。不要使用其他插件的 ID 或把私密身份文件提交进仓库。

## 许可

项目代码采用 MIT 许可证。FFmpeg 由 uTools 扩展提供，不包含在此仓库。
