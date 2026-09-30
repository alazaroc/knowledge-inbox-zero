import { useEffect, useState } from 'react';
import type { Item } from '@app/shared';
import { api } from '../../lib/api';

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setError('');
    try {
      const res = await api.get<{ items: Item[] }>('/items');
      setItems(res.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await api.post('/items', { name: name.trim() });
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (itemId: string) => {
    setError('');
    try {
      await api.delete(`/items/${itemId}`);
      setItems((prev) => prev.filter((i) => i.itemId !== itemId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Items</h1>
        <p className="text-sm text-gray-500">
          The starter's example entity. Replace it with your own domain.
        </p>
      </div>

      <form onSubmit={onCreate} className="flex gap-2">
        <input
          className="input"
          placeholder="Item name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">No items yet. Create the first one.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {items.map((item) => (
            <li key={item.itemId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{item.name}</p>
                <p className="text-xs text-gray-400">{item.status}</p>
              </div>
              <button
                onClick={() => onDelete(item.itemId)}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
