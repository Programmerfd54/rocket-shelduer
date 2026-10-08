"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Home,
  RefreshCw,
  FileQuestion,
  ServerCrash,
  Wrench,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  ShieldX,
} from "lucide-react";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

type ErrorType = "unauthorized" | "forbidden" | "not-found" | "server-error" | "maintenance";

interface ErrorConfig {
  code: number | string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const errorConfigs: Record<ErrorType, ErrorConfig> = {
  unauthorized: {
    code: 401,
    title: "Нужно войти в систему",
    description: "Эта страница доступна только авторизованным пользователям. Войдите и попробуйте снова.",
    icon: Lock,
  },
  forbidden: {
    code: 403,
    title: "Нет доступа",
    description: "У вашей роли нет прав на эту страницу. Если доступ нужен, обратитесь к администратору.",
    icon: ShieldX,
  },
  "not-found": {
    code: 404,
    title: "Страница не найдена",
    description: "Возможно, ссылка устарела или страница была удалена. Проверьте адрес или вернитесь на главную.",
    icon: FileQuestion,
  },
  "server-error": {
    code: 500,
    title: "Что-то пошло не так",
    description: "Произошла внутренняя ошибка. Попробуйте обновить страницу — данные не потеряны.",
    icon: ServerCrash,
  },
  maintenance: {
    code: 503,
    title: "Технические работы",
    description: "Сервис временно недоступен. Попробуйте зайти через несколько минут.",
    icon: Wrench,
  },
};

interface ErrorPageProps {
  type: ErrorType;
  errorDetails?: string;
  errorStack?: string;
  isAdmin?: boolean;
  showBackButton?: boolean;
  showHomeButton?: boolean;
  showRefreshButton?: boolean;
  autoDetectAdmin?: boolean;
  logError?: boolean;
  onReset?: () => void;
}

async function logErrorToServer(data: {
  errorCode: string;
  message: string;
  stack?: string;
  url?: string;
}) {
  try {
    await fetch("/api/errors/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    console.error("Failed to log error to server");
  }
}

export function ErrorPage({
  type,
  errorDetails,
  errorStack,
  isAdmin: isAdminProp,
  showBackButton = true,
  showHomeButton = true,
  showRefreshButton = false,
  autoDetectAdmin = true,
  logError = true,
  onReset,
}: ErrorPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const copy = useCopyToClipboard();
  const config = errorConfigs[type];
  const Icon = config.icon;

  const [isAdmin, setIsAdmin] = useState(isAdminProp ?? false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorId] = useState(() => `ERR-${Date.now().toString(36).toUpperCase()}`);
  const logged = useRef(false);

  useEffect(() => {
    if (autoDetectAdmin && isAdminProp === undefined) {
      const checkAdmin = async () => {
        try {
          const res = await fetch("/api/auth/me", { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setIsAdmin(data.user?.role === "LEAD_SUP" || data.user?.role === "SUP");
          }
        } catch {
          setIsAdmin(false);
        }
      };
      checkAdmin();
    }
  }, [autoDetectAdmin, isAdminProp]);

  useEffect(() => {
    if (logError && !logged.current && type !== "not-found") {
      logged.current = true;
      logErrorToServer({
        errorCode: String(config.code),
        message: errorDetails || config.title,
        stack: errorStack,
        url: pathname,
      });
    }
  }, [logError, config.code, config.title, errorDetails, errorStack, pathname, type]);

  const handleCopyError = async () => {
    const errorInfo = [
      `Error ID: ${errorId}`,
      `Code: ${config.code}`,
      `Type: ${type}`,
      `URL: ${pathname}`,
      `Time: ${new Date().toISOString()}`,
      errorDetails && `Details: ${errorDetails}`,
      errorStack && `Stack:\n${errorStack}`,
    ]
      .filter(Boolean)
      .join("\n");

    const ok = await copy(errorInfo, "Информация об ошибке скопирована");
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasDetails = isAdmin && (errorDetails || errorStack);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4" aria-hidden />
            <span className="font-mono text-xs">Ошибка {config.code}</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{config.title}</h1>
          <p className="text-sm text-muted-foreground text-pretty">{config.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showHomeButton && (
            <Button onClick={() => router.push("/dashboard")}>
              <Home aria-hidden />
              На главную
            </Button>
          )}
          {showRefreshButton && (
            <Button
              variant="outline"
              onClick={() => (onReset ? onReset() : window.location.reload())}
            >
              <RefreshCw aria-hidden />
              Попробовать снова
            </Button>
          )}
          {showBackButton && (
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft aria-hidden />
              Назад
            </Button>
          )}
        </div>

        {hasDetails && (
          <div className="space-y-3 rounded-lg border bg-card p-4 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Для администратора</span>
              <Badge variant="muted" className="font-mono">
                {errorId}
              </Badge>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Адрес</dt>
              <dd className="truncate font-mono">{pathname}</dd>
              <dt className="text-muted-foreground">Время</dt>
              <dd>{new Date().toLocaleString("ru")}</dd>
            </dl>

            <button
              type="button"
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              aria-expanded={detailsExpanded}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {detailsExpanded ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
              {detailsExpanded ? "Скрыть технические детали" : "Показать технические детали"}
            </button>

            {detailsExpanded && (
              <div className="space-y-2">
                {errorDetails && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Сообщение</p>
                    <p className="text-sm break-words">{errorDetails}</p>
                  </div>
                )}
                {errorStack && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Stack trace</p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                      {errorStack}
                    </pre>
                  </div>
                )}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={handleCopyError}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Скопировано" : "Скопировать информацию"}
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Если ошибка повторяется, сообщите об этом администратору.
        </p>
      </div>
    </div>
  );
}

export { type ErrorType, errorConfigs };
