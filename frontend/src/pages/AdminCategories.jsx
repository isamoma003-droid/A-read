import { useState } from 'react';
import { FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { keys, useCategories } from '../api/queries.js';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { formatNumber } from '../utils/format.js';

// Admins keep the list of categories; uploaders file each book under one, and readers browse by them.
export default function AdminCategories() {
  const queryClient = useQueryClient();
  const { data: categories, isPending, error } = useCategories();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const run = async (request) => {
    setBusy(true);
    setActionError(null);
    try {
      await request();
      await queryClient.invalidateQueries({ queryKey: keys.categories });
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['book'] });
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { name: form.elements.name.value, description: form.elements.description.value };
    if (await run(() => api('/categories', { method: 'POST', body }))) form.reset();
  };

  const save = async (event, category) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = { name: form.elements.name.value, description: form.elements.description.value };
    if (await run(() => api(`/categories/${category.id}`, { method: 'PATCH', body }))) setEditing(null);
  };

  const remove = (category) => {
    const books = category.books ? ` Its ${category.books} book${category.books === 1 ? '' : 's'} stay in the library without a category.` : '';
    if (window.confirm(`Delete the category "${category.name}"?${books}`)) run(() => api(`/categories/${category.id}`, { method: 'DELETE' }));
  };

  return (
    <div className="stack">
      <section className="panel">
        <h2 className="panel-title">
          <Plus size={18} aria-hidden="true" /> New category
        </h2>
        <form className="form category-form" onSubmit={add}>
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={60} placeholder="e.g. Fiction, History, Children" />
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <input name="description" maxLength={300} placeholder="Shown at the top of the category in the library" />
          </label>
          <button className="button button-primary" disabled={busy}>
            Add category
          </button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <FolderOpen size={18} aria-hidden="true" /> Categories
        </h2>
        <ErrorMessage error={error || actionError} />
        {isPending && <Spinner label="Loading…" />}
        {categories?.length === 0 && <p className="muted">No categories yet. Add one above, then pick it when uploading or editing a book.</p>}
        {categories?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Books</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {categories.map((c) =>
                  editing === c.id ? (
                    <tr key={c.id}>
                      <td colSpan={3}>
                        <form className="form category-form" onSubmit={(e) => save(e, c)}>
                          <label className="field">
                            <span>Name</span>
                            <input name="name" required maxLength={60} defaultValue={c.name} autoFocus />
                          </label>
                          <label className="field">
                            <span>Description</span>
                            <input name="description" maxLength={300} defaultValue={c.description} />
                          </label>
                          <div className="button-row">
                            <button className="button button-primary button-small" disabled={busy}>
                              Save
                            </button>
                            <button type="button" className="button button-ghost button-small" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/?category=${encodeURIComponent(c.slug)}`}>
                          <strong>{c.name}</strong>
                        </Link>
                        {c.description && <div className="muted small">{c.description}</div>}
                      </td>
                      <td className="num">{formatNumber(c.books)}</td>
                      <td className="actions">
                        <button type="button" className="icon-button" onClick={() => setEditing(c.id)} title="Rename" disabled={busy}>
                          <Pencil size={16} />
                          <span className="sr-only">Rename {c.name}</span>
                        </button>
                        <button type="button" className="icon-button danger" onClick={() => remove(c)} title="Delete category" disabled={busy}>
                          <Trash2 size={16} />
                          <span className="sr-only">Delete {c.name}</span>
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
