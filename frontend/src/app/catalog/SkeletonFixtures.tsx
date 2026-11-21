import { AutoSkeleton } from "@orbis/ui/skeleton";
import { NotebookCard } from "../../features/documents/NotebookCard";
import { NotebookShelfLayout, notebookShelfGridClassName } from "../../features/documents/NotebookShelfLayout";
import { TiptapEditor } from "../../features/documents/editor/TiptapEditor";
import { editorCanvasClassName } from "../../features/documents/editor/document-chrome";
import type { NoteBlocksV2 } from "../../features/content/blocks";
import type { Notebook } from "../../shared/api/schemas";
import { workspaceGridClassName, workspaceShellClassName } from "../../features/workspace/workspace-chrome";

const sampleId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const sampleTime = Date.UTC(2026, 0, 10);
const notebooks: Notebook[] = ["产品笔记本", "阅读笔记", "项目记录", "团队资料"].map((title, index) => ({
  id: sampleId(index + 1),
  workspace_id: sampleId(20),
  group_id: sampleId(21),
  title, sort_order: index,
  icon: null,
  metadata_version: 1,
  directory_version: 1,
  is_archived: false,
  archived_at_ms: null,
  created_at_ms: sampleTime,
  updated_at_ms: sampleTime,
}));

const blocks: NoteBlocksV2 = {
  schema_version: 2,
  editor: "blocknote",
  blocks: [
    { id: sampleId(30), type: "heading", props: { level: 2 }, content: "文档概览", children: [] },
    ...["把日常记录、项目资料和团队经验放在一起。", "正文使用标题和段落组织内容，让读者能快速定位。", "在需要时补上背景、示例和参考信息。"].map((content, index) => ({
      id: sampleId(31 + index), type: "paragraph", props: {}, content, children: [],
    })),
  ],
};

/** Capture the shipped components with synthetic data, without requests or a signed-in workspace. */
export function SkeletonFixtures() {
  return (
    <main className={`${workspaceShellClassName} overflow-auto`}>
      <div className={workspaceGridClassName}>
        <div aria-hidden="true" className="hidden min-[768px]:block" />
        <div className="min-w-0">
          <NotebookShelfLayout description={null}>
            <div className="@container/notebook-shelf">
              <AutoSkeleton name="notebook-shelf" loading={false}>
                <div className={notebookShelfGridClassName}>
                  {notebooks.map(notebook => <NotebookCard key={notebook.id} notebook={notebook} noteCount={3} indexLoading={false}
                    recent={["最近更新的内容", "讨论与记录", "阅读与参考"].map((title, index) => ({ id: sampleId(index + 11), title, updated_at_ms: sampleTime }))}
                  />)}
                </div>
              </AutoSkeleton>
            </div>
          </NotebookShelfLayout>
          <article className={`${editorCanvasClassName} mx-auto`}>
            <AutoSkeleton name="document-body" loading={false}>
              <TiptapEditor readOnly blocks={blocks} onChange={() => {}} />
            </AutoSkeleton>
          </article>
        </div>
      </div>
    </main>
  );
}
