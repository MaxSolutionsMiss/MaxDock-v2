import { CalendarClock, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DockBoard } from '../components/DockBoard';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';
import { useMaxDock } from '../context/MaxDockContext';

const docks = ['DOCK-01', 'DOCK-02', 'DOCK-03', 'DOCK-04'];
const hours = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const slots = [
  { dock: 'DOCK-01', hour: '07:00', reference: 'MXD-000038', detail: 'Outbound · 10 sk', tone: 'out' as const },
  { dock: 'DOCK-01', hour: '09:00', reference: 'MXD-000041', detail: 'Inbound · 26 skids · 53 ft', tone: 'in' as const, span: 2 },
  { dock: 'DOCK-01', hour: '12:00', reference: 'Lunch', tone: 'blocked' as const },
  { dock: 'DOCK-01', hour: '14:00', reference: 'MXD-000045', detail: 'Outbound · 8 sk', tone: 'out' as const },
  { dock: 'DOCK-02', hour: '08:00', reference: 'MXD-000040', detail: 'Priority · Guelph', tone: 'priority' as const },
  { dock: 'DOCK-02', hour: '11:00', reference: 'MXD-000042', detail: 'Inbound · 12 sk', tone: 'in' as const },
  { dock: 'DOCK-02', hour: '12:00', reference: 'Lunch', tone: 'blocked' as const },
  { dock: 'DOCK-02', hour: '16:00', reference: 'MXD-000047', detail: 'Outbound · 4 sk', tone: 'out' as const },
  { dock: 'DOCK-03', hour: '07:00', reference: 'MXD-000039', detail: 'Inbound · 18 sk', tone: 'in' as const },
  { dock: 'DOCK-03', hour: '10:00', reference: 'MXD-000043', detail: 'Outbound · Bristol · 30 skids', tone: 'out' as const, span: 2 },
  { dock: 'DOCK-03', hour: '12:00', reference: 'Lunch', tone: 'blocked' as const },
  { dock: 'DOCK-04', hour: '09:00', reference: 'MXD-000044', detail: 'Inbound · Bristol', tone: 'in' as const },
  { dock: 'DOCK-04', hour: '12:00', reference: 'Lunch', tone: 'blocked' as const },
  { dock: 'DOCK-04', hour: '14:00', reference: 'MXD-000046', detail: 'Outbound · 10 sk', tone: 'out' as const },
];

export function DashboardPage() {
  const { selectedLocation } = useMaxDock();

  return (
    <div className="page-stack">
      <PageHeader
        title="Dock board"
        description={`${selectedLocation?.name ?? 'Location'} · ${docks.length} docks · 07:00–17:00`}
        action={
          <>
            <button className="btn btn--quiet" type="button"><CalendarClock size={14} />Block dock time</button>
            <Link className="btn btn--primary" to="/request"><Plus size={14} />Book appointment</Link>
          </>
        }
      />

      <section className="kpis" aria-label="Today’s dock metrics">
        <KpiCard label="Booked today" value="18" note="of 24 slots" />
        <KpiCard label="On site now" value="3" note="docks 1, 4, 5" tone="ok" />
        <KpiCard label="Priority" value="2" note="next at 10:30" tone="signal" />
        <KpiCard label="Skids in / out" value="140 / 96" note="planned" />
        <KpiCard label="Cancelled" value="1" note="today" tone="stop" />
      </section>

      <DockBoard docks={docks} hours={hours} slots={slots} />
    </div>
  );
}
