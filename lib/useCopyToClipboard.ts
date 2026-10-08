'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

function copyViaExecCommand(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  el.style.top = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    document.body.removeChild(el);
    return false;
  }
}

/**
 * Копирует текст в буфер и показывает тост «Скопировано».
 * Сначала пробует navigator.clipboard (может не работать по HTTP), затем fallback через execCommand.
 */
export function useCopyToClipboard() {
  return useCallback(async (text: string, successMessage = 'Скопировано') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
        return true;
      }
    } catch {
      /* fallback */
    }
    if (copyViaExecCommand(text)) {
      toast.success(successMessage);
      return true;
    }
    toast.error('Не удалось скопировать');
    return false;
  }, []);
}
