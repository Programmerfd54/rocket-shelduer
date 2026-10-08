import { describe, it, expect } from 'vitest'
import {
  sanitizeHelpHtml,
  sanitizeMessageHtml,
  sanitizeSvgIcon,
  filterHelpStyle,
  filterHelpClass,
  safeExternalHref,
} from '../sanitize'

/** Классические XSS-векторы: после санитизации не должно остаться ни скриптов, ни обработчиков, ни опасных URL. */
const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<img src="x" onerror="alert(1)">',
  '<svg onload=alert(1)><circle/></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<video><source onerror="alert(1)"></video>',
  '<audio src=x onerror=alert(1)>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
  '<form action="https://evil.example"><input name=x></form>',
  '<details open ontoggle=alert(1)>',
  '<body onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<p><style>*{display:none}</style>x</p>',
  '<base href="https://evil.example/">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<img src="x" id="__proto__" name="cookie">',
]

function assertClean(out: string) {
  const lower = out.toLowerCase()
  expect(lower).not.toMatch(/<script/)
  expect(lower).not.toMatch(/\son[a-z]+\s*=/)
  expect(lower).not.toMatch(/javascript:/)
  expect(lower).not.toMatch(/vbscript:/)
  expect(lower).not.toMatch(/href="data:/)
  expect(lower).not.toMatch(/<(iframe|object|embed|form|input|style|base|meta|link|video|audio|svg|math|body|details)\b/)
  expect(lower).not.toMatch(/\s(id|name)=/)
}

describe('sanitizeHelpHtml', () => {
  it.each(XSS_PAYLOADS)('neutralizes %s', (payload) => {
    assertClean(sanitizeHelpHtml(payload))
  })

  it('keeps editor output: headings, lists, links, images, code', () => {
    const html =
      '<h2>T</h2><ul><li><p>a</p></li></ul><ol start="3"><li>b</li></ol>' +
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="text-primary underline">l</a></p>' +
      '<img src="/help-uploads/help-1-abc.png" alt="" class="rounded-md h-auto cursor-pointer" width="300" height="200">' +
      '<pre><code class="language-js">x</code></pre>'
    const out = sanitizeHelpHtml(html)
    expect(out).toContain('<h2>T</h2>')
    expect(out).toContain('start="3"')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('src="/help-uploads/help-1-abc.png"')
    expect(out).toContain('width="300"')
    expect(out).toContain('class="language-js"')
  })

  it('allows hr and mark (horizontal rule, highlight) with safe color style', () => {
    const out = sanitizeHelpHtml(
      '<p>a</p><hr><p><mark data-color="#ffc078" style="background-color: #ffc078; color: inherit">hl</mark></p>'
    )
    expect(out).toContain('<hr>')
    expect(out).toContain('<mark')
    expect(out).toContain('background-color: #ffc078')
    expect(out).toContain('data-color="#ffc078"')
  })

  it('keeps help icons and block highlight attributes', () => {
    const out = sanitizeHelpHtml(
      '<span class="help-inline-icon" data-icon="info" data-icon-color="#dc2626" style="color:#dc2626"></span>' +
        '<div data-type="block-highlight" data-color="blue" class="help-block-highlight help-block-blue"><p>x</p></div>'
    )
    expect(out).toContain('data-icon="info"')
    expect(out).toContain('data-icon-color="#dc2626"')
    expect(out).toContain('color: #dc2626')
    expect(out).toContain('data-type="block-highlight"')
    expect(out).toContain('help-block-blue')
  })

  it('drops unknown data-* attributes', () => {
    expect(sanitizeHelpHtml('<p data-foo="x">a</p>')).toBe('<p>a</p>')
  })

  it('strips layout-escaping CSS (overlay / UI redressing)', () => {
    const out = sanitizeHelpHtml(
      '<div style="position:fixed;inset:0;z-index:9999;background-color:#fff;color:red">phish</div>'
    )
    expect(out).not.toMatch(/position|inset|z-index/)
    expect(out).toContain('background-color: #fff')
    expect(out).toContain('color: red')
  })

  it('strips url()/expression in style', () => {
    const out = sanitizeHelpHtml('<span style="background-color: url(https://evil/x); color: expression(alert(1))">x</span>')
    expect(out).toBe('<span>x</span>')
  })

  it('strips overlay Tailwind classes but keeps others', () => {
    const out = sanitizeHelpHtml('<div class="fixed inset-0 z-50 md:absolute help-block-amber text-sm">x</div>')
    expect(out).toContain('class="help-block-amber text-sm"')
  })

  it('forces rel=noopener on target=_blank and removes other targets', () => {
    expect(sanitizeHelpHtml('<a href="https://e.com" target="_blank">x</a>')).toContain('rel="noopener noreferrer"')
    expect(sanitizeHelpHtml('<a href="https://e.com" target="_blank" rel="opener">x</a>')).toContain(
      'rel="noopener noreferrer"'
    )
    expect(sanitizeHelpHtml('<a href="https://e.com" target="_top">x</a>')).not.toContain('target')
  })

  it('allows mailto/tel/relative/anchor links', () => {
    expect(sanitizeHelpHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"')
    expect(sanitizeHelpHtml('<a href="tel:+7123">x</a>')).toContain('href="tel:+7123"')
    expect(sanitizeHelpHtml('<a href="/dashboard">x</a>')).toContain('href="/dashboard"')
    expect(sanitizeHelpHtml('<a href="#s1">x</a>')).toContain('href="#s1"')
  })

  it('handles empty / non-string input', () => {
    expect(sanitizeHelpHtml('')).toBe('')
    expect(sanitizeHelpHtml(undefined as unknown as string)).toBe('')
  })
})

describe('sanitizeMessageHtml', () => {
  it.each(XSS_PAYLOADS)('neutralizes %s', (payload) => {
    assertClean(sanitizeMessageHtml(payload))
  })

  it('does not allow style', () => {
    expect(sanitizeMessageHtml('<span style="position:fixed">x</span>')).toBe('<span>x</span>')
  })

  it('rejects tel: and other schemes, keeps http(s)/mailto', () => {
    expect(sanitizeMessageHtml('<a href="tel:1">x</a>')).not.toContain('href')
    expect(sanitizeMessageHtml('<a href="https://e.com">x</a>')).toContain('href="https://e.com"')
    expect(sanitizeMessageHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"')
  })

  it('keeps relative emoji proxy src and forces rel on _blank', () => {
    const out = sanitizeMessageHtml(
      '<img src="/api/workspace/w1/emoji-image?name=a&amp;ext=png" class="rc-custom-emoji"><a href="https://e.com" target="_blank">x</a>'
    )
    expect(out).toContain('src="/api/workspace/w1/emoji-image?name=a&amp;ext=png"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('help-mode hooks do not leak into message mode', () => {
    // В режиме сообщений style не разрешён вообще, class не фильтруется по deny-list.
    expect(sanitizeMessageHtml('<span class="fixed">x</span>')).toBe('<span class="fixed">x</span>')
  })
})

describe('sanitizeSvgIcon', () => {
  it('strips scripts and handlers from svg', () => {
    const out = sanitizeSvgIcon('<svg onload="alert(1)"><script>alert(1)</script><path d="M0 0" onclick="x()"/></svg>')
    expect(out).not.toMatch(/script|onload|onclick/)
    expect(out).toContain('<path d="M0 0"')
  })
})

describe('filterHelpStyle / filterHelpClass', () => {
  it('filters style declarations', () => {
    expect(filterHelpStyle('color: rgb(1, 2, 3); position: absolute')).toBe('color: rgb(1, 2, 3)')
    expect(filterHelpStyle('color: red !important')).toBe('')
    expect(filterHelpStyle('width: 300px; height: auto')).toBe('width: 300px; height: auto')
    expect(filterHelpStyle('color: "x"')).toBe('')
    expect(filterHelpStyle('color: \\72 ed')).toBe('')
  })
  it('filters classes', () => {
    expect(filterHelpClass('sticky top-0 -z-10 lg:fixed !fixed w-screen help-x')).toBe('help-x')
  })
})

describe('safeExternalHref', () => {
  it('accepts http(s)/mailto only', () => {
    expect(safeExternalHref('https://rc.example.com')).toBe('https://rc.example.com')
    expect(safeExternalHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeExternalHref('javascript://example.com/%0aalert(1)')).toBeNull()
    expect(safeExternalHref('data:text/html,x')).toBeNull()
    expect(safeExternalHref('')).toBeNull()
  })
})

describe('safeIconColor (help editor icon)', async () => {
  const { safeIconColor } = await import('../helpEditorExtensions')
  it('accepts colors and rejects CSS injection', () => {
    expect(safeIconColor('#dc2626')).toBe('#dc2626')
    expect(safeIconColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(safeIconColor('red')).toBe('red')
    expect(safeIconColor('red;position:fixed;inset:0')).toBeNull()
    expect(safeIconColor('url(https://evil)')).toBeNull()
    expect(safeIconColor(null)).toBeNull()
  })
})
