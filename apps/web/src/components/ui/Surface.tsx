import type { HTMLAttributes, ReactNode } from "react";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Element to render: a `section` for a labelled region, a `div` otherwise. */
  as?: "div" | "section" | "article";
  /** `raised` sits on another surface (a stop card), `sunken` is an inset well. */
  tone?: "default" | "raised" | "sunken";
  /** Inner padding from the spacing scale; `none` for content that bleeds. */
  pad?: "none" | "sm" | "md" | "lg";
  children?: ReactNode;
}

/** The one card: replaces `.controls-surface`, `.panel` and `.stop-card` chrome. */
export function Surface({
  as: Tag = "div",
  tone = "default",
  pad = "md",
  className,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <Tag className={`surface surface--${tone} surface--pad-${pad}${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </Tag>
  );
}
