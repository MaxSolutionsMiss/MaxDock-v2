type KpiCardProps = {
  label: string;
  value: string;
  note: string;
  tone?: 'default' | 'ok' | 'signal' | 'stop';
};

export function KpiCard({ label, value, note, tone = 'default' }: KpiCardProps) {
  return (
    <article className={`kpi ${tone === 'default' ? '' : `kpi--${tone}`}`.trim()}>
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      <div className="kpi__note">{note}</div>
    </article>
  );
}
