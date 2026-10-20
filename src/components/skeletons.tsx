// Placeholders shaped like the content they stand in for, shown while data streams in.
// They shimmer gently (still when the device asks for reduced motion).

type SkProps = { w?: number | string; h?: number; r?: number; style?: React.CSSProperties };
export function Sk({ w = "100%", h = 14, r = 6, style }: SkProps) {
  return <span className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

function Busy({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export function SkeletonStrip({ cells = 4 }: { cells?: number }) {
  return (
    <Busy className="strip score">
      {range(cells).map((i) => (
        <div key={i}><Sk w="45%" h={32} /><Sk w="70%" h={12} style={{ marginTop: 8 }} /></div>
      ))}
    </Busy>
  );
}

export function SkeletonTable({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Busy className="tbl">
      <table>
        <thead><tr>{range(cols).map((c) => <th key={c} className={c ? "num" : undefined}><Sk w={c ? 48 : 90} h={10} style={c ? { marginLeft: "auto" } : undefined} /></th>)}</tr></thead>
        <tbody>
          {range(rows).map((r) => (
            <tr key={r}>{range(cols).map((c) => <td key={c} className={c ? "num" : undefined}><Sk w={c ? 36 : "60%"} style={c ? { marginLeft: "auto" } : undefined} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </Busy>
  );
}

export function SkeletonList({ rows = 3, action = true }: { rows?: number; action?: boolean }) {
  return (
    <Busy className="list">
      {range(rows).map((i) => (
        <div key={i} className="row">
          <span style={{ flex: 1 }}><Sk w="38%" h={14} /><Sk w="62%" h={11} style={{ marginTop: 7 }} /></span>
          {action ? <Sk w={58} h={30} r={9} /> : null}
        </div>
      ))}
    </Busy>
  );
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <Busy>
      {range(lines).map((i) => <Sk key={i} w={`${70 - i * 12}%`} style={{ marginTop: i ? 10 : 0 }} />)}
    </Busy>
  );
}

export function SkeletonTabs({ tabs = 4 }: { tabs?: number }) {
  return (
    <div className="tabs" aria-hidden="true">
      {range(tabs).map((i) => <Sk key={i} w={88} h={30} r={9} />)}
    </div>
  );
}

export function SkeletonCards({ cards = 3 }: { cards?: number }) {
  return (
    <Busy className="mcards">
      {range(cards).map((i) => (
        <section key={i} className="panel">
          <Sk w="55%" h={16} />
          <Sk w="35%" h={34} style={{ marginTop: 14 }} />
          <Sk w="80%" h={11} style={{ marginTop: 12 }} />
          <Sk w="65%" h={11} style={{ marginTop: 8 }} />
        </section>
      ))}
    </Busy>
  );
}

// The daily entry screen: date bar, attendance, then stage cards.
export function SkeletonDay() {
  return (
    <Busy>
      <div className="daynav"><Sk w={120} h={38} r={10} /><Sk w={150} h={38} r={10} /><Sk w={100} h={38} r={10} /></div>
      <Sk w={260} h={24} style={{ margin: "4px 0 16px" }} />
      <section className="panel" style={{ marginBottom: 18 }}>
        <Sk w={130} h={16} />
        <div className="people" style={{ marginTop: 14 }}>
          {range(8).map((i) => (
            <div key={i} className="person"><Sk w="60%" h={14} /><Sk w={190} h={30} r={10} /></div>
          ))}
        </div>
      </section>
      <div className="stations">
        {range(4).map((i) => (
          <section key={i} className={`panel${i === 0 ? " wide" : ""}`}>
            <Sk w="40%" h={18} />
            <Sk w="75%" h={11} style={{ marginTop: 8 }} />
            <Sk w="100%" h={34} r={10} style={{ marginTop: 14 }} />
            <Sk w={96} h={32} r={9} style={{ marginTop: 14 }} />
          </section>
        ))}
      </div>
    </Busy>
  );
}
