// Enkel cache med minne + disk, slik at rute- og geokodingskall ikke gjentas.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class Cache {
  /**
   * @param mappe  katalog for diskcache (null = kun minne)
   * @param ttlMs  levetid per oppføring
   * @param maks   maks antall oppføringer i minnet
   */
  constructor(mappe, ttlMs, maks = 500) {
    this.mappe = mappe;
    this.ttlMs = ttlMs;
    this.maks = maks;
    this.minne = new Map();
    this.paagaar = new Map();
  }

  fil(nokkel) {
    return path.join(this.mappe, crypto.createHash('sha1').update(nokkel).digest('hex') + '.json');
  }

  async hent(nokkel) {
    const m = this.minne.get(nokkel);
    if (m && Date.now() - m.tid < this.ttlMs) return m.verdi;
    if (!this.mappe) return undefined;
    try {
      const post = JSON.parse(await fs.readFile(this.fil(nokkel), 'utf8'));
      if (Date.now() - post.tid < this.ttlMs) { this.husk(nokkel, post); return post.verdi; }
    } catch { /* ikke i cache */ }
    return undefined;
  }

  husk(nokkel, post) {
    this.minne.delete(nokkel);
    this.minne.set(nokkel, post);
    if (this.minne.size > this.maks) this.minne.delete(this.minne.keys().next().value);
  }

  async sett(nokkel, verdi) {
    const post = { tid: Date.now(), verdi };
    this.husk(nokkel, post);
    if (!this.mappe) return;
    try {
      await fs.mkdir(this.mappe, { recursive: true });
      await fs.writeFile(this.fil(nokkel), JSON.stringify(post));
    } catch { /* diskcache er valgfri */ }
  }

  /** Henter fra cache, eller kjører `lag` og lagrer resultatet. Like samtidige kall deler ett oppslag. */
  async eller(nokkel, lag) {
    const funnet = await this.hent(nokkel);
    if (funnet !== undefined) return funnet;
    if (this.paagaar.has(nokkel)) return this.paagaar.get(nokkel);
    const lofte = (async () => {
      try { const v = await lag(); await this.sett(nokkel, v); return v; } finally { this.paagaar.delete(nokkel); }
    })();
    this.paagaar.set(nokkel, lofte);
    return lofte;
  }
}
