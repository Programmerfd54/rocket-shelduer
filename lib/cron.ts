import cron, { type ScheduledTask } from 'node-cron';
import { sendScheduledMessages } from '@/scripts/send-scheduled-messages';
import { runReactionRatingTick } from '@/lib/reactions/service';

let cronJob: ScheduledTask | null = null;

export function startCronJob() {
  if (cronJob) return;
  // Внутренний cron запускается ВСЕГДА (dev и production), независимо от CRON_SECRET: он вызывает отправку напрямую
  // из процесса приложения, без HTTP и секрета. Раньше при заданном CRON_SECRET он отключался в расчёте на внешний
  // cron-контейнер — если контейнера нет (корневой docker-compose.yml) или секрет отклонялся, сообщения не уходили.
  // Совместная работа с внешним cron (/api/cron/send-messages) безопасна: сообщение перед отправкой атомарно
  // «захватывается» (compare-and-swap), поэтому дубликатов не будет. Отключить: DISABLE_INTERNAL_CRON=true.
  if (process.env.DISABLE_INTERNAL_CRON === 'true') {
    console.log('ℹ️ Internal cron is disabled (DISABLE_INTERNAL_CRON=true) — scheduled messages need an external cron.');
    return;
  }

  console.log('🚀 Starting internal cron job for scheduled messages...');

  cronJob = cron.schedule('* * * * *', async () => {
    try {
      const result = await sendScheduledMessages();
      const total = (result.sent ?? 0) + (result.failed ?? 0);
      if (total > 0) {
        console.log(`✅ Cron: sent=${result.sent ?? 0}, failed=${result.failed ?? 0}`);
      }
    } catch (error) {
      console.error('❌ Cron job error:', error instanceof Error ? error.message : error);
    }
    // Рейтинг реакций: синхронизация и автопубликации (сам ограничивает частоту, не блокирует отправку)
    void runReactionRatingTick().catch((e) => console.error('❌ Reactions tick error:', e));
  }, { name: 'send-scheduled-messages', noOverlap: true }); // медленный тик не запускается повторно поверх себя

  console.log('✅ Internal cron started! Messages will be sent every minute.');
}

export function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('🛑 Cron job stopped');
  }
}
