"use client";

import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export default function ImprovedToaster() {
  const { theme = "system", resolvedTheme } = useTheme();
  const effectiveTheme = (resolvedTheme ?? theme) as ToasterProps["theme"];

  return (
    <Sonner
      theme={effectiveTheme}
      position="top-right"
      expand={true}
      richColors={false}
      closeButton
      duration={5000}
      offset="20px"
      gap={10}
      visibleToasts={5}
      icons={{
        success: (
          <CheckCircle2 className="size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" />
        ),
        error: (
          <XCircle className="size-[18px] shrink-0 text-red-600 dark:text-red-400" />
        ),
        warning: (
          <AlertTriangle className="size-[18px] shrink-0 text-amber-600 dark:text-amber-400" />
        ),
        info: (
          <Info className="size-[18px] shrink-0 text-sky-600 dark:text-sky-400" />
        ),
        loading: (
          <Loader2 className="size-[18px] shrink-0 animate-spin text-primary" />
        ),
      }}
      toastOptions={{
        style: {
          borderRadius: "12px",
          padding: "14px 16px 12px",
          fontSize: "14px",
          minHeight: "auto",
          minWidth: "300px",
          maxWidth: "400px",
          background: "var(--card)",
          color: "var(--card-foreground)",
          border: "1px solid var(--border)",
        },
        classNames: {
          toast:
            "group/toast !rounded-xl !border !bg-card !text-card-foreground [--toast-accent:theme(colors.primary.DEFAULT)] toast-improved",
          title: "!text-[14px] !font-medium !tracking-tight !text-foreground",
          description:
            "!text-[13px] !mt-1 !leading-relaxed !text-muted-foreground",
          actionButton:
            "!bg-primary !text-primary-foreground !rounded-lg !px-3 !py-1.5 !text-sm !font-medium hover:!opacity-90 !transition-opacity",
          cancelButton:
            "!bg-muted !text-muted-foreground !rounded-lg !px-3 !py-1.5 !text-sm !font-medium !border !border-border hover:!bg-muted/80 !transition-colors",
          closeButton:
            "!rounded-lg !opacity-60 hover:!opacity-100 !text-muted-foreground hover:!text-foreground !transition-all !border-0",
          success:
            "!border-l-[3px] !border-l-emerald-500/80 dark:!border-l-emerald-400/80 [&_[data-icon]]:!text-emerald-600 dark:[&_[data-icon]]:!text-emerald-400",
          error:
            "!border-l-[3px] !border-l-red-500/80 dark:!border-l-red-400/80 [&_[data-icon]]:!text-red-600 dark:[&_[data-icon]]:!text-red-400",
          warning:
            "!border-l-[3px] !border-l-amber-500/80 dark:!border-l-amber-400/80 [&_[data-icon]]:!text-amber-600 dark:[&_[data-icon]]:!text-amber-400",
          info: "!border-l-[3px] !border-l-sky-500/80 dark:!border-l-sky-400/80 [&_[data-icon]]:!text-sky-600 dark:[&_[data-icon]]:!text-sky-400",
          loading:
            "!border-l-[3px] !border-l-primary/80 [&_[data-icon]]:!text-primary [&_[data-icon]]:!animate-spin",
        },
      }}
    />
  );
}
