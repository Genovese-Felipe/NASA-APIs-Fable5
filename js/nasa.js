/* ── Cosmoscope · nasa.js ───────────────────────────────────────────
   NASA open-API client. Endpoint choices were verified empirically
   (2026-08): the api.nasa.gov EPIC proxy 302s to a 404 and DONKI
   returns 503 there, so we call the GSFC hosts directly (keyless,
   CORS *); the dedicated Mars Rover Photos API was decommissioned
   with its Heroku backend, so rover imagery streams from the NASA
   Image & Video Library instead. Every call is cached in
   localStorage and degrades to embedded sample data offline.       */

const CACHE_PREFIX = 'cosmoscope.cache.';

function todayUTC(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function fetchJSON(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (res.status === 429) {
      const err = new Error('rate limit');
      err.kind = 'ratelimit';
      throw err;
    }
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.kind = 'http';
      throw err;
    }
    return await res.json();
  } catch (e) {
    if (!e.kind) e.kind = 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function cacheGet(key, ttlMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttlMs) {
      localStorage.removeItem(CACHE_PREFIX + key);   /* prune on expiry */
      return null;
    }
    return v;
  } catch { return null; }
}
function cachePut(key, v) {
  const payload = JSON.stringify({ t: Date.now(), v });
  try {
    localStorage.setItem(CACHE_PREFIX + key, payload);
  } catch {
    /* quota hit: evict the oldest cached entries and retry once */
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) {
          const t = (JSON.parse(localStorage.getItem(k)) || {}).t || 0;
          entries.push({ k, t });
        }
      }
      entries.sort((a, b) => a.t - b.t);
      for (const e of entries.slice(0, Math.ceil(entries.length / 2))) localStorage.removeItem(e.k);
      localStorage.setItem(CACHE_PREFIX + key, payload);
    } catch { /* still failing — caching stays best-effort */ }
  }
}

async function cached(key, ttlMs, fetcher) {
  const hit = cacheGet(key, ttlMs);
  if (hit) return { data: hit, offline: false, fromCache: true };
  const data = await fetcher();
  cachePut(key, data);
  return { data, offline: false, fromCache: false };
}

