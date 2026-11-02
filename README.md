<p align="center"><img src="utools/logo.png" width="88" alt="视频工坊"></p>

# 视频工坊 FunVideo

基于 [uTools FFmpeg 扩展](https://www.u-tools.cn/docs/api-reference/ffmpeg.html)的本地批量视频处理插件。支持压缩为 MP4、按时间裁剪、按宽度调整尺寸、转换为 MP4/MKV/WebM、转 GIF、旋转翻转，以及提取音频、静音和调整音量。

## 使用

在 uTools 开发者工具中选择 `utools/plugin.json` 导入开发版，或从 GitHub Actions 的 `utools-funvideo-developer-files` 下载完整插件目录后导入。输入“视频工坊”进入，也可在 uTools 中选中视频文件后使用“用视频工坊处理”。添加视频、选择处理方式，然后开始处理；输出位置可从右上角设置另选。首次使用时，uTools 会引导安装 FFmpeg 扩展。

任务串行处理，逐项显示进度和错误；可以取消当前任务、重试失败任务。复制视频文件后可在插件页面直接粘贴，文件 URL 或绝对路径文本也可粘贴。每次开始处理会在目标目录下创建精确到秒的 `FunVideo_YYYY-MM-DD_HH-mm-ss` 文件夹，同一秒再次处理自动追加序号。默认目标是本批首个视频所在目录，也可指定统一目标；源文件和已有结果都不会被覆盖。插件不上传视频，不保存文件历史。输出视频保留第一条视频轨和可选的第一条音轨；提取与调节音量需要源文件有音轨。转 GIF 默认取开头 5 秒，最长可设为 30 秒。WebM 转换依赖 uTools FFmpeg 扩展中提供 VP9/Opus 编码器，需在目标平台验收。

## 开发与打包

界面使用原生 HTML/CSS/JavaScript，无前端构建依赖。图标源于 [farfarfun 品牌仓库](https://github.com/farfarfun/.github/tree/master/brand)的统一生成器。`utools/preload.js` 负责文件访问与调用 `utools.runFFmpeg()`，`utools/tasks.js` 负责生成参数。GitHub Actions 执行语法检查、测试和开发目录打包；本工作区不在本机运行构建、测试或打包。

`identity.json` 记录该插件的官方 ID `zyynr2j3`。组织 Secrets `UTOOLS_MID`、`UTOOLS_UID`、`UTOOLS_CELLPHONE` 可用时，CI 会调用组织现有的 `utools-devtools` 生成 UPXS。不要把私密身份文件提交进仓库。

## 许可

项目代码采用 MIT 许可证。FFmpeg 由 uTools 扩展提供，不包含在此仓库。
