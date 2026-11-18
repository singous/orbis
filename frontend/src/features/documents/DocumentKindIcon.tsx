import { FileText, Shapes, Table2 } from "@orbis/ui/icons";
import type { Note } from "../../shared/api/schemas";

const documentKinds = {
  document: { label: "文档", Icon: FileText, color: "text-(--ob-icon-blue)" },
  sheet: { label: "数据表", Icon: Table2, color: "text-(--ob-icon-mint)" },
  board: { label: "画板", Icon: Shapes, color: "text-(--ob-icon-violet)" },
};

export function documentKind(note: Pick<Note, "sheet_id" | "board_id">) {
  return note.sheet_id ? "sheet" : note.board_id ? "board" : "document";
}

export function DocumentKindIcon({ note, size = 16 }: { note: Pick<Note, "sheet_id" | "board_id">; size?: number }) {
  const { Icon, color, label } = documentKinds[documentKind(note)];
  return <span className="inline-flex flex-none items-center" title={label}><Icon aria-hidden="true" size={size} className={color} /></span>;
}
