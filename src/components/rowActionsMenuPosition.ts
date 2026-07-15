const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;

export interface MenuPosition {
  left: number;
  top: number;
}

interface MenuGeometry {
  anchorRight: number;
  anchorTop: number;
  anchorBottom: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function resolveRowActionsMenuPosition({
  anchorRight,
  anchorTop,
  anchorBottom,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
}: MenuGeometry): MenuPosition {
  const availableBelow =
    viewportHeight - VIEWPORT_PADDING - anchorBottom - MENU_GAP;
  const availableAbove = anchorTop - VIEWPORT_PADDING - MENU_GAP;
  const opensAbove =
    menuHeight > availableBelow && availableAbove > availableBelow;
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    viewportWidth - VIEWPORT_PADDING - menuWidth,
  );
  const maxTop = Math.max(
    VIEWPORT_PADDING,
    viewportHeight - VIEWPORT_PADDING - menuHeight,
  );

  return {
    left: Math.min(
      Math.max(VIEWPORT_PADDING, anchorRight - menuWidth),
      maxLeft,
    ),
    top: Math.min(
      Math.max(
        VIEWPORT_PADDING,
        opensAbove
          ? anchorTop - MENU_GAP - menuHeight
          : anchorBottom + MENU_GAP,
      ),
      maxTop,
    ),
  };
}
