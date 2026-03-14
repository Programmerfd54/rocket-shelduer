import cron, { type ScheduledTask } from 'node-cron';
import { sendScheduledMessages } from '@/scripts/send-scheduled-messages';

let cronJob: ScheduledTask | null = null;

export function startCronJob() {
  if (cronJob) return;
  // В development: всегда запускаем внутренний cron.
  // В production: запускаем, если CRON_SECRET не задан (нет внешнего cron — Docker без отдельного cron-контейнера).
  const runInternalCron =
    process.env.NODE_ENV === 'development' ||
    (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET);
  if (!runInternalCron) return;

  console.log('🚀 Starting internal cron job for scheduled messages...');

  cronJob = cron.schedule('* * * * *', async () => {
    try {
      const result = await sendScheduledMessages();
      const total = (result.sent ?? 0) + (result.failed ?? 0);
      if (total > 0) {
        console.log(`✅ Cron: sent=${result.sent ?? 0}, failed=${result.failed ?? 0}`);
      }
    } catch (error) {
      console.error('❌ Cron job error:', error);
    }
  });

  console.log('✅ Internal cron started! Messages will be sent every minute.');
}

export function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('🛑 Cron job stopped');
  }
}
