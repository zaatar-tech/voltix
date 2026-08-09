# Patterns

Complete recipes you can copy into an app.

- [Sending requests](#sending-requests)
- [Fetching by a parameter](#fetching-by-a-parameter)
- [Mutations with optimistic updates](#mutations-with-optimistic-updates)
- [Live updates with polling](#live-updates-with-polling)
- [A live table: a lookup + polling](#a-live-table-a-lookup--polling)

See also [Composition](./composition.md) for lookups and nesting, [Guides](./guides.md) for the feature-level reference, and [Core concepts](./core-concepts.md) for how re-rendering works.

## Sending requests

Keep a request in the store as three keys: `status`, `data`, `error`. The spinner reads `status`, the table reads `data`, and each re-renders only when its own key changes.

Put the fetch in a function next to the store. `set` writes several keys in one update, so a component reading two of them re-renders once.

```tsx
import { createStore } from 'voltix';

type User = { id: string; name: string };
type Status = 'idle' | 'loading' | 'success' | 'error';

export const users = createStore({
  status: 'idle' as Status,
  data: [] as User[],
  error: null as string | null,
});

export async function loadUsers() {
  users.setKey('status', 'loading');
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: User[] = await res.json();
    users.set({ data, error: null, status: 'success' });
  } catch (err) {
    users.set({ error: (err as Error).message, status: 'error' });
  }
}
```

In components, split the reads: the shell reads `status`, the list reads `data`. Refetching a fresh list never re-runs the spinner branch.

```tsx
import { useStoreKey, useStoreSelector } from 'voltix';
import { users, loadUsers } from './users';

function UserList() {
  const { status, error } = useStoreSelector(users, ['status', 'error']);
  if (status === 'loading') return <Spinner />;
  if (status === 'error') return <Error message={error} onRetry={loadUsers} />;
  return <Rows />;
}

function Rows() {
  const data = useStoreKey(users, 'data'); // re-renders only when the list changes
  return <ul>{data.map((u) => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

Start the load as early as you can. An effect in a leaf component fires only after everything above it has rendered and mounted, so every level you move the call up starts the request sooner. The store lives outside React, so the earliest spot is outside React entirely — your entry file — where the fetch runs in parallel with the first render:

```tsx
// main.tsx — the fetch races the initial render
loadUsers();
createRoot(document.getElementById('root')!).render(<App />);
```

In an SSR framework, module scope and the entry file run on the server too, so start client loads from the top component's effect instead — or pass server-fetched data down as props, see [server rendering](./guides.md#server-rendering). For data only some screens need, put the kick-off in the highest component that knows it's needed:

```tsx
function useUsers() {
  useEffect(() => {
    if (users.getKey('status') === 'idle') loadUsers();
  }, []);
  return useStoreSelector(users, ['status', 'data', 'error']);
}
```

Because the store lives outside React, mounting two `UserList` components does not fetch twice: the `idle` guard runs once, and both components read the same slice.

## Fetching by a parameter

When the request depends on an input (a selected id, a search query), keep the input in the store and fetch when it changes. Before writing the response, check the store still wants it — switch documents quickly and a slow old response can land after a newer one:

```tsx
import { createStore } from 'voltix';

type Doc = { id: string; title: string; body: string };

export const viewer = createStore({
  id: null as string | null,
  status: 'idle' as 'idle' | 'loading' | 'success' | 'error',
  data: null as Doc | null,
});

export async function openDocument(id: string) {
  if (viewer.getKey('id') === id) return;
  viewer.set({ id, status: 'loading' });
  const res = await fetch(`/api/documents/${id}`);
  const data: Doc = await res.json();
  if (viewer.getKey('id') !== id) return; // the user opened another document; drop this one
  viewer.set({ data, status: 'success' });
}
```

The guard is plain store usage: the store holds the current selection, so reading it answers "is this response still the one on screen?". If a fetching library (React Query, SWR) handles your requests, it owns this problem — write its results into the store and skip the guard.

```tsx
function DocumentView({ id }: { id: string }) {
  useEffect(() => { openDocument(id); }, [id]);
  const { status, data } = useStoreSelector(viewer, ['status', 'data']);
  return status === 'success' && data ? <article>{data.body}</article> : <Spinner />;
}
```

## Mutations with optimistic updates

Write the change immediately, then tell the server. Snapshot the old value first so you can roll back if the request fails.

```tsx
export const settings = createStore({ theme: 'light' as 'light' | 'dark', saving: false });

export async function setTheme(theme: 'light' | 'dark') {
  const prev = settings.getKey('theme');
  settings.set({ theme, saving: true }); // optimistic: UI updates now
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ theme }),
    });
    if (!res.ok) throw new Error('save failed');
    settings.setKey('saving', false);
  } catch {
    settings.set({ theme: prev, saving: false }); // roll back to the snapshot
  }
}
```

For a list, snapshot the array, update it optimistically, and restore the snapshot on failure.

## Live updates with polling

For data that changes on the server, load a full snapshot once, then poll for what changed. The server returns a cursor with every response; send it back as `?since=` and you get only the rows that moved since. Payloads stay small no matter how long the tab is open.

The store holds the rows by id, their order, and the current cursor.

```tsx
import { createStore } from 'voltix';

