// Ported to Vue from nexu-io/open-design packages/components/src/button.tsx (Apache-2.0):
// the variant / size class maps; Button.vue renders them.
import { joinClassNames } from './class-names';
import styles from './button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'primary-ghost' | 'ghost' | 'subtle' | 'secondary';
export type ButtonSize = 'default' | 'icon' | 'sm';

export const buttonVariantClassNames: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: joinClassNames(styles.primary, 'primary'),
  'primary-ghost': joinClassNames(styles.primaryGhost, 'primary-ghost'),
  ghost: joinClassNames(styles.ghost, 'ghost'),
  subtle: joinClassNames(styles.subtle, 'subtle'),
  // chat 设计稿的 .btn.mod-secondary:白底细描边,hover 只加深描边与字色。
  secondary: styles.secondary,
};

export const buttonSizeClassNames: Record<ButtonSize, string | undefined> = {
  default: undefined,
  icon: joinClassNames(styles.icon, 'icon-btn'),
  // chat 设计稿的 .btn.mod-sm:26px 高、12px/600、胶囊角。
  sm: styles.sm,
};

export function buttonClassName(variant: ButtonVariant = 'default', size: ButtonSize = 'default'): string | undefined {
  return joinClassNames(styles.button, buttonVariantClassNames[variant], buttonSizeClassNames[size]);
}
