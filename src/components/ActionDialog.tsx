// Small modal used for action confirmations: a confirmation (delete) or a
// single text input (rename, move-to-folder).

import { useEffect, useRef } from "react";

interface Props {
  title: string;
  message?: string;
  /** When set, renders a text input prefilled with this value. */
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function ActionDialog({
  title,
  message,
  defaultValue,
  placeholder,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="overlay-scrim" onMouseDown={onCancel}>
      <div className="action-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        {defaultValue !== undefined && (
          <input
            ref={inputRef}
            className="action-input"
            defaultValue={defaultValue}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm((e.target as HTMLInputElement).value);
              if (e.key === "Escape") onCancel();
            }}
          />
        )}
        <div className="conflict-actions">
          <button className="btn-quiet" onClick={onCancel}>Cancel</button>
          <button
            className={`btn-quiet${danger ? " action-danger" : ""}`}
            onClick={() =>
              onConfirm(defaultValue !== undefined ? inputRef.current?.value ?? "" : "")
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}