const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const preloadPath = path.join(__dirname, '../utools/preload.js')
const source = fs.readFileSync(preloadPath, 'utf8')

function bridge(runFFmpeg, getPathForFile = file => file.path) {
  const listeners = {}
  const tools = new Map()
  const opened = []
  let pluginOutHandler = null
  const window = { addEventListener(name, callback) { listeners[name] = callback } }
  const utools = {
    onPluginEnter() {},
    onPluginOut(cb) { pluginOutHandler = cb },
    runFFmpeg,
    registerTool: (name, handler) => tools.set(name, handler),
    shellOpenPath(target) { opened.push(target); return '' },
  }
  const requireFromPreload = createRequire(preloadPath)
  const requireModule = name => name === 'electron' ? { webUtils: { getPathForFile } } : requireFromPreload(name)
  vm.runInNewContext(source, { window, utools, require: requireModule, setTimeout, clearTimeout }, { filename: preloadPath })
  return { api: window.funvideo, listeners, tools, opened, triggerPluginOut: () => pluginOutHandler?.() }
}

test('AI 加入队列前校验所有视频，不自动执行 FFmpeg', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-ai-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const video = path.join(directory, 'clip.mp4')
  fs.writeFileSync(video, 'video bytes')
  const runFFmpeg = () => { throw new Error('不应自动处理') }
  const { api, tools } = bridge(runFFmpeg)
  const queued = []
  api.onFiles(paths => queued.push(...paths))
  const tool = tools.get('queue_videos')
  assert.equal(tool({ paths: [video] }).queued[0].name, 'clip.mp4')
  assert.deepEqual(queued, [video])
  assert.throws(() => tool({ paths: [video, path.join(directory, 'missing.mp4')] }))
  assert.deepEqual(queued, [video])
})

test('a completed job preserves the source and never replaces an existing output', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const { api } = bridge(args => { fs.writeFileSync(args.at(-1), 'processed'); return Promise.resolve() })
  const batchDir = api.createBatchOutput('', input)
  fs.writeFileSync(path.join(batchDir, 'clip_压缩.mp4'), 'existing')
  const output = await api.runJob({ input, outputDir: batchDir, operation: 'compress', options: { quality: 'balanced' } })
  assert.match(path.basename(batchDir), /^FunVideo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
  assert.equal(path.basename(output), 'clip_压缩_2.mp4')
  assert.equal(path.dirname(output), batchDir)
  assert.equal(fs.readFileSync(input, 'utf8'), 'source')
  assert.equal(fs.readFileSync(path.join(batchDir, 'clip_压缩.mp4'), 'utf8'), 'existing')
  assert.equal(fs.readFileSync(output, 'utf8'), 'processed')
  assert.equal(fs.readdirSync(batchDir).filter(name => name.startsWith('.funvideo-')).length, 0)
})

test('each batch gets its own folder even within the same second', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const { api } = bridge(() => Promise.resolve())
  const first = api.createBatchOutput(directory, input)
  const second = api.createBatchOutput(directory, input)
  assert.notEqual(first, second)
  assert.equal(path.dirname(first), directory)
  assert.equal(path.dirname(second), directory)
  assert.match(path.basename(second), /^FunVideo_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_2)?$/)
  await assert.rejects(api.runJob({ input, operation: 'compress', options: { quality: 'balanced' } }), /输出文件夹/)
})

test('failed jobs remove partial outputs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const { api } = bridge(args => { fs.writeFileSync(args.at(-1), 'partial'); return Promise.reject(new Error('encoding failed')) })
  const batchDir = api.createBatchOutput(directory, input)
  await assert.rejects(api.runJob({ input, outputDir: batchDir, operation: 'compress', options: { quality: 'balanced' } }), /encoding failed/)
  assert.deepEqual(fs.readdirSync(batchDir), [])
})

test('replacement music must be an existing audio file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-music-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const { api } = bridge(() => { throw new Error('FFmpeg must not start') })
  const batchDir = api.createBatchOutput(directory, input)
  await assert.rejects(api.runJob({ input, outputDir: batchDir, operation: 'audio', options: { mode: 'replace', music: path.join(directory, 'missing.mp3') } }), /背景音乐/)
  await assert.rejects(api.runJob({ input, outputDir: batchDir, operation: 'audio', options: { mode: 'replace', music: directory } }), /背景音乐/)
})

test('pasting a copied video file adds it to the queue', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const { api, listeners } = bridge(() => Promise.resolve())
  let received
  api.onFiles(paths => { received = paths })
  let prevented = false
  listeners.paste({ clipboardData: { files: [{ path: input }] }, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(received[0], input)
})

test('pasting a file URL adds the video without changing ordinary input paste', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, '带 空格.mp4')
  fs.writeFileSync(input, 'source')
  const { api, listeners } = bridge(() => Promise.resolve())
  let received
  api.onFiles(paths => { received = paths })
  const data = { files: [], getData: () => `file://${input.replace(' ', '%20')}` }
  listeners.paste({ clipboardData: data, target: {}, preventDefault() {} })
  assert.equal(received[0], input)
  received = undefined
  listeners.paste({ clipboardData: data, target: { closest: () => ({}) }, preventDefault() {} })
  assert.equal(received, undefined)
})

