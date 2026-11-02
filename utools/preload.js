const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { VIDEO_EXTENSIONS, validateInput, outputName, buildArgs } = require('./tasks')

const enterQueue = []
let enterHandler
let active

utools.onPluginEnter(action => {
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  const files = action.payload.filter(file => file && file.isFile && typeof file.path === 'string').map(file => file.path)
  if (enterHandler) enterHandler(files)
  else enterQueue.push(files)
})

function checkedFile(file) {
  validateInput(file)
  const info = fs.statSync(file)
  if (!info.isFile()) throw new Error('输入必须是文件')
  return { path: file, name: path.basename(file), size: info.size }
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
  async runJob(job, onProgress) {
    if (active) throw new Error('已有任务正在处理')
    if (!job || typeof job.outputDir !== 'string' || !path.isAbsolute(job.outputDir) || !fs.statSync(job.outputDir).isDirectory()) throw new Error('请选择有效的输出文件夹')
    checkedFile(job.input)
    const name = outputName(job.input, job.operation, job.options)
    const temporaryDir = fs.mkdtempSync(path.join(job.outputDir, '.funvideo-'))
    const temporaryFile = path.join(temporaryDir, `${randomUUID()}${path.extname(name)}`)
    const task = { process: null, canceled: false }
    active = task
    try {
      const args = buildArgs(job, temporaryFile)
      task.process = utools.runFFmpeg(args, progress => {
        if (typeof onProgress === 'function') onProgress(progress)
      })
      await task.process
      if (task.canceled) throw new Error('任务已取消')
      if (!fs.existsSync(temporaryFile) || !fs.statSync(temporaryFile).size) throw new Error('FFmpeg 未生成有效的输出文件')
      return publishOutput(temporaryFile, job.outputDir, name)
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
