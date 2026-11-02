const bridge = window.funvideo
const jobs = []
const elements = {
  add: document.querySelector('#add-files'),
  start: document.querySelector('#start'),
  cancel: document.querySelector('#cancel'),
  output: document.querySelector('#choose-output'),
  outputLabel: document.querySelector('#output-label'),
  settings: document.querySelector('#settings-dialog'),
  settingsButton: document.querySelector('#open-settings'),
  resetOutput: document.querySelector('#reset-output'),
  batchFolder: document.querySelector('#open-batch-folder'),
  clear: document.querySelector('#clear-done'),
  list: document.querySelector('#job-list'),
  empty: document.querySelector('#empty-state'),
  count: document.querySelector('#file-count'),
  summary: document.querySelector('#queue-summary'),
  notice: document.querySelector('#notice'),
  options: document.querySelector('#options'),
}
let operation = 'compress'
let outputDir = ''
let lastBatchDir = ''
let running = false
let stopRequested = false

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#icon-${name}`)
  svg.append(use)
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

function button(iconName, action, title) {
  const control = document.createElement('button')
  control.type = 'button'
  control.className = 'row-action'
  control.title = title
  control.setAttribute('aria-label', title)
  control.append(icon(iconName))
  control.addEventListener('click', action)
  return control
}

function message(text, error = false) {
  elements.notice.textContent = text
  elements.notice.classList.toggle('error', error)
}

function formatBytes(size) {
  return size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : size >= 1024 ** 2 ? `${(size / 1024 ** 2).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`
}

function render() {
  elements.list.replaceChildren()
  for (const job of jobs) {
    const row = document.createElement('li')
    row.className = `job status-${job.status}`
    const marker = document.createElement('div')
    marker.className = 'job-marker'
    marker.append(icon(job.status === 'done' ? 'check' : 'film'))
    const body = document.createElement('div')
    body.className = 'job-body'
    const name = document.createElement('strong')
    name.textContent = job.name
    name.title = job.path
    const detail = document.createElement('span')
    const labels = { queued: '等待处理', running: `${job.progress}%`, done: '已完成', failed: '处理失败', canceled: '已取消' }
    detail.textContent = `${formatBytes(job.size)} · ${labels[job.status]}${job.error ? ` · ${job.error}` : ''}`
    detail.title = job.error || job.path
    body.append(name, detail)
    if (job.status === 'running') {
      const track = document.createElement('div')
      track.className = 'progress-track'
      const fill = document.createElement('div')
      fill.className = 'progress-fill'
      fill.style.width = `${job.progress}%`
      track.append(fill)
      body.append(track)
    }
    const actions = document.createElement('div')
    actions.className = 'job-actions'
    if (job.status === 'done') actions.append(button('external', () => openOutput(job.output), '打开输出文件'))
    if (job.status === 'failed' || job.status === 'canceled') actions.append(button('refresh', () => { job.status = 'queued'; job.error = ''; job.progress = 0; render() }, '重新加入队列'))
    if (!running && job.status !== 'running') actions.append(button('close', () => { jobs.splice(jobs.indexOf(job), 1); render() }, '从队列移除'))
    row.append(marker, body, actions)
    elements.list.append(row)
  }
  const done = jobs.filter(job => job.status === 'done').length
  const queued = jobs.filter(job => job.status === 'queued').length
  const failed = jobs.filter(job => job.status === 'failed').length
  elements.count.textContent = String(jobs.length)
  elements.empty.hidden = jobs.length > 0
  elements.summary.textContent = jobs.length ? `${queued} 待处理 · ${done} 已完成${failed ? ` · ${failed} 失败` : ''}` : '等待添加视频'
  elements.start.disabled = running || !bridge || !queued
  elements.clear.hidden = !done
}

function addFiles(files) {
  let added = 0
  for (const file of files) {
    if (jobs.some(job => job.path === file.path)) continue
    jobs.push({ ...file, status: 'queued', progress: 0, output: '', error: '' })
    added++
  }
  render()
  message(added ? `已添加 ${added} 个视频` : '这些视频已在队列中')
}

async function openOutput(file) {
  try {
    const error = await bridge.openOutput(file)
    if (error) message(error, true)
  } catch (error) {
    message(error.message, true)
  }
}

