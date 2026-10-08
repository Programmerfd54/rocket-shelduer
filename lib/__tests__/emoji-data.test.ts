import { describe, it, expect } from 'vitest'
import {
  STANDARD_EMOJIS,
  EMOJI_CATEGORIES,
  emojiByShortcode,
  replaceShortcodes,
  searchStandardEmojis,
  searchCustomEmojis,
  customEmojiImageUrl,
} from '../emoji-data'

describe('emoji dataset', () => {
  it('has a solid number of emojis in every category', () => {
    expect(STANDARD_EMOJIS.length).toBeGreaterThanOrEqual(300)
    for (const c of EMOJI_CATEGORIES) {
      expect(STANDARD_EMOJIS.filter((e) => e.category === c.id).length).toBeGreaterThan(10)
    }
  })

  it('has unique names and no alias clashing with another entry', () => {
    const names = STANDARD_EMOJIS.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    const primary = new Set(names)
    const seenAliases = new Set<string>()
    for (const e of STANDARD_EMOJIS) {
      for (const a of e.aliases ?? []) {
        expect(primary.has(a), `alias ${a} of ${e.name} clashes with a name`).toBe(false)
        expect(seenAliases.has(a), `alias ${a} is duplicated`).toBe(false)
        seenAliases.add(a)
      }
    }
  })

  it('has valid shortcodes and non-empty glyphs', () => {
    for (const e of STANDARD_EMOJIS) {
      expect(e.name).toMatch(/^[a-z0-9_+-]+$/)
      expect(e.char.length).toBeGreaterThan(0)
    }
  })

  it('contains rocket and common shortcodes', () => {
    expect(emojiByShortcode('rocket')?.char).toBe('🚀')
    expect(emojiByShortcode(':rocket:')?.char).toBe('🚀')
    for (const n of [
      'smile', 'wink', 'heart', 'thumbsup', '+1', 'tada', 'fire', 'clap', 'ok_hand', 'wave',
      'raised_hands', 'pray', 'eyes', 'white_check_mark', 'warning', 'star', 'bulb', 'calendar', 'bell', 'mega',
      'loudspeaker', 'books', 'hourglass', 'x', 'exclamation', 'page_facing_up', 'clock930', 'slightly_smiling_face',
    ]) {
      expect(emojiByShortcode(n), n).toBeDefined()
    }
  })
})

describe('replaceShortcodes', () => {
  it('replaces known shortcodes', () => {
    expect(replaceShortcodes('Привет :wave: :rocket:!')).toBe('Привет 👋 🚀!')
  })
  it('keeps custom/unknown shortcodes and plain text', () => {
    expect(replaceShortcodes(':cat_typing: ok :rocket:')).toBe(':cat_typing: ok 🚀')
    expect(replaceShortcodes('время 10:30:15 тест')).toBe('время 10:30:15 тест')
  })
  it('handles aliases and +1', () => {
    expect(replaceShortcodes(':+1: :slightly_smiling_face:')).toBe('👍 🙂')
  })
  it('is case-insensitive for names', () => {
    expect(replaceShortcodes(':ROCKET:')).toBe('🚀')
  })
})

describe('search', () => {
  it('finds by english name, ranking exact first', () => {
    expect(searchStandardEmojis('rocket')[0].name).toBe('rocket')
  })
  it('finds by russian keyword', () => {
    expect(searchStandardEmojis('ракета').map((e) => e.name)).toContain('rocket')
    expect(searchStandardEmojis('Огонь').map((e) => e.name)).toContain('fire')
  })
  it('accepts colons and returns empty for empty query', () => {
    expect(searchStandardEmojis(':wave:')[0].name).toBe('wave')
    expect(searchStandardEmojis('  ')).toEqual([])
  })
  it('searches custom emojis by name and alias', () => {
    const list = [
      { name: 'cat_typing', aliases: ['typing_cat'] },
      { name: 'bigcat' },
      { name: 'froge_bonk' },
    ]
    expect(searchCustomEmojis(list, 'cat').map((e) => e.name)).toEqual(['cat_typing', 'bigcat'])
    expect(searchCustomEmojis(list, 'typing_cat')[0].name).toBe('cat_typing')
    expect(searchCustomEmojis(list, 'zzz')).toEqual([])
  })
})

describe('customEmojiImageUrl', () => {
  it('builds proxy url', () => {
    const url = customEmojiImageUrl('ws1', {
      name: 'cat_typing',
      extension: 'gif',
      _id: 'abc',
      _updatedAt: '2024-01-01T00:00:00.000Z',
    })
    expect(url).toContain('/api/workspace/ws1/emoji-image?')
    expect(url).toContain('name=cat_typing')
    expect(url).toContain('ext=gif')
    expect(url).toContain('id=abc')
    expect(url).toContain('t=1704067200000')
  })
})
