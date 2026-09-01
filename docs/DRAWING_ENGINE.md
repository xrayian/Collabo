# Collabo Drawing Engine & Ephemeral TTL

The Collabo Drawing Engine is designed for low-latency, cross-platform collaborative screen annotation using the HTML5 Canvas API and normalized floating-point coordinate math.

---

## 1. Ephemeral Stroke Lifecycle (5.0s Solid + 0.5s Blur-Fade)

To keep shared screens readable during active engineering reviews, strokes do not linger indefinitely. Instead, each stroke follows a strict **5.5-second total TTL curve**:

```
Alpha (Opacity)
1.0 |==========================================\
    |                                           \
    |                                            \  (0.5s Blur & Fade)
    |                                             \
0.0 +----------------------------------------------\----> Time (seconds)
    0s                                            5.0s   5.5s
```

### Mathematical Formulation

Given $t = \text{Date.now}() - \text{stroke.timestamp}$:

1. **Active Phase ($t \le 5000\text{ms}$):**
   $$\text{alpha} = 1.0, \quad \text{blur} = 0\text{px}$$

2. **Transition Phase ($5000\text{ms} < t < 5500\text{ms}$):**
   $$\text{progress} = \frac{t - 5000}{500}$$
   $$\text{alpha} = 1.0 - \text{progress}$$
   $$\text{blur} = \text{progress} \times 6\text{px}$$

3. **Expired Phase ($t \ge 5500\text{ms}$):**
   The stroke is pruned from memory and omitted from canvas draw cycles.

---

## 2. Open Curve Interpolation & Non-Closing Geometry

Earlier canvas implementations often closed freeform strokes when the mouse button was released. Collabo uses continuous quadratic Bézier smoothing between intermediate midpoint vectors:

```typescript
// Midpoint quadratic Bézier smoothing
for (let i = 1; i < points.length - 1; i++) {
  const [currX, currY] = denormalizePoint(points[i], width, height);
  const [nextX, nextY] = denormalizePoint(points[i + 1], width, height);
  const midX = (currX + nextX) / 2;
  const midY = (currY + nextY) / 2;
  ctx.quadraticCurveTo(currX, currY, midX, midY);
}
```

When pointer disengagement occurs (`pointerup`), an empty delta with `isEnd: true` is transmitted, ensuring the curve endpoints remain completely open.

---

## 3. Multi-Input Support (Pointer Events)

By utilizing W3C **Pointer Events** (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`):
- **Desktop:** Standard mouse tracking.
- **Stylus / Pen:** High-frequency digital pen input with palm rejection.
- **Mobile / Tablet:** Smooth capacitive multi-touch drawing with automatic gesture prevention (`touch-action: none`).
