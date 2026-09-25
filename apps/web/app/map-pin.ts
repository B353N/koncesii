/**
 * Флагчето за картата, нарисувано в canvas (иконата на symbol слоя):
 * флагът е в цвета на тежестта, точката в основата - във вида обект.
 * Само в браузъра (document).
 */
import { DEFAULT_KIND_COLOR, KIND_COLORS, SEV_COLORS } from "./map-style";

export function pinImage(sev: number, kind: string): ImageData {
  const s = 2;
  const c = document.createElement("canvas");
  c.width = 26 * s;
  c.height = 34 * s;
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.fillStyle = "rgba(21,33,43,.18)";
  g.beginPath();
  g.ellipse(6, 31, 5, 2, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#15212b";
  g.lineWidth = 2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(6, 30);
  g.lineTo(6, 3);
  g.stroke();
  g.fillStyle = SEV_COLORS[sev]!;
  g.beginPath();
  g.moveTo(7, 3);
  g.bezierCurveTo(12, 1, 16, 6, 23, 3.5);
  g.lineTo(21, 10);
  g.lineTo(23, 16.5);
  g.bezierCurveTo(16, 19, 12, 14, 7, 16);
  g.closePath();
  g.fill();
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(6, 30, 3.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = KIND_COLORS[kind] ?? DEFAULT_KIND_COLOR;
  g.beginPath();
  g.arc(6, 30, 2.4, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}
