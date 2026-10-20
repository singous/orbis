import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDataTable } from "./use-table";
import {
  readTable,
  mutateTable,
  type TableResult,
} from "./api";
import type { TableHost,PendingTableWriter } from "./context";
import type { TablePage } from "./model";

vi.mock("./api", () => ({
  readTable: vi.fn(),
  mutateTable: vi.fn(),
}));
vi.mock("./drafts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tableDrafts: {
    read: async () => null,
    candidates: async () => [],
    write: async () => {},
    remove: async () => {},
  },
}));

it("uses the save receipt version when a read refresh still shows the previous version", async () => {
  let release!: (value: TablePage) => void;
  const staleRead = new Promise<TablePage>((resolve) => {
    release = resolve;
  });
  const page = (revision: number): TablePage => ({
    table_id: "table",
    block_id: "block",
    revision,
    content_version: revision,
    view_id: "view",
    definition: {
      title: "Table",
      fields: [],
      views: [],
      public_view_id: "view",
      public_field_ids: [],
    },
    records: [{ id: "row", values: {} }],
    total: 1,
    offset: 0,
    next_offset: 1,
    has_more: false,
    groups: [],
  });
  vi.mocked(readTable)
    .mockResolvedValueOnce(page(1))
    .mockReturnValueOnce(staleRead)
    .mockResolvedValue(page(3));
  let version = 1;
  vi.mocked(mutateTable).mockImplementation(async () => ({
    content_version: ++version,
    table_revision: version,
    table_id: "table",
    block: {
      id: "block",
      type: "dataTable",
      props: {},
      content: [],
      children: [],
    },
    inverse: {},
  }));
  const host: TableHost = {
    noteId: "note",
    draftScope: "receipt-race",
    readOnly: false,
    auth: {
      accessToken: "test",
      refreshToken: null,
      onTokenRefresh: () => {},
      onUnauthorized: () => {},
    },
    transact: async (perform) => perform(version),
  };
  const { result, unmount } = renderHook(() =>
    useDataTable(host, "table", 1, "block"),
  );
  await waitFor(() => expect(result.current.recovering).toBe(false));
  await waitFor(() => expect(result.current.page?.revision).toBe(1));
  act(() =>
    result.current.stage({
      upserts: [{ id: "row", values: { title: "first" } }],
    }),
  );
  let first!: Promise<TableResult | undefined>;
  act(() => {
    first = result.current.save();
  });
  await waitFor(() => expect(readTable).toHaveBeenCalledTimes(2));
  expect(result.current.page?.revision).toBe(1);
  act(() =>
    result.current.stage({
      upserts: [{ id: "row", values: { title: "second" } }],
    }),
  );
  await act(async () => {
    release(page(2));
    await first;
  });
  await act(async () => {
    await result.current.save();
  });
  expect(vi.mocked(mutateTable).mock.calls[1][2].expected_table_revision).toBe(
    2,
  );
  unmount();
});

const mutablePage=(revision:number):TablePage=>({table_id:"table",block_id:"block",revision,content_version:revision,view_id:"view",definition:{title:"Table",fields:[],views:[],public_view_id:"view",public_field_ids:[]},records:[{id:"row",values:{}}],total:1,offset:0,next_offset:1,has_more:false,groups:[]});
const receipt=(version:number):TableResult=>({content_version:version,table_revision:version,table_id:"table",block:{id:"block",type:"dataTable",props:{},content:[],children:[]},inverse:{}});
async function mutableTable(registerWriter?:TableHost["registerWriter"]){
  vi.mocked(readTable).mockReset();vi.mocked(mutateTable).mockReset();
  let version=1;
  vi.mocked(readTable).mockImplementation(async()=>mutablePage(version));
  const reload=vi.fn(async()=>{version=3;});
  const host:TableHost={noteId:"note",draftScope:"retry-draft",readOnly:false,registerWriter,auth:{accessToken:"test",refreshToken:null,onTokenRefresh:()=>{},onUnauthorized:()=>{}},reload,documentVersion:()=>version,transact:async perform=>perform(version)};
  const hook=renderHook(()=>useDataTable(host,"table",1,"block"));
  await waitFor(()=>expect(hook.result.current.recovering).toBe(false));
  await waitFor(()=>expect(hook.result.current.page?.revision).toBe(1));
  return {...hook,reload};
}

