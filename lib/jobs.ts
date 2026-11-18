import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type StepState = 'wait' | 'run' | 'done' | 'fail';
export type JobStep = { key: string; label: string; note?: string; state: StepState };
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type Job = {
  id: string;
  image: string;
  sentence: string;
  sender: string;
  name: string;
  status: JobStatus;
  steps: JobStep[];
  itemId?: string;
  code?: string;
  partCount?: number;
  /** 两次真实调用：拿得出任务号和耗时才敢写到这里 */
  pipeline?: {
    generate: { taskId: string; seconds: number };
    split: { taskId: string; seconds: number };
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const DIR = resolve(process.cwd(), '.data/jobs');

export const STEP_PLAN: JobStep[] = [
  { key: 'intake', label: '照片到了', state: 'wait' },
  { key: 'understand', label: '认出了它', state: 'wait' },
  { key: 'shape', label: '正在长', state: 'wait' },
  { key: 'split', label: '拆成零件', state: 'wait' },
  { key: 'pack', label: '装进盒子', state: 'wait' },
  { key: 'ready', label: '等人打开', state: 'wait' },
];

const ensureDir = () => mkdirSync(DIR, { recursive: true });

export const jobPath = (id: string) => resolve(DIR, `${id}.json`);

export const newJobId = () => {
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 7);
  return `j${stamp}${salt}`;
};

export function createJob(input: Pick<Job, 'image' | 'sentence' | 'sender' | 'name'>): Job {
  ensureDir();
  const job: Job = {
    id: newJobId(),
    ...input,
    status: 'queued',
    steps: STEP_PLAN.map((s) => ({ ...s })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), 'utf8');
  return job;
}

export function readJob(id: string): Job | null {
  if (!/^j[a-z0-9]{6,20}$/.test(id)) return null;
  const p = jobPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Job;
  } catch {
    return null;
  }
}

export function writeJob(job: Job) {
  ensureDir();
  job.updatedAt = Date.now();
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), 'utf8');
}

export function recentJobs(limit = 20): Job[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Job;
      } catch {
        return null;
      }
    })
    .filter((j): j is Job => !!j)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
