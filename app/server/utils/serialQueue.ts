// Tasks that read a file, change it and write it back must not interleave, or the later write drops the
// earlier change. One queue per file, within this process.
export function serialQueue() {
  let pending: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = pending.then(task, task)
    pending = run.catch(() => undefined)
    return run
  }
}
