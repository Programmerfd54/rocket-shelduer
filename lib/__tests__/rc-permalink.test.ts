import { describe, it, expect } from 'vitest'
import { buildRcPermalink, normalizeWorkspaceBase } from '../rc-permalink'

const base = { workspaceUrl: 'https://chat.example.com', messageId: 'abc123' }

describe('buildRcPermalink', () => {
  it('публичный канал → /channel/<имя>', () => {
    expect(buildRcPermalink({ ...base, roomType: 'c', roomName: 'general' })).toBe(
      'https://chat.example.com/channel/general?msg=abc123',
    )
  })

  it('приватная группа → /group/<имя>', () => {
    expect(buildRcPermalink({ ...base, roomType: 'p', roomName: 'team-a' })).toBe(
      'https://chat.example.com/group/team-a?msg=abc123',
    )
  })

  it('личные сообщения → /direct/<id комнаты>', () => {
    expect(buildRcPermalink({ ...base, roomType: 'd', roomId: 'rid9' })).toBe(
      'https://chat.example.com/direct/rid9?msg=abc123',
    )
  })

  it('кодирует части пути и id сообщения', () => {
    const url = buildRcPermalink({
      workspaceUrl: 'https://chat.example.com',
      roomType: 'c',
      roomName: 'a b/ü?#',
      messageId: 'x&y=1',
    })
    expect(url).toBe('https://chat.example.com/channel/a%20b%2F%C3%BC%3F%23?msg=x%26y%3D1')
  })

  it('убирает хвостовые слэши, query и hash у адреса сервера', () => {
    expect(
      buildRcPermalink({ ...base, workspaceUrl: 'https://chat.example.com/sub//?x=1#h', roomType: 'c', roomName: 'g' }),
    ).toBe('https://chat.example.com/sub/channel/g?msg=abc123')
  })

  it('неизвестный или пустой тип комнаты → null (не угадываем)', () => {
    expect(buildRcPermalink({ ...base, roomType: 'l', roomName: 'g', roomId: 'r' })).toBeNull()
    expect(buildRcPermalink({ ...base, roomType: undefined, roomName: 'g' })).toBeNull()
    expect(buildRcPermalink({ ...base, roomType: null, roomName: 'g' })).toBeNull()
    expect(buildRcPermalink({ ...base, roomType: '', roomName: 'g' })).toBeNull()
  })

  it('не хватает данных → null', () => {
    expect(buildRcPermalink({ ...base, roomType: 'c', roomName: '  ' })).toBeNull()
    expect(buildRcPermalink({ ...base, roomType: 'p' })).toBeNull()
    expect(buildRcPermalink({ ...base, roomType: 'd', roomName: 'x' })).toBeNull()
    expect(buildRcPermalink({ ...base, messageId: '', roomType: 'c', roomName: 'g' })).toBeNull()
    expect(buildRcPermalink({ ...base, messageId: null, roomType: 'c', roomName: 'g' })).toBeNull()
  })

  it('только http(s) адреса', () => {
    for (const workspaceUrl of ['javascript:alert(1)', 'ftp://chat.example.com', 'chat.example.com', '', null, undefined]) {
      expect(buildRcPermalink({ workspaceUrl, messageId: 'm', roomType: 'c', roomName: 'g' })).toBeNull()
    }
    expect(buildRcPermalink({ workspaceUrl: 'http://localhost:3000', messageId: 'm', roomType: 'c', roomName: 'g' })).toBe(
      'http://localhost:3000/channel/g?msg=m',
    )
  })
})

describe('normalizeWorkspaceBase', () => {
  it('нормализует и отклоняет некорректное', () => {
    expect(normalizeWorkspaceBase(' https://a.b/ ')).toBe('https://a.b')
    expect(normalizeWorkspaceBase('not a url')).toBeNull()
  })
})
