const path = require('node:path')

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv', '.m4v'])
const MUSIC_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg'])
const OPERATIONS = new Set(['compress', 'trim', 'resize', 'convert', 'animate', 'transform', 'audio', 'crop', 'watermark', 'cover', 'speed', 'frames'])

function validateInput(input) {
  if (typeof input !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(input).toLowerCase())) {
    throw new Error('请选择受支持的视频文件')
  }
  return input
}

function outputName(input, operation, options = {}) {
  options = options || {}
  const base = path.basename(input, path.extname(input))
  const suffix = { compress: '压缩', trim: '裁剪', resize: '尺寸', convert: '转换', animate: '动图', transform: '变换', audio: { extract: '音频', mute: '静音', gain: '音量', replace: '配乐' }[options.mode || 'extract'], crop: '画面裁剪', watermark: '水印', cover: '封面', speed: '变速', frames: '帧' }[operation]
  if (!suffix) throw new Error('不支持的处理方式')
  const extension = operation === 'audio' ? (['mute', 'gain', 'replace'].includes(options.mode) ? 'mp4' : 'm4a') : operation === 'animate' ? 'gif' : ['cover', 'frames'].includes(operation) ? 'jpg' : operation === 'convert' ? options.format : 'mp4'
  if (!['mp4', 'mkv', 'webm', 'm4a', 'gif', 'jpg'].includes(extension)) throw new Error('不支持的输出格式')
  return `${base}_${suffix}.${extension}`
}

