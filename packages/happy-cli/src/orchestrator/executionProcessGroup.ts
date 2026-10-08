import type { ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';

export const EXECUTION_PROCESS_MARKER = 'HAPPY_ORCH_PROCESS_MARKER';
export const PARENT_EXECUTION_PROCESS_MARKER = 'HAPPY_ORCH_PARENT_PROCESS_MARKER';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Member = { pid: number; parent: number; group: number; startTime: string; state: string };

export class ExecutionProcessGroup {
  readonly isolated = process.platform !== 'win32';
  private readonly pid: number;
  private readonly marker: string;
  private readonly uid = process.getuid?.();
  private readonly known = new Map<number, string>();
  private leaderStartTime: string | null = null;

  constructor(child: ChildProcess, marker: string) {
    if (!child.pid || child.pid <= 1 || !/^[0-9a-f-]{36}$/.test(marker))
      throw new Error('Execution process group identity is unavailable');
    this.pid = child.pid;
    this.marker = marker;
    if (process.platform === 'linux') {
      const leader = this.readMember(this.pid);
      if (!leader) throw new Error('Execution process leader identity is unavailable');
      this.leaderStartTime = leader.startTime;
      this.known.set(this.pid, leader.startTime);
    }
  }

  private readMember(pid: number): Member | null {
    try {
      const directory = `/proc/${pid}`;
      if (statSync(directory).uid !== this.uid) return null;
      const raw = readFileSync(`${directory}/stat`, 'utf8');
      const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (fields.length < 20) throw new Error('Incomplete execution process identity');
      return { pid, startTime: fields[19], parent: Number(fields[1]), group: Number(fields[2]), state: fields[0] };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ESRCH') return null;
      throw error;
    }
  }

  private linuxMembers(): Member[] {
    if (this.uid === undefined) throw new Error('Execution group owner identity is unavailable');
    const candidates = new Map<number, Member>();
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      const pid = Number(name);
      const member = this.readMember(pid);
      if (member && member.state !== 'Z' && member.state !== 'X') candidates.set(pid, member);
    }
    const leader = candidates.get(this.pid);
    const groupStillOwned = !leader || leader.startTime === this.leaderStartTime;
    for (const [pid, member] of candidates) {
      if (this.known.get(pid) === member.startTime) continue;
      if ((groupStillOwned && member.group === this.pid)
        || (this.known.has(member.parent)
          && this.known.get(member.parent) === candidates.get(member.parent)?.startTime)) {
        this.known.set(pid, member.startTime);
        continue;
      }
      let environment: Buffer;
      try { environment = readFileSync(`/proc/${pid}/environ`); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ESRCH') continue;
        // An unrelated same-UID process may make environ unreadable. Owned
        // members were already recognized by group or recorded ancestry.
        continue;
      }
      const matches = [EXECUTION_PROCESS_MARKER, PARENT_EXECUTION_PROCESS_MARKER].some((key) => {
        const entry = Buffer.from(`${key}=${this.marker}\0`);
        return environment.subarray(0, entry.length).equals(entry)
          || environment.includes(Buffer.concat([Buffer.from([0]), entry]));
      });
      if (matches) this.known.set(pid, member.startTime);
    }
    return [...candidates.values()].filter((member) => this.known.get(member.pid) === member.startTime);
  }

  hasLiveMembers(): boolean {
    if (this.isolated && process.platform === 'linux') return this.linuxMembers().length > 0;
    try { process.kill(this.isolated ? -this.pid : this.pid, 0); return true; }
    catch { return false; }
  }

  signal(signal: NodeJS.Signals): void {
    if (this.isolated && process.platform === 'linux') {
      for (const member of this.linuxMembers()) {
        if (this.readMember(member.pid)?.startTime !== member.startTime) continue;
        try { process.kill(member.pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    } else if (this.hasLiveMembers()) {
      if (this.isolated) process.kill(-this.pid, signal);
      else execFileSync('taskkill', ['/PID', String(this.pid), '/T', '/F'], { timeout: 5_000, stdio: 'ignore' });
    }
  }

  async waitForNaturalExit(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.hasLiveMembers()) return true;
      await pause(100);
    }
    return !this.hasLiveMembers();
  }

  async settle(graceMs = 5_000): Promise<{ exited: boolean; lingered: boolean }> {
    const lingered = this.hasLiveMembers();
    if (!lingered) return { exited: true, lingered: false };
    try { this.signal('SIGTERM'); } catch { /* Retry with SIGKILL after grace. */ }
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!this.hasLiveMembers()) return { exited: true, lingered };
      await pause(100);
    }
    try { this.signal('SIGKILL'); } catch { /* Caller fails closed if members remain. */ }
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!this.hasLiveMembers()) return { exited: true, lingered };
      await pause(100);
    }
    return { exited: false, lingered };
  }
}
