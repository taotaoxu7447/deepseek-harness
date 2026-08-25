// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 20 figma extracts + four product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(70)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the fish path in currentColor at the native ratio', () => {
    const { container } = render(<primitives.FishLogo />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('24')
    expect(Number(svg.getAttribute('height'))).toBeCloseTo(17.66, 1)
    expect(svg.getAttribute('viewBox')).toBe('0 0 23.16 17.04')
    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.innerHTML).toContain('currentColor')
    expect(container.innerHTML).not.toContain('M0 0L23.16')
  })
})

describe('BrandWordmark', () => {
  it('can render the name artwork with or without its leading mark and renders default TAO tag', () => {
    const view = render(<primitives.BrandWordmark />)
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('220.5')
    expect(svg.getAttribute('viewBox')).toBe('0 0 220.5 24')

    const texts = view.container.querySelectorAll('text')
    const tagText = Array.from(texts).find(el => el.textContent === 'TAO')
    expect(tagText).not.toBeNull()
    expect(tagText?.getAttribute('fill')).toBe('#00e5ff')
    expect(tagText?.getAttribute('x')).toBe('65.75')

    const tagPolygon = view.container.querySelector('polygon.dsh-brand-tag-plate')
    expect(tagPolygon).not.toBeNull()
    expect(tagPolygon?.getAttribute('points')).toBe('49.5,0 86.5,0 82,14 45,14')
    expect(tagPolygon?.getAttribute('stroke')).toBe('#00e5ff')

    view.rerender(<primitives.BrandWordmark includeMark={false} />)
    expect(svg.getAttribute('width')).toBe('194.5')
    expect(svg.getAttribute('viewBox')).toBe('26 0 194.5 24')
  })

  it('renders custom tagText="TEST" with calculated width and polygon', () => {
    const { container } = render(<primitives.BrandWordmark tagText="TEST" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('227.5')
    expect(svg.getAttribute('viewBox')).toBe('0 0 227.5 24')

    const tagText = Array.from(container.querySelectorAll('text')).find(el => el.textContent === 'TEST')
    expect(tagText).not.toBeNull()
    expect(tagText?.getAttribute('x')).toBe('69.25')

    const tagPolygon = container.querySelector('polygon.dsh-brand-tag-plate')
    expect(tagPolygon?.getAttribute('points')).toBe('49.5,0 93.5,0 89,14 45,14')
  })

  it('truncates custom tagText longer than 8 characters', () => {
    const { container } = render(<primitives.BrandWordmark tagText="LONGERTHAN8CHARS" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('255.5')
    expect(svg.getAttribute('viewBox')).toBe('0 0 255.5 24')

    const tagText = Array.from(container.querySelectorAll('text')).find(el => el.textContent === 'LONGERTH')
    expect(tagText).not.toBeNull()
    expect(tagText?.getAttribute('x')).toBe('83.25')

    const tagPolygon = container.querySelector('polygon.dsh-brand-tag-plate')
    expect(tagPolygon?.getAttribute('points')).toBe('49.5,0 121.5,0 117,14 45,14')
  })

  it('sets custom tagStroke for border stroke and text color', () => {
    const { container } = render(<primitives.BrandWordmark tagStroke="#ef4444" />)
    const tagPolygon = container.querySelector('polygon.dsh-brand-tag-plate')
    expect(tagPolygon?.getAttribute('stroke')).toBe('#ef4444')

    const tagText = Array.from(container.querySelectorAll('text')).find(el => el.textContent === 'TAO')
    expect(tagText?.getAttribute('fill')).toBe('#ef4444')
  })

  it('supports custom tagFillLight and tagFillDark props in style defs', () => {
    const { container } = render(<primitives.BrandWordmark tagFillLight="#ffffff" tagFillDark="#0f172a" />)
    const styleEl = container.querySelector('defs style')
    expect(styleEl?.textContent).toContain('#ffffff')
    expect(styleEl?.textContent).toContain('#0f172a')
  })
})
