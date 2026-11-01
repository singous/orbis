import { cva } from "class-variance-authority";

// 画板继承的是无单位1.5行距，控件缩为12px后实际行高随之成为18px。
export const boardControlStyles = cva("inline-flex min-h-[30px] min-w-[30px] items-center [justify-content:center] [gap:6px] rounded-[5px] p-[5px] pointer-coarse:min-h-(--ob-control-height-touch) pointer-coarse:min-w-(--ob-control-height-touch)", {
  variants: {
    context: {
      canvas: "[font:400_var(--ob-text-caption-size)/1.5_var(--ob-font-sans)]",
      header: "[font:400_var(--ob-text-caption-size)/20px_var(--ob-font-sans)]",
    },
  },
  defaultVariants: { context: "canvas" },
});

export const boardFloatingPanelStyles = "absolute z-[22] top-3 right-3 bottom-14 w-[352px] overflow-auto rounded-[10px] border border-(--ob-board-border) bg-ob-card [box-shadow:var(--ob-shadow-card)] [@container(640px<width<=900px)]:w-72 [@container(max-width:640px)]:top-[58px] [@container(max-width:640px)]:w-[min(300px,calc(100%-80px))]";

// 分支计数保留11px/1基线；坐标与命中框仍由独立overlay几何样式拥有。
export const boardMindmapControlClassName = "board-mindmap-action rounded-[999px] border border-[color:color-mix(in_oklab,var(--ob-primary)_45%,var(--ob-board-border))] bg-ob-card text-ob-primary [&.board-mindmap-action]:text-[11px] [&.board-mindmap-action]:leading-none [&:hover]:bg-ob-primary [&:hover]:text-ob-primary-foreground enabled:hover:bg-ob-primary focus-visible:bg-ob-primary focus-visible:text-ob-primary-foreground";

export const boardConnectionPortClassName = "cursor-crosshair rounded-[50%] [border:0] bg-transparent [box-shadow:none] enabled:hover:bg-transparent [&.board-connection-port:focus-visible]:outline-2 [&.board-connection-port:focus-visible]:outline-solid [&.board-connection-port:focus-visible]:outline-ob-primary [&.board-connection-port:focus-visible]:outline-offset-[-2px] [&:hover_.board-connection-port-mark]:bg-ob-primary [&:hover_.board-connection-port-mark]:text-ob-primary-foreground [&:focus-visible_.board-connection-port-mark]:bg-ob-primary [&:focus-visible_.board-connection-port-mark]:text-ob-primary-foreground [&.is-active_.board-connection-port-mark]:bg-ob-primary [&.is-active_.board-connection-port-mark]:text-ob-primary-foreground";
export const boardConnectionMarkClassName = "rounded-[50%] border-[1.5px] border-ob-primary bg-ob-card text-ob-primary [box-shadow:0_0_0_2px_var(--ob-surface)]";