type Order = { id: string; total: number; status: string };

type Snapshot = { orders: Order[]; cursor: string };
type Delta = { changed: Order[]; removed: string[]; cursor: string };

export const orders = createStore({
  byId: {} as Record<string, Order>,
  ids: new Set<string>(),
  cursor: null as string | null,
  status: 'idle' as 'idle' | 'ready' | 'error',
});

export async function bootstrapOrders() {
  const res = await fetch('/api/orders');
  const snap: Snapshot = await res.json();
  const byId: Record<string, Order> = {};
  for (const o of snap.orders) byId[o.id] = o;
  orders.set({ byId, ids: new Set(snap.orders.map((o) => o.id)), cursor: snap.cursor, status: 'ready' });
}

export function applyOrdersDelta(delta: Delta) {
  if (delta.changed.length === 0 && delta.removed.length === 0) {
    orders.setKey('cursor', delta.cursor);
    return;
  }
  const byId = { ...orders.getKey('byId') };
  const ids = new Set(orders.getKey('ids'));   // fresh copies — reference equality drives notify
  for (const o of delta.changed) { byId[o.id] = o; ids.add(o.id); }
  for (const id of delta.removed) { delete byId[id]; ids.delete(id); }
  orders.set({ byId, ids, cursor: delta.cursor });
}
```

Drive it with a loop that never overlaps its own requests and pauses when the tab is hidden. A recursive timeout waits for each poll to finish before scheduling the next; an error backs off instead of hammering.

```ts
export function startPolling(intervalMs = 4000) {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    if (document.hidden) return schedule(intervalMs);

    const cursor = orders.getKey('cursor');
    if (cursor === null) {
      await bootstrapOrders();
      return schedule(intervalMs);
    }
    try {
      const res = await fetch(`/api/orders?since=${encodeURIComponent(cursor)}`);
      applyOrdersDelta(await res.json());
      schedule(intervalMs);
    } catch {
      schedule(intervalMs * 2); // back off on failure
    }
  }

  function schedule(ms: number) {
    if (!stopped) setTimeout(tick, ms);
  }

  tick();
  return () => { stopped = true; };
}
```

Start it once and stop it on teardown. The cursor is opaque to the client; the server decodes it, and falls back to "from the start" when it can't. Upserts are by id, so a row sent twice across two polls is harmless.

```tsx
useEffect(() => startPolling(), []);
```

## A live table: a lookup + polling

The single-map version above re-renders every reader of `byId` on any delta. When a poll touches three rows out of thousands, exactly three components should re-render. Give each row its own store with a [lookup](./composition.md#lookups-a-store-per-id): an index store holds the id list and the cursor, and each row reads its own store.

```tsx
import { createStore } from 'voltix';

type Row = { id: string; total: number; status: string };
type Snapshot = { rows: Row[]; cursor: string };
type Delta = { changed: Row[]; removed: string[]; cursor: string };

const rows = createLookup((id: string) => ({ total: 0, status: '' }));

export const table = createStore({ ids: new Set<string>(), cursor: null as string | null, ready: false });

export async function bootstrapTable() {
  const snap: Snapshot = await (await fetch('/api/rows')).json();
  for (const r of snap.rows) rows.at(r.id).set({ total: r.total, status: r.status });
  table.set({ ids: new Set(snap.rows.map((r) => r.id)), cursor: snap.cursor, ready: true });
}

export function applyTableDelta(delta: Delta) {
  // Only rows that changed touch their own store; siblings never re-render.
  for (const r of delta.changed) rows.at(r.id).set({ total: r.total, status: r.status });
  for (const id of delta.removed) rows.remove(id);

  if (delta.changed.length || delta.removed.length) {
    const ids = new Set(table.getKey('ids'));
    for (const r of delta.changed) ids.add(r.id);
    for (const id of delta.removed) ids.delete(id);
    table.setKey('ids', ids); // fresh Set — the list re-renders only on add/remove
  }
  table.setKey('cursor', delta.cursor);
}

export { rows };
```

A delta that changes one row's `status` wakes that one `<TableRow>` and nothing else. `<Table>` re-renders only when a row is added or removed, because that is the only time `ids` changes.

```tsx
import { useStoreSelector } from 'voltix';
import { table, rows } from './table';

function Table() {
  const { ids, ready } = useStoreSelector(table, ['ids', 'ready']);
  if (!ready) return <Spinner />;
  return (
    <table>
      <tbody>{[...ids].map((id) => <TableRow key={id} id={id} />)}</tbody>
    </table>
  );
}

function TableRow({ id }: { id: string }) {
  const { total, status } = useStoreSelector(rows.at(id), ['total', 'status']);
  return (
    <tr>
      <td>{id}</td>
      <td>{total}</td>
      <td>{status}</td>
    </tr>
  );
}
```

Drive it with the same polling loop, reading `table.getKey('cursor')` and calling `bootstrapTable` and `applyTableDelta`. Use this shape for dashboards, order books, and live grids.
