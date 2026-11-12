import { Link, type LinkProps } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@orbis/ui/cn";
import { workbenchStyles } from "./workbench-styles";

type Props = Omit<LinkProps, "children" | "title"> & {
  appearance: "card" | "inline";
  icon: ReactNode;
  iconStyle?: CSSProperties;
  title: ReactNode;
  caption?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
};

/** 站点整卡和笔记本卡片内链接共享资源身份骨架，外层操作各归调用方。 */
export function WorkbenchResourceLink({ appearance, icon, iconStyle, title, caption, children, end, className, ...props }: Props) {
  return <Link {...props} className={cn(appearance === "card" ? workbenchStyles.resourceCard : "flex min-w-0 items-center", className)}>
    <span className={workbenchStyles.resourceIcon} style={iconStyle}>{icon}</span>
    <span className={workbenchStyles.resourceCopy}>
      <strong className={workbenchStyles.resourceTitle}>{title}</strong>
      {caption != null ? <span className={workbenchStyles.resourceCaption}>{caption}</span> : null}
      {children}
    </span>
    {end}
  </Link>;
}
