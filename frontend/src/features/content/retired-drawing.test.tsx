import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ContentRenderer } from "./ContentRenderer";

it("omits retired drawings without loading a preview or hiding other content", () => {
  render(<ContentRenderer blocks={{schema_version:2,editor:"blocknote",blocks:[
    {id:"before",type:"paragraph",props:{},content:"保留正文",children:[]},
    {id:"retired",type:"drawing",props:{scene:"discarded scene",caption:"旧绘图",url:"https://example.test/retired.png"},content:[],children:[]},
  ]}} />);
  expect(screen.getByText("保留正文")).toBeInTheDocument();
  expect(screen.queryByText("旧绘图")).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
