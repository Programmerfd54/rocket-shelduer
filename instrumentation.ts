export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Последний рубеж против утечек в журнал: пароли/токены/заголовки авторизации скрываются в любом console.*
    const { installConsoleRedaction } = await import('./lib/sensitive-data');
    installConsoleRedaction();
    const { validateEnv } = await import('./lib/env');
    validateEnv();
    const { startCronJob } = await import('./lib/cron');
    startCronJob();
  }
}
