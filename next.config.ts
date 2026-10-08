import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Не раскрываем стек/версию в заголовке X-Powered-By
  poweredByHeader: false,
  // Исходники клиентского кода не публикуются (явно: значение по умолчанию может поменяться)
  productionBrowserSourceMaps: false,
  // undici (connect-time SSRF guard в lib/ssrf.ts) подключается из node_modules, а не бандлится
  serverExternalPackages: ["undici"],
  async rewrites() {
    return {
      // Загрузки лежат в public/, но статикой не отдаются: beforeFiles срабатывает раньше public/,
      // запрос уходит в route handler с проверкой сессии и безопасными заголовками
      // (см. lib/uploaded-files.ts). URL, сохранённые в БД/HTML, не меняются.
      beforeFiles: [
        { source: "/help-uploads/:name", destination: "/api/uploads/help/:name" },
        { source: "/uploads/avatars/:name", destination: "/api/uploads/avatars/:name" },
        // Прочие пути под /uploads и вложенные пути — в тот же обработчик (ответит 404)
        { source: "/uploads/:path*", destination: "/api/uploads/none/none" },
        { source: "/help-uploads/:path*", destination: "/api/uploads/none/none" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // Статика (_next/static, иконки — исключены из matcher middleware) — тоже без MIME-sniffing
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
