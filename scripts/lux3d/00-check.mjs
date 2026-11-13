// 零积分自检：只调任务列表，验证 key 与网关可用，不创建任何任务。
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

const apiKey = process.env.AHOLO_API_KEY;
if (!apiKey) {
  console.error('缺少 AHOLO_API_KEY（用 node --env-file=.env.local 运行）');
  process.exit(1);
}

const lux3d = createLux3dClient({ apiKey, region: (process.env.AHOLO_REGION || 'cn') });
const page = await lux3d.tasks.list({ page: 1, pageSize: 10 });
console.log(JSON.stringify(page, null, 2));