/* ── embedded offline samples (also serve the sandboxed artifact) ── */
export const SAMPLES = {
  apod: {
    date: '2026-08-04',
    title: 'Curious Cometary Knots in the Helix Nebula',
    explanation: 'What causes unusual knots of gas and dust in planetary nebulas? Seen here in a deep image from the James Webb Space Telescope, the Helix Nebula hosts thousands of cometary knots — each about the size of our Solar System — sculpted by the fierce radiation of the dying star at its center.',
    media_type: 'image',
    url: 'https://apod.nasa.gov/apod/image/2608/HelixKnots_JWST_960.jpg',
    hdurl: 'https://apod.nasa.gov/apod/image/2608/HelixKnots_JWST_2000.jpg',
  },
  neo: {
    element_count: 3,
    near_earth_objects: {
      '2026-08-01': [
        { id: '3266031', name: '(2005 BU)', absolute_magnitude_h: 26.7,
          estimated_diameter: { meters: { estimated_diameter_min: 12.15, estimated_diameter_max: 27.17 } },
          is_potentially_hazardous_asteroid: false,
          close_approach_data: [{ close_approach_date_full: '2026-Aug-01 16:55',
            relative_velocity: { kilometers_per_hour: '56532.176' },
            miss_distance: { kilometers: '61128505.099', lunar: '158.95' }, orbiting_body: 'Earth' }] },
        { id: '54339874', name: '(2023 KT3)', absolute_magnitude_h: 23.2,
          estimated_diameter: { meters: { estimated_diameter_min: 60.2, estimated_diameter_max: 134.6 } },
          is_potentially_hazardous_asteroid: true,
          close_approach_data: [{ close_approach_date_full: '2026-Aug-02 04:12',
            relative_velocity: { kilometers_per_hour: '32411.55' },
            miss_distance: { kilometers: '7480313.2', lunar: '19.45' }, orbiting_body: 'Earth' }] },
        { id: '2523661', name: '523661 (2012 CY46)', absolute_magnitude_h: 20.1,
          estimated_diameter: { meters: { estimated_diameter_min: 253.8, estimated_diameter_max: 567.6 } },
          is_potentially_hazardous_asteroid: false,
          close_approach_data: [{ close_approach_date_full: '2026-Aug-04 22:30',
            relative_velocity: { kilometers_per_hour: '88123.9' },
            miss_distance: { kilometers: '44892100.5', lunar: '116.72' }, orbiting_body: 'Earth' }] },
      ],
    },
  },
  epic: [
    { identifier: '20260801004554', image: 'epic_1b_20260801004554',
      caption: "This image was taken by NASA's EPIC camera onboard the NOAA DSCOVR spacecraft",
      date: '2026-08-01 00:41:06', centroid_coordinates: { lat: 10.55, lon: 179.82 } },
  ],
  flares: [
    { flrID: '2026-07-01T06:19:00-FLR-001', beginTime: '2026-07-01T06:19Z', peakTime: '2026-07-01T06:27Z',
      endTime: '2026-07-01T06:30Z', classType: 'M1.1', sourceLocation: 'N19W23', activeRegionNum: 14479 },
  ],
  cmes: [
    { activityID: '2026-07-25T02:00:00-CME-001', startTime: '2026-07-25T02:00Z', sourceLocation: 'S28W50',
      note: 'Faint CME observed to the SW in SOHO LASCO C2/C3.',
      cmeAnalyses: [{ isMostAccurate: true, speed: 531.0, type: 'C', halfAngle: 10.0 }] },
  ],
  library: {
    collection: {
      metadata: { total_hits: 2 },
      items: [
        { data: [{ title: 'Jupiter Plume (Voyager)', nasa_id: 'PIA01518', date_created: '1999-03-13T14:54:19Z',
            description: 'Jupiter Plume as seen by Voyager.', center: 'JPL', media_type: 'image' }],
          links: [{ href: 'https://images-assets.nasa.gov/image/PIA01518/PIA01518~thumb.jpg', rel: 'preview', render: 'image' }] },
        { data: [{ title: 'Hubble Sees a Star Set to Explode', nasa_id: 'GSFC_20171208_Archive_e001465',
            date_created: '2017-12-08T00:00:00Z', description: 'The super star Eta Carinae.', center: 'GSFC', media_type: 'image' }],
          links: [{ href: 'https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e001465/GSFC_20171208_Archive_e001465~thumb.jpg', rel: 'preview', render: 'image' }] },
      ],
    },
  },
};

export class NasaClient {
  constructor() {
    let key = null;
    try { key = localStorage.getItem('cosmoscope.apikey'); } catch { /* unavailable */ }
    this.key = key || 'DEMO_KEY';
  }

  setKey(k) {
    this.key = (k || '').trim() || 'DEMO_KEY';
    try { localStorage.setItem('cosmoscope.apikey', this.key); } catch { /* unavailable */ }
  }

  /* ── APOD ──
     Without a date param the API returns the current entry; pinning
     "today" in UTC 404s for the first hours of each UTC day because
     APOD publishes on US Eastern midnight. */
  async apod(date) {
    const key = date ? `apod.${date}.${this.key}` : `apod.latest.${this.key}`;
    const ttl = date ? 24 * 3600e3 : 1800e3;
    const qs = date ? `&date=${date}` : '';
    try {
      return await cached(key, ttl, () =>
        fetchJSON(`https://api.nasa.gov/planetary/apod?api_key=${this.key}${qs}&thumbs=true`));
    } catch (e) {
      if (e.kind === 'ratelimit') throw e;
      return { data: SAMPLES.apod, offline: true };
    }
  }

