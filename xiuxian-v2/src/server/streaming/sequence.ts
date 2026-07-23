/**
 * Sequence allocator for SSE event ordering.
 * Generates contiguous monotonically-increasing sequence numbers starting at 0.
 */
export interface SequenceAllocator {
  /** Allocate and return the next sequence number */
  next(): number
  /** Return the current sequence number without incrementing */
  current(): number
}

export function createSequenceAllocator(): SequenceAllocator {
  let seq = 0

  return {
    next(): number {
      return seq++
    },
    current(): number {
      return seq - 1 >= 0 ? seq - 1 : 0
    },
  }
}
