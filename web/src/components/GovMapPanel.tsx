export function GovMapPanel({ address, mode = "map" }: { address: string; mode?: "map" | "plot" }) {
  // A separate same-origin document isolates each SDK instance (including history
  // reports) and tears down its message listeners when React removes the frame.
  // The fragment keeps the address out of hosting request logs and referrers.
  return <section className="govmap-panel" aria-label={mode === "plot" ? "תיאור החלקה ומפת GovMap" : "מפת הנכס וגוש וחלקה"}>
    <iframe
      key={`${mode}:${address}`}
      className={`govmap-frame${mode === "plot" ? " plot-frame" : ""}`}
      title={`${mode === "plot" ? "תיאור החלקה ומפת GovMap" : "מפת GovMap וגוש וחלקה"} — ${address}`}
      src={`/govmap.html#${new URLSearchParams({ address, mode })}`}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  </section>;
}
