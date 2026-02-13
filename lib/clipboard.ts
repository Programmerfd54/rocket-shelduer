/**
 * Безопасное копирование текста в буфер обмена
 * Работает и на клиенте, и на сервере (SSR)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    // Проверяем, что мы на клиенте
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      console.warn('copyToClipboard: не в браузере')
      return false
    }
  
    // Современный API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (err) {
        console.warn('Ошибка Clipboard API:', err)
        // Пробуем fallback
      }
    }
  
    // Fallback для старых браузеров
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      textarea.style.left = '0'
      textarea.style.top = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      
      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      
      return success
    } catch (err) {
      console.warn('Ошибка fallback копирования:', err)
      return false
    }
  }
  
  /**
   * Хук для безопасного копирования с toast уведомлением
   */
  export function useCopyToClipboard() {
    const copy = async (text: string, successMessage = 'Скопировано') => {
      const success = await copyToClipboard(text)
      
      // Импортируем toast динамически, чтобы избежать циклических зависимостей
      const { toast } = await import('sonner')
      
      if (success) {
        toast.success(successMessage)
      } else {
        toast.error('Не удалось скопировать')
      }
      
      return success
    }
    
    return { copy }
  }