// One queue covers orders, menus and stock because these operations share data.
export function createMutationQueue() {
  let tail = Promise.resolve()
  return (work) => {
    const result = tail.then(work)
    tail = result.catch(() => {})
    return result
  }
}
