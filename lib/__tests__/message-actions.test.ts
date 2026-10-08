import { describe, it, expect } from 'vitest'
import { getMessageActions } from '../message-actions'

const me = { id: 'u1', role: 'ADM' }

describe('getMessageActions', () => {
  it('автор: PENDING — изменить и удалить', () => {
    expect(getMessageActions({ status: 'PENDING', user: { id: 'u1' } }, me)).toEqual({
      canEdit: true, canDelete: true, canRetry: false, notOwner: false,
    })
  })
  it('SENT: можно править в RC, нельзя удалять', () => {
    const a = getMessageActions({ status: 'SENT', user: { id: 'u1' } }, me)
    expect(a.canEdit).toBe(true)
    expect(a.canDelete).toBe(false)
  })
  it('FAILED: повторить и удалить, править нельзя', () => {
    const a = getMessageActions({ status: 'FAILED', user: { id: 'u1' } }, me)
    expect(a.canRetry).toBe(true)
    expect(a.canDelete).toBe(true)
    expect(a.canEdit).toBe(false)
  })
  it('CANCELLED: только удалить', () => {
    const a = getMessageActions({ status: 'CANCELLED', user: { id: 'u1' } }, me)
    expect([a.canEdit, a.canDelete, a.canRetry]).toEqual([false, true, false])
  })
  it('чужое сообщение: ничего, кроме повтора для SUP', () => {
    const other = { status: 'FAILED', user: { id: 'u2' } }
    expect(getMessageActions(other, me)).toMatchObject({ canEdit: false, canDelete: false, canRetry: false, notOwner: true })
    expect(getMessageActions(other, { id: 'u1', role: 'SUP' }).canRetry).toBe(true)
    expect(getMessageActions({ status: 'PENDING', user: { id: 'u2' } }, { id: 'u1', role: 'SUP' }).canEdit).toBe(false)
  })
  it('автор неизвестен — решает сервер, кнопки видны', () => {
    expect(getMessageActions({ status: 'PENDING' }, me).canEdit).toBe(true)
    expect(getMessageActions({ status: 'PENDING', user: { id: 'u2' } }, null).canEdit).toBe(true)
  })
})
