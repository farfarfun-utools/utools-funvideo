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

  const replace = buildArgs({ input, operation: 'audio', options: { mode: 'replace', music: '/music/theme.mp3' } }, output)
  assert.deepEqual(replace.slice(replace.indexOf('-stream_loop'), replace.indexOf('-stream_loop') + 4), ['-stream_loop', '-1', '-i', '/music/theme.mp3'])
  assert.ok(replace.includes('-shortest'))
  assert.equal(outputName(input, 'audio', { mode: 'replace' }), '片段_配乐.mp4')

  const crop = buildArgs({ input, operation: 'crop', options: { x: 0, y: 2, width: 1280, height: 720 } }, output)
  assert.ok(crop.includes('crop=1280:720:0:2'))
  const watermark = buildArgs({ input, operation: 'watermark', options: { image: '/images/logo.png', width: 180, opacity: 0.8, position: 'bottom-right' } }, output)
  assert.ok(watermark.includes('/images/logo.png'))
  assert.ok(watermark.some(arg => arg.includes('overlay=W-w-24:H-h-24')))
  const cover = buildArgs({ input, operation: 'cover', options: { time: 2 } }, '/out/cover.jpg')
  assert.ok(cover.includes('-frames:v'))
  assert.equal(outputName(input, 'cover'), '片段_封面.jpg')
  const speed = buildArgs({ input, operation: 'speed', options: { rate: 1.5 } }, output)
  assert.ok(speed.includes('setpts=PTS/1.5'))
  assert.ok(speed.includes('atempo=1.5'))
  const frames = buildArgs({ input, operation: 'frames', options: { interval: 5, count: 20 } }, '/out/frame_%04d.jpg')
  assert.ok(frames.includes('fps=1/5'))
  assert.equal(outputName(input, 'frames'), '片段_帧.jpg')
})

test('invalid settings are rejected before FFmpeg runs', () => {
  assert.throws(() => buildArgs({ input, operation: 'trim', options: { start: 10, end: 5 } }, output), /裁剪时间/)
  assert.throws(() => buildArgs({ input, operation: 'resize', options: { width: 1279 } }, output), /偶数/)
  assert.throws(() => buildArgs({ input, operation: 'convert', options: { format: 'exe' } }, output), /输出格式/)
  assert.throws(() => buildArgs({ input: '/videos/file.txt', operation: 'audio' }, output), /视频文件/)
  assert.throws(() => buildArgs({ input, operation: 'animate', options: { fps: 15, width: 480, duration: 31 } }, output), /动图/)
  assert.throws(() => buildArgs({ input, operation: 'audio', options: { mode: 'gain', level: 8 } }, output), /音量倍数/)
  assert.throws(() => buildArgs({ input, operation: 'audio', options: { mode: 'replace', music: '/music/theme.txt' } }, output), /背景音乐/)
  assert.throws(() => buildArgs({ input, operation: 'transform', options: { direction: 'sideways' } }, output), /方向/)
  assert.throws(() => buildArgs({ input, operation: 'crop', options: { x: 1, y: 0, width: 1280, height: 720 } }, output), /偶数/)
  assert.throws(() => buildArgs({ input, operation: 'watermark', options: { image: '/tmp/a.txt', width: 180, opacity: 0.8, position: 'center' } }, output), /水印图片/)
  assert.throws(() => buildArgs({ input, operation: 'speed', options: { rate: 3 } }, output), /变速倍数/)
  assert.throws(() => buildArgs({ input, operation: 'frames', options: { interval: 5, count: 101 } }, output), /抽帧/)
  assert.equal(outputName(input, 'audio'), '片段_音频.m4a')
})
