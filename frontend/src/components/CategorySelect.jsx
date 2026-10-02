// The library's categories (admins manage the list). Submits as "category".
export default function CategorySelect({ categories, defaultValue = '' }) {
  return (
    <select name="category" defaultValue={defaultValue}>
      <option value="">No category</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
