'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  successMessage?: string;
  variant?: 'ghost' | 'outline' | 'link';
  size?: 'icon' | 'sm' | 'default' | 'lg';
  className?: string;
  'aria-label'?: string;
}

/** Кнопка «Копировать» с тултипом и тостом «Скопировано». */
export function CopyButton({
  text,
  successMessage = 'Скопировано',
  variant = 'ghost',
  size = 'icon',
  className,
  'aria-label': ariaLabel = 'Копировать',
}: CopyButtonProps) {
  const copy = useCopyToClipboard();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          aria-label={ariaLabel}
          onClick={() => copy(text, successMessage)}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{ariaLabel}</TooltipContent>
    </Tooltip>
  );
}
