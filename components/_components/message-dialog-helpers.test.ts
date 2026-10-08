import { describe, it, expect } from 'vitest'
import { describeSaveError } from './message-dialog-helpers'

describe('describeSaveError', () => {
  it('сеть, 401, время, неизвестное', () => {
    expect(describeSaveError(0, null).kind).toBe('network')
    expect(describeSaveError(401, { error: 'Unauthorized' }).kind).toBe('auth')
    const t = describeSaveError(400, { error: 'Scheduled time must be in the future' })
    expect(t.kind).toBe('time')
    expect(t.timeError).toBe('Время отправки должно быть в будущем')
    expect(describeSaveError(500, { error: 'boom' }).message).toMatch(/Ошибка сервера/)
    expect(describeSaveError(404, { error: 'Message not found' }).message).toMatch(/не найдено/)
    expect(describeSaveError(400, { error: 'Укажите только один тип шаблона' }).message).toBe('Укажите только один тип шаблона')
  })
})
