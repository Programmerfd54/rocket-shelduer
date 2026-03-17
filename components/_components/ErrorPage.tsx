"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
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
  CheckCircle,
  Clock,
  Globe,
  ChevronDown,
  ChevronUp,
  Bug,
  Lock,
  ShieldX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ErrorType = "unauthorized" | "forbidden" | "not-found" | "server-error" | "maintenance";

interface ErrorConfig {
  code: number | string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  bgGradient: string;
}

const errorConfigs: Record<ErrorType, ErrorConfig> = {
  unauthorized: {
    code: 401,
    title: "Не авторизован",
    description: "Для доступа к этой странице необходимо войти в систему.",
    icon: Lock,
    iconColor: "text-yellow-500",
    bgGradient: "from-yellow-500/10 via-transparent to-transparent",
  },
  forbidden: {
    code: 403,
    title: "Доступ запрещён",
    description: "У вас нет прав для просмотра этой страницы.",
    icon: ShieldX,
    iconColor: "text-red-500",
    bgGradient: "from-red-500/10 via-transparent to-transparent",
  },
  "not-found": {
    code: 404,
    title: "Страница не найдена",
    description: "Запрашиваемая страница не существует или была удалена.",
    icon: FileQuestion,
    iconColor: "text-blue-500",
    bgGradient: "from-blue-500/10 via-transparent to-transparent",
  },
  "server-error": {
    code: 500,
    title: "Ошибка сервера",
    description: "Произошла внутренняя ошибка. Мы уже работаем над её устранением.",
    icon: ServerCrash,
    iconColor: "text-red-500",
    bgGradient: "from-red-500/10 via-transparent to-transparent",
  },
  maintenance: {
    code: 503,
    title: "Технические работы",
    description: "Сервис временно недоступен. Пожалуйста, попробуйте позже.",
    icon: Wrench,
    iconColor: "text-orange-500",
    bgGradient: "from-orange-500/10 via-transparent to-transparent",
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
  const config = errorConfigs[type];
  const Icon = config.icon;

  const [isAdmin, setIsAdmin] = useState(isAdminProp ?? false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorId] = useState(() => `ERR-${Date.now().toString(36).toUpperCase()}`);
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    if (autoDetectAdmin && isAdminProp === undefined) {
      const checkAdmin = async () => {
        try {
          const res = await fetch("/api/auth/me", { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setIsAdmin(data.user?.role === "ADMIN" || data.user?.role === "SUPPORT");
          }
        } catch {
          setIsAdmin(false);
        }
      };
      checkAdmin();
    }
  }, [autoDetectAdmin, isAdminProp]);

  useEffect(() => {
    if (logError && !logged && type !== "not-found") {
      logErrorToServer({
        errorCode: String(config.code),
        message: errorDetails || config.title,
        stack: errorStack,
        url: pathname,
      });
      setLogged(true);
    }
  }, [logError, logged, config.code, errorDetails, errorStack, pathname, type]);

  const handleCopyError = () => {
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

    navigator.clipboard.writeText(errorInfo);
    setCopied(true);
    toast.success("Информация об ошибке скопирована");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className={cn("absolute inset-0 bg-gradient-to-b", config.bgGradient)} />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 max-w-md w-full text-center space-y-8"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="flex justify-center"
        >
          <div
            className={cn(
              "relative flex items-center justify-center w-24 h-24 rounded-full",
              "bg-muted/50 border border-border/50"
            )}
          >
            <Icon className={cn("size-12", config.iconColor)} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="space-y-3"
        >
          <h1 className="text-7xl font-bold tracking-tighter text-foreground">{config.code}</h1>
          <h2 className="text-2xl font-semibold text-foreground">{config.title}</h2>
          <p className="text-muted-foreground text-base leading-relaxed">{config.description}</p>
        </motion.div>

        {isAdmin && (errorDetails || errorStack) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ delay: 0.3 }}
            className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl p-4 text-left space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bug className="size-4 text-red-500" />
                <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                  Информация для администратора
                </span>
              </div>
              <Badge variant="outline" className="text-xs font-mono border-red-300 dark:border-red-800">
                {errorId}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="size-3" />
                <span className="truncate">{pathname}</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-3" />
                <span>{new Date().toLocaleString("ru")}</span>
              </div>
            </div>

            {(errorDetails || errorStack) && (
              <>
                <button
                  onClick={() => setDetailsExpanded(!detailsExpanded)}
                  className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  {detailsExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {detailsExpanded ? "Скрыть детали" : "Показать детали"}
                </button>

                {detailsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    className="space-y-2"
                  >
                    {errorDetails && (
                      <div className="rounded-lg bg-white dark:bg-zinc-900 p-3 border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Сообщение</p>
                        <p className="text-sm text-foreground">{errorDetails}</p>
                      </div>
                    )}
                    {errorStack && (
                      <div className="rounded-lg bg-white dark:bg-zinc-900 p-3 border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Stack trace</p>
                        <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
                          {errorStack}
                        </pre>
                      </div>
                    )}
                  </motion.div>
                )}
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyError}
              className="w-full gap-2 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              {copied ? (
                <>
                  <CheckCircle className="size-3 text-green-500" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="size-3" />
                  Скопировать информацию об ошибке
                </>
              )}
            </Button>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          {showBackButton && (
            <Button variant="outline" onClick={() => router.back()} className="gap-2">
              <ArrowLeft className="size-4" />
              Назад
            </Button>
          )}
          {showHomeButton && (
            <Button onClick={() => router.push("/dashboard")} className="gap-2">
              <Home className="size-4" />
              На главную
            </Button>
          )}
          {showRefreshButton && (
            <Button
              variant="outline"
              onClick={() => (onReset ? onReset() : window.location.reload())}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              Обновить
            </Button>
          )}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-xs text-muted-foreground/60"
        >
          Если проблема сохраняется, обратитесь к администратору.
        </motion.p>
      </motion.div>
    </div>
  );
}

export { type ErrorType, errorConfigs };
