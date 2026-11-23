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
  assert.ok(trim.indexOf('-ss') < trim.indexOf('-i'), 'trim should use fast input seeking (-ss before -i)')
  assert.deepEqual(trim.slice(trim.indexOf('-ss'), trim.indexOf('-ss') + 6), ['-ss', '2.5', '-i', input, '-t', '6.5'])

  const resize = buildArgs({ input, operation: 'resize', options: { width: 1280 } }, output)
  assert.deepEqual(resize.slice(resize.indexOf('-vf'), resize.indexOf('-vf') + 2), ['-vf', 'scale=1280:-2'])

  const convert = buildArgs({ input, operation: 'convert', options: { format: 'webm' } }, output)
  assert.ok(convert.includes('libvpx-vp9'))
  assert.ok(convert.includes('libopus'))

  const audio = buildArgs({ input, operation: 'audio' }, output)
  assert.ok(audio.includes('0:a:0'))
  assert.ok(!audio.includes('0:v:0'))

  const animate = buildArgs({ input, operation: 'animate', options: { fps: 15, width: 480, duration: 5 } }, '/out/result.gif')
  assert.match(animate[animate.indexOf('-filter_complex') + 1], /^trim=duration=5,fps=/)
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
  assert.ok(cover.indexOf('-ss') < cover.indexOf('-i'), 'cover should use fast input seeking (-ss before -i)')
  assert.ok(cover.includes('-frames:v'))
  assert.equal(outputName(input, 'cover'), '片段_封面.jpg')
  const speed = buildArgs({ input, operation: 'speed', options: { rate: 1.5 } }, output)
  assert.ok(speed.includes('setpts=PTS/1.5'))
  assert.ok(speed.includes('atempo=1.5'))
  const frames = buildArgs({ input, operation: 'frames', options: { interval: 5, count: 20 } }, '/out/frame_%04d.jpg')
  assert.ok(frames.includes('fps=1/5'))
  assert.equal(outputName(input, 'frames'), '片段_帧.jpg')
  assert.equal(outputName(input, 'sheet'), '片段_缩略图拼图.jpg')
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
  assert.throws(() => buildArgs({ input, operation: 'sheet', options: { grid: 5, interval: 2 } }, output), /拼图/)
  assert.throws(() => buildArgs({ input, operation: 'sheet', options: { grid: 3, interval: 0 } }, output), /间隔/)
  assert.equal(outputName(input, 'audio'), '片段_音频.m4a')
})

test('rejects relative paths, empty/out-of-range times, and escapes % in image2 output paths', () => {
  assert.throws(() => outputName('relative.mp4', 'compress'), /视频文件/)
  assert.throws(() => buildArgs({ input: 'relative.mp4', operation: 'compress', options: { quality: 'balanced' } }, output), /视频文件/)
  assert.throws(() => buildArgs({ input, operation: 'trim', options: { start: '', end: 5 } }, output), /裁剪时间/)
  assert.throws(() => buildArgs({ input, operation: 'trim', options: { start: 0, end: 90000 } }, output), /裁剪时间/)
  assert.throws(() => buildArgs({ input, operation: 'cover', options: { time: '' } }, '/out/cover.jpg'), /封面时间/)
  assert.throws(() => buildArgs({ input, operation: 'cover', options: { time: 90000 } }, '/out/cover.jpg'), /封面时间/)

  const frames = buildArgs({ input, operation: 'frames', options: { interval: 2, count: 5 } }, '/tmp/100%dir/frame_%04d.jpg')
  assert.equal(frames.at(-1), '/tmp/100%%dir/frame_%04d.jpg')
  const cover = buildArgs({ input, operation: 'cover', options: { time: 1 } }, '/tmp/100%dir/cover%1.jpg')
  assert.ok(cover.includes('-update'))
  assert.equal(cover.at(-1), '/tmp/100%dir/cover%1.jpg')
  const sheet = buildArgs({ input, operation: 'sheet', options: { grid: 2, interval: 1 } }, '/tmp/100%dir/sheet.jpg')
  assert.ok(sheet.includes('-update'))
  assert.equal(sheet.at(-1), '/tmp/100%dir/sheet.jpg')

  const trimFloat = buildArgs({ input, operation: 'trim', options: { start: 2.1, end: 9.3 } }, output)
  assert.equal(trimFloat[trimFloat.indexOf('-t') + 1], '7.2')

  assert.throws(() => buildArgs({ input, operation: 'crop', options: { x: '', y: 0, width: 1280, height: 720 } }, output), /偶数/)
  assert.throws(() => buildArgs({ input, operation: 'watermark', options: { image: '/images/logo.png', width: '', opacity: 0.8, position: 'center' } }, output), /水印/)
})
