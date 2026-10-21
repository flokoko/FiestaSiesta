import './Skeleton.css'

interface SkeletonProps {
  width?: string
  height?: string
  radius?: string
  className?: string
}

export function Skeleton({ width, height, radius, className }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ width, height, borderRadius: radius }}
    />
  )
}

export function SkeletonLine() {
  return <Skeleton className="skeleton-line" />
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-siesta">
        <span className="skeleton-siesta-emoji">☀️</span>
      </div>
      <div className="skeleton-lines">
        <div className="skeleton-line skeleton-line-title" />
        <div className="skeleton-line skeleton-line-sub" />
      </div>
    </div>
  )
}

export function SkeletonNote() {
  return (
    <div className="skeleton-note">
      <div className="skeleton-line skeleton-line-title" />
      <div className="skeleton-line skeleton-line-sub" />
    </div>
  )
}

export function SkeletonCatHeader() {
  return <Skeleton className="skeleton-cat-header" />
}

export function SkeletonItemRow() {
  return <Skeleton className="skeleton-item-row" />
}

export function SkeletonExpenseCard() {
  return <Skeleton className="skeleton-expense-card" />
}
