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
      offset="16px"
      gap={8}
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
          borderRadius: "8px",
          padding: "12px 14px",
          fontSize: "13px",
          minHeight: "auto",
          minWidth: "300px",
          maxWidth: "400px",
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
        },
        classNames: {
          toast: "group/toast !rounded-lg !border !bg-popover !text-popover-foreground toast-improved",
          title: "!text-[13px] !font-medium !tracking-tight !text-foreground",
          description: "!text-[12.5px] !mt-0.5 !leading-relaxed !text-muted-foreground",
          actionButton:
            "!bg-foreground !text-background !rounded-md !px-2.5 !py-1 !text-xs !font-medium hover:!opacity-90 !transition-opacity",
          cancelButton:
            "!bg-muted !text-muted-foreground !rounded-md !px-2.5 !py-1 !text-xs !font-medium hover:!bg-accent !transition-colors",
          closeButton:
            "!rounded-md !opacity-60 hover:!opacity-100 !text-muted-foreground hover:!text-foreground !transition-opacity !border-0 !bg-transparent",
        },
      }}
    />
  );
}
