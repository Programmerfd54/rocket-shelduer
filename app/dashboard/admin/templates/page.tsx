"use client"

/**
 * «Шаблоны анонсов». Та же страница переиспользуется в /dashboard/templates (SUP, ADM, MEMBER) и во встраивании ?chrome=0.
 * Реализация — components/templates/** (TemplatesHub): официальные шаблоны SUP/ADM (управление для Lead_SUP),
 * «Мои шаблоны», «Запланировать» по шаблону, словарь каналов.
 */
import { TemplatesHub } from '@/components/templates/TemplatesHub'

export default function TemplatesPage() {
  return <TemplatesHub />
}
