/**
 * Обёртка над sonner для единообразных и информативных тостов.
 * Используйте title + description для контекста; для асинхронных операций — toast.promise.
 */

import { toast as sonnerToast, type ExternalToast } from "sonner";

type ToastOptions = ExternalToast & {
  title?: string;
  description?: string;
};

/** Показать успех с заголовком и опциональным описанием */
export function success(message: string, options?: ToastOptions) {
  return sonnerToast.success(options?.title ?? message, {
    description: options?.description ?? (options?.title ? message : undefined),
    duration: options?.duration ?? 5000,
    ...options,
  });
}

/** Показать ошибку с заголовком и опциональным описанием (например, текст с сервера) */
export function error(message: string, options?: ToastOptions) {
  return sonnerToast.error(options?.title ?? message, {
    description: options?.description ?? (options?.title ? message : undefined),
    duration: options?.duration ?? 6000,
    ...options,
  });
}

/** Показать предупреждение */
export function warning(message: string, options?: ToastOptions) {
  return sonnerToast.warning(options?.title ?? message, {
    description: options?.description ?? (options?.title ? message : undefined),
    duration: options?.duration ?? 5000,
    ...options,
  });
}

/** Показать информационное сообщение */
export function info(message: string, options?: ToastOptions) {
  return sonnerToast.info(options?.title ?? message, {
    description: options?.description ?? (options?.title ? message : undefined),
    duration: options?.duration ?? 5000,
    ...options,
  });
}

/** Показать тост «В процессе» (загрузка). Возвращает id — можно обновить через sonnerToast.success/error(id, ...) */
export function loading(message: string, options?: ToastOptions) {
  return sonnerToast.loading(message, {
    description: options?.description,
    duration: Infinity,
    ...options,
  });
}

/**
 * Обёртка над toast.promise: автоматически показывает «Загрузка» → «Успех» или «Ошибка».
 * Пример:
 *   toast.promise(saveMessage(), {
 *     loading: 'Сохранение...',
 *     success: 'Сообщение запланировано!',
 *     error: (e) => e?.message ?? 'Ошибка при сохранении',
 *   })
 */
export const promise = sonnerToast.promise;

/** Закрыть тост по id (например, после ручного loading) */
export const dismiss = sonnerToast.dismiss;

/** Нативный toast для кастомных сценариев */
export const toast = sonnerToast;
