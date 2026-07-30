// Which truck the run actually needs.
//
// Combining two loads is arithmetic on skids, and the answer is often "more than the truck
// that was booked holds". Until now both places that combine said so and stopped there —
// the booking wizard printed "4 over" in amber and let the person pick a time anyway, and
// the queue dialog said "keep one of the bigger trucks instead", which is advice, not an
// action. A 48 ft trailer four skids over is a 53 ft trailer, and the system knows that.
//
// So this works out the smallest truck at *this site* that holds the run. Per site, because
// skid capacity is set per site — the same trailer is stacked differently in different
// buildings — and a ladder invented from the trailer's length would be wrong wherever
// somebody double-stacks.
//
// It is deliberately not automatic. Changing the truck changes how long the load holds a
// door, which changes which times are free, and possibly which docks will take it. That is
// a decision with consequences a person should see, so this returns the offer and the two
// callers make it.

const capacityOf = truck => Number(truck?.skid_capacity || 0);

// truckTypes: [{ code, name, skid_capacity }] — the types enabled at this site, with the
// capacity entered for this site.
export function truckUpgrade(truckTypes, currentCode, skids) {
  const types = (truckTypes || []).filter(truck => capacityOf(truck) > 0);
  const current = types.find(truck => truck.code === currentCode) || null;
  const capacity = capacityOf(current);
  const wanted = Number(skids || 0);
  // No capacity entered for the booked truck is not "it fits" and not "it doesn't" — it is
  // a missing setting, and guessing either way would be worse than saying nothing.
  if (!capacity || wanted <= capacity) return null;

  const bigger = types
    .filter(truck => capacityOf(truck) > capacity)
    .sort((a, b) => capacityOf(a) - capacityOf(b));
  // The smallest one that *holds the run*, not simply the next one up: 26 → 48 is a step,
  // and a 34-skid run needs the step after it.
  const fits = bigger.find(truck => capacityOf(truck) >= wanted) || null;
  return {
    current,
    capacity,
    skids: wanted,
    over: wanted - capacity,
    // The truck to offer, or null when nothing at this site is big enough — in which case
    // the run has to be split, and the caller says so instead of offering a truck.
    fits,
    // What the site's largest trailer holds, so "even the biggest holds 26" can be said
    // with the number in it rather than as a shrug.
    biggest: bigger.at(-1) || current,
  };
}

// The sentence each caller shows. One wording, so the wizard and the queue dialog cannot
// drift into describing the same situation two different ways.
export function upgradeMessage(upgrade) {
  if (!upgrade) return '';
  const { over, skids, capacity, current, fits, biggest } = upgrade;
  const name = current?.name || 'this truck';
  if (fits) {
    return `${skids} skids is ${over} more than a ${name} holds (${capacity}). A ${fits.name} holds ${capacityOf(fits)} and takes the whole run.`;
  }
  return `${skids} skids is ${over} more than a ${name} holds (${capacity}), and the largest trailer at this site holds ${capacityOf(biggest)}. This run needs more than one truck — leave a load out and book it separately.`;
}
