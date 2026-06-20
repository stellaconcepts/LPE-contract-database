export default function PricingBadge({ isPricing }: { isPricing: boolean }) {
  const cls = isPricing ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
  return (
    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {isPricing ? 'Pricing' : 'No pricing'}
    </span>
  )
}
