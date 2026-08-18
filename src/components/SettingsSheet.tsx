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
          <Row label="Update links on rename" hint="Rewrite wikilinks when a note is renamed or moved">
            <input
              type="checkbox"
              checked={settings.update_links_on_rename}
              onChange={(e) => update({ update_links_on_rename: e.target.checked })}
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
          <Row label="Editor font">
            <select
              value={settings.editor_font}
              onChange={(e) => update({ editor_font: e.target.value as Settings["editor_font"] })}
            >
              <option value="serif">Serif</option>
              <option value="sans">System sans</option>
              <option value="mono">Mono</option>
            </select>
          </Row>
          <Row label="Editor font size">
            <select
              value={settings.editor_font_size}
              onChange={(e) => update({ editor_font_size: Number(e.target.value) })}
            >
              {[14, 15, 16, 17, 18, 19, 20, 21, 22].map((n) => (
                <option key={n} value={n}>{n} px</option>
              ))}
            </select>
          </Row>
          <Row label="Show line numbers">
            <input
              type="checkbox"
              checked={settings.line_numbers}
              onChange={(e) => update({ line_numbers: e.target.checked })}
            />
          </Row>
        </section>

        <section className="settings-section">
          <h3>Reading</h3>
          <Row label="Reading font size">
            <select
              value={settings.reading_font_size}
              onChange={(e) => update({ reading_font_size: Number(e.target.value) })}
            >
              {[15, 16, 17, 18, 19, 20, 21].map((n) => (
                <option key={n} value={n}>{n} px</option>
              ))}
            </select>
          </Row>
          <Row label="Reading line width" hint="How wide the text column is">
            <select
              value={settings.reading_width}
              onChange={(e) => update({ reading_width: e.target.value as Settings["reading_width"] })}
            >
              <option value="narrow">Narrow</option>
              <option value="medium">Medium</option>
              <option value="wide">Wide</option>
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