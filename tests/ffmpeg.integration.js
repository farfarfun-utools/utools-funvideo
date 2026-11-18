const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { buildArgs } = require('../utools/tasks')

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', timeout: 30000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
}

test('GIF, rotation and audio gain produce playable outputs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-ffmpeg-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'input.mp4')
  ffmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', input])
  const watermark = path.join(directory, 'watermark.jpg')
  ffmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32', '-frames:v', '1', watermark])
  const jobs = [
    { operation: 'animate', options: { fps: 10, width: 160, duration: 1 }, output: 'result.gif' },
    { operation: 'transform', options: { direction: 'clockwise' }, output: 'rotated.mp4' },
    { operation: 'audio', options: { mode: 'mute' }, output: 'silent.mp4' },
    { operation: 'audio', options: { mode: 'gain', level: 1.5 }, output: 'louder.mp4' },
    { operation: 'crop', options: { x: 0, y: 0, width: 160, height: 100 }, output: 'cropped.mp4' },
    { operation: 'watermark', options: { image: watermark, width: 32, opacity: 0.8, position: 'bottom-right' }, output: 'watermarked.mp4' },
    { operation: 'cover', options: { time: 0.1 }, output: 'cover.jpg' },
    { operation: 'speed', options: { rate: 1.5 }, output: 'faster.mp4' },
  ]
  for (const job of jobs) {
    const output = path.join(directory, job.output)
    ffmpeg(buildArgs({ input, operation: job.operation, options: job.options }, output))
    assert.ok(fs.statSync(output).size > 0, job.output)
  }
  const frames = path.join(directory, 'frame_%04d.jpg')
  ffmpeg(buildArgs({ input, operation: 'frames', options: { interval: 0.2, count: 3 } }, frames))
  assert.equal(fs.readdirSync(directory).filter(file => /^frame_\d{4}\.jpg$/.test(file)).length, 3)

  const music = path.join(directory, 'music.wav')
  ffmpeg(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100', '-t', '0.3', music])
  const replaced = path.join(directory, 'replaced.mp4')
  ffmpeg(buildArgs({ input: path.join(directory, 'silent.mp4'), operation: 'audio', options: { mode: 'replace', music } }, replaced))
  assert.ok(fs.statSync(replaced).size > 0)
})

test('contact sheet samples in time order and leaves unused cells black', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'funvideo-sheet-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'portrait.mp4')
  const output = path.join(directory, 'sheet.jpg')
  ffmpeg(['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=90x160:r=10:d=0.5',
    '-f', 'lavfi', '-i', 'color=blue:s=90x160:r=10:d=0.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'mpeg4', input])
  ffmpeg(buildArgs({ input, operation: 'sheet', options: { grid: 2, interval: 0.5 } }, output))
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height', '-of', 'csv=p=0', output], { encoding: 'utf8' })
  assert.equal(probe.stdout.trim(), '640,360')
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  assert.equal(decoded.status, 0)
  const pixel = (x, y) => decoded.stdout.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)
  assert.ok(pixel(160, 90)[0] > 200 && pixel(480, 90)[2] > 200, 'first row is red then blue')
  assert.ok(pixel(20, 90).every(value => value < 12), 'portrait has black side margins')
  assert.ok(pixel(160, 270).every(value => value < 12), 'unused tile is black')
})