it("keeps an uncertain table UUID through a later rejection and refuses to reapply it",async()=>{
  const {ApiError}=await import("../../shared/api/api-client");
  const view=await mutableTable();
  vi.mocked(mutateTable).mockRejectedValueOnce(new ApiError(503,"Unknown","TABLE_WRITE_RESULT_UNKNOWN")).mockRejectedValueOnce(new ApiError(422,"Changed validation")).mockResolvedValueOnce(receipt(2));
  act(()=>view.result.current.stage({upserts:[{id:"row",values:{title:"retained",flag:false,number:0}}]}));
  await act(async()=>{await expect(view.result.current.save()).rejects.toMatchObject({code:"TABLE_WRITE_RESULT_UNKNOWN"});});
  const original=structuredClone(vi.mocked(mutateTable).mock.calls[0][2]);
  await expect(view.result.current.reapply()).rejects.toMatchObject({code:"TABLE_WRITE_RESULT_UNKNOWN"});
  expect(view.reload).not.toHaveBeenCalled();
  await act(async()=>{await expect(view.result.current.save()).rejects.toMatchObject({code:"TABLE_WRITE_RESULT_UNKNOWN"});});
  await act(async()=>{await view.result.current.save();});
  expect(vi.mocked(mutateTable).mock.calls.map(call=>call[2])).toEqual([original,original,original]);
  view.unmount();
});

it("flushes a table draft through its document owner before a snapshot action",async()=>{
  let writer:PendingTableWriter|undefined;
  const release=vi.fn();
  const view=await mutableTable((_blockId,value)=>{writer=value;return release;});
  expect(writer?.hasPending()).toBe(false);
  vi.mocked(mutateTable).mockResolvedValueOnce(receipt(2));
  act(()=>view.result.current.stage({upserts:[{id:"row",values:{title:"复制前的最新内容",flag:false,number:0}}]}));
  expect(writer?.hasPending()).toBe(true);
  await act(async()=>{await writer!.flush();});
  expect(vi.mocked(mutateTable).mock.calls[0][2].upserts).toEqual([{id:"row",values:{title:"复制前的最新内容",flag:false,number:0}}]);
  expect(writer?.hasPending()).toBe(false);
  view.unmount();
  expect(release).toHaveBeenCalled();
});

it("reapplies a definitively rejected table intent with all later visible edits",async()=>{
  const {ApiError}=await import("../../shared/api/api-client");
  const view=await mutableTable();
  vi.mocked(mutateTable).mockRejectedValueOnce(new ApiError(409,"Conflict")).mockResolvedValueOnce(receipt(4));
  act(()=>view.result.current.stage({upserts:[{id:"row",values:{title:"before"}}]}));
  await act(async()=>{await expect(view.result.current.save()).rejects.toMatchObject({status:409});});
  const original=vi.mocked(mutateTable).mock.calls[0][2].operation_id;
  act(()=>view.result.current.stage({upserts:[{id:"row",values:{title:"after",flag:false,number:0}}]}));
  await act(async()=>{await view.result.current.reapply();});
  await act(async()=>{await view.result.current.save();});
  const sent=vi.mocked(mutateTable).mock.calls[1][2];
  expect(sent.operation_id).not.toBe(original);
  expect(sent).toMatchObject({expected_document_version:3,expected_table_revision:3,upserts:[{id:"row",values:{title:"after",flag:false,number:0}}]});
  view.unmount();
});
