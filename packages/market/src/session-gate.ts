import { supportsApiVersion } from '@dsh-eac/market-core/compatibility'

/** A handshake is bound to the official transport peer, never a client-supplied
 * identity. It is capability negotiation, not user consent or authentication.
 * Every UI write renegotiates, so expiry/reconnect cannot silently reuse a gate.
 */
export class ClientSessionGate {
  private readonly sessions = new Map<string, number>()

  constructor(private readonly protocol: string, private readonly now = Date.now) {}

  connect(peerId: string, clientProtocol: string): boolean {
    this.sessions.delete(peerId)
    if (!peerId || !supportsApiVersion(this.protocol, clientProtocol)) return false
    const now = this.now()
    for (const [peer, expires] of this.sessions) if (expires <= now) this.sessions.delete(peer)
    // Bound memory even when clients repeatedly reconnect without disposal.
    if (this.sessions.size >= 512) this.sessions.delete(this.sessions.keys().next().value!)
    this.sessions.set(peerId, now + 5 * 60_000)
    return true
  }

  assert(peerId: string): void {
    if ((this.sessions.get(peerId) ?? 0) <= this.now()) {
      this.sessions.delete(peerId)
      throw new Error('市场页面尚未完成兼容性确认或连接已变化，请刷新市场后重试。')
    }
  }
}
