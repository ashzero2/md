// Recursive file explorer. Folders expand/collapse; files open notes.

import { type CSSProperties, useState } from "react";
import type { FileNode } from "../lib/types";

interface Props {
  nodes: FileNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

function TreeItem({ node, depth, activePath, onOpen }: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { "--indent": `${8 + depth * 16}px` } as CSSProperties;

  if (!node.is_dir) {
    const label = node.name.replace(/\.md$/i, "");
    return (
      <li className="tree-node tree-node-file">
        <button
          className={`tree-file${activePath === node.path ? " active" : ""}`}
          style={indent}
          onClick={() => onOpen(node.path)}
          title={node.path}
        >
          <span className="tree-spacer" aria-hidden="true" />
          <span className="tree-icon tree-icon-file" aria-hidden="true" />
          <span className="tree-label">{label}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="tree-node tree-node-dir">
      <button
        className={`tree-dir${open ? " open" : ""}`}
        style={indent}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`caret${open ? " open" : ""}`} aria-hidden="true" />
        <span className="tree-icon tree-icon-folder" aria-hidden="true" />
        <span className="tree-label">{node.name}</span>
      </button>
      {open && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Tree({ nodes, activePath, onOpen }: Props) {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
