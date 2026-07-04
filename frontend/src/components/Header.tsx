export default function Header() {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b-2 border-accent-subtle shrink-0">
      <img src="/lpe-logo-highres.svg" alt="LPE" className="h-8 w-auto" />
      <span className="text-accent font-semibold text-sm">Contract Management Portal</span>
    </div>
  )
}
