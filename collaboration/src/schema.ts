import { Schema, type NodeSpec, type MarkSpec } from "@tiptap/pm/model";
import contract from "../../api/editor-prosemirror-schema.json";

// The backend-owned persisted schema is shared with the browser parity test.
// Browser widgets and editor lifecycle plugins never enter the runtime engine.
export const schema = new Schema({
  nodes: contract.nodes as Record<string, NodeSpec>,
  marks: contract.marks as Record<string, MarkSpec>,
});
