import { Download, Maximize2, Printer } from 'lucide-react';

type SlotTone = 'in' | 'out' | 'priority' | 'blocked';

type BoardSlot = {
  dock: string;
  hour: string;
  reference: string;
  detail?: string;
  tone: SlotTone;
  span?: number;
};

type DockBoardProps = {
  docks: string[];
  hours: string[];
  slots: BoardSlot[];
};

export function DockBoard({ docks, hours, slots }: DockBoardProps) {
  return (
    <section className="board" aria-label="Dock schedule">
      <div className="board__head">
        <span className="board__title">Today</span>
        <span className="tag tag--quiet">Inbound</span>
        <span className="tag tag--quiet">Outbound</span>
        <div className="board__actions">
          <button className="btn btn--ghost" type="button"><Download size={14} />Export</button>
          <button className="btn btn--ghost" type="button"><Printer size={14} />Print</button>
          <button className="btn btn--quiet" type="button"><Maximize2 size={14} />Full screen</button>
        </div>
      </div>

      <div className="board__scroll">
        <div
          className="board__grid"
          style={{ gridTemplateColumns: `78px repeat(${hours.length}, minmax(58px, 1fr))` }}
        >
          <div className="board__corner" />
          {hours.map((hour) => <div className="board__hour" key={hour}>{hour}</div>)}

          {docks.map((dock) => (
            <BoardRow dock={dock} hours={hours} slots={slots.filter((slot) => slot.dock === dock)} key={dock} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BoardRow({ dock, hours, slots }: { dock: string; hours: string[]; slots: BoardSlot[] }) {
  return (
    <>
      <div className="board__dock">{dock}</div>
      {hours.map((hour) => {
        const slot = slots.find((item) => item.hour === hour);
        return (
          <div className="board__cell" key={`${dock}-${hour}`}>
            {slot && (
              <button
                className={`slot slot--${slot.tone}`}
                style={slot.span && slot.span > 1 ? { width: `calc(${slot.span * 100}% - 6px)` } : undefined}
                type="button"
                disabled={slot.tone === 'blocked'}
              >
                <span className="slot__ref">{slot.reference}</span>
                {slot.detail && <span className="slot__who">{slot.detail}</span>}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
