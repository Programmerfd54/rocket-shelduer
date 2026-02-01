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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                <Send className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-semibold text-gray-900">Rocket.Chat Scheduler</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/login"
                className="text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Вход
              </Link>
              <Link
                href="/register"
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
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
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            Планируйте сообщения в<br />
            <span className="text-red-600">Rocket.Chat</span> легко
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            Отправляйте отложенные сообщения в ваши каналы Rocket.Chat. 
            Удобный интерфейс, надёжное шифрование, автоматическая отправка.
          </p>
          <div className="flex justify-center space-x-4">
            <Link
              href="/register"
              className="px-8 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-lg font-medium shadow-lg"
            >
              Начать бесплатно
            </Link>
            <Link
              href="/login"
              className="px-8 py-3 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-lg font-medium border-2 border-gray-200"
            >
              Войти
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid md:grid-cols-3 gap-8">
          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
              <Calendar className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Отложенная отправка
            </h3>
            <p className="text-gray-600">
              Планируйте отправку сообщений на удобное время. Система автоматически отправит их в указанный момент.
            </p>
          </div>

          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Безопасность
            </h3>
            <p className="text-gray-600">
              Ваши данные и пароли защищены современным шифрованием AES-256-GCM. Полная конфиденциальность.
            </p>
          </div>

          <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Простота
            </h3>
            <p className="text-gray-600">
              Интуитивный интерфейс. Подключите пространство, выберите канал и запланируйте сообщение за минуты.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-24 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-500 text-sm">
            © {new Date().getFullYear()} Rocket.Chat Scheduler. Сделано с ❤️
          </p>
        </div>
      </footer>
    </div>
  );
}
