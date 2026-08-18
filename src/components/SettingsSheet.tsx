// Settings sheet (Cmd+,): thin set of workflow settings, persisted to app-data.

import { useSettingsStore } from "../store/settings";
import type { Settings } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="settings-row">
      <span className="settings-row-label">
        {label}
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export default function SettingsSheet({ open, onClose }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  if (!open) return null;

  return (
    <div className="overlay-scrim" onMouseDown={onClose}>
      <div className="settings-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="btn-quiet" onClick={onClose}>Done</button>
        </div>

        <section className="settings-section">
          <h3>General</h3>
          <Row label="Reopen last vault on launch">
            <input
              type="checkbox"
              checked={settings.reopen_last_vault}
              onChange={(e) => update({ reopen_last_vault: e.target.checked })}
            />
          </Row>
          <Row label="Confirm before deleting notes">
            <input
              type="checkbox"
              checked={settings.confirm_before_delete}
              onChange={(e) => update({ confirm_before_delete: e.target.checked })}
            />
          </Row>
          <Row label="New note location" hint="Where new notes are created">
            <select
              value={settings.default_new_note_location}
              onChange={(e) =>
                update({ default_new_note_location: e.target.value as Settings["default_new_note_location"] })
              }
            >
              <option value="root">Vault root</option>
              <option value="same_folder">Same folder as current note</option>
            </select>
          </Row>
        </section>

        <section className="settings-section">
          <h3>Editor</h3>
          <Row label="Autosave delay">
            <select
              value={settings.autosave_delay_ms}
              onChange={(e) => update({ autosave_delay_ms: Number(e.target.value) })}
            >
              <option value={300}>Fast (300 ms)</option>
              <option value={600}>Normal (600 ms)</option>
              <option value={1000}>Slow (1000 ms)</option>
            </select>
          </Row>
        </section>

        <section className="settings-section">
          <h3>Appearance</h3>
          <Row label="Theme" hint="Follows your system by default">
            <select
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Row>
        </section>
      </div>
    </div>
  );
}