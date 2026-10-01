import { useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { formatBytes } from '../utils/format.js';

// A click-or-drop file picker. `accept` is passed to the input; `onFile(file|null)`.
export default function FileDrop({ accept, file, onFile, label, hint, icon: Icon = FileText }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (files) => {
    const chosen = files?.[0];
    if (chosen) onFile(chosen);
  };

  return (
    <div
      className={`drop ${over ? 'drop-over' : ''} ${file ? 'drop-filled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files)} />
      {file ? (
        <div className="drop-file">
          <Icon size={22} aria-hidden="true" />
          <div>
            <strong>{file.name}</strong>
            <span className="muted"> · {formatBytes(file.size)}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              onFile(null);
              if (input.current) input.current.value = '';
            }}
            title="Remove file"
          >
            <X size={16} />
            <span className="sr-only">Remove file</span>
          </button>
        </div>
      ) : (
        <button type="button" className="drop-button" onClick={() => input.current?.click()}>
          <Icon size={28} strokeWidth={1.5} aria-hidden="true" />
          <strong>{label}</strong>
          <span className="muted">{hint}</span>
        </button>
      )}
    </div>
  );
}
