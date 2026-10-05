export interface TaskRequestTicket {
  accepting: boolean
}

export class TaskRequestGuard {
  private current: TaskRequestTicket | undefined

  get pending(): boolean { return this.current !== undefined }

  begin(): TaskRequestTicket | undefined {
    if (this.current) return undefined
    const ticket = { accepting: true }
    this.current = ticket
    return ticket
  }

  accepts(ticket: TaskRequestTicket): boolean {
    return this.current === ticket && ticket.accepting
  }

  expire(ticket: TaskRequestTicket): void {
    ticket.accepting = false
  }

  stopAccepting(): void {
    if (this.current) this.expire(this.current)
  }

  finish(ticket: TaskRequestTicket): boolean {
    if (this.current !== ticket) return false
    this.current = undefined
    ticket.accepting = false
    return true
  }

  invalidate(): void {
    if (this.current) this.current.accepting = false
    this.current = undefined
  }
}
