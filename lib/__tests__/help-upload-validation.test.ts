import { describe, it, expect } from 'vitest'
import {
  checkHelpUploadMeta,
  checkHelpUploadContent,
  randomHelpUploadName,
  isSafeHelpFileName,
  HELP_MAX_IMAGE,
  HELP_MAX_FILE,
  HELP_MAX_MEDIA,
} from '../help-upload-validation'

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === 'string' ? Array.from(x, (c) => c.charCodeAt(0)) : [x])))

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const GIF = bytes('GIF89a', 0)
const WEBP = bytes('RIFF', 0, 0, 0, 0, 'WEBP', 'VP8 ')
const PDF = bytes('%PDF-1.7\n')
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0)
const OLE = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
const HTML = bytes('<html><script>alert(1)</script></html>')

describe('checkHelpUploadMeta', () => {
  it('rejects SVG, HTML, JS and unknown types', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/javascript', 'application/xhtml+xml', 'application/octet-stream', '']) {
      const r = checkHelpUploadMeta({ name: 'x.png', type, size: 10 })
      expect(r.ok, type).toBe(false)
    }
  })

  it('extension is derived from MIME allow-list, never from a dangerous name', () => {
    const r = checkHelpUploadMeta({ name: 'evil.html', type: 'image/png', size: 10 })
    expect(r).toMatchObject({ ok: true, ext: '.png', kind: 'image' })
    const r2 = checkHelpUploadMeta({ name: '../../x.svg', type: 'application/pdf', size: 10 })
    expect(r2).toMatchObject({ ok: true, ext: '.pdf' })
    const r3 = checkHelpUploadMeta({ name: 'photo.JPEG', type: 'image/jpeg', size: 10 })
    expect(r3).toMatchObject({ ok: true, ext: '.jpeg' })
  })

  it('generic video/audio: media extension or .bin', () => {
    expect(checkHelpUploadMeta({ name: 'a.mov', type: 'video/quicktime', size: 10 })).toMatchObject({ ok: true, ext: '.mov', kind: 'video' })
    expect(checkHelpUploadMeta({ name: 'a.html', type: 'video/quicktime', size: 10 })).toMatchObject({ ok: true, ext: '.bin' })
    expect(checkHelpUploadMeta({ name: 'a.mp4', type: 'video/<script>', size: 10 }).ok).toBe(false)
  })

  it('size limits depend on the real type; hint cannot raise image limit to media', () => {
    expect(checkHelpUploadMeta({ name: 'a.png', type: 'image/png', size: HELP_MAX_IMAGE + 1 }).ok).toBe(false)
    expect(checkHelpUploadMeta({ name: 'a.png', type: 'image/png', size: HELP_MAX_IMAGE + 1 }, 'video').ok).toBe(false)
    expect(checkHelpUploadMeta({ name: 'a.png', type: 'image/png', size: HELP_MAX_IMAGE + 1 }, 'file').ok).toBe(true)
    expect(checkHelpUploadMeta({ name: 'a.png', type: 'image/png', size: HELP_MAX_FILE + 1 }, 'file').ok).toBe(false)
    expect(checkHelpUploadMeta({ name: 'a.pdf', type: 'application/pdf', size: HELP_MAX_FILE + 1 }).ok).toBe(false)
    expect(checkHelpUploadMeta({ name: 'a.mp4', type: 'video/mp4', size: HELP_MAX_MEDIA }).ok).toBe(true)
    expect(checkHelpUploadMeta({ name: 'a.mp4', type: 'video/mp4', size: HELP_MAX_MEDIA + 1 }).ok).toBe(false)
    expect(checkHelpUploadMeta({ name: 'a.txt', type: 'text/plain', size: 0 }).ok).toBe(false)
  })

  it('Windows CSV (application/vnd.ms-excel) keeps .csv', () => {
    expect(checkHelpUploadMeta({ name: 'r.csv', type: 'application/vnd.ms-excel', size: 5 })).toMatchObject({ ok: true, ext: '.csv' })
  })
})

describe('checkHelpUploadContent (magic bytes)', () => {
  it('accepts matching signatures', () => {
    expect(checkHelpUploadContent('image/png', '.png', PNG)).toBe(true)
    expect(checkHelpUploadContent('image/jpeg', '.jpg', JPEG)).toBe(true)
    expect(checkHelpUploadContent('image/gif', '.gif', GIF)).toBe(true)
    expect(checkHelpUploadContent('image/webp', '.webp', WEBP)).toBe(true) // ранее webp отклонялся из-за опечатки в сигнатуре
    expect(checkHelpUploadContent('application/pdf', '.pdf', PDF)).toBe(true)
    expect(checkHelpUploadContent('application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx', ZIP)).toBe(true)
    expect(checkHelpUploadContent('application/msword', '.doc', OLE)).toBe(true)
    expect(checkHelpUploadContent('application/vnd.ms-excel', '.csv', bytes('a,b\n1,2'))).toBe(true)
    expect(checkHelpUploadContent('text/plain', '.txt', bytes('hello'))).toBe(true)
  })

  it('rejects HTML/other content disguised as image/pdf/office', () => {
    expect(checkHelpUploadContent('image/png', '.png', HTML)).toBe(false)
    expect(checkHelpUploadContent('image/webp', '.webp', bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe(false)
    expect(checkHelpUploadContent('application/pdf', '.pdf', HTML)).toBe(false)
    expect(checkHelpUploadContent('application/msword', '.doc', HTML)).toBe(false)
    expect(checkHelpUploadContent('text/plain', '.txt', bytes('MZ', 0, 0))).toBe(false)
    expect(checkHelpUploadContent('image/png', '.png', new Uint8Array(0))).toBe(false)
  })
})

describe('randomHelpUploadName / isSafeHelpFileName', () => {
  it('generates unique safe names', () => {
    const a = randomHelpUploadName('.png')
    const b = randomHelpUploadName('.png')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^help-\d+-[0-9a-f]{24}\.png$/)
    expect(isSafeHelpFileName(a)).toBe(true)
    expect(randomHelpUploadName('.ht/../ml')).toMatch(/\.bin$/)
  })

  it('accepts legacy names', () => {
    expect(isSafeHelpFileName('help-1769856449230-y50hqlju.pdf')).toBe(true)
  })

  it('rejects traversal and odd names', () => {
    for (const n of ['..', '../etc/passwd', '..\\x', '/etc/passwd', 'a/b', 'a\\b', '.hidden', 'a..b', 'a b', 'a\r\nb', '', null, undefined, 'x'.repeat(201)]) {
      expect(isSafeHelpFileName(n as string), String(n)).toBe(false)
    }
  })
})
