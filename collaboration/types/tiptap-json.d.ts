// The shared model imports only this JSON type from the browser package. Keep
// the headless compiler independent of React and browser widget dependencies.
declare module "@tiptap/react" {
  export type JSONContent = {
    type?: string;
    attrs?: Record<string, any>;
    content?: JSONContent[];
    marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[];
    text?: string;
    [key: string]: any;
  };
}
