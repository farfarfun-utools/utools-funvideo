const path = require('node:path')

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.flv', '.m4v'])
const OPERATIONS = new Set(['compress', 'trim', 'resize', 'convert', 'animate', 'transform', 'audio'])

function validateInput(input) {
  if (typeof input !== 'string' || !VIDEO_EXTENSIONS.has(path.extname(input).toLowerCase())) {
    throw new Error('请选择受支持的视频文件')
  }
  return input
}

function outputName(input, operation, options = {}) {
  options = options || {}
  const base = path.basename(input, path.extname(input))
  const suffix = { compress: '压缩', trim: '裁剪', resize: '尺寸', convert: '转换', animate: '动图', transform: '变换', audio: { extract: '音频', mute: '静音', gain: '音量' }[options.mode || 'extract'] }[operation]
  if (!suffix) throw new Error('不支持的处理方式')
  const extension = operation === 'audio' ? (options.mode === 'mute' || options.mode === 'gain' ? 'mp4' : 'm4a') : operation === 'animate' ? 'gif' : operation === 'convert' ? options.format : 'mp4'
  if (!['mp4', 'mkv', 'webm', 'm4a', 'gif'].includes(extension)) throw new Error('不支持的输出格式')
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
    case 'audio': {
      const mode = options.mode || 'extract'
      if (mode === 'extract') args = [...common, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k']
      else if (mode === 'mute') args = [...common, '-map', '0:v:0', '-an', ...mp4, '-crf', '23']
      else if (mode === 'gain') {
        const level = Number(options.level)
        if (!Number.isFinite(level) || level < 0.25 || level > 4) throw new Error('音量倍数必须在 0.25 至 4 之间')
        args = [...common, '-map', '0:v:0', '-map', '0:a:0', '-af', `volume=${level}`, ...mp4, '-crf', '23']
      } else throw new Error('不支持的音频操作')
      break
    }
  }
  return [...args, output]
}

module.exports = { VIDEO_EXTENSIONS, validateInput, outputName, buildArgs }
