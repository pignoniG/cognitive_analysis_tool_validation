// Where a session's files go. Every file is always kept in memory (so it can be downloaded at the end); when the
// page is served by server.py, every append is also sent to disk as it happens, in order, so a crash loses
// nothing that was shown. If a send fails, sending stops and the files are rewritten whole at the end.

export async function serverAvailable() {
  try {
    const r = await fetch("api/ping", { cache: "no-store", signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

export class Sink {
  /** `folder`: the session folder name; `server`: whether server.py is there. */
  constructor(folder, server) {
    this.folder = folder;
    this.server = server;
    this.files = new Map();
    this.queue = Promise.resolve();
    this.broken = null;           // the first send error, after which only memory is written
    this.sent = 0;
  }

  get mode() { return this.server ? (this.broken ? "server (interrupted)" : "server") : "memory"; }

  append(name, text) {
    this.files.set(name, (this.files.get(name) ?? "") + text);
    this.#send("append", name, text);
  }

  write(name, text) {
    this.files.set(name, text);
    this.#send("write", name, text);
  }

  #send(op, name, text) {
    if (!this.server || this.broken) return;
    this.queue = this.queue.then(async () => {
      if (this.broken) return;
      try {
        await post(op, this.folder, name, text);
        this.sent++;
      } catch (e) {
        this.broken = e;
      }
    });
  }

  /** Wait for every send; if any failed, try once to write every file whole. Returns true when the disk copy is
   *  complete (or there is no server). */
  async flush() {
    await this.queue;
    if (!this.server) return true;
    if (!this.broken) return true;
    try {
      for (const [name, text] of this.files) await post("write", this.folder, name, text);
      this.broken = null;
      return true;
    } catch (e) {
      this.broken = e;
      return false;
    }
  }

  /** The files as a plain object, for sending to another window. */
  snapshot() { return Object.fromEntries(this.files); }
}

async function post(op, folder, name, text) {
  const url = `api/${op}?session=${encodeURIComponent(folder)}&file=${encodeURIComponent(name)}`;
  const r = await fetch(url, { method: "POST", body: text, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (!r.ok) throw new Error(`${op} ${name}: HTTP ${r.status}`);
}
