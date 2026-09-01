/**
 * lib/draw-sync.ts
 * Canvas stroke rendering, normalized coordinate math, and drawing event utilities.
 * Annotations have a 5-second active lifetime followed by a 0.5-second blur/fade-away transition.
 */
import { Stroke, StrokePoint } from './types';

export const STROKE_LIFETIME_MS = 5000; // 5.0s solid visible lifetime
export const STROKE_FADE_DURATION_MS = 500; // 0.5s blur and fade transition
export const STROKE_TOTAL_TTL_MS = STROKE_LIFETIME_MS + STROKE_FADE_DURATION_MS; // 5500ms total TTL

/**
 * Normalizes a pointer event's position relative to the canvas bounding rect (0.0 to 1.0).
 */
export function getNormalizedPointerPos(
  event: PointerEvent | React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): StrokePoint {
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

/**
 * Converts a normalized stroke point back to pixel coordinates on the given canvas dimensions.
 */
export function denormalizePoint(
  point: StrokePoint,
  width: number,
  height: number
): [number, number] {
  return [point[0] * width, point[1] * height];
}

/**
 * Draws a single stroke onto a 2D canvas context with age-based blur & opacity fade.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke | { color: string; points: StrokePoint[]; timestamp?: number },
  width: number,
  height: number,
  now = Date.now(),
  lineWidthScale = 1
) {
  const points = stroke.points;
  if (!points || points.length === 0) return;

  // Calculate age and fade/blur parameters
  let alpha = 1.0;
  let blurPx = 0;

  if (stroke.timestamp) {
    const age = now - stroke.timestamp;
    if (age >= STROKE_TOTAL_TTL_MS) {
      return; // Fully expired, skip rendering
    }
    if (age > STROKE_LIFETIME_MS) {
      // Progress from 0.0 to 1.0 over the 0.5s fade window
      const progress = Math.min(1, (age - STROKE_LIFETIME_MS) / STROKE_FADE_DURATION_MS);
      alpha = Math.max(0, 1.0 - progress);
      blurPx = progress * 6; // Gradually blur from 0px up to 6px
    }
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  if (blurPx > 0 && typeof ctx.filter === 'string') {
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  }
  ctx.strokeStyle = stroke.color;

  // Scaled line width proportional to canvas width for resolution independence (base 3px on 1000px wide)
  const baseWidth = Math.max(2.5, (width / 400) * lineWidthScale);
  ctx.lineWidth = baseWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    const [x, y] = denormalizePoint(points[0], width, height);
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(x, y, baseWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  const [firstX, firstY] = denormalizePoint(points[0], width, height);
  ctx.moveTo(firstX, firstY);

  if (points.length === 2) {
    const [secondX, secondY] = denormalizePoint(points[1], width, height);
    ctx.lineTo(secondX, secondY);
  } else {
    // Smooth curves using quadratic bezier between midpoints
    for (let i = 1; i < points.length - 1; i++) {
      const [currX, currY] = denormalizePoint(points[i], width, height);
      const [nextX, nextY] = denormalizePoint(points[i + 1], width, height);
      const midX = (currX + nextX) / 2;
      const midY = (currY + nextY) / 2;
      ctx.quadraticCurveTo(currX, currY, midX, midY);
    }
    const [lastX, lastY] = denormalizePoint(points[points.length - 1], width, height);
    ctx.lineTo(lastX, lastY);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Clears and re-renders all completed and in-progress strokes on the canvas.
 * Returns true if any active (non-expired) strokes were rendered.
 */
export function renderAllStrokes(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  inProgressStrokes: Map<string, Stroke> | Stroke[] = [],
  now = Date.now()
): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  let hasActiveStrokes = false;

  // Render completed strokes with TTL check
  for (const stroke of strokes) {
    const age = now - (stroke.timestamp || now);
    if (age < STROKE_TOTAL_TTL_MS) {
      drawStroke(ctx, stroke, width, height, now);
      hasActiveStrokes = true;
    }
  }

  // Render in-progress remote and local strokes (always 100% visible)
  if (inProgressStrokes instanceof Map) {
    for (const stroke of inProgressStrokes.values()) {
      drawStroke(ctx, stroke, width, height, now);
      hasActiveStrokes = true;
    }
  } else if (Array.isArray(inProgressStrokes)) {
    for (const stroke of inProgressStrokes) {
      drawStroke(ctx, stroke, width, height, now);
      hasActiveStrokes = true;
    }
  }

  return hasActiveStrokes;
}
