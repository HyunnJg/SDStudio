/* Polling is sequential; the comparison method remains part of the service API. */
/* eslint import/prefer-default-export: off, no-await-in-loop: off, class-methods-use-this: off */
const UPDATE_SERVICE_INTERVAL = 240 * 1000;
const FORK_RELEASES = 'https://github.com/HyunnJg/SDStudio/releases';

type UpdateOptions = {
  fetcher?: typeof fetch;
  intervalMs?: number;
} & (
  | { enabled: true; getVersion: () => Promise<string> }
  | { enabled?: false; getVersion?: () => Promise<string> }
);

export class AppUpdateNoticeService extends EventTarget {
  current = '';

  outdated = false;

  readonly releasesURL = FORK_RELEASES;

  private running = false;

  private generation = 0;

  private timer?: ReturnType<typeof setTimeout>;

  private wake?: () => void;

  constructor(private options: UpdateOptions = {}) {
    super();
  }

  async getLatestRelease() {
    const response = await (this.options.fetcher ?? fetch)(
      'https://api.github.com/repos/HyunnJg/SDStudio/releases/latest',
      { headers: { Accept: 'application/vnd.github.v3+json' } },
    );
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`Update check failed: ${response.status}`);
    return (await response.json()).tag_name as string;
  }

  async run() {
    if (!this.options.enabled || this.running) return;
    const { getVersion } = this.options;
    this.running = true;
    this.generation += 1;
    const { generation } = this;
    const active = () => this.running && generation === this.generation;
    while (active()) {
      try {
        if (!this.current) this.current = await getVersion();
        if (!active()) return;
        const latest = await this.getLatestRelease();
        if (latest && active() && this.isOutdated(this.current, latest)) {
          this.outdated = true;
          this.dispatchEvent(new Event('updated'));
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Update check failed', error);
      }
      if (active()) {
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(
            resolve,
            this.options.intervalMs ?? UPDATE_SERVICE_INTERVAL,
          );
        });
      }
    }
  }

  stop() {
    this.running = false;
    this.generation += 1;
    clearTimeout(this.timer);
    this.wake?.();
    this.wake = undefined;
  }

  isOutdated(current: string, latest: string): boolean {
    const installed = /^v?(\d+\.\d+\.\d+)(-rc\.\d+)?$/i.exec(current);
    if (!installed || !/^v?\d+\.\d+\.\d+$/i.test(latest)) return false;
    const a = installed[1].split('.').map(Number);
    const b = latest.replace(/^v/i, '').split('.').map(Number);
    const index = a.findIndex((value, i) => value !== b[i]);
    return index >= 0 ? a[index] < b[index] : Boolean(installed[2]);
  }
}