function readOptions() {
  switch (operation) {
    case 'compress': return { quality: document.querySelector('#quality').value }
    case 'trim': {
      const start = document.querySelector('#trim-start').value
      const end = document.querySelector('#trim-end').value
      if (start === '' || !Number.isFinite(Number(start)) || Number(start) < 0 || (end !== '' && (!Number.isFinite(Number(end)) || Number(end) <= Number(start)))) throw new Error('请检查裁剪时间')
      return { start, end }
    }
    case 'resize': {
      const width = Number(document.querySelector('#width').value)
      if (!Number.isInteger(width) || width < 160 || width > 7680 || width % 2) throw new Error('宽度必须是 160 至 7680 的偶数')
      return { width }
    }
    case 'convert': return { format: document.querySelector('#format').value }
    case 'animate': {
      const duration = Number(document.querySelector('#gif-duration').value)
      const width = Number(document.querySelector('#gif-width').value)
      const fps = Number(document.querySelector('#gif-fps').value)
      if (!Number.isFinite(duration) || duration < 1 || duration > 30) throw new Error('动图时长须在 1 至 30 秒之间')
      return { duration, width, fps }
    }
    case 'transform': return { direction: document.querySelector('#direction').value }
    case 'audio': {
      const mode = document.querySelector('#audio-mode').value
      const level = Number(document.querySelector('#audio-level').value)
      if (mode === 'gain' && (!Number.isFinite(level) || level < 0.25 || level > 4)) throw new Error('音量倍数须在 0.25 至 4 之间')
      return { mode, level }
    }
    default: return {}
  }
}

function setRunning(value) {
  running = value
  document.querySelectorAll('[data-lock]').forEach(control => { control.disabled = value })
  elements.options.disabled = value
  elements.cancel.hidden = !value
  elements.cancel.disabled = false
  render()
}

async function startBatch() {
  if (!bridge || running) return
  let options
  let batchDir
  const pending = jobs.filter(job => job.status === 'queued')
  if (!pending.length) return
  try {
    options = readOptions()
    batchDir = bridge.createBatchOutput(outputDir, pending[0].path)
  } catch (error) { message(error.message, true); return }
  lastBatchDir = batchDir
  elements.batchFolder.hidden = false
  elements.batchFolder.title = batchDir
  stopRequested = false
  setRunning(true)
  message('正在处理视频')
  for (const job of pending) {
    if (stopRequested) break
    job.status = 'running'
    job.progress = 0
    render()
    try {
      job.output = await bridge.runJob({ input: job.path, outputDir: batchDir, operation, options }, progress => {
        job.progress = Math.max(0, Math.min(100, Math.round(progress.percent || 0)))
        render()
      })
      job.status = 'done'
      job.progress = 100
    } catch (error) {
      job.status = stopRequested ? 'canceled' : 'failed'
      job.error = error.message || String(error)
    }
    render()
  }
  setRunning(false)
  message(stopRequested ? '已取消，未开始的任务仍在队列中' : '本轮处理结束')
}

document.querySelectorAll('[data-operation]').forEach(control => control.addEventListener('click', () => {
  operation = control.dataset.operation
  document.querySelectorAll('[data-operation]').forEach(item => {
    const selected = item === control
    item.classList.toggle('active', selected)
    item.setAttribute('aria-pressed', String(selected))
  })
  document.querySelectorAll('[data-for]').forEach(item => { item.hidden = item.dataset.for !== operation })
}))
document.querySelector('#audio-mode').addEventListener('change', event => {
  document.querySelector('#gain-setting').hidden = event.target.value !== 'gain'
})

elements.add.addEventListener('click', () => {
  try { addFiles(bridge.chooseFiles()) } catch (error) { message(error.message, true) }
})
elements.settingsButton.addEventListener('click', () => elements.settings.showModal())
document.querySelector('#close-settings').addEventListener('click', () => elements.settings.close())
elements.settings.addEventListener('click', event => {
  const bounds = elements.settings.getBoundingClientRect()
  if (event.target === elements.settings && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) elements.settings.close()
})
elements.resetOutput.addEventListener('click', () => {
  outputDir = ''
  elements.outputLabel.textContent = '首个视频所在目录'
  elements.outputLabel.title = '首个视频所在目录'
  elements.resetOutput.disabled = true
})
elements.output.addEventListener('click', () => {
  try {
    const selected = bridge.chooseOutput()
    if (!selected) return
    outputDir = selected
    elements.outputLabel.textContent = selected
    elements.outputLabel.title = selected
    elements.resetOutput.disabled = false
  } catch (error) { message(error.message, true) }
})
elements.start.addEventListener('click', startBatch)
elements.batchFolder.addEventListener('click', () => openOutput(lastBatchDir))
elements.cancel.addEventListener('click', () => { stopRequested = true; bridge.cancel(); elements.cancel.disabled = true; message('正在取消任务') })
elements.clear.addEventListener('click', () => { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].status === 'done') jobs.splice(i, 1); render() })

if (bridge) bridge.onFiles(paths => {
  try { addFiles(bridge.addFiles(paths)) } catch (error) { message(error.message, true) }
})
else {
  elements.add.disabled = true
  elements.output.disabled = true
  message('请在 uTools 中打开插件以选择和处理本地视频')
}
elements.resetOutput.disabled = true
render()
