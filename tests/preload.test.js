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
  const window = { addEventListener(name, callback) { listeners[name] = callback } }
  const utools = { onPluginEnter() {}, runFFmpeg }
  const requireFromPreload = createRequire(preloadPath)
  const requireModule = name => name === 'electron' ? { webUtils: { getPathForFile } } : requireFromPreload(name)
  vm.runInNewContext(source, { window, utools, require: requireModule }, { filename: preloadPath })
  return { api: window.funvideo, listeners }
}

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
