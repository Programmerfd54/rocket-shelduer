import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyEmojiImage,
  isSafeEmojiKey,
  normalizeEmojiExt,
  isValidImportEmojiName,
  leadingJunkOffset,
} from '../emoji-image'
import {
  isPrivateIp,
  checkPublicHttpUrl,
  assertPublicHttpUrl,
  safeFetchPublic,
  readBodyLimited,
  SafeFetchError,
} from '../emoji-safe-fetch'
import { parseEmojiCatalog, EMOJI_CATALOG_MAX_ITEMS } from '../emoji-catalog'

const enc = (s: string) => new TextEncoder().encode(s)

describe('classifyEmojiImage', () => {
  it('detects raster formats by signature', () => {
    expect(classifyEmojiImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe('png')
    expect(classifyEmojiImage(enc('GIF89a...'))).toBe('gif')
    expect(classifyEmojiImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(classifyEmojiImage(enc('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
  })
  it('detects svg (incl. comment/doctype prefix) and html', () => {
    expect(classifyEmojiImage(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('svg')
    expect(classifyEmojiImage(enc('<?xml version="1.0"?><!-- c --><svg onload="x"></svg>'))).toBe('svg')
    expect(classifyEmojiImage(enc('<!DOCTYPE html><html></html>'))).toBe('html')
    expect(classifyEmojiImage(enc('<script>alert(1)</script>'))).toBe('html')
    expect(classifyEmojiImage(enc('{"ok":true}'), 'text/html; charset=utf-8')).toBe('html')
    expect(classifyEmojiImage(enc('{"ok":true}'), 'image/svg+xml')).toBe('unknown')
  })
  it('content-type cannot upgrade non-svg body to svg', () => {
    expect(classifyEmojiImage(enc('<x:script xmlns:x="http://www.w3.org/1999/xhtml">alert(1)</x:script>'), 'image/svg+xml')).toBe('unknown')
  })
  it('leadingJunkOffset strips BOM and whitespace', () => {
    expect(leadingJunkOffset(new Uint8Array([0xef, 0xbb, 0xbf, 0x20, 0x0a, 0x89]))).toBe(5)
    expect(leadingJunkOffset(new Uint8Array([0x89]))).toBe(0)
  })
})

describe('emoji key / ext / name validation', () => {
  it('isSafeEmojiKey', () => {
    expect(isSafeEmojiKey('party_parrot')).toBe(true)
    expect(isSafeEmojiKey('a+b-c')).toBe(true)
    for (const v of ['.', '..', '../api/v1/me', 'a/b', 'a\\b', 'a\nb', '', null, 'x'.repeat(129)]) {
      expect(isSafeEmojiKey(v as string), String(v)).toBe(false)
    }
  })
  it('normalizeEmojiExt', () => {
    expect(normalizeEmojiExt('PNG')).toBe('png')
    expect(normalizeEmojiExt('gif')).toBe('gif')
    expect(normalizeEmojiExt('png?x=1')).toBe('png')
    expect(normalizeEmojiExt('../x')).toBe('png')
    expect(normalizeEmojiExt(null)).toBe('png')
  })
  it('isValidImportEmojiName follows RC rules', () => {
    expect(isValidImportEmojiName('party_parrot')).toBe(true)
    expect(isValidImportEmojiName('100')).toBe(true)
    for (const v of ['a b', 'a/b', '../x', 'a:b', '<x>', 'a"b', '', 'x'.repeat(65), 1, null]) {
      expect(isValidImportEmojiName(v), String(v)).toBe(false)
    }
  })
})

describe('isPrivateIp', () => {
  it('blocks private/loopback/link-local/CGNAT/metadata and IPv6 equivalents', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '185.199.108.133', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('checkPublicHttpUrl', () => {
  it('rejects non-http schemes, credentials, odd ports, internal hosts', () => {
    for (const u of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://example.com',
      'data:text/plain,x',
      'javascript:alert(1)',
      'http://user:pass@example.com/',
      'http://example.com:6379/',
      'http://localhost/',
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata/',
      'http://printer.local/',
      'http://svc.internal/',
      'not a url',
    ]) {
      expect(checkPublicHttpUrl(u).ok, u).toBe(false)
    }
  })
  it('accepts public http(s)', () => {
    expect(checkPublicHttpUrl('https://raw.githubusercontent.com/a/b/main/emojis.yaml').ok).toBe(true)
    expect(checkPublicHttpUrl('http://example.com:8080/x.png').ok).toBe(true)
  })
})

describe('assertPublicHttpUrl (DNS)', () => {
  it('rejects hostnames resolving to internal addresses', async () => {
    await expect(assertPublicHttpUrl('https://evil.example.com/', async () => ['127.0.0.1'])).rejects.toBeInstanceOf(SafeFetchError)
    await expect(assertPublicHttpUrl('https://evil.example.com/', async () => ['8.8.8.8', '10.0.0.1'])).rejects.toBeInstanceOf(SafeFetchError)
    await expect(assertPublicHttpUrl('https://evil.example.com/', async () => [])).rejects.toBeInstanceOf(SafeFetchError)
    await expect(assertPublicHttpUrl('https://evil.example.com/', async () => { throw new Error('ENOTFOUND') })).rejects.toBeInstanceOf(SafeFetchError)
  })
  it('accepts hostnames resolving to public addresses', async () => {
    const u = await assertPublicHttpUrl('https://ok.example.com/a', async () => ['93.184.216.34'])
    expect(u.hostname).toBe('ok.example.com')
  })
})

describe('safeFetchPublic', () => {
  afterEach(() => vi.unstubAllGlobals())
  const publicDns = async () => ['93.184.216.34']

  it('blocks redirect to an internal address', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      safeFetchPublic('https://ok.example.com/x.yaml', { maxBytes: 1000, timeoutMs: 1000, resolve: publicDns })
    ).rejects.toBeInstanceOf(SafeFetchError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' })
  })

  it('follows public redirects and enforces the size limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/y.yaml' } }))
      .mockResolvedValueOnce(new Response('x'.repeat(2000), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      safeFetchPublic('https://ok.example.com/x.yaml', { maxBytes: 1000, timeoutMs: 1000, resolve: publicDns })
    ).rejects.toThrow(/слишком большой/)
    expect(String((fetchMock.mock.calls[1] as unknown[])[0])).toBe('https://ok.example.com/y.yaml')
  })

  it('returns body for small public responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('emojis: []', { status: 200, headers: { 'content-type': 'text/yaml' } })))
    const r = await safeFetchPublic('https://ok.example.com/x.yaml', { maxBytes: 1000, timeoutMs: 1000, resolve: publicDns })
    expect(r.ok).toBe(true)
    expect(new TextDecoder().decode(r.body)).toBe('emojis: []')
  })

  it('stops after too many redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } })))
    await expect(
      safeFetchPublic('https://ok.example.com/x', { maxBytes: 1000, timeoutMs: 1000, resolve: publicDns, maxRedirects: 2 })
    ).rejects.toThrow(/редирект/)
  })

  it('readBodyLimited rejects by Content-Length before reading', async () => {
    const res = new Response('abc', { headers: { 'content-length': '999999' } })
    await expect(readBodyLimited(res, 10)).rejects.toBeInstanceOf(SafeFetchError)
  })
})

describe('parseEmojiCatalog', () => {
  it('keeps valid entries and drops internal/invalid ones', () => {
    const yamlText = `
emojis:
  - name: party
    src: https://cdn.example.com/emoji/party.gif?raw=true
  - name: 100
    src: https://cdn.example.com/emoji/100.png
  - name: meta
    src: http://169.254.169.254/latest/meta-data/iam
  - name: local
    src: http://localhost:3000/api/admin/users
  - name: "../evil"
    src: https://cdn.example.com/x.png
  - name: file
    src: file:///etc/passwd
  - name: party
    src: https://cdn.example.com/dup.png
  - src: https://cdn.example.com/noname.png
`
    const r = parseEmojiCatalog(yamlText)
    expect(r.emojis.map((e) => e.name)).toEqual(['party', '100'])
    expect(r.emojis[0]).toMatchObject({ ext: 'gif', contentType: 'image/gif' })
    expect(r.emojis[1]).toMatchObject({ ext: 'png', contentType: 'image/png' })
    expect(r.rejected).toBe(6)
  })

  it('does not execute YAML tags', () => {
    expect(() => parseEmojiCatalog('emojis: !!js/function "function(){}"')).toThrow()
  })

  it('caps the number of entries', () => {
    const lines = ['emojis:']
    for (let i = 0; i < EMOJI_CATALOG_MAX_ITEMS + 5; i++) lines.push(`  - {name: e${i}, src: "https://cdn.example.com/${i}.png"}`)
    const r = parseEmojiCatalog(lines.join('\n'))
    expect(r.emojis.length).toBe(EMOJI_CATALOG_MAX_ITEMS)
    expect(r.truncated).toBe(5)
  })

  it('handles garbage', () => {
    expect(parseEmojiCatalog('just a string').emojis).toEqual([])
    expect(parseEmojiCatalog('emojis: 5').emojis).toEqual([])
  })
})
