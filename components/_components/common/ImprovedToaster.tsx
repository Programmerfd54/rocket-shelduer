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
      offset="24px"
      gap={12}
      visibleToasts={4}
      icons={{
        success: (
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ),
        error: (
          <XCircle className="size-5 shrink-0 text-red-600 dark:text-red-400" />
        ),
        warning: (
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        ),
        info: (
          <Info className="size-5 shrink-0 text-sky-600 dark:text-sky-400" />
        ),
        loading: (
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
        ),
      }}
      toastOptions={{
        style: {
          borderRadius: "var(--radius-xl)",
          padding: "16px 18px 14px",
          fontSize: "14px",
          minHeight: "auto",
          minWidth: "320px",
          maxWidth: "420px",
          background: "var(--card)",
          color: "var(--card-foreground)",
          border: "1px solid var(--border)",
          boxShadow:
            "0 10px 40px -10px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.03)",
        },
        classNames: {
          toast:
            "group/toast rounded-xl border bg-card text-card-foreground shadow-xl [--toast-accent:theme(colors.primary.DEFAULT)]",
          title: "text-[15px] font-semibold tracking-tight text-foreground",
          description:
            "text-[13px] mt-1 leading-snug text-muted-foreground/95",
          actionButton:
            "bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90",
          cancelButton:
            "bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm font-medium border border-border hover:bg-muted/80",
          closeButton:
            "rounded-lg border border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
          success:
            "border-l-4 border-l-emerald-500 dark:border-l-emerald-400 [&_[data-icon]]:text-emerald-600 dark:[&_[data-icon]]:text-emerald-400",
          error:
            "border-l-4 border-l-red-500 dark:border-l-red-400 [&_[data-icon]]:text-red-600 dark:[&_[data-icon]]:text-red-400",
          warning:
            "border-l-4 border-l-amber-500 dark:border-l-amber-400 [&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-400",
          info: "border-l-4 border-l-sky-500 dark:border-l-sky-400 [&_[data-icon]]:text-sky-600 dark:[&_[data-icon]]:text-sky-400",
          loading:
            "border-l-4 border-l-primary [&_[data-icon]]:text-primary [&_[data-icon]]:animate-spin",
        },
      }}
    />
  );
}
