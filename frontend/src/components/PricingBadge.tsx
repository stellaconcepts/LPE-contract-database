export default function PricingBadge({ isPricing }: { isPricing: boolean }) {
  const cls = isPricing ? 'bg-success-bg text-success-text' : 'bg-neutral-100 text-neutral-500'
  return (
    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {isPricing ? 'Pricing' : 'No pricing'}
    </span>
  )
}
