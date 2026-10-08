import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import ImprovedToaster from "@/components/_components/common/ImprovedToaster";
import OfflineDetector from "@/components/_components/common/OfflineDetector";
import GlobalFetchHandler from "@/components/_components/common/GlobalFetchHandler";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fontSans, fontMono } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Rocket.Chat Scheduler",
  description: "Планирование отложенных сообщений для Rocket.Chat",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // nonce из middleware (CSP без 'unsafe-inline' для скриптов): нужен инлайн-скрипту next-themes.
  // Скрипты самого Next получают nonce автоматически из заголовка Content-Security-Policy запроса.
  // Чтение headers() делает страницы динамическими — это требование nonce-CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="ru"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased font-sans">
        <ThemeProvider nonce={nonce}>
          <TooltipProvider delayDuration={300}>
            <GlobalFetchHandler />
            {children}
            <ImprovedToaster />
            <OfflineDetector />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
