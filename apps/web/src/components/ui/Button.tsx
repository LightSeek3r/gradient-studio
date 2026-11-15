import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** `icon` is a square icon-only button and needs an `aria-label`. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Visible label. Hidden visually (not from assistive tech) on small screens when `collapse` is set. */
  children?: ReactNode;
  /** Keep only the icon on narrow screens; the label stays in the accessible name. */
  collapse?: boolean;
  /** Fill the available width. */
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The one button. Variants replace the old `.btn-*` family; sizes set the
 * hit area (lg is the touch-friendly one; every size grows to 44px on touch
 * layouts via CSS).
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  collapse = false,
  block = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "btn",
    `btn--${variant}`,
    `btn--${size}`,
    block && "btn--block",
    collapse && "btn--collapse",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={variant === "icon" ? 16 : 15} />}
      {children !== undefined && children !== null && <span className="btn-label">{children}</span>}
    </button>
  );
}
