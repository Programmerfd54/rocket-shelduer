'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  successMessage?: string;
  variant?: 'ghost' | 'outline' | 'link';
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg' | 'xs' | 'sm' | 'default' | 'lg';
  className?: string;
  'aria-label'?: string;
}

/** Кнопка «Копировать»: тултип, тост «Скопировано» и галочка на пару секунд. */
export function CopyButton({
  text,
  successMessage = 'Скопировано',
  variant = 'ghost',
  size = 'icon',
  className,
  'aria-label': ariaLabel = 'Копировать',
}: CopyButtonProps) {
  const copy = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleClick = async () => {
    const ok = await copy(text, successMessage);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          aria-label={ariaLabel}
          onClick={handleClick}
        >
          {copied ? <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{copied ? 'Скопировано' : ariaLabel}</TooltipContent>
    </Tooltip>
  );
}
