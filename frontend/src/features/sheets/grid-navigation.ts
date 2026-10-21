export type GridPoint = { row: number; col: number };

export function moveGridSelection(
  point: GridPoint,
  key: string,
  shift: boolean,
  rowCount: number,
  columnCount: number,
): GridPoint | null {
  if (!rowCount || !columnCount) return null;
  if (key === "Tab") {
    const index = point.row * columnCount + point.col + (shift ? -1 : 1);
    if (index < 0 || index >= rowCount * columnCount) return null;
    return { row: Math.floor(index / columnCount), col: index % columnCount };
  }
  const moves: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    Enter: [shift ? -1 : 1, 0],
  };
  const delta = moves[key];
  if (!delta) return null;
  return {
    row: Math.max(0, Math.min(rowCount - 1, point.row + delta[0])),
    col: Math.max(0, Math.min(columnCount - 1, point.col + delta[1])),
  };
}
