const WINDOW_MS = 60_000;
const MAX_TRACKED_ADDRESSES = 4_096;
const MAX_UPGRADES_PER_WINDOW = 24;
const MAX_SESSIONS_PER_IP = 4;
const MAX_SESSIONS = 128;

interface ClientUsage {
  active: number;
  upgrades: number;
  windowEnd: number;
  failures: number;
  failureReset: number;
  blockedUntil: number;
}

export interface GatewayAdmission {
  canAuthenticate: () => boolean;
  recordTokenFailure: () => void;
  release: () => void;
}

export class GatewayAdmissionLimiter {
  private readonly clients = new Map<string, ClientUsage>();
  private active = 0;
  private sweepAt = 0;

  constructor(private readonly now = () => performance.now()) {}

  acquire(address: string): GatewayAdmission | null {
    if (this.active >= MAX_SESSIONS) return null;

    const now = this.now();
    if (now >= this.sweepAt) {
      this.sweepAt = now + WINDOW_MS;
      for (const [ip, usage] of this.clients) {
        if (!usage.active && now >= Math.max(usage.windowEnd, usage.failureReset)) this.clients.delete(ip);
      }
    }

    let usage = this.clients.get(address);
    if (!usage) {
      if (this.clients.size >= MAX_TRACKED_ADDRESSES) return null;
      usage = { active: 0, upgrades: 0, windowEnd: 0, failures: 0, failureReset: 0, blockedUntil: 0 };
      this.clients.set(address, usage);
    }

    if (now >= usage.windowEnd) {
      usage.upgrades = 0;
      usage.windowEnd = now + WINDOW_MS;
    }
    if (usage.active >= MAX_SESSIONS_PER_IP || usage.upgrades >= MAX_UPGRADES_PER_WINDOW || now < usage.blockedUntil) {
      return null;
    }

    usage.active++;
    usage.upgrades++;
    this.active++;
    let released = false;
    return {
      canAuthenticate: () => this.now() >= usage.blockedUntil,
      recordTokenFailure: () => {
        const now = this.now();
        if (now >= usage.failureReset) usage.failures = 0;
        usage.failures = Math.min(8, usage.failures + 1);
        usage.failureReset = now + WINDOW_MS;
        if (usage.failures >= 3) {
          usage.blockedUntil = now + Math.min(30_000, 1_000 * 2 ** (usage.failures - 3));
        }
      },
      release: () => {
        if (released) return;
        released = true;
        usage.active--;
        this.active--;
      },
    };
  }
}
