/**
 * In-memory registry of background jobs (renders, thumbnails, preview proxies).
 *
 * Stored on globalThis so it survives Next.js hot reloads in dev mode.
 * Jobs are not persisted: restarting the server forgets them (finished files stay on disk).
 */
export type JobKind = "render" | "thumbs" | "preview";
export type JobState = "running" | "done" | "error" | "canceled";

export interface Job {
  id: string;
  projectId: string;
  kind: JobKind;
  state: JobState;
  /** 0–100 */
  progress: number;
  /** Output file relative to the project folder, when done. */
  output?: string;
  error?: string;
  /** Last FFmpeg log lines (useful when something fails). */
  log: string[];
  startedAt: number;
  finishedAt?: number;
}

interface Registry {
  jobs: Map<string, Job>;
  controllers: Map<string, AbortController>;
}

const g = globalThis as typeof globalThis & { __clipforgeJobs?: Registry };
const registry: Registry = (g.__clipforgeJobs ??= { jobs: new Map(), controllers: new Map() });

const key = (projectId: string, kind: JobKind) => `${projectId}:${kind}`;

/** The latest job of this kind for a project (running or finished). */
export function getJob(projectId: string, kind: JobKind): Job | undefined {
  return registry.jobs.get(key(projectId, kind));
}

/**
 * Start a job. `work` receives callbacks to report progress and logs, and an AbortSignal.
 * Only one job per project and kind runs at a time; starting another while one runs throws.
 */
export function startJob(
  projectId: string,
  kind: JobKind,
  work: (ctx: { progress: (p: number) => void; log: (line: string) => void; signal: AbortSignal }) => Promise<string | void>,
): Job {
  const k = key(projectId, kind);
  const existing = registry.jobs.get(k);
  if (existing?.state === "running") throw new Error(`A ${kind} job is already running for this project.`);
  const job: Job = {
    id: `${kind}_${Date.now().toString(36)}`,
    projectId,
    kind,
    state: "running",
    progress: 0,
    log: [],
    startedAt: Date.now(),
  };
  const controller = new AbortController();
  registry.jobs.set(k, job);
  registry.controllers.set(k, controller);
  work({
    progress: (p) => (job.progress = Math.round(p * 10) / 10),
    log: (line) => {
      job.log.push(line);
      if (job.log.length > 30) job.log.shift();
    },
    signal: controller.signal,
  })
    .then((output) => {
      job.state = "done";
      job.progress = 100;
      if (output) job.output = output;
    })
    .catch((e: Error & { log?: string[] }) => {
      job.state = controller.signal.aborted ? "canceled" : "error";
      job.error = e.message.split("\n")[0];
      if (e.log) job.log = e.log;
    })
    .finally(() => {
      job.finishedAt = Date.now();
      registry.controllers.delete(k);
    });
  return job;
}

export function cancelJob(projectId: string, kind: JobKind): boolean {
  const c = registry.controllers.get(key(projectId, kind));
  if (!c) return false;
  c.abort();
  return true;
}

/** Cancel every job of a project (used before deleting it). */
export function cancelProjectJobs(projectId: string) {
  for (const kind of ["render", "thumbs", "preview"] as JobKind[]) cancelJob(projectId, kind);
}
