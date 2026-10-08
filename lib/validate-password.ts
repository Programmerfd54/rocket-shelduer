import { checkPasswordStrength } from '@/lib/utils'

/**
 * Клиентская проверка нового пароля — те же правила, что и на сервере
 * (минимум 8 символов и не «слабый»: нужны минимум 2 вида символов).
 * Возвращает текст ошибки для поля или undefined, если пароль подходит.
 */
export function validateNewPassword(password: string): string | undefined {
  if (!password) return 'Введите пароль'
  if (password.length < 8) return 'Минимум 8 символов'
  const strength = checkPasswordStrength(password)
  if (!strength.valid || strength.strength === 'weak') {
    return 'Слишком простой пароль: добавьте заглавные буквы, цифры или спецсимволы'
  }
  return undefined
}

/** Ошибка поля «Повторите пароль». */
export function validatePasswordConfirm(password: string, confirm: string): string | undefined {
  if (!confirm) return 'Повторите пароль'
  if (password !== confirm) return 'Пароли не совпадают'
  return undefined
}
