export function GovMapPanel({ address }: { address: string }) {
  // A separate same-origin document isolates each SDK instance (including history
  // reports) and tears down its message listeners when React removes the frame.
  // The fragment keeps the address out of hosting request logs and referrers.
  return <section className="govmap-panel" aria-label="מפת הנכס וגוש וחלקה">
    <iframe
      key={address}
      className="govmap-frame"
      title={`מפת GovMap וגוש וחלקה — ${address}`}
      src={`/govmap.html#${new URLSearchParams({ address })}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </section>;
}
