'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

/**
 * Копирует текст в буфер и показывает тост «Скопировано».
 * Использовать для кнопок «Копировать» (ссылки приглашений, длинный текст).
 */
export function useCopyToClipboard() {
  return useCallback(async (text: string, successMessage = 'Скопировано') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
      return true;
    } catch {
      toast.error('Не удалось скопировать');
      return false;
    }
  }, []);
}
