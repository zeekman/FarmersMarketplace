'use strict';

/**
 * Background job registration (#1367).
 *
 *   - importing app starts no timers or cron tasks
 *   - startJobs() is a no-op unless RUN_JOBS=true
 *   - runExclusive() skips a tick while the previous run is still going
 *   - every job module that exists is either scheduled or a documented non-job
 *
 * Run with `npm run test:handles` to have Jest's --detectOpenHandles confirm
 * nothing is left running after importing app.
 */

const fs = require('fs');
const path = require('path');

jest.mock('node-cron', () => ({ schedule: jest.fn(() => ({ stop: jest.fn() })) }));

const cron = require('node-cron');
const logger = require('../src/logger');
const { JOBS, startJobs, runExclusive, jobsEnabled } = require('../src/jobs');

describe('importing app', () => {
  it('schedules no cron tasks and no intervals', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    cron.schedule.mockClear();

    jest.isolateModules(() => {
      require('../src/app');
    });

    expect(cron.schedule).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('does not expose app.locals.startBackgroundJobs (registry is the only scheduler)', () => {
    const app = require('../src/app');
    expect(app.locals.startBackgroundJobs).toBeUndefined();
  });
});

describe('startJobs', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // jest.setup.js calls jest.resetAllMocks() before every test, which would
    // strip the node-cron factory implementation below — re-arm it so
    // cron.schedule() keeps returning a stoppable task handle.
    cron.schedule.mockReset();
    cron.schedule.mockImplementation(() => ({ stop: jest.fn() }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([undefined, 'false', '1', 'TRUE'])('does nothing when RUN_JOBS=%s', (value) => {
    const run = jest.fn();
    const stop = startJobs({ env: { RUN_JOBS: value }, jobs: [{ name: 'x', intervalMs: 10, runOnStart: true, run }] });

    jest.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(jobsEnabled({ RUN_JOBS: value })).toBe(false);
    stop();
  });

  it('schedules cron jobs in UTC and interval jobs when RUN_JOBS=true, and stops them', async () => {
    const intervalRun = jest.fn().mockResolvedValue();
    const stop = startJobs({
      env: { RUN_JOBS: 'true' },
      jobs: [
        { name: 'cron-job', cron: '0 * * * *', run: jest.fn() },
        { name: 'interval-job', intervalMs: 1000, run: intervalRun },
      ],
    });

    expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function), expect.objectContaining({ timezone: 'UTC' }));

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(intervalRun).toHaveBeenCalledTimes(1);

    stop();
    jest.advanceTimersByTime(5000);
    expect(intervalRun).toHaveBeenCalledTimes(1);
    expect(cron.schedule.mock.results[0].value.stop).toHaveBeenCalled();
  });

  it('skips jobs whose enabled() returns false', () => {
    const run = jest.fn();
    const stop = startJobs({
      env: { RUN_JOBS: 'true' },
      jobs: [{ name: 'off', intervalMs: 10, runOnStart: true, enabled: () => false, run }],
    });
    jest.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
    stop();
  });

  it('schedules zero timers for the real registry when RUN_JOBS is unset', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const runs = JOBS.map(() => jest.fn());
    const jobs = JOBS.map((job, i) => ({ ...job, runOnStart: true, run: runs[i] }));

    const stop = startJobs({ env: {}, jobs });
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(cron.schedule).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(runs.every((run) => run.mock.calls.length === 0)).toBe(true);
    stop();
    setIntervalSpy.mockRestore();
  });

  it('schedules each registry job exactly once when RUN_JOBS=true', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const jobs = JOBS.map((job) => ({ ...job, enabled: undefined, runOnStart: false, run: jest.fn() }));

    const stop = startJobs({ env: { RUN_JOBS: 'true' }, jobs });

    const cronJobs = jobs.filter((job) => job.cron).length;
    const intervalJobs = jobs.filter((job) => job.intervalMs).length;
    expect(cron.schedule).toHaveBeenCalledTimes(cronJobs);
    expect(setIntervalSpy).toHaveBeenCalledTimes(intervalJobs);
    expect(new Set(JOBS.map((job) => job.name)).size).toBe(JOBS.length);

    stop();
    setIntervalSpy.mockRestore();
  });

  it('stop() cancels every scheduled job in the registry', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const jobs = JOBS.map((job) => ({ ...job, enabled: undefined, runOnStart: false, run: jest.fn() }));

    const stop = startJobs({ env: { RUN_JOBS: 'true' }, jobs });
    const intervalHandles = setIntervalSpy.mock.calls.length;
    expect(intervalHandles).toBeGreaterThan(0);

    stop();

    cron.schedule.mock.results.forEach((result) => {
      expect(result.value.stop).toHaveBeenCalled();
    });
    expect(clearIntervalSpy).toHaveBeenCalledTimes(intervalHandles);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe('runExclusive', () => {
  it('skips a run while the previous one is still in progress', async () => {
    let finish;
    const run = jest.fn(() => new Promise((resolve) => { finish = resolve; }));

    const first = runExclusive('slow', run);
    await expect(runExclusive('slow', run)).resolves.toBe('skipped');
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await expect(first).resolves.toBe('completed');
    await expect(runExclusive('slow', jest.fn())).resolves.toBe('completed');
  });

  it('logs failures with duration instead of throwing', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(runExclusive('boom', () => Promise.reject(new Error('nope')))).resolves.toBe('failed');
    expect(errorSpy).toHaveBeenCalledWith(
      '[jobs] Job failed',
      expect.objectContaining({ job: 'boom', error: 'nope', durationMs: expect.any(Number) })
    );
    errorSpy.mockRestore();
  });
});

describe('job registry', () => {
  it('has unique names and exactly one schedule per job', () => {
    const names = JOBS.map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    for (const job of JOBS) {
      expect(Boolean(job.cron) !== Boolean(job.intervalMs)).toBe(true);
      expect(typeof job.run).toBe('function');
    }
  });

  it('schedules the previously unstarted confirm-payments job', () => {
    expect(JOBS.map((j) => j.name)).toContain('confirm-payments');
  });

  it('every module in src/jobs is registered (no orphaned jobs)', () => {
    const registrySource = fs.readFileSync(path.join(__dirname, '../src/jobs/index.js'), 'utf8');
    const modules = fs
      .readdirSync(path.join(__dirname, '../src/jobs'))
      .filter((f) => f.endsWith('.js') && f !== 'index.js')
      .map((f) => f.replace(/\.js$/, ''));
    const unregistered = modules.filter((m) => !registrySource.includes(`require('./${m}')`));
    expect(unregistered).toEqual([]);
  });
});

describe('job leader wiring (#011)', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

  it('schedules jobs only through the jobs/index.js registry', () => {
    expect(indexSource).toMatch(/const stopJobs = startJobs\(\)/);
    expect(indexSource).not.toMatch(/startBackgroundJobs/);
    expect(appSource).not.toMatch(/startBackgroundJobs/);
    expect(appSource).not.toMatch(/startActivityMonitor|startOrphanedUploadsCleanupJob/);
  });

  it('cancels the scheduled jobs when the process is signalled to stop', () => {
    expect(indexSource).toMatch(/process\.once\('SIGTERM'/);
    expect(indexSource).toMatch(/process\.once\('SIGINT'/);
    expect(indexSource).toContain('stopJobs()');
  });
});
