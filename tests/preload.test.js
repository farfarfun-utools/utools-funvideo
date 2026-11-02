const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const preloadPath = path.join(__dirname, '../utools/preload.js')
const source = fs.readFileSync(preloadPath, 'utf8')

function bridge(runFFmpeg) {
  const window = {}
  const utools = { onPluginEnter() {}, runFFmpeg }
  vm.runInNewContext(source, { window, utools, require: createRequire(preloadPath) }, { filename: preloadPath })
  return window.funvideo
}

test('a completed job preserves the source and never replaces an existing output', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  fs.writeFileSync(path.join(directory, 'clip_压缩.mp4'), 'existing')
  const api = bridge(args => { fs.writeFileSync(args.at(-1), 'processed'); return Promise.resolve() })
  const output = await api.runJob({ input, outputDir: directory, operation: 'compress', options: { quality: 'balanced' } })
  assert.equal(path.basename(output), 'clip_压缩_2.mp4')
  assert.equal(fs.readFileSync(input, 'utf8'), 'source')
  assert.equal(fs.readFileSync(path.join(directory, 'clip_压缩.mp4'), 'utf8'), 'existing')
  assert.equal(fs.readFileSync(output, 'utf8'), 'processed')
  assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('.funvideo-')).length, 0)
})

test('failed jobs remove partial outputs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'clip.mp4')
  fs.writeFileSync(input, 'source')
  const api = bridge(args => { fs.writeFileSync(args.at(-1), 'partial'); return Promise.reject(new Error('encoding failed')) })
  await assert.rejects(api.runJob({ input, outputDir: directory, operation: 'compress', options: { quality: 'balanced' } }), /encoding failed/)
  assert.deepEqual(fs.readdirSync(directory), ['clip.mp4'])
})
