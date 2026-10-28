import { mergeTripInMemory } from '../../../../js/storage/merge.js';
import { CONFIG } from '../../../../js/config.js';

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  organizer_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  meta_updated_at INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  trip_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_updated_at ON trips(updated_at);`;

let schemaInitialized = false;

async function ensureSchema(db) {
  if (schemaInitialized || !db) return;
  try {
    if (typeof db.exec === 'function') {
      await db.exec(SCHEMA_SQL);
    } else if (typeof db.batch === 'function' && typeof db.prepare === 'function') {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS trips (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          currency TEXT NOT NULL DEFAULT 'INR',
          organizer_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          meta_updated_at INTEGER NOT NULL DEFAULT 0,
          deleted INTEGER NOT NULL DEFAULT 0,
          trip_json TEXT NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_trips_updated_at ON trips(updated_at)`)
      ]);
    }
    schemaInitialized = true;
  } catch (err) {
    console.warn('ensureSchema warning:', err?.message || err);
  }
}

function createTripsContainer() {
  const arr = [];
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop in target) {
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      }
      return target.find(t => t && t.id === prop);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'string' && isNaN(Number(prop)) && prop !== 'length') {
        const idx = target.findIndex(t => t && t.id === prop);
        if (idx !== -1) {
          target[idx] = value;
        } else {
          target.push(value);
        }
      }
      return Reflect.set(target, prop, value, receiver);
    }
  });
}

export async function onRequestGet(context) {
  const tripId = context.params?.id;

  if (!context.env?.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database binding DB is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await ensureSchema(context.env.DB);

  let row;
  try {
    row = await context.env.DB.prepare('SELECT trip_json FROM trips WHERE id = ?1')
      .bind(tripId)
      .first();
  } catch (err) {
    if (String(err?.message || err).includes('no such table')) {
      schemaInitialized = false;
      await ensureSchema(context.env.DB);
      row = await context.env.DB.prepare('SELECT trip_json FROM trips WHERE id = ?1')
        .bind(tripId)
        .first();
    } else {
      throw err;
    }
  }

  if (!row || !row.trip_json) {
    return new Response(JSON.stringify({ ok: false, error: 'Trip not found in cloud' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ ok: true, trip: JSON.parse(row.trip_json) }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost(context) {
  const tripId = context.params?.id;

  if (!context.env?.DB) {
    return new Response(JSON.stringify({ ok: false, error: 'Database binding DB is not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Trip ID mismatch or invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const incomingPayload = {
    app: CONFIG.APP_NAME || 'TripSplit',
    version: CONFIG.SCHEMA_VERSION || 1,
    type: 'TRIPSPLIT_SYNC_V1',
    exportedAt: Date.now(),
    trip: (body && typeof body === 'object' && body.trip) ? body.trip : body
  };

  if (!incomingPayload.trip || incomingPayload.trip.id !== tripId) {
    return new Response(JSON.stringify({ ok: false, error: 'Trip ID mismatch or invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await ensureSchema(context.env.DB);

  let row;
  try {
    row = await context.env.DB.prepare('SELECT trip_json FROM trips WHERE id = ?1')
      .bind(tripId)
      .first();
  } catch (err) {
    if (String(err?.message || err).includes('no such table')) {
      schemaInitialized = false;
      await ensureSchema(context.env.DB);
      row = await context.env.DB.prepare('SELECT trip_json FROM trips WHERE id = ?1')
        .bind(tripId)
        .first();
    } else {
      throw err;
    }
  }

  const state = {
    version: CONFIG.SCHEMA_VERSION || 1,
    activeTripId: tripId,
    activeMemberByTrip: {},
    activeIdentities: {},
    trips: createTripsContainer()
  };

  if (row && row.trip_json) {
    try {
      state.trips[tripId] = JSON.parse(row.trip_json);
    } catch {
      // If corrupted in DB, treat as empty
    }
  }

  const stats = mergeTripInMemory(state, incomingPayload);
  const mergedTrip = state.trips[tripId];

  const UPSERT_SQL = `INSERT INTO trips (id, name, currency, organizer_id, created_at, updated_at, meta_updated_at, deleted, trip_json)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  currency = excluded.currency,
  organizer_id = excluded.organizer_id,
  updated_at = excluded.updated_at,
  meta_updated_at = excluded.meta_updated_at,
  deleted = excluded.deleted,
  trip_json = excluded.trip_json`;

  try {
    await context.env.DB.prepare(UPSERT_SQL)
      .bind(
        mergedTrip.id,
        mergedTrip.name || 'Untitled Trip',
        mergedTrip.currency || 'INR',
        mergedTrip.organizerId || '',
        mergedTrip.createdAt || Date.now(),
        mergedTrip.updatedAt || Date.now(),
        mergedTrip.metaUpdatedAt || mergedTrip.updatedAt || Date.now(),
        mergedTrip.deleted ? 1 : 0,
        JSON.stringify(mergedTrip)
      )
      .run();
  } catch (err) {
    if (String(err?.message || err).includes('no such table')) {
      schemaInitialized = false;
      await ensureSchema(context.env.DB);
      await context.env.DB.prepare(UPSERT_SQL)
        .bind(
          mergedTrip.id,
          mergedTrip.name || 'Untitled Trip',
          mergedTrip.currency || 'INR',
          mergedTrip.organizerId || '',
          mergedTrip.createdAt || Date.now(),
          mergedTrip.updatedAt || Date.now(),
          mergedTrip.metaUpdatedAt || mergedTrip.updatedAt || Date.now(),
          mergedTrip.deleted ? 1 : 0,
          JSON.stringify(mergedTrip)
        )
        .run();
    } else {
      throw err;
    }
  }

  return new Response(JSON.stringify({ ok: true, trip: mergedTrip, stats }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
