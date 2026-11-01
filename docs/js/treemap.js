// Squarified treemap layout (Bruls, Huizing, van Wijk). Pure function, no DOM.
// items: [{ value, ... }] → same items with { x, y, w, h } in a width × height box.

function worst(row, side, scale) {
  const s = row.reduce((a, r) => a + r.value * scale, 0);
  const max = Math.max(...row.map((r) => r.value * scale)), min = Math.min(...row.map((r) => r.value * scale));
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

export function squarify(items, width, height) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value).map((i) => ({ ...i }));
  const total = list.reduce((a, i) => a + i.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total; // area per unit of value
  const out = [];
  let x = 0, y = 0, w = width, h = height;
  let row = [];
  const layoutRow = (r) => {
    const area = r.reduce((a, i) => a + i.value * scale, 0);
    if (w >= h) { // lay the row out as a column on the left
      const cw = area / h;
      let cy = y;
      for (const i of r) { const ih = (i.value * scale) / cw; out.push({ ...i, x, y: cy, w: cw, h: ih }); cy += ih; }
      x += cw; w -= cw;
    } else { // as a row on top
      const rh = area / w;
      let cx = x;
      for (const i of r) { const iw = (i.value * scale) / rh; out.push({ ...i, x: cx, y, w: iw, h: rh }); cx += iw; }
      y += rh; h -= rh;
    }
  };
  for (const item of list) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, item], side, scale) <= worst(row, side, scale)) row.push(item);
    else { layoutRow(row); row = [item]; }
  }
  if (row.length) layoutRow(row);
  return out;
}
