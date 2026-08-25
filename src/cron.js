import { generateDailyTasks, init } from './server.js';
import { closeDb } from './db.js';

try {
  await init();
  const result = await generateDailyTasks();
  console.log(`Tarefas diarias criadas: ${result.created}`);
} finally {
  await closeDb();
}
