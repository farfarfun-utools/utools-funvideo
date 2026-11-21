const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fileURLToPath } = require('node:url')
const { VIDEO_EXTENSIONS, MUSIC_EXTENSIONS, validateInput, outputName, buildArgs } = require('./tasks')

const IMAGE2_OPERATIONS = new Set(['cover', 'frames', 'sheet'])
const MAX_OUTPUT_ATTEMPTS = 10000
const KILL_GRACE_MS = 2000

const enterQueue = []
const sessionOutputs = new Set()
let enterHandler
let active

function deliverFiles(files) {
  if (enterHandler) enterHandler(files)
  else enterQueue.push(files)
}

function cancelActive() {
  if (!active) return false
  const task = active
  task.canceled = true
  try { task.process?.kill?.() } catch { /* process already exited */ }
  if (!task.killTimer) {
    task.killTimer = setTimeout(() => {
      task.killTimer = null
      if (active === task) {
        try { task.process?.kill?.('SIGKILL') } catch { /* process already exited */ }
      }
    }, KILL_GRACE_MS)
    task.killTimer.unref?.()
  }
  return true
}

utools.onPluginEnter(action => {
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  const files = action.payload.filter(file => file && file.isFile && typeof file.path === 'string').map(file => file.path)
  deliverFiles(files)
})

utools.onPluginOut?.(() => {
  cancelActive()
})

function receiveFiles(event) {
  const data = event.clipboardData || event.dataTransfer
  if (!data) return
  let paths = []
  if (data.files?.length) {
    if (event.type === 'drop') event.preventDefault()
    const { webUtils } = require('electron')
    paths = [...data.files].map(file => {
      try { return webUtils.getPathForFile(file) }
      catch { return '' }
    }).filter(Boolean)
  }
  if (event.type !== 'drop' && !paths.length && !event.target?.closest?.('input, textarea, select, [contenteditable]')) {
    const text = data.getData('text/uri-list') || data.getData('text/plain')
    if (text.length <= 32768) {
      paths = text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).slice(0, 100).map(line => {
        try { return line.startsWith('file://') ? fileURLToPath(line) : line }
        catch { return '' }
      }).filter(file => path.isAbsolute(file))
    }
  }
  const videos = paths.filter(file => {
    try { checkedFile(file); return true }
    catch { return false }
  })
  if (videos.length) {
    event.preventDefault()
    deliverFiles(videos)
  }
}

window.addEventListener?.('paste', receiveFiles)
window.addEventListener?.('drop', receiveFiles)
window.addEventListener?.('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
})

function checkedFile(file) {
  validateInput(file)
  const resolved = path.resolve(file)
  let info
  try { info = fs.lstatSync(resolved) }
  catch { throw new Error('视频文件不存在或无法访问') }
  if (info.isSymbolicLink()) throw new Error('不支持符号链接文件')
  if (!info.isFile()) throw new Error('输入必须是文件')
  if (info.size <= 0) throw new Error('视频文件为空')
  return { path: resolved, name: path.basename(resolved), size: info.size }
}

utools.registerTool?.('queue_videos', params => {
  const paths = params?.paths
  if (!Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('请提供 1 至 100 个本地视频路径')
  const files = paths.map(checkedFile)
  deliverFiles(files.map(file => file.path))
  return { queued: files.map(({ name, size }) => ({ name, size })) }
})

function checkedMusic(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !MUSIC_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error('请选择受支持的背景音乐文件')
  const resolved = path.resolve(file)
  let info
  try { info = fs.lstatSync(resolved) }
  catch { throw new Error('请选择有效的背景音乐文件') }
  if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) throw new Error('请选择有效的背景音乐文件')
  return resolved
}

function checkedWatermark(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择有效的水印图片')
  const resolved = path.resolve(file)
  let stat
  try { stat = fs.lstatSync(resolved) }
  catch { throw new Error('请选择有效的水印图片') }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 32 * 1024 * 1024) {
    throw new Error('水印图片必须是 32 MB 以内的有效文件')
  }
  return resolved
}

function checkedDirectory(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('请选择有效的输出文件夹')
  const resolved = path.resolve(dir)
  let stat
  try { stat = fs.statSync(resolved) }
  catch { throw new Error('请选择有效的输出文件夹') }
  if (!stat.isDirectory()) throw new Error('请选择有效的输出文件夹')
  return resolved
}