  randomApodDate() {
    const start = Date.UTC(1995, 5, 16);           /* first APOD: 1995-06-16 */
    const end = Date.now() - 86400000;
    return new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10);
  }

  /* ── NeoWs: feed for the week starting today (API caps at 7 days) ── */
  async neoFeed() {
    const d = todayUTC();
    try {
      return await cached('neo.' + d + '.' + this.key, 1800e3, () =>
        fetchJSON(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${d}&api_key=${this.key}`));
    } catch (e) {
      if (e.kind === 'ratelimit') throw e;
      return { data: SAMPLES.neo, offline: true };
    }
  }

  /* ── EPIC: keyless GSFC host (api.nasa.gov proxy is broken) ── */
  async epic() {
    try {
      return await cached('epic', 1800e3, () =>
        fetchJSON('https://epic.gsfc.nasa.gov/api/natural'));
    } catch {
      return { data: SAMPLES.epic, offline: true };
    }
  }

  epicImageUrl(item) {
    /* date format: 'YYYY-MM-DD HH:MM:SS' (space, not ISO T) */
    const [y, m, d] = item.date.split(' ')[0].split('-');
    return `https://epic.gsfc.nasa.gov/archive/natural/${y}/${m}/${d}/jpg/${item.image}.jpg`;
  }

  /* ── DONKI: keyless CCMC host first (api.nasa.gov 503s), proxy as backup ── */
  async donki() {
    const f30 = todayUTC(-30), f7 = todayUTC(-7), now = todayUTC();
    try {
      return await cached('donki', 900e3, async () => {
        const grab = async (kind, start) => {
          try {
            return await fetchJSON(`https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/${kind}?startDate=${start}&endDate=${now}`);
          } catch {
            return await fetchJSON(`https://api.nasa.gov/DONKI/${kind}?startDate=${start}&endDate=${now}&api_key=${this.key}`);
          }
        };
        const [flares, cmes] = await Promise.all([grab('FLR', f30), grab('CME', f7)]);
        return { flares: flares || [], cmes: cmes || [] };
      });
    } catch {
      return { data: { flares: SAMPLES.flares, cmes: SAMPLES.cmes }, offline: true };
    }
  }

  /* Solar activity score 0..1 from recent flares (X=1, M=0.6, C=0.25) */
  activityScore(flares) {
    let s = 0;
    for (const f of flares || []) {
      const c = (f.classType || '')[0];
      if (c === 'X') s = Math.max(s, 1);
      else if (c === 'M') s = Math.max(s, 0.6);
      else if (c === 'C') s = Math.max(s, 0.25);
    }
    return s;
  }

  /* ── Mars rover imagery via the Image & Video Library.
     (The dedicated Mars Rover Photos API was retired with its
     Heroku backend — verified dead 2026-08.) ── */
  async marsPhotos(rover) {
    const q = rover === 'curiosity'
      ? 'Curiosity rover Mars Gale crater surface'
      : 'Perseverance rover Mars Jezero surface';
    return this.librarySearch(q, 'image', 1);
  }

  /* ── NASA Image & Video Library (keyless) ── */
  async librarySearch(q, mediaType = 'image', page = 1) {
    const key = `lib.${mediaType}.${page}.${q}`;
    try {
      return await cached(key, 1800e3, () =>
        fetchJSON(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=${mediaType}&page=${page}&page_size=24`));
    } catch {
      return { data: SAMPLES.library, offline: true };
    }
  }

  thumbOf(item) {
    const link = (item.links || []).find((l) => l.rel === 'preview');
    return link ? link.href.replace(/^http:/, 'https:') : null;
  }

  /* audio items: resolve the collection.json manifest → playable https URL */
  async audioUrlOf(item) {
    try {
      const manifest = await fetchJSON(item.href.replace(/^http:/, 'https:'));
      const list = manifest.map((u) => u.replace(/^http:/, 'https:'));
      return list.find((u) => u.endsWith('~128k.mp3'))
          || list.find((u) => u.endsWith('.mp3'))
          || list.find((u) => u.endsWith('.m4a'))
          || list.find((u) => u.endsWith('.wav'))
          || null;
    } catch { return null; }
  }
}
