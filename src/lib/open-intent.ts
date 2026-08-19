export interface OpenNoteOptions {
  background?: boolean;
  pane?: "main" | "secondary";
}

export function eventOpensInBackground(event: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
}) {
  return event.button === 1 || (event.button === 0 && (event.metaKey || event.ctrlKey));
}
