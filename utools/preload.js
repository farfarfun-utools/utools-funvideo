const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fileURLToPath } = require('node:url')
const { VIDEO_EXTENSIONS, MUSIC_EXTENSIONS, validateInput, outputName, buildArgs } = require('./tasks')

const enterQueue = []
let enterHandler
let active

function deliverFiles(files) {
  if (enterHandler) enterHandler(files)
  else enterQueue.push(files)
}

utools.onPluginEnter(action => {
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  const files = action.payload.filter(file => file && file.isFile && typeof file.path === 'string').map(file => file.path)
  deliverFiles(files)
})

window.addEventListener?.('paste', event => {
  const data = event.clipboardData
  if (!data) return
  let paths = []
  if (data.files?.length) {
    const { webUtils } = require('electron')
    paths = [...data.files].map(file => {
      try { return webUtils.getPathForFile(file) }
      catch { return '' }
    }).filter(Boolean)
  }
  if (!paths.length && !event.target?.closest?.('input, textarea, select, [contenteditable]')) {
    const text = data.getData('text/uri-list') || data.getData('text/plain')
    if (text.length <= 32768) {
      paths = text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).slice(0, 100).map(line => {
        try { return line.startsWith('file://') ? fileURLToPath(line) : line }
        catch { return '' }
      }).filter(file => path.isAbsolute(file))
    }
  }
  const videos = paths.filter(file => {
    try { return VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()) && fs.statSync(file).isFile() }
    catch { return false }
  })
  if (videos.length) {
    event.preventDefault()
    deliverFiles(videos)
  }
})

function checkedFile(file) {
  validateInput(file)
  const info = fs.statSync(file)
  if (!info.isFile()) throw new Error('输入必须是文件')
  return { path: file, name: path.basename(file), size: info.size }
}

utools.registerTool?.('queue_videos', ({ paths }) => {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请提供 1 至 100 个本地视频路径')
  const files = paths.map(checkedFile)
  deliverFiles(files.map(file => file.path))
  return { queued: files.map(({ name, size }) => ({ name, size })) }
})

function checkedMusic(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !MUSIC_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error('请选择受支持的背景音乐文件')
  try { if (fs.statSync(file).isFile()) return file }
  catch {}
  throw new Error('请选择有效的背景音乐文件')
}

function publishOutput(temporaryFile, directory, name) {
  const extension = path.extname(name)
  const stem = name.slice(0, -extension.length)
  for (let index = 1; ; index++) {
    const target = path.join(directory, index === 1 ? name : `${stem}_${index}${extension}`)
    try {
      try {
        fs.linkSync(temporaryFile, target)
      } catch (error) {
        if (!['EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(error.code)) throw error
        fs.copyFileSync(temporaryFile, target, fs.constants.COPYFILE_EXCL)
      }
      return target
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}

function outputDirectory(targetDir, firstInput) {
  checkedFile(firstInput)
  const parent = targetDir || path.dirname(firstInput)
  if (typeof parent !== 'string' || !path.isAbsolute(parent) || !fs.statSync(parent).isDirectory()) throw new Error('请选择有效的输出文件夹')
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const base = `FunVideo_${stamp}`
  for (let index = 1; ; index++) {
    const directory = path.join(parent, index === 1 ? base : `${base}_${index}`)
    try { fs.mkdirSync(directory); return directory }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
}

window.funvideo = {
  onFiles(callback) {
    enterHandler = callback
    for (const files of enterQueue.splice(0)) callback(files)
  },
  addFiles(paths) {
    if (!Array.isArray(paths)) throw new Error('文件列表无效')
    return paths.map(checkedFile)
  },
  chooseFiles() {
    const files = utools.showOpenDialog({
      title: '选择视频',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '视频文件', extensions: [...VIDEO_EXTENSIONS].map(ext => ext.slice(1)) }],
    })
    return files ? files.map(checkedFile) : []
  },
  chooseOutput() {
    const selected = utools.showOpenDialog({ title: '选择输出文件夹', properties: ['openDirectory'] })
    return selected?.[0] || null
  },
  chooseWatermark() {
    const selected = utools.showOpenDialog({ title: '选择水印图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })?.[0]
    if (!selected) return null
    const stat = fs.statSync(selected)
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('水印图片必须是 32 MB 以内的文件')
    return selected
  },
  chooseMusic() {
    const selected = utools.showOpenDialog({ title: '选择背景音乐', properties: ['openFile'], filters: [{ name: '音频文件', extensions: [...MUSIC_EXTENSIONS].map(ext => ext.slice(1)) }] })?.[0]
    return selected ? checkedMusic(selected) : null
  },
  createBatchOutput: outputDirectory,
  async runJob(job, onProgress) {
    if (active) throw new Error('已有任务正在处理')
    if (!job) throw new Error('任务无效')
    checkedFile(job.input)
    if (job.operation === 'watermark') {
      const image = job.options?.image
      if (typeof image !== 'string' || !path.isAbsolute(image) || !fs.statSync(image).isFile() || fs.statSync(image).size > 32 * 1024 * 1024) throw new Error('请选择有效的水印图片')
    }
    if (job.operation === 'audio' && job.options?.mode === 'replace') checkedMusic(job.options.music)
    const outputDir = job.outputDir
    if (typeof outputDir !== 'string' || !path.isAbsolute(outputDir) || !fs.statSync(outputDir).isDirectory()) throw new Error('请选择有效的输出文件夹')
    const name = outputName(job.input, job.operation, job.options)
    const temporaryDir = fs.mkdtempSync(path.join(outputDir, '.funvideo-'))
    const temporaryFile = path.join(temporaryDir, job.operation === 'frames' ? 'frame_%04d.jpg' : `${randomUUID()}${path.extname(name)}`)
    const task = { process: null, canceled: false }
    active = task
    try {
      const args = buildArgs(job, temporaryFile)
      task.process = utools.runFFmpeg(args, progress => {
        if (typeof onProgress === 'function') onProgress(progress)
      })
      await task.process
      if (task.canceled) throw new Error('任务已取消')
      if (job.operation === 'frames') {
        const files = fs.readdirSync(temporaryDir).filter(file => /^frame_\d{4}\.jpg$/.test(file)).sort()
        if (!files.length) throw new Error('视频中没有可提取的画面')
        const stem = name.slice(0, -4)
        files.forEach((file, index) => publishOutput(path.join(temporaryDir, file), outputDir, `${stem}_${String(index + 1).padStart(4, '0')}.jpg`))
        return outputDir
      }
      if (!fs.existsSync(temporaryFile) || !fs.statSync(temporaryFile).size) throw new Error('FFmpeg 未生成有效的输出文件')
      return publishOutput(temporaryFile, outputDir, name)
    } catch (error) {
      if (task.canceled) throw new Error('任务已取消')
      throw error
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true })
      active = null
    }
  },
  cancel() {
    if (!active) return false
    active.canceled = true
    active.process?.kill()
    return true
  },
  openOutput(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !fs.existsSync(file)) throw new Error('输出文件不存在')
    return utools.shellOpenPath(file)
  },
}
