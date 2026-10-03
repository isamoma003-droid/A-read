// The library's categories (admins manage the list). Submits as "category". Pass `value` and
// `onChange` to control it; otherwise it's a plain form field.
export default function CategorySelect({ categories, defaultValue = '', emptyLabel = 'No category', value, onChange }) {
  const controlled = value !== undefined ? { value, onChange: (e) => onChange?.(e.target.value) } : { defaultValue };
  return (
    <select name="category" {...controlled}>
      <option value="">{emptyLabel}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