function publishOutput(temporaryFile, directory, name) {
  const extension = path.extname(name)
  const stem = name.slice(0, -extension.length)
  for (let index = 1; index <= MAX_OUTPUT_ATTEMPTS; index++) {
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
  throw new Error('输出目录中同名文件过多，请更换输出文件夹')
}

function outputDirectory(targetDir, firstInput) {
  const input = checkedFile(firstInput)
  const parent = checkedDirectory(targetDir || path.dirname(input.path))
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  const base = `FunVideo_${stamp}`
  for (let index = 1; index <= MAX_OUTPUT_ATTEMPTS; index++) {
    const directory = path.join(parent, index === 1 ? base : `${base}_${index}`)
    try {
      fs.mkdirSync(directory)
      sessionOutputs.add(path.resolve(directory))
      return directory
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw new Error('输出目录中同名文件夹过多，请更换输出文件夹')
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
    return selected ? checkedWatermark(selected) : null
  },
  chooseMusic() {
    const selected = utools.showOpenDialog({ title: '选择背景音乐', properties: ['openFile'], filters: [{ name: '音频文件', extensions: [...MUSIC_EXTENSIONS].map(ext => ext.slice(1)) }] })?.[0]
    return selected ? checkedMusic(selected) : null
  },
  createBatchOutput: outputDirectory,
  async runJob(job, onProgress) {
    if (active) throw new Error('已有任务正在处理')
    if (!job) throw new Error('任务无效')
    const input = checkedFile(job.input)
    if (job.operation === 'watermark') checkedWatermark(job.options?.image)
    if (job.operation === 'audio' && job.options?.mode === 'replace') checkedMusic(job.options.music)
    const outputDir = checkedDirectory(job.outputDir)
    const name = outputName(input.path, job.operation, job.options)
    // image2 复用器会把输出路径里的 % 当作序号占位符；当目标目录含 % 时改用系统临时目录，再发布到目标目录。
    const tempBase = IMAGE2_OPERATIONS.has(job.operation) && outputDir.includes('%') && !os.tmpdir().includes('%')
      ? os.tmpdir()
      : outputDir
    const temporaryDir = fs.mkdtempSync(path.join(tempBase, '.funvideo-'))
    const temporaryFile = path.join(temporaryDir, job.operation === 'frames' ? 'frame_%04d.jpg' : `${randomUUID()}${path.extname(name)}`)
    const task = { process: null, canceled: false, killTimer: null }
    active = task
    try {
      const args = buildArgs({ ...job, input: input.path }, temporaryFile)
      task.process = utools.runFFmpeg(args, progress => {
        if (typeof onProgress === 'function') onProgress(progress)
      })
      await task.process
      if (task.canceled) throw new Error('任务已取消')
      if (job.operation === 'frames') {
        const files = fs.readdirSync(temporaryDir).filter(file => /^frame_\d{4}\.jpg$/.test(file)).sort()
        if (!files.length) throw new Error('视频中没有可提取的画面')
        const stem = name.slice(0, -4)
        files.forEach((file, index) => {
          const saved = publishOutput(path.join(temporaryDir, file), outputDir, `${stem}_${String(index + 1).padStart(4, '0')}.jpg`)
          sessionOutputs.add(path.resolve(saved))
        })
        sessionOutputs.add(path.resolve(outputDir))
        return outputDir
      }
      if (!fs.existsSync(temporaryFile) || !fs.statSync(temporaryFile).size) throw new Error('FFmpeg 未生成有效的输出文件')
      const published = publishOutput(temporaryFile, outputDir, name)
      sessionOutputs.add(path.resolve(published))
      return published
    } catch (error) {
      if (task.canceled) throw new Error('任务已取消')
      throw error
    } finally {
      if (task.killTimer) {
        clearTimeout(task.killTimer)
        task.killTimer = null
      }
      active = null
      try { fs.rmSync(temporaryDir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    }
  },
  cancel: cancelActive,
  openOutput(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('输出文件不存在')
    const resolved = path.resolve(file)
    if (!sessionOutputs.has(resolved) || !fs.existsSync(resolved)) throw new Error('输出文件不存在')
    return utools.shellOpenPath(resolved)
  },
}
