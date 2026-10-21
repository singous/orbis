import {expect,it} from "vitest";
import {publicEditorBlocks} from "./public-content";
const id=(n:string)=>"00000000-0000-4000-8000-"+n.padStart(12,"0");
it("renders only the public table projection and retains zero, false and epoch values",()=>{
  const fields=[{id:id("1"),name:"数字",kind:"number",options:[]},{id:id("2"),name:"状态",kind:"checkbox",options:[]},{id:id("3"),name:"时间",kind:"datetime",options:[]}];
  const projection={id:id("4"),version:7,title:"公开表格",fields,view:{name:"公开视图",kind:"grid",group_field_id:null,widths:{}},items:[{id:id("5"),values:{[id("1")]:0,[id("2")]:false,[id("3")]:0}}],groups:[],total:1,records_url:`/api/v1/public/sites/site/tables/${id("4")}/records?release_id=${id("6")}`};
  const output=publicEditorBlocks([{id:"public-0",type:"data_table",props:{},content:[],children:[],data_table:projection}]);
  const snapshot=(output.blocks[0] as {table_snapshot?:{columns:string[];rows:string[][]}}).table_snapshot!;
  expect(snapshot.columns).toEqual(["数字","状态","时间"]);
  expect(snapshot.rows[0][0]).toBe("0");
  expect(snapshot.rows[0][1]).toBe("☐");
  expect(snapshot.rows[0][2]).toContain("1970");
  expect(output.blocks[0].props).not.toHaveProperty("table_id");
});
