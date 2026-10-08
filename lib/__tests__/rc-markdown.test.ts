import { describe, it, expect } from 'vitest'
import { parseRocketChatMarkdown, safeMarkdownHref } from '../rc-markdown'
import { sanitizeMessageHtml } from '../sanitize'

const render = (text: string, workspaceId?: string, emojis?: Parameters<typeof parseRocketChatMarkdown>[2]) =>
  sanitizeMessageHtml(parseRocketChatMarkdown(text, workspaceId, emojis))

describe('parseRocketChatMarkdown — XSS', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '[click](javascript:alert(1))',
    '[click](JavaScript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](vbscript:x)',
    '[x](https://e.com" onmouseover="alert(1))',
    "[x](https://e.com' onmouseover='alert(1))",
    '[<img src=x onerror=alert(1)>](https://e.com)',
    '```<script>alert(1)</script>```',
    '`<img src=x onerror=alert(1)>`',
    '**<script>alert(1)</script>**',
    '@<script>alert(1)</script>',
    ':smile:<img src=x onerror=alert(1)>:smile:',
    '\u00000\u0000<b>x</b>',
  ]

  it.each(payloads)('raw parser output has no live HTML from input: %s', (p) => {
    const out = parseRocketChatMarkdown(p)
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/<img[^>]*onerror/i)
    expect(out).not.toMatch(/<svg/i)
    expect(out).not.toMatch(/\son\w+="/i)
    expect(out).not.toMatch(/href="(javascript|data|vbscript):/i)
  })

  it.each(payloads)('sanitized output is clean: %s', (p) => {
    const out = render(p)
    // Текст payload может остаться в экранированном виде (&lt;img …&gt;) — проверяем «живую» разметку
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i)
    expect(out).not.toMatch(/(href|src)="\s*(javascript|vbscript|data):/i)
  })

  it('shows raw HTML as text (escaped), like Rocket.Chat', () => {
    expect(parseRocketChatMarkdown('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;')
  })

  it('unsafe links stay as plain text', () => {
    expect(parseRocketChatMarkdown('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))')
  })
})

describe('parseRocketChatMarkdown — formatting', () => {
  it('bold / italic / strike / code / mention / newline', () => {
    const out = parseRocketChatMarkdown('**b** *i* ~~s~~ `c` @all\nnext')
    expect(out).toContain('<strong class="font-semibold">b</strong>')
    expect(out).toContain('<em class="italic">i</em>')
    expect(out).toContain('<del class="line-through">s</del>')
    expect(out).toContain('<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">c</code>')
    expect(out).toContain('<span class="text-primary font-medium">@all</span>')
    expect(out).toContain('<br />')
  })

  it('does not format inside code blocks', () => {
    const out = parseRocketChatMarkdown('```\n**x** @user :smile:\n```')
    expect(out).toContain('**x** @user :smile:')
    expect(out).not.toContain('<strong')
  })

  it('links: http(s) and mailto with escaped href; formatting does not leak into href', () => {
    const out = parseRocketChatMarkdown('[site](https://e.com/a_*b*_?x=1&y=2) [mail](mailto:a@b.c)')
    expect(out).toContain('href="https://e.com/a_*b*_?x=1&amp;y=2"')
    expect(out).toContain('href="mailto:a@b.c"')
    expect(out).not.toMatch(/href="[^"]*<(em|span)/)
  })

  it('custom emoji img src is built from the proxy URL and encoded', () => {
    const out = render(':party:', 'ws1', [{ name: 'party', extension: 'png', _id: 'id1' }])
    expect(out).toMatch(/<img[^>]+src="\/api\/workspace\/ws1\/emoji-image\?name=party&amp;ext=png&amp;id=id1&amp;v=3"/)
    expect(out).toContain('class="rc-custom-emoji')
  })

  it('custom emoji with hostile extension/id stays inside the attribute', () => {
    const out = render(':x:', 'w"><script>', [
      { name: 'x', extension: '"><img src=y onerror=alert(1)>', _id: '" onerror="alert(1)' },
    ])
    expect(out).not.toMatch(/onerror=|<script/i)
    expect(out).toMatch(/src="\/api\/workspace\/w%22%3E%3Cscript%3E\/emoji-image\?/)
  })

  it('standard emoji renders as unicode, unknown shortcode stays text', () => {
    expect(parseRocketChatMarkdown(':smile:')).toContain('title=":smile:"')
    expect(parseRocketChatMarkdown(':definitely_unknown_xyz:')).toBe(':definitely_unknown_xyz:')
  })
})

describe('safeMarkdownHref', () => {
  it('accepts only http(s)/mailto', () => {
    expect(safeMarkdownHref('https://e.com')).toBe('https://e.com')
    expect(safeMarkdownHref('http://e.com')).toBe('http://e.com')
    expect(safeMarkdownHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeMarkdownHref('javascript:alert(1)')).toBeNull()
    expect(safeMarkdownHref('//evil.com')).toBeNull()
    expect(safeMarkdownHref('/relative')).toBeNull()
    expect(safeMarkdownHref('https://e.com/\nx')).toBeNull()
  })
})
