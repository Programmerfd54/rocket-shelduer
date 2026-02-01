import cron, { type ScheduledTask } from 'node-cron';

let cronJob: ScheduledTask | null = null;

export function startCronJob() {
  // Запускаем только в development и если еще не запущен
  if (process.env.NODE_ENV === 'development' && !cronJob) {
    console.log('🚀 Starting cron job for scheduled messages...');
    
    // Запускаем каждую минуту
    cronJob = cron.schedule('* * * * *', async () => {
      try {
        console.log(`[${new Date().toISOString()}] Checking for scheduled messages...`);
        
        const response = await fetch('http://localhost:3000/api/cron/send-messages');
        const data = await response.json();
        
        if (response.ok && (data.sent > 0 || data.failed > 0)) {
          console.log(`✅ Sent: ${data.sent}, Failed: ${data.failed}`);
        }
      } catch (error) {
        console.error('❌ Cron job error:', error);
      }
    });

    console.log('✅ Cron job started! Messages will be sent automatically every minute.');
  }
}

export function stopCronJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('🛑 Cron job stopped');
  }
}
