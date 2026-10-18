/** Totals from `totalLines`: one line per currency, right-aligned. */
export default function MoneyLines({ lines, className = '' }: { lines: string[]; className?: string }) {
  return (
    <span className={`money-lines ${className}`.trim()}>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  )
}
