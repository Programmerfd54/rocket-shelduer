'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HELP_ROLE_OPTIONS } from '@/components/_components/HelpRichEditor'

/** Подпись роли для списков («Для всех», если роли не ограничены). */
export function helpRolesLabel(roles: string[] | undefined): string {
  if (!roles || roles.length === 0) return 'Для всех'
  return roles
    .map((r) => HELP_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r)
    .join(', ')
}

/** Проверка порядка: целое число ≥ 0. Пустая строка считается ошибкой. */
export function validateHelpOrder(raw: string): string | undefined {
  const v = raw.trim()
  if (!/^\d{1,6}$/.test(v)) return 'Введите целое число от 0.'
  return undefined
}

/** Выбор ролей, которым виден материал. Пустой выбор = «для всех». */
export function HelpRolesField({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (roles: string[]) => void
  disabled?: boolean
}) {
  const uid = useId()
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-[13px] font-medium">Кому показывать</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {HELP_ROLE_OPTIONS.filter((o) => o.value).map((o) => {
          const id = `${uid}-${o.value}`
          return (
            <div key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={value.includes(o.value)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, o.value] : value.filter((r) => r !== o.value))
                }
              />
              <Label htmlFor={id} className="text-sm font-normal">
                {o.label}
              </Label>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Ничего не выбрано — материал виден всем.</p>
    </fieldset>
  )
}

/** Строка списка с названием, пояснением и кнопками «изменить» / «удалить». */
export function HelpListRow({
  title,
  meta,
  editLabel,
  deleteLabel,
  editHref,
  onEdit,
  onDelete,
}: {
  title: ReactNode
  meta?: ReactNode
  editLabel: string
  deleteLabel: string
  /** Если задан — «изменить» работает как ссылка */
  editHref?: string
  onEdit?: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex min-h-12 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            {editHref ? (
              <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
                <Link href={editHref} aria-label={editLabel}>
                  <Pencil />
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={editLabel}
                onClick={onEdit}
              >
                <Pencil />
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent side="top">{editLabel}</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              aria-label={deleteLabel}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{deleteLabel}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  )
}

export type HelpFaqValues = { question: string; answer: string; roles: string[]; order: number }

const QUESTION_MAX = 300
const ANSWER_MAX = 5000

function FaqForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: HelpFaqValues
  submitLabel: string
  onCancel: () => void
  /** Возвращает true, если сохранено (диалог закроет родитель). Ошибку с тостом показывает родитель. */
  onSubmit: (values: HelpFaqValues) => Promise<boolean>
}) {
  const [question, setQuestion] = useState(initial.question)
  const [answer, setAnswer] = useState(initial.answer)
  const [roles, setRoles] = useState<string[]>(initial.roles)
  const [order, setOrder] = useState(String(initial.order))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const q = question.trim()
  const a = answer.trim()
  const errors = {
    question: !q
      ? 'Введите текст вопроса.'
      : q.length > QUESTION_MAX
        ? `Не длиннее ${QUESTION_MAX} символов.`
        : undefined,
    answer: !a
      ? 'Введите текст ответа.'
      : a.length > ANSWER_MAX
        ? `Не длиннее ${ANSWER_MAX} символов.`
        : undefined,
    order: validateHelpOrder(order),
  }
  const hasErrors = Boolean(errors.question || errors.answer || errors.order)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSubmitted(true)
    if (hasErrors || saving) return
    setSaving(true)
    try {
      await onSubmit({ question: q, answer: a, roles, order: Number(order) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label="Вопрос" htmlFor="help-faq-question" required error={submitted ? errors.question : undefined}>
        <Input
          id="help-faq-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Например: Как запланировать анонс?"
          aria-invalid={submitted && !!errors.question}
          disabled={saving}
          autoFocus
        />
      </Field>
      <Field label="Ответ" htmlFor="help-faq-answer" required error={submitted ? errors.answer : undefined}>
        <Textarea
          id="help-faq-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="min-h-28"
          placeholder="Текст ответа"
          aria-invalid={submitted && !!errors.answer}
          disabled={saving}
        />
      </Field>
      <HelpRolesField value={roles} onChange={setRoles} disabled={saving} />
      <Field
        label="Порядок"
        htmlFor="help-faq-order"
        hint="Чем меньше число, тем выше в списке."
        error={submitted ? errors.order : undefined}
        className="max-w-40"
      >
        <Input
          id="help-faq-order"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          aria-invalid={submitted && !!errors.order}
          disabled={saving}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" disabled={saving || (submitted && hasErrors)}>
          {saving && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Диалог создания/редактирования вопроса FAQ (общий для глобального FAQ и FAQ каталога). */
export function HelpFaqDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  submitLabel: string
  initial: HelpFaqValues
  onSubmit: (values: HelpFaqValues) => Promise<boolean>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* Форма монтируется заново при каждом открытии — состояние полей берётся из initial */}
        {open && (
          <FaqForm
            initial={initial}
            submitLabel={submitLabel}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
