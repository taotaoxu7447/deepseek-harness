# Design Specification: Customizable Brand Tag Plugin & Light Mode White Background

- **Status**: Approved
- **Date**: 2026-08-25
- **Target Repository**: `/home/taotao-xu/deepseek_harness`
- **Affected Packages**:
  - `packages/client/ui-primitives`
  - `packages/client/ui-brand-official`
  - `packages/client/ui-settings-general`

---

## 1. Overview & Goals

1. **Light Mode White Background Fix**:
   - In Light Mode, the `TAO` cyber chamfer badge background in the top-left wordmark (`BrandWordmark`) defaults to pure white (`#ffffff`).
   - In Dark Mode, it continues to default to a clean dark surface (`#0f172a`).
2. **Personalized Brand Tag Plugin & Customization**:
   - Make the `TAO` brand tag in the top-left corner fully customizable via **Settings $\rightarrow$ General**:
     - **Text (文字)**: Custom string with a strict length constraint (1 to 8 characters, default: `TAO`).
     - **Stroke/Border & Text Color (边框与文字颜色)**: Customizable color with quick preset color chips (e.g. `#00e5ff` Cyber Cyan, `#3b82f6` Blue, `#10b981` Green, `#f59e0b` Amber, `#ef4444` Red, `#8b5cf6` Purple) plus custom HEX input.
     - **Fill/Background Colors (填充背景色)**: Independently customizable for Light Mode (default: `#ffffff`) and Dark Mode (default: `#0f172a`).
3. **Dynamic Adaptive Geometry**:
   - The C-2 Cyber Chamfer `<polygon>` and text position dynamically adapt to the custom text length (from 1 to 8 characters) without visual clipping or alignment distortion.
   - Settings changes immediately re-render live in the UI via the reactive `SettingsScope` with no page reload required.

---

## 2. Geometry & Mathematical Calculation

The badge utilizes an 18-degree chamfer parallelogram (`h = 14px`, `dx = 4.5px`, `y = 5.5px`):

```
       (49.5, 0) +----------------------+ (49.5 + W, 0)
                /                      /
               /         TEXT         /
              /                      /
(49.5 - 4.5, 14) +--------------------+ (49.5 + W - 4.5, 14)
```

1. **Base Positioning**:
   - `x_start = 49.5px`
   - Estimated width per character: `charWidth = 7.0px`
   - Padding on sides: `horizontalPadding = 16px`
   - Width: `W = Math.max(28, 16 + charCount * 7.0)`
2. **Polygon Coordinates**:
   - Point 1: `(x_start, 0)`
   - Point 2: `(x_start + W, 0)`
   - Point 3: `(x_start + W - 4.5, 14)`
   - Point 4: `(x_start - 4.5, 14)`
3. **Text Center**:
   - `x_text = x_start + W / 2 - 2.25`
   - `y_text = 10`
4. **SVG ViewBox Adaptation**:
   - Total wordmark width expands dynamically:
     `totalWidth = includeMark ? (128 + x_start + W + 6) : (102 + x_start + W + 6)`
   - `viewBox = includeMark ? '0 0 totalWidth 24' : '26 0 (totalWidth - 26) 24'`

---

## 3. Settings Schema (`brand-tag` Namespace)

```ts
export const BRAND_TAG_NS = 'brand-tag'

export interface BrandTagSettings {
  text?: string               // Default "TAO", length 1-8
  strokeColor?: string        // Default "#00e5ff"
  fillColorLight?: string     // Default "#ffffff"
  fillColorDark?: string      // Default "#0f172a"
}
```

---

## 4. UI Components & Integration

### 4.1 `packages/client/ui-primitives/src/BrandWordmark.tsx`
- Adds optional props:
  ```ts
  export interface BrandWordmarkProps extends IconProps {
    includeMark?: boolean
    tagText?: string
    tagStroke?: string
    tagFillLight?: string
    tagFillDark?: string
  }
  ```
- Uses CSS variables or direct props with theme detection to render:
  - In light mode: `tagFillLight ?? '#ffffff'`
  - In dark mode: `tagFillDark ?? '#0f172a'`
  - Stroke and text fill: `tagStroke ?? '#00e5ff'`
  - Text: `(tagText?.trim() || 'TAO').slice(0, 8)`

### 4.2 `packages/client/ui-brand-official/src/client/Brand.tsx`
- Binds to `SettingsScope<BrandTagSettings>` (`brand-tag` namespace).
- Subscribes to settings changes and feeds dynamic `tagText`, `tagStroke`, `tagFillLight`, `tagFillDark` props to `BrandWordmark`.

### 4.3 `packages/client/ui-settings-general/src/client/BrandTagCard.tsx`
- Renders inside General Settings (`GeneralSection.tsx`).
- Card layout:
  - **Live Preview**: Side-by-side Light Mode and Dark Mode mini wordmark preview.
  - **Text Input**: `maxLength={8}`, with character counter `(N/8)` and placeholder `"TAO"`.
  - **Color Pickers**:
    - Preset color chips: `#00e5ff`, `#3b82f6`, `#10b981`, `#f59e0b`, `#ef4444`, `#8b5cf6`.
    - Custom HEX input field for stroke/text color.
    - Optional override fields for Light/Dark backgrounds with a "Reset to default" button.

---

## 5. Testing & Verification Plan

1. **Unit Tests**:
   - `packages/client/ui-primitives/tests/icons.client.spec.tsx`:
     - Test `BrandWordmark` rendering custom text (e.g. `PRO`, `DEV88888`), verifying calculated width and polygon vertices.
     - Test default fallback when `tagText` is empty or invalid.
     - Test light mode white background fill and dark mode dark fill.
   - `packages/client/ui-settings-general/tests/brand-tag.client.spec.tsx`:
     - Test `BrandTagCard` input interaction, length limiting (8 chars), color selection, and settings persistence.
   - `packages/client/ui-brand-official/tests/`:
     - Test `OfficialBrandName` updating when `brand-tag` settings change.
2. **Workspace Verification**:
   - Full vitest suite execution.
   - Full TypeScript typecheck (`tsc -b`).
   - Project build (`pnpm run build`).
