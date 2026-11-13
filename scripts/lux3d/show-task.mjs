// 查单个 Lux3D 任务详情（含失败原因），用于排查。
// 用法：node --env-file=.env.local scripts/lux3d/show-task.mjs 6976085
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

const taskId = Number(process.argv[2]);
if (!taskId) {
  console.error('usage: node --env-file=.env.local scripts/lux3d/show-task.mjs <taskId>');
  process.exit(1);
}

const lux3d = createLux3dClient({ apiKey: process.env.AHOLO_API_KEY, region: process.env.AHOLO_REGION || 'cn' });
const task = await lux3d.tasks.retrieve(taskId);
console.log(JSON.stringify(task, null, 2));
