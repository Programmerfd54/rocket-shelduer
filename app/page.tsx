import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import Link from 'next/link';
import { Send, Calendar, Shield, Zap } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen auth-canvas">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm ring-1 ring-primary/25">
                <Send className="w-6 h-6" />
              </div>
              <span className="text-xl font-semibold text-foreground tracking-tight">Rocket.Chat Scheduler</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground px-4 py-2 rounded-lg hover:bg-muted/80 transition-colors"
              >
                Вход
              </Link>
              <Link
                href="/register"
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
              >
                Регистрация
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-foreground mb-6 tracking-tight">
            Планируйте сообщения в<br />
            <span className="text-primary">Rocket.Chat</span> легко
          </h1>
          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Отправляйте отложенные сообщения в ваши каналы Rocket.Chat. Удобный интерфейс, надёжное шифрование,
            автоматическая отправка.
          </p>
          <div className="flex justify-center flex-wrap gap-4">
            <Link
              href="/register"
              className="px-8 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-lg font-medium shadow-lg shadow-primary/20"
            >
              Начать бесплатно
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 bg-card text-foreground rounded-xl hover:bg-muted/80 transition-colors text-lg font-medium border border-border/80 shadow-sm"
            >
              Войти
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid md:grid-cols-3 gap-8">
          <div className="bg-card p-8 rounded-2xl shadow-sm border border-border/60">
            <div className="w-12 h-12 bg-primary/12 text-primary rounded-xl flex items-center justify-center mb-4 ring-1 ring-primary/10">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Отложенная отправка</h3>
            <p className="text-muted-foreground leading-relaxed">
              Планируйте отправку сообщений на удобное время. Система автоматически отправит их в указанный момент.
            </p>
          </div>

          <div className="bg-card p-8 rounded-2xl shadow-sm border border-border/60">
            <div className="w-12 h-12 bg-sky-500/12 text-sky-600 dark:text-sky-400 rounded-xl flex items-center justify-center mb-4 ring-1 ring-sky-500/20">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Безопасность</h3>
            <p className="text-muted-foreground leading-relaxed">
              Ваши данные и пароли защищены современным шифрованием AES-256-GCM. Полная конфиденциальность.
            </p>
          </div>

          <div className="bg-card p-8 rounded-2xl shadow-sm border border-border/60">
            <div className="w-12 h-12 bg-accent text-accent-foreground rounded-xl flex items-center justify-center mb-4 ring-1 ring-primary/10">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Простота</h3>
            <p className="text-muted-foreground leading-relaxed">
              Интуитивный интерфейс. Подключите пространство, выберите канал и запланируйте сообщение за минуты.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 mt-24 py-8 bg-card/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-muted-foreground text-sm">© {new Date().getFullYear()} Rocket.Chat Scheduler.</p>
        </div>
      </footer>
    </div>
  );
}