function buildArgs(job, output) {
  if (!job || !OPERATIONS.has(job.operation)) throw new Error('不支持的处理方式')
  const input = validateInput(job.input)
  const options = job.options || {}
  const common = ['-hide_banner', '-n', '-i', input]
  const map = ['-map', '0:v:0', '-map', '0:a:0?']
  const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']
  const mp4 = [...h264, '-movflags', '+faststart']
  let args

  switch (job.operation) {
    case 'compress': {
      const quality = { small: '32', balanced: '28', high: '23' }[options.quality]
      if (!quality) throw new Error('请选择压缩质量')
      args = [...common, ...map, ...mp4, '-crf', quality, '-preset', 'medium']
      break
    }
    case 'trim': {
      const start = Number(options.start)
      const end = options.end === '' || options.end == null ? null : Number(options.end)
      if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) {
        throw new Error('裁剪时间必须为非负秒数，结束时间须晚于开始时间')
      }
      args = [...common, '-ss', String(start), ...(end === null ? [] : ['-t', String(end - start)]), ...map, ...mp4, '-crf', '23']
      break
    }
    case 'resize': {
      const width = Number(options.width)
      if (!Number.isInteger(width) || width < 160 || width > 7680 || width % 2) throw new Error('宽度必须是 160 至 7680 的偶数')
      args = [...common, ...map, '-vf', `scale=${width}:-2`, ...mp4, '-crf', '23']
      break
    }
    case 'convert': {
      if (!['mp4', 'mkv', 'webm'].includes(options.format)) throw new Error('不支持的输出格式')
      args = options.format === 'webm'
        ? [...common, ...map, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus']
        : [...common, ...map, ...(options.format === 'mp4' ? mp4 : h264), '-crf', '23']
      break
    }
    case 'animate': {
      const fps = Number(options.fps)
      const width = Number(options.width)
      const duration = Number(options.duration)
      if (!Number.isInteger(fps) || fps < 1 || fps > 30 || !Number.isInteger(width) || width < 160 || width > 1920 || width % 2 || !Number.isFinite(duration) || duration < 1 || duration > 30) {
        throw new Error('动图帧率、宽度或时长无效')
      }
      const filter = `fps=${fps},scale=${width}:-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
      args = [...common, '-t', String(duration), '-filter_complex', filter, '-an', '-loop', '0']
      break
    }
    case 'transform': {
      const filter = { hflip: 'hflip', vflip: 'vflip', clockwise: 'transpose=1', counterclockwise: 'transpose=2', rotate180: 'hflip,vflip' }[options.direction]
      if (!filter) throw new Error('请选择旋转或翻转方向')
      args = [...common, ...map, '-vf', filter, ...mp4, '-crf', '23']
      break
    }
    case 'crop': {
      const { x, y, width, height } = options
      if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 2 || height < 2 || [x, y, width, height].some(value => value % 2)) throw new Error('画面裁剪坐标和尺寸必须是非负偶数，宽高至少为 2')
      args = [...common, ...map, '-vf', `crop=${width}:${height}:${x}:${y}`, ...mp4, '-crf', '23']
      break
    }
    case 'watermark': {
      const { image, width, opacity, position } = options
      if (typeof image !== 'string' || !path.isAbsolute(image) || !['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(image).toLowerCase())) throw new Error('请选择水印图片')
      if (!Number.isInteger(width) || width < 16 || width > 2000 || !Number.isFinite(opacity) || opacity < 0.1 || opacity > 1) throw new Error('水印尺寸或透明度无效')
      const point = { 'bottom-right': 'W-w-24:H-h-24', 'bottom-left': '24:H-h-24', 'top-right': 'W-w-24:24', 'top-left': '24:24', center: '(W-w)/2:(H-h)/2' }[position]
      if (!point) throw new Error('水印位置无效')
      args = [...common, '-i', image, '-filter_complex', `[1:v]scale=${width}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${point}[v]`, '-map', '[v]', '-map', '0:a:0?', ...mp4, '-crf', '23']
      break
    }
    case 'cover': {
      const time = Number(options.time)
      if (!Number.isFinite(time) || time < 0) throw new Error('封面时间必须是非负秒数')
      args = [...common, '-ss', String(time), '-map', '0:v:0', '-frames:v', '1', '-q:v', '2']
      break
    }
    case 'speed': {
      const rate = Number(options.rate)
      if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('变速倍数必须在 0.5 至 2 之间')
      args = [...common, ...map, '-vf', `setpts=PTS/${rate}`, '-af', `atempo=${rate}`, ...mp4, '-crf', '23']
      break
    }
    case 'frames': {
      const interval = Number(options.interval)
      const count = Number(options.count)
      if (!Number.isFinite(interval) || interval < 0.1 || interval > 3600 || !Number.isInteger(count) || count < 1 || count > 100) throw new Error('抽帧间隔或数量无效')
      args = [...common, '-map', '0:v:0', '-vf', `fps=1/${interval}`, '-frames:v', String(count), '-q:v', '2']
      break
    }
    case 'audio': {
      const mode = options.mode || 'extract'
      if (mode === 'extract') args = [...common, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k']
      else if (mode === 'mute') args = [...common, '-map', '0:v:0', '-an', ...mp4, '-crf', '23']
      else if (mode === 'gain') {
        const level = Number(options.level)
        if (!Number.isFinite(level) || level < 0.25 || level > 4) throw new Error('音量倍数必须在 0.25 至 4 之间')
        args = [...common, '-map', '0:v:0', '-map', '0:a:0', '-af', `volume=${level}`, ...mp4, '-crf', '23']
      } else if (mode === 'replace') {
        const music = options.music
        if (typeof music !== 'string' || !path.isAbsolute(music) || !MUSIC_EXTENSIONS.has(path.extname(music).toLowerCase())) throw new Error('请选择受支持的背景音乐文件')
        args = [...common, '-stream_loop', '-1', '-i', music, '-map', '0:v:0', '-map', '1:a:0', ...mp4, '-crf', '23', '-shortest']
      } else throw new Error('不支持的音频操作')
      break
    }
  }
  return [...args, output]
}

module.exports = { VIDEO_EXTENSIONS, MUSIC_EXTENSIONS, validateInput, outputName, buildArgs }