test('dropping local videos adds supported files to the queue', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-drop-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const pathName = path.join(directory, '旅行.mov')
  fs.writeFileSync(pathName, 'video')
  const { api, listeners } = bridge(() => Promise.resolve())
  const received = []
  api.onFiles(paths => received.push(...paths))
  listeners.drop({ type: 'drop', dataTransfer: { files: [{ path: pathName }, { path: '/note.txt' }] }, preventDefault() {} })
  assert.deepEqual(received, [pathName])
})

test('cancel and onPluginOut terminate active FFmpeg task and clear active state', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-cancel-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')

  const signals = []
  let rejectProc
  const { api, triggerPluginOut } = bridge(() => {
    const p = new Promise((_resolve, reject) => { rejectProc = reject })
    p.kill = signal => {
      signals.push(signal || 'SIGTERM')
      rejectProc(new Error('killed'))
    }
    return p
  })
  const batchDir = api.createBatchOutput(directory, input)

  const first = api.runJob({ input, outputDir: batchDir, operation: 'compress', options: { quality: 'balanced' } })
  assert.equal(api.cancel(), true)
  await assert.rejects(first, /任务已取消/)
  assert.deepEqual(signals, ['SIGTERM'])

  const second = api.runJob({ input, outputDir: batchDir, operation: 'compress', options: { quality: 'balanced' } })
  triggerPluginOut()
  await assert.rejects(second, /任务已取消/)
  assert.deepEqual(signals, ['SIGTERM', 'SIGTERM'])
  assert.equal(api.cancel(), false)
})

test('image2 operations in directories containing % use safe temp dir and publish outputs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-100%dir-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')

  let seenOutputArg = ''
  const { api } = bridge(args => {
    seenOutputArg = args.at(-1)
    if (seenOutputArg.endsWith('frame_%04d.jpg')) {
      fs.writeFileSync(path.join(path.dirname(seenOutputArg), 'frame_0001.jpg'), 'jpg1')
    } else {
      fs.writeFileSync(seenOutputArg, 'jpg-cover')
    }
    return Promise.resolve()
  })
  const batchDir = api.createBatchOutput(directory, input)
  const coverOut = await api.runJob({ input, outputDir: batchDir, operation: 'cover', options: { time: 0 } })
  assert.ok(!path.dirname(seenOutputArg).includes('%'), 'temp dir for image2 should avoid %')
  assert.equal(path.dirname(coverOut), batchDir)
  assert.equal(fs.readFileSync(coverOut, 'utf8'), 'jpg-cover')

  const framesOut = await api.runJob({ input, outputDir: batchDir, operation: 'frames', options: { interval: 1, count: 2 } })
  assert.equal(framesOut, batchDir)
  assert.equal(fs.readFileSync(path.join(batchDir, 'clip_帧_0001.jpg'), 'utf8'), 'jpg1')
})

test('rejects relative paths, symlinks, 0-byte files, null queue_videos params, and arbitrary openOutput paths', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-sec-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const real = path.join(directory, 'real.mp4')
  fs.writeFileSync(real, 'video-bytes')
  const link = path.join(directory, 'link.mp4')
  fs.symlinkSync(real, link)
  const empty = path.join(directory, 'empty.mp4')
  fs.writeFileSync(empty, '')

  const { api, tools, opened } = bridge(args => {
    fs.writeFileSync(args.at(-1), 'done')
    return Promise.resolve()
  })
  const tool = tools.get('queue_videos')
  assert.throws(() => tool(null), /1 至 100/)
  assert.throws(() => tool(undefined), /1 至 100/)
  assert.throws(() => api.addFiles(['relative.mp4']), /视频文件/)
  assert.throws(() => api.addFiles([link]), /符号链接/)
  assert.throws(() => api.addFiles([empty]), /为空/)

  assert.throws(() => api.openOutput(real), /不存在/)
  const batchDir = api.createBatchOutput(directory, real)
  const output = await api.runJob({ input: real, outputDir: batchDir, operation: 'compress', options: { quality: 'balanced' } })
  api.openOutput(batchDir)
  api.openOutput(output)
  assert.deepEqual(opened, [path.resolve(batchDir), path.resolve(output)])

  await assert.rejects(
    api.runJob({ input: real, outputDir: batchDir, operation: 'watermark', options: { image: path.join(directory, 'missing.png'), width: 100, opacity: 0.8, position: 'center' } }),
    /水印图片/,
  )
  await assert.rejects(
    api.runJob({ input: real, outputDir: path.join(directory, 'no-such-dir'), operation: 'compress', options: { quality: 'balanced' } }),
    /输出文件夹/,
  )
})
