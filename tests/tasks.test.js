const assert = require('node:assert/strict')
const test = require('node:test')
const { buildArgs, outputName } = require('../utools/tasks')

const input = '/videos/片段.mov'
const output = '/out/result.mp4'

test('video operations produce expected FFmpeg arguments', () => {
  const compress = buildArgs({ input, operation: 'compress', options: { quality: 'balanced' } }, output)
  assert.deepEqual(compress.slice(-5), ['-crf', '28', '-preset', 'medium', output])
  assert.ok(compress.includes('0:a:0?'))

  const trim = buildArgs({ input, operation: 'trim', options: { start: 2.5, end: 9 } }, output)
  assert.deepEqual(trim.slice(trim.indexOf('-ss'), trim.indexOf('-ss') + 4), ['-ss', '2.5', '-t', '6.5'])

  const resize = buildArgs({ input, operation: 'resize', options: { width: 1280 } }, output)
  assert.deepEqual(resize.slice(resize.indexOf('-vf'), resize.indexOf('-vf') + 2), ['-vf', 'scale=1280:-2'])

  const convert = buildArgs({ input, operation: 'convert', options: { format: 'webm' } }, output)
  assert.ok(convert.includes('libvpx-vp9'))
  assert.ok(convert.includes('libopus'))

  const audio = buildArgs({ input, operation: 'audio' }, output)
  assert.ok(audio.includes('0:a:0'))
  assert.ok(!audio.includes('0:v:0'))

  const animate = buildArgs({ input, operation: 'animate', options: { fps: 15, width: 480, duration: 5 } }, '/out/result.gif')
  assert.ok(animate.some(arg => arg.includes('palettegen[p]')))
  assert.ok(animate.includes('-loop'))
  assert.equal(outputName(input, 'animate'), '片段_动图.gif')

  const transform = buildArgs({ input, operation: 'transform', options: { direction: 'clockwise' } }, output)
  assert.ok(transform.includes('transpose=1'))

  const mute = buildArgs({ input, operation: 'audio', options: { mode: 'mute' } }, output)
  assert.ok(mute.includes('-an'))
  assert.equal(outputName(input, 'audio', { mode: 'mute' }), '片段_静音.mp4')

  const gain = buildArgs({ input, operation: 'audio', options: { mode: 'gain', level: 1.5 } }, output)
  assert.ok(gain.includes('volume=1.5'))
  assert.equal(outputName(input, 'audio', { mode: 'gain' }), '片段_音量.mp4')
})

test('invalid settings are rejected before FFmpeg runs', () => {
  assert.throws(() => buildArgs({ input, operation: 'trim', options: { start: 10, end: 5 } }, output), /裁剪时间/)
  assert.throws(() => buildArgs({ input, operation: 'resize', options: { width: 1279 } }, output), /偶数/)
  assert.throws(() => buildArgs({ input, operation: 'convert', options: { format: 'exe' } }, output), /输出格式/)
  assert.throws(() => buildArgs({ input: '/videos/file.txt', operation: 'audio' }, output), /视频文件/)
  assert.throws(() => buildArgs({ input, operation: 'animate', options: { fps: 15, width: 480, duration: 31 } }, output), /动图/)
  assert.throws(() => buildArgs({ input, operation: 'audio', options: { mode: 'gain', level: 8 } }, output), /音量倍数/)
  assert.throws(() => buildArgs({ input, operation: 'transform', options: { direction: 'sideways' } }, output), /方向/)
  assert.equal(outputName(input, 'audio'), '片段_音频.m4a')
})
