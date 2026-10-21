import {z} from "zod";
import {cellText,type TableField,type TableSnapshot} from "./model";
const cell=z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string()),z.null()]);
export const publicFieldSchema=z.object({id:z.string().uuid(),name:z.string(),kind:z.enum(["text","number","select","multi_select","datetime","checkbox","url"]),options:z.array(z.object({id:z.string().uuid(),label:z.string(),color:z.string()}))});
export const publicRecordSchema=z.object({id:z.string().uuid(),values:z.record(cell)});
export const publicViewSchema=z.object({name:z.string(),kind:z.enum(["grid","kanban"]),group_field_id:z.string().uuid().nullable(),widths:z.record(z.number())});
export const publicTableRefSchema=z.object({restricted:z.boolean().optional(),id:z.string().uuid(),version:z.number().int().positive(),title:z.string(),fields:z.array(publicFieldSchema),view:publicViewSchema,items:z.array(publicRecordSchema),total:z.number().int().nonnegative(),records_url:z.string(),groups:z.array(z.object({option_id:z.string().uuid().nullable(),name:z.string(),count:z.number().int().nonnegative()}))});
export function tableRows(fields:TableField[],records:Array<{values:Record<string,unknown>}>):string[][]{
  return records.map(record=>fields.map(field=>cellText(field,record.values[field.id] as Parameters<typeof cellText>[1])));
}
export function publicTableSnapshot(input:z.infer<typeof publicTableRefSchema>):TableSnapshot{
  return {restricted:input.restricted,title:input.title,view:input.view.name,revision:input.version,columns:input.fields.map(field=>field.name),rows:tableRows(input.fields,input.items),fields:input.fields,total:input.total,offset:0,snapshot_id:input.id,records_url:input.records_url};
}
