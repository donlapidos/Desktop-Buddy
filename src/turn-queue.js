// A correction cancels the old answer, then waits for its cleanup before starting the next one. Only the latest
// pending question starts, so rapid corrections cannot overlap a Brain's history, approvals, or desktop actions.
/** @param {{ stop: () => void }} ui */
export function createTurnQueue(ui) {
  let generation = 0;
  let pending = Promise.resolve();
  let count = 0;
  const superseded = () => ({ reply: null, superseded: true });
  function cancel() {
    generation++;
    if (count) ui.stop();
  }
  return {
    run(work) {
      cancel();
      const mine = generation;
      count++;
      const current = () => mine === generation;
      const result = pending.then(async () => {
        if (!current()) return superseded();
        const reply = await work(current);
        return current() ? reply : superseded();
      });
      pending = result.then(() => {}, () => {}).finally(() => { count--; });
      return result;
    },
    cancel,
    settled: () => pending,
  };
}
