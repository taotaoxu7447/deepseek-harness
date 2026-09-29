/**
 * Popover card presenting daily and monthly DeepSeek API consumption charts.
 */

import React, { type ReactNode, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ConsumptionData, ConsumptionItem } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { DeepSeekBalanceLocaleKey } from './locales.ts'
import css from './ConsumptionPopover.module.css'

/**
 * Format currency amount with symbol.
 * @param amount - raw numeric consumption.
 * @param currency - currency code (CNY, USD, etc.).
 * @returns formatted string (e.g. ¥3.45).
 */
export function formatCurrency(amount: number, currency = 'CNY'): string {
  const pretty = amount.toFixed(2)
  if (currency === 'CNY') return `¥${pretty}`
  if (currency === 'USD') return `$${pretty}`
  return `${pretty} ${currency}`
}

function formatYTick(val: number, currency = 'CNY'): string {
  const pretty = val >= 10 ? String(Math.round(val)) : val.toFixed(1)
  if (currency === 'CNY') return `¥${pretty}`
  if (currency === 'USD') return `$${pretty}`
  return pretty
}

/** Props for the ConsumptionPopover component. */
export interface ConsumptionPopoverProps {
  consumption?: ConsumptionData
  currency?: string
  onClose: () => void
  t: (key: DeepSeekBalanceLocaleKey, vars?: Record<string, string | number>) => string
  anchorRef?: React.RefObject<HTMLElement>
}

/**
 * Anchored popover card with native SVG bar charts for historical API consumption.
 */
export function ConsumptionPopover({
  consumption,
  currency = 'CNY',
  onClose,
  t,
  anchorRef,
}: ConsumptionPopoverProps): ReactNode {
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      const target = e.target as Node
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        (!anchorRef?.current || !anchorRef.current.contains(target))
      ) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, anchorRef])

  const items: ConsumptionItem[] = (activeTab === 'daily' ? consumption?.daily : consumption?.monthly) ?? []
  const hasData = items.length > 0

  // Chart Geometry
  const width = 288
  const height = 140
  const top = 18
  const bottom = 22
  const left = 34
  const right = 8
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom

  const maxAmount = hasData ? Math.max(...items.map(item => item.amount), 0) : 0
  const niceMax = maxAmount > 0 ? maxAmount * 1.15 : 1
  const yTicks = [0, niceMax / 2, niceMax]

  const slotWidth = hasData ? plotWidth / items.length : 0
  const barWidth = hasData ? Math.max(3, Math.min(14, slotWidth * 0.6)) : 0

  const labelStep = items.length > 12 ? Math.ceil(items.length / 8) : 1
  const hoveredItem = hoveredIndex !== null && items[hoveredIndex] ? items[hoveredIndex] : null

  return (
    <div
      ref={popoverRef}
      className={css.popover}
      data-deepseek-consumption-popover=""
      role="dialog"
      aria-label={t('popoverTitle')}
    >
      <div className={css.header}>
        <span className={css.title}>{t('popoverTitle')}</span>
        <div className={css.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'daily'}
            className={clsx(css.tab, activeTab === 'daily' && css.tabActive)}
            onClick={() => {
              setActiveTab('daily')
              setHoveredIndex(null)
            }}
          >
            {t('tabDaily')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'monthly'}
            className={clsx(css.tab, activeTab === 'monthly' && css.tabActive)}
            onClick={() => {
              setActiveTab('monthly')
              setHoveredIndex(null)
            }}
          >
            {t('tabMonthly')}
          </button>
        </div>
      </div>

      <div className={css.chartContainer}>
        {hoveredItem && (
          <div className={css.tooltip} data-testid="consumption-tooltip">
            {hoveredItem.key}: {formatCurrency(hoveredItem.amount, currency)}
          </div>
        )}

        {!hasData ? (
          <div className={css.empty}>{t('noConsumption')}</div>
        ) : (
          <svg
            className={css.svg}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
          >
            {/* Horizontal Grid lines & Y Ticks */}
            {yTicks.map((tVal) => {
              const yPos = top + plotHeight - (tVal / niceMax) * plotHeight
              return (
                <g key={tVal}>
                  <line
                    x1={left}
                    y1={yPos}
                    x2={left + plotWidth}
                    y2={yPos}
                    className={css.gridLine}
                  />
                  <text
                    x={left - 4}
                    y={yPos + 3}
                    textAnchor="end"
                    className={css.axisText}
                  >
                    {formatYTick(tVal, currency)}
                  </text>
                </g>
              )
            })}

            {/* X-axis Baseline */}
            <line
              x1={left}
              y1={top + plotHeight}
              x2={left + plotWidth}
              y2={top + plotHeight}
              className={css.axisLine}
            />

            {/* Bars & Labels */}
            {items.map((item, idx) => {
              const cx = left + idx * slotWidth + slotWidth / 2
              const barX = cx - barWidth / 2
              const barH = maxAmount > 0 ? (item.amount / niceMax) * plotHeight : 0
              const barY = top + plotHeight - barH
              const rx = Math.min(3, barH / 2)
              const showLabel = idx % labelStep === 0 || idx === items.length - 1

              return (
                <g
                  key={item.key}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {/* Visual Bar */}
                  <rect
                    x={barX}
                    y={barY}
                    width={barWidth}
                    height={Math.max(barH, 1)}
                    rx={rx}
                    ry={rx}
                    className={clsx(css.bar, hoveredIndex === idx && css.barActive)}
                    data-testid={`bar-${item.key}`}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                  {/* Invisible Hit Slot */}
                  <rect
                    x={left + idx * slotWidth}
                    y={top}
                    width={slotWidth}
                    height={plotHeight + bottom}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                  {/* X-axis Label */}
                  {showLabel && (
                    <text
                      x={cx}
                      y={top + plotHeight + 14}
                      textAnchor="middle"
                      className={css.axisText}
                    >
                      {item.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}

export default ConsumptionPopover
